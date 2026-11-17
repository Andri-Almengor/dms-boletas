import { Readable } from 'node:stream';
import { AppError } from '../core/errors.js';
import { driveApi } from '../infra/google.js';
import { trashFile } from '../infra/drive.repository.js';
import { resolveBaseFolderId } from './maintenance-presentation.service.js';

const DMS_LOGO_URL = 'https://raw.githubusercontent.com/Andri-Almengor/dms-boletas/main/src/assets/dms-report-logo.png';
export const VISUAL_REPORT_FILTERS = Object.freeze(['todos', 'sanos', 'danados']);

function text(value) { return String(value ?? '').trim(); }
function normalized(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function html(value) {
  return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function visualDeviceState(row = {}) {
  const estado = normalized(row.estado);
  const severity = normalized(row.gravedadFalla);
  const damaged = estado === 'mal estado' || row.averiado === true;
  const healthy = !damaged && (row.operativo === true || ['buen estado', 'correcto', 'en buen estado'].includes(estado));
  return {
    kind: damaged ? 'danado' : healthy ? 'sano' : 'sin_evaluar',
    severity: damaged && severity === 'critica' ? 'Crítica'
      : damaged && severity === 'moderada' ? 'Moderada'
        : damaged && severity === 'leve' ? 'Leve' : (damaged ? 'Sin clasificar' : ''),
    rank: damaged ? (severity === 'critica' ? 0 : severity === 'moderada' ? 1 : severity === 'leve' ? 2 : 3)
      : healthy ? 4 : 5,
  };
}

// El resumen y los gráficos siempre utilizan TODOS los equipos evaluados para
// cliente/fecha; el selector afecta solo a la tabla, no a la salud del sistema.
export function buildMaintenanceVisualReportModel(data, filter = 'todos') {
  if (!VISUAL_REPORT_FILTERS.includes(filter)) throw new AppError('INVALID_REPORT_FILTER', 'Seleccione todos, solo buenos o solo dañados.', 400);
  if (!Array.isArray(data?.detailRows) || data.reportDetailCount !== data.detailRows.length
    || data.detailRows.length !== data?.totals?.dispositivosFiltrados) {
    throw new AppError('INCOMPLETE_VISUAL_REPORT', 'Los dispositivos del informe llegaron incompletos. No se generó el documento.', 502);
  }
  const all = data.detailRows.map((row) => ({ ...row, salud: visualDeviceState(row) }));
  const healthy = all.filter((row) => row.salud.kind === 'sano').length;
  const damaged = all.filter((row) => row.salud.kind === 'danado').length;
  const pending = all.length - healthy - damaged;
  const evaluated = healthy + damaged;
  const byCategory = new Map();
  all.forEach((row) => {
    const key = text(row.categoria) || 'Sin categoría';
    if (!byCategory.has(key)) byCategory.set(key, { categoria: key, total: 0, sanos: 0, danados: 0, sinEvaluar: 0 });
    const category = byCategory.get(key);
    category.total += 1;
    if (row.salud.kind === 'sano') category.sanos += 1;
    else if (row.salud.kind === 'danado') category.danados += 1;
    else category.sinEvaluar += 1;
  });
  const rows = all.filter((row) => filter === 'todos' || (filter === 'sanos' ? row.salud.kind === 'sano' : row.salud.kind === 'danado'))
    .sort((a, b) => a.salud.rank - b.salud.rank
      || a.categoria.localeCompare(b.categoria, 'es')
      || a.zona.localeCompare(b.zona, 'es')
      || a.nombreDispositivo.localeCompare(b.nombreDispositivo, 'es'));
  return {
    client: text(data.filtersApplied.cliente),
    date: text(data.filtersApplied.fecha),
    filter,
    rows,
    total: all.length,
    healthy,
    damaged,
    pending,
    evaluated,
    health: evaluated ? Math.round(healthy * 1000 / evaluated) / 10 : null,
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'es')),
  };
}

function barSegment(value, total, background) {
  if (!value || !total) return '';
  const width = Math.max(1, Math.round(100 * value / total));
  return `<td bgcolor="${background}" width="${width}%" style="background-color:${background};font-size:10px;color:#ffffff;text-align:center;padding:6px 1px"><b>${value}</b></td>`;
}

