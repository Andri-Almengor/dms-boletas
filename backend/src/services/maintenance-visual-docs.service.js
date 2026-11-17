import { Readable } from 'node:stream';
import { AppError } from '../core/errors.js';

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
  const visits = Array.isArray(data.reportContext?.mantenimientos)
    ? data.reportContext.mantenimientos : [];
  const sites = [...new Set(visits.map((visit) => text(visit.ubicacion)).filter(Boolean))];
  const maintenanceLabel = visits.length === 1
    ? text(visits[0].titulo || visits[0].id)
    : visits.length > 1 ? `${visits.length} mantenimientos` : '';
  const siteLabel = sites.length === 1 ? sites[0] : sites.length > 1 ? 'Varias ubicaciones' : '';
  return {
    client: text(data.filtersApplied.cliente),
    date: text(data.filtersApplied.fecha),
    maintenanceLabel,
    siteLabel,
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


// Google Docs convierte CSS moderno de forma parcial; los colores, tamaños y
// bordes esenciales se indican también inline en tablas editables.
const VISUAL = Object.freeze({
  red: '#b90d19', darkRed: '#930b16', ink: '#1d2028', muted: '#636b79',
  border: '#e2e3e8', ok: '#12805e', danger: '#bc1421', pending: '#89919e',
  paleGreen: '#e7f6ec', paleRed: '#fde9eb', paleGray: '#f2f3f6',
  amber: '#a56605',
});

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return text(value);
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function metricTile(title, count, color, background, symbol) {
  return `<td width="25%" bgcolor="${background}" valign="top" style="background-color:${background};border:1px solid ${VISUAL.border};padding:13px 12px;text-align:center">
    <p style="margin:0 0 5px;color:${color};font-size:11pt"><b>${symbol} ${html(title)}</b></p>
    <p style="margin:0;color:${color};font-size:25pt"><b>${html(count)}</b></p>
  </td>`;
}

function barSegment(value, total, background) {
  if (!value || !total) return '';
  const width = Math.max(0.1, Math.round(value / total * 1000) / 10);
  return `<td width="${width}%" bgcolor="${background}" style="background-color:${background};padding:5px 0;color:white;text-align:center;font-size:9pt">
    <b>${value}</b>
  </td>`;
}

function stackedBar(values, total) {
  if (!total) return '<p style="color:#89919e">Sin datos evaluados</p>';
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse">
    <tr>${barSegment(values.sanos, total, VISUAL.ok)}${barSegment(values.danados, total, VISUAL.danger)}${barSegment(values.sinEvaluar || 0, total, VISUAL.pending)}</tr>
  </table>`;
}

function categoryChart(item) {
  return `<tr>
    <td><b>${html(item.categoria)}</b></td>
    <td width="52%">${stackedBar(item, item.total)}</td>
    <td align="right"><b>${item.total}</b></td>
    <td align="right" style="color:${VISUAL.danger}"><b>${item.danados}</b></td>
  </tr>`;
}

function statusChip(row) {
  const state = row.salud;
  const color = state.kind === 'sano' ? VISUAL.ok : state.kind === 'sin_evaluar' ? '#616977'
    : state.severity === 'Crítica' ? VISUAL.darkRed
      : state.severity === 'Moderada' ? VISUAL.amber : '#8b6608';
  const background = state.kind === 'sano' ? VISUAL.paleGreen
    : state.kind === 'sin_evaluar' ? VISUAL.paleGray
      : state.severity === 'Crítica' ? VISUAL.paleRed : '#fff1d3';
  const label = state.kind === 'sano' ? 'Sano' : state.kind === 'sin_evaluar'
    ? 'Sin evaluar' : state.severity;
  return `<span style="display:inline-block;border-radius:14px;padding:4px 8px;background-color:${background};color:${color};font-weight:bold">${html(label)}</span>`;
}

function detailRow(row, index) {
  const background = index % 2 ? '#f8f9fb' : '#ffffff';
  return `<tr bgcolor="${background}" style="background-color:${background}">
    <td><b>${html(row.nombreDispositivo)}</b><br><small style="color:${VISUAL.muted}">${html(row.creador || 'Sin responsable')}</small></td>
    <td>${html(row.categoria)}</td>
    <td>${html(row.zona)}</td>
    <td>${statusChip(row)}</td>
    <td>${html(row.funcionamiento || 'Sin dato')}</td>
    <td>${html(row.observacion || 'Sin observaciones')}</td>
  </tr>`;
}

// Se conserva el modelo y los filtros anteriores: esta función solo da formato
// a los datos que el backend ya autorizó y verificó (sin truncar las filas).
export function buildMaintenanceVisualReportHtml(model) {
  const healthText = model.health === null ? 'Sin evaluación' : `${model.health}%`;
  const healthColor = model.health === null ? VISUAL.pending
    : model.health >= 80 ? VISUAL.ok : model.health >= 50 ? VISUAL.amber : VISUAL.danger;
  const completion = model.evaluated ? Math.round(100 * model.evaluated / model.total) : 0;
  const categories = model.categories.map(categoryChart).join('')
    || '<tr><td colspan="4">No hay dispositivos registrados en este mantenimiento.</td></tr>';
  const rows = model.rows.map(detailRow).join('')
    || '<tr><td colspan="6">No hay dispositivos para el filtro seleccionado.</td></tr>';
  const filterTitle = model.filter === 'todos' ? 'Todos los dispositivos'
    : model.filter === 'sanos' ? 'Solo dispositivos sanos' : 'Solo dispositivos dañados';
  const generatedAt = new Intl.DateTimeFormat('es-CR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Costa_Rica',
  }).format(new Date());
  // Nunca sustituir el nombre del cliente por un título genérico de informe.
  const title = html(model.client || 'Cliente sin nombre');
  const maintenance = html(model.maintenanceLabel || 'No especificado');
  const site = model.siteLabel
    ? `<p style="margin:3px 0;font-size:9pt"><b>Sitio:</b> ${html(model.siteLabel)}</p>` : '';
  const ringAngle = model.health === null ? 0 : Math.max(0, Math.min(360, model.health * 3.6));

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>${title} · Resumen visual del estado del sistema · DMS</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1d2028;font-size:10pt;line-height:1.3}
      h1{font-size:25pt;color:#1d2028;margin:0} h2{font-size:14pt;color:#1d2028;margin:15px 0 7px}
      p{margin:5px 0} table{border-collapse:collapse}
      .data-grid{width:100%;border-collapse:collapse}
      .data-grid th{background-color:#b90d19;color:white;font-size:9pt;padding:8px;text-align:left}
      .data-grid td{padding:7px;border-bottom:1px solid #e2e3e8;font-size:9pt;vertical-align:top;word-wrap:break-word}
      .keep{page-break-inside:avoid}
    </style>
    </head><body>
    <!-- Reserva una posición válida para insertar el logo mediante Docs API cuando
         el importador HTML omite la imagen externa. -->
    <p style="margin:0;font-size:1pt">&nbsp;</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 14px">
      <tr><td bgcolor="#22252b" width="34%" style="background-color:#22252b;padding:8px 13px">
        <img src="${DMS_LOGO_URL}" alt="DMS Solutions Provider" width="142" height="80">
      </td><td bgcolor="#b90d19" align="right" style="background-color:#b90d19;color:white;padding:12px">
        <p style="font-size:12pt;color:white;margin:0"><b>REPORTE DE MANTENIMIENTO</b></p>
        <p style="font-size:9pt;color:white;margin:4px 0 0">DMS SOLUTIONS PROVIDER</p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 15px">
      <tr>
        <td width="64%" valign="top" style="padding:0 15px 0 0">
          <h1>${title}</h1>
          <p style="font-size:13pt;color:#636b79;margin:4px 0 9px"><b>Resumen visual del estado del sistema</b></p>
          <table width="72" cellpadding="0" cellspacing="0" role="presentation"><tr><td bgcolor="#b90d19" height="4" style="background-color:#b90d19">&nbsp;</td></tr></table>
        </td>
        <td valign="top" style="border-left:2px solid #e2e3e8;padding:0 0 0 12px">
          <p style="margin:3px 0;font-size:9pt"><b>Fecha del informe:</b> ${html(generatedAt)}</p>
          <p style="margin:3px 0;font-size:9pt"><b>Fecha mantenimiento:</b> ${html(formatDate(model.date))}</p>
          <p style="margin:3px 0;font-size:9pt"><b>Mantenimiento:</b> ${maintenance}</p>
          ${site}
        </td>
      </tr>
    </table>
    <h2 style="margin:14px 0 8px;border-left:4px solid #b90d19;padding-left:9px">▥ Resumen general</h2>
    <table width="100%" cellpadding="5" cellspacing="0" role="presentation" class="keep">
      <tr>
        ${metricTile('Total dispositivos', model.total, VISUAL.ink, VISUAL.paleGray, '▣')}
        ${metricTile('En buen estado', model.healthy, VISUAL.ok, VISUAL.paleGreen, '✓')}
        ${metricTile('Dispositivos dañados', model.damaged, VISUAL.danger, VISUAL.paleRed, '⚠')}
        ${metricTile('Salud general', healthText, healthColor, '#fff3f3', '♥')}
      </tr>
    </table>
    <table width="100%" cellpadding="8" cellspacing="0" role="presentation" style="margin:8px 0 12px">
      <tr><td width="40%" valign="top" style="border:1px solid #e2e3e8">
        <h2 style="margin:2px 0 10px;border-left:4px solid #b90d19;padding-left:8px">♥ Salud del sistema</h2>
        <table width="100%" role="presentation"><tr>
          <td width="45%" align="center" valign="middle">
            <div style="display:inline-block;background:conic-gradient(${healthColor} ${ringAngle}deg,#e7e8ec 0deg);border-radius:50%;padding:11px">
              <div style="background-color:white;border-radius:50%;padding:19px 11px">
                <span style="font-size:27pt;color:${healthColor}"><b>${html(healthText)}</b></span>
              </div>
            </div>
            <p style="font-size:25pt;color:${healthColor};margin:3px 0"><b>${html(healthText)}</b></p>
          </td>
          <td valign="middle"><p style="font-size:9pt;color:#454d59"><b>Salud general del sistema</b></p>
            <p style="font-size:9pt">${model.healthy} sanos de ${model.evaluated} evaluados.</p>
            <p style="font-size:8pt;color:#636b79">${model.damaged} dañados · ${model.pending} sin evaluar.</p>
          </td></tr></table>
        ${stackedBar({ sanos: model.healthy, danados: model.damaged }, model.evaluated)}
        <p style="font-size:8pt;color:#636b79">Salud = equipos sanos / equipos evaluados. El ${completion}% del inventario tiene evaluación.</p>
      </td>
      <td width="60%" valign="top" style="border:1px solid #e2e3e8">
        <h2 style="margin:2px 0 9px;border-left:4px solid #b90d19;padding-left:8px">▥ Dispositivos por tipo</h2>
        <p style="font-size:8pt;color:#636b79">● Verde: sanos &nbsp; ● Rojo: dañados &nbsp; ● Gris: sin evaluar</p>
        <table class="data-grid" width="100%">
          <tr><th>Tipo</th><th>Distribución visual</th><th>Total</th><th>Dañados</th></tr>
          ${categories}
        </table>
      </td></tr>
    </table>
    <h2 style="margin:15px 0 6px;border-left:4px solid #b90d19;padding-left:8px">⚠ Detalle de dispositivos · ${html(filterTitle)}</h2>
    <p style="font-size:9pt;color:#636b79">${model.rows.length} dispositivos incluidos. Prioridad: Crítica → Moderada → Leve → Sin clasificar → Sanos → Sin evaluar.</p>
    <table class="data-grid" width="100%">
      <thead><tr>
        <th width="17%">Dispositivo</th><th width="13%">Tipo</th><th width="16%">Ubicación</th>
        <th width="13%">Estado</th><th width="12%">Falla</th><th width="29%">Observación</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2 style="margin:18px 0 9px;border-left:4px solid #b90d19;padding-left:8px">✎ Recomendaciones</h2>
    <table width="100%" cellpadding="12" cellspacing="0" role="presentation" style="border:1px solid #bc1421">
      <tr><td style="border:1px solid #bc1421">
        <p style="font-size:10pt;color:#636b79"><i>Escriba aquí las recomendaciones del mantenimiento...</i></p>
        <p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:18px"><tr>
      <td bgcolor="#b90d19" height="7" style="background-color:#b90d19;font-size:5px">&nbsp;</td>
    </tr></table>
    <p align="right" style="font-size:8pt;color:#636b79">DMS Solutions Provider · Documento editable en Google Docs</p>
    </body></html>`;
}

/**
 * El importador HTML de Drive no garantiza CSS circular ni imágenes remotas.
 * Se fija A4 horizontal y se comprueba la presencia del logo mediante Docs API.
 * Si la conversión omite el PNG corporativo se inserta usando su URL pública.
 * El contenido, tablas y recomendaciones siguen siendo editables.
 */
export async function finalizeMaintenanceVisualDoc({ docsApi, documentId }) {
  const doc = await docsApi.documents.get({
    documentId,
    fields: 'inlineObjects',
  });
  const logoImported = Object.keys(doc.data?.inlineObjects || {}).length > 0;
  const requests = [{
    updateDocumentStyle: {
      documentStyle: {
        pageSize: {
          width: { magnitude: 841.9, unit: 'PT' },
          height: { magnitude: 595.3, unit: 'PT' },
        },
        marginTop: { magnitude: 28, unit: 'PT' },
        marginBottom: { magnitude: 28, unit: 'PT' },
        marginLeft: { magnitude: 30, unit: 'PT' },
        marginRight: { magnitude: 30, unit: 'PT' },
      },
      fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight',
    },
  }];
  if (!logoImported) {
    requests.push({
      insertInlineImage: {
        uri: DMS_LOGO_URL,
        location: { index: 1 },
        objectSize: {
          width: { magnitude: 122, unit: 'PT' },
          height: { magnitude: 68, unit: 'PT' },
        },
      },
    });
  }
  await docsApi.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
  return { logoImported, logoRestored: !logoImported };
}

export async function createMaintenanceVisualDocs({ model, actor }) {
  const email = text(actor?.Correo || actor?.Email || actor?.CorreoElectronico || actor?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('REPORT_USER_EMAIL_MISSING', 'Su usuario necesita un correo válido para conceder acceso de edición al documento.', 400);
  }
  // Las APIs de Google se cargan solo al ejecutar la acción; las pruebas puras
  // y el dashboard no dependen de credenciales de Google al importarse.
  const [{ driveApi, docsApi }, { trashFile }, { resolveBaseFolderId }] = await Promise.all([
    import('../infra/google.js'),
    import('../infra/drive.repository.js'),
    import('./maintenance-presentation.service.js'),
  ]);
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
    // Garantizar formato apaisado y logo real antes de otorgar el acceso.
    await finalizeMaintenanceVisualDoc({ docsApi, documentId });
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