function categoryChart(item) {
  return `<tr><td style="padding:5px 7px;font-size:10px"><b>${html(item.categoria)}</b></td>
    <td><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${barSegment(item.sanos, item.total, '#12805e')}
    ${barSegment(item.danados, item.total, '#bc1421')}
    ${barSegment(item.sinEvaluar, item.total, '#90949d')}
    </tr></table></td><td align="right" style="padding:5px 7px"><b>${item.total}</b></td>
    <td align="right" style="padding:5px 7px;color:#bc1421">${item.danados}</td></tr>`;
}

function statusChip(row) {
  const state = row.salud;
  const color = state.kind === 'sano' ? '#12805e' : state.kind === 'sin_evaluar' ? '#777777'
    : state.severity === 'Crítica' ? '#ae0c19' : state.severity === 'Moderada' ? '#b66d0c' : '#986d08';
  const label = state.kind === 'sano' ? 'Sano' : state.kind === 'sin_evaluar' ? 'Sin evaluar' : state.severity;
  return `<b style="color:${color}">${html(label)}</b>`;
}

export function buildMaintenanceVisualReportHtml(model) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(model.date)
    ? model.date.split('-').reverse().join('/') : model.date;
  const healthText = model.health === null ? 'Sin evaluaciones' : `${model.health}%`;
  const healthColor = model.health === null ? '#777777' : model.health >= 80 ? '#12805e' : model.health >= 50 ? '#b66d0c' : '#bc1421';
  const chartRows = model.categories.map(categoryChart).join('');
  const tableRows = model.rows.map((row) => `<tr>
    <td>${html(row.nombreDispositivo)}</td><td>${html(row.categoria)}</td><td>${html(row.zona)}</td>
    <td>${statusChip(row)}</td><td>${html(row.funcionamiento)}</td>
    <td>${html(row.creador)}</td><td>${html(row.observacion || 'Sin observaciones')}</td>
  </tr>`).join('');
  const label = model.filter === 'todos' ? 'Todos los dispositivos'
    : model.filter === 'sanos' ? 'Solo equipos en buen estado' : 'Solo equipos dañados';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <style>body{font-family:Arial,Helvetica,sans-serif;color:#202126;font-size:10pt}
    h1{font-size:23pt;color:#17191d;margin:8px 0}h2{font-size:14pt;color:#a90b19;margin:22px 0 8px}
    table{border-collapse:collapse}th,td{vertical-align:top}p{line-height:1.4}
    .grid th{background-color:#25272f;color:#ffffff;padding:9px}
    .grid td{border-bottom:1px solid #e4e4e8;padding:7px;font-size:9pt}
    .tile{border:1px solid #dedee4;background-color:#f7f7f9;padding:10px}
    .tile b{font-size:22pt}.sub{color:#646774}
    </style></head><body>
    <table width="100%"><tr><td bgcolor="#24262d" style="background-color:#24262d;color:white;padding:12px">
    <img src="${DMS_LOGO_URL}" alt="DMS Solutions Provider" width="154" height="86"></td>
    <td bgcolor="#b90d19" align="right" style="background-color:#b90d19;color:#ffffff;padding:12px"><b>INFORME COMPLETO DE MANTENIMIENTO</b></td></tr></table>
    <h1>Estado de salud del sistema</h1><p class="sub"><b>Cliente:</b> ${html(model.client)}
    &nbsp; | &nbsp; <b>Fecha de mantenimiento:</b> ${html(date)} &nbsp; | &nbsp; <b>Generado:</b> ${html(new Date().toLocaleDateString('es-CR',{timeZone:'America/Costa_Rica'}))}</p>
    <h2>01 · Resumen general</h2>
    <table width="100%" cellpadding="8"><tr>
    <td class="tile" align="center">Total dispositivos<br><b>${model.total}</b></td>
    <td class="tile" align="center">En buen estado<br><b style="color:#12805e">${model.healthy}</b></td>
    <td class="tile" align="center">Dañados<br><b style="color:#bc1421">${model.damaged}</b></td>
    <td class="tile" align="center">Sin evaluar<br><b style="color:#777777">${model.pending}</b></td>
    </tr></table>
    <h2>02 · Salud del sistema</h2>
    <table width="100%" cellpadding="10"><tr>
    <td width="31%" bgcolor="#f6f7f9" align="center"><span style="color:${healthColor};font-size:34pt"><b>${healthText}</b></span><br><b>Salud general</b></td>
    <td><b>Salud = dispositivos sanos / dispositivos evaluados.</b><br>
    ${model.healthy} sanos de ${model.evaluated} evaluados (${model.damaged} dañados).
    ${model.pending ? `${model.pending} pendientes o sin datos se excluyen del porcentaje.` : 'Todos los dispositivos cuentan con evaluación.'}
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${barSegment(model.healthy, model.evaluated, '#12805e')}
    ${barSegment(model.damaged, model.evaluated, '#bc1421')}
    </tr></table></td></tr></table>
    <h2>03 · Distribución por tipo de dispositivo</h2>
    <p style="color:#646774">■ Verde: sanos &nbsp; ■ Rojo: dañados &nbsp; ■ Gris: sin evaluar. Se muestran todos los tipos registrados.</p>
    <table class="grid" width="100%"><tr><th width="25%">Tipo</th><th>Distribución visual</th><th>Total</th><th>Dañados</th></tr>${chartRows}</table>
    <h2>04 · Detalle de dispositivos · ${html(label)}</h2>
    <p>${model.rows.length} equipo(s), ordenados por prioridad: Crítica → Moderada → Leve → Sin clasificar → Sanos → Sin evaluar.</p>
    <table class="grid" width="100%"><tr><th>Dispositivo</th><th>Tipo</th><th>Ubicación</th><th>Prioridad</th><th>Funcionamiento</th><th>Responsable</th><th>Observación</th></tr>
    ${tableRows || '<tr><td colspan="7">No hay dispositivos para este filtro.</td></tr>'}</table>
    <h2>05 · Recomendaciones</h2>
    <p>Complete y edite esta sección en Google Docs, de acuerdo con los hallazgos del mantenimiento.</p>
    <p style="color:#6f7480"><i>Escriba aquí las recomendaciones del mantenimiento...</i></p>
    <p>&nbsp;</p><p>&nbsp;</p>
    <p style="color:#888888">DMS Solutions Provider · Informe editable</p>
    </body></html>`;
}

export async function createMaintenanceVisualDocs({ model, actor }) {
  const email = text(actor?.Correo || actor?.Email || actor?.CorreoElectronico || actor?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('REPORT_USER_EMAIL_MISSING', 'Su usuario necesita un correo válido para conceder acceso de edición al documento.', 400);
  }
  const folderId = await resolveBaseFolderId();
  const documentName = `DMS - Salud de mantenimiento - ${model.client} - ${model.date} - ${model.filter}`.slice(0, 190);
  const content = buildMaintenanceVisualReportHtml(model);
  let documentId = '';
  try {
    const { data } = await driveApi.files.create({
      requestBody: { name: documentName, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
      media: { mimeType: 'text/html', body: Readable.from([Buffer.from(content, 'utf8')]) },
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: true,
    });
    documentId = text(data?.id);
    if (!documentId || data?.mimeType !== 'application/vnd.google-apps.document') {
      throw new AppError('REPORT_DOCS_CONVERSION_FAILED', 'Drive no pudo convertir el informe a Google Docs editable.', 502);
    }
    await driveApi.permissions.create({
      fileId: documentId,
      requestBody: { type: 'user', role: 'writer', emailAddress: email },
      sendNotificationEmail: false,
      supportsAllDrives: true,
      fields: 'id',
    });
    return { docsId: documentId, docsUrl: `https://docs.google.com/document/d/${documentId}/edit`, devices: model.rows.length };
  } catch (error) {
    if (documentId) await trashFile(documentId).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError('MAINTENANCE_DOCS_GENERATION_FAILED', 'Falló la creación del Google Docs o la asignación del permiso de edición en Drive.', 502);
  }
}
