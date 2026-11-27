import { Readable } from 'node:stream';
import { deflateSync, crc32 } from 'node:zlib';
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
    responsibleLabel: [...new Set(all.map((row) => text(row.creador)).filter((name) => name && name !== 'Sin responsable'))].sort((a, b) => a.localeCompare(b, 'es')).join(', '),
    evidenceCount: Number(data.totals.evidencias || 0),
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
  border: '#cfd3dc', ok: '#12805e', danger: '#bc1421', pending: '#89919e',
  paleGreen: '#e7f6ec', paleRed: '#fde9eb', paleGray: '#f2f3f6',
  amber: '#a56605',
});

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return text(value);
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

// The chart is generated locally; client metrics are never sent to an external
// chart service. A PNG is used because Docs does not preserve CSS conic gradients.
function pngChunk(type, data) {
  const tag = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, checksum]);
}

export function buildHealthDonutPng(model) {
  const size = 160;
  const rgba = Buffer.alloc(size * (1 + size * 4));
  const ratio = model.evaluated ? model.healthy / model.evaluated : 0;
  const green = [18, 128, 94];
  const red = [188, 20, 33];
  const gray = [207, 211, 220];
  // Supersampling keeps the ring smooth in print, including 0 and 100%.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0];
      let covered = 0;
      for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
        const sx = x + dx - size / 2;
        const sy = y + dy - size / 2;
        const radius = Math.hypot(sx, sy);
        if (radius < 47 || radius > 76) continue;
        const angle = (Math.atan2(sx, -sy) + 2 * Math.PI) % (2 * Math.PI);
        const color = !model.evaluated ? gray : angle < ratio * 2 * Math.PI ? green : red;
        covered++;
        color.forEach((value, index) => { sums[index] += value; });
      }
      const offset = y * (1 + size * 4) + 1 + x * 4;
      if (covered) sums.forEach((value, index) => { rgba[offset + index] = Math.round(value / covered); });
      rgba[offset + 3] = Math.round(255 * covered / 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rgba)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sectionBand(title) {
  return `<table class="section-band" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin:9pt 0 5pt"><tr>
    <td bgcolor="${VISUAL.red}" width="76%" style="background-color:${VISUAL.red};color:#ffffff;padding:5pt 8pt;font-size:12pt;font-weight:bold"><b>${html(title)}</b></td>
    <td bgcolor="#e7e8eb" style="background-color:#e7e8eb;border-top:2pt solid ${VISUAL.red};font-size:1pt">&nbsp;</td>
  </tr></table>`;
}

function metricTile(title, count, color) {
  return `<td width="25%" bgcolor="#f6f7f9" valign="middle" style="background-color:#f6f7f9;border:1px solid ${VISUAL.border};padding:8pt 4pt;text-align:center">
    <p style="margin:0 0 4pt;color:${VISUAL.muted};font-size:9pt"><b>${html(title)}</b></p>
    <p style="margin:0;color:${color};font-size:23pt"><b>${html(count)}</b></p>
  </td>`;
}

function barSegment(value, total, background) {
  if (!value || !total) return '';
  const width = Math.max(0.1, Math.round(value / total * 1000) / 10);
  return `<td width="${width}%" bgcolor="${background}" style="background-color:${background};padding:3pt 0;color:white;text-align:center;font-size:8pt"><b>${value}</b></td>`;
}

function stackedBar(values, total) {
  if (!total) return '<p style="color:#89919e">Sin datos evaluados</p>';
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse">
    <tr>${barSegment(values.sanos, total, VISUAL.ok)}${barSegment(values.danados, total, VISUAL.danger)}${barSegment(values.sinEvaluar || 0, total, VISUAL.pending)}</tr>
  </table>`;
}

function categoryChart(item) {
  return `<tr>
    <td style="padding:3pt;font-size:8pt"><b>${html(item.categoria)}</b></td>
    <td width="45%" style="padding:3pt">${stackedBar(item, item.total)}</td>
    <td align="right" style="padding:3pt;font-size:8pt"><b>${item.total}</b></td>
    <td align="right" style="padding:3pt;font-size:8pt;color:${VISUAL.danger}"><b>${item.danados}</b></td>
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
  const completion = model.total ? Math.round(100 * model.evaluated / model.total) : 0;
  const categories = model.categories.map(categoryChart).join('')
    || '<tr><td colspan="4">No hay dispositivos registrados.</td></tr>';
  const rows = model.rows.map(detailRow).join('')
    || '<tr><td colspan="6">No hay dispositivos para el filtro seleccionado.</td></tr>';
  const filterTitle = model.filter === 'todos' ? 'Detalle de todos los dispositivos'
    : model.filter === 'sanos' ? 'Dispositivos en buen estado' : 'Dispositivos con fallas';
  const generatedAt = new Intl.DateTimeFormat('es-CR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Costa_Rica',
  }).format(new Date());
  const title = html(model.client || 'Cliente sin nombre');
  const maintenance = html(model.maintenanceLabel || 'No especificado');
  const site = model.siteLabel
    ? `<p style="margin:3pt 0"><b>Sitio:</b> ${html(model.siteLabel)}</p>` : '';
  const donut = buildHealthDonutPng(model).toString('base64');
  const pct = (value) => model.evaluated ? `${Math.round(value * 1000 / model.evaluated) / 10}%` : '—';

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>${title} · Resumen visual del estado del sistema · DMS</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#202126;font-size:10pt;line-height:1.25}
      h1{font-size:23pt;color:#930b16;margin:0} p{margin:4pt 0}
      table{border-collapse:collapse}
      .data-grid{width:100%;border-collapse:collapse}
      .data-grid th{background-color:#24262e;color:white;font-size:8pt;padding:5pt;text-align:left;border:1px solid #cfd3dc}
      .data-grid td{padding:5pt;border:1px solid #d9dce3;font-size:8pt;vertical-align:top;word-wrap:break-word;white-space:pre-wrap}
      .keep{page-break-inside:avoid}
      .data-grid thead{display:table-header-group}
      .data-grid tr{page-break-inside:avoid}
    </style>
    </head><body>
    <p style="margin:0;font-size:1pt">&nbsp;</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td align="left" valign="middle" style="padding:0 0 3pt"><img src="${DMS_LOGO_URL}" alt="DMS Solutions Provider" width="142" height="80"></td>
      <td align="right" valign="middle" style="font-size:9pt;color:${VISUAL.muted}"><b>REPORTE DE MANTENIMIENTO</b></td>
    </tr><tr><td bgcolor="${VISUAL.red}" height="4" style="background-color:${VISUAL.red};font-size:1pt">&nbsp;</td><td bgcolor="#e7e8eb" style="background-color:#e7e8eb;border-top:2pt solid ${VISUAL.red};font-size:1pt">&nbsp;</td></tr></table>
    <h1>${title}</h1>
    <p style="font-size:15pt;color:#636b79;margin:1pt 0 8pt"><b>Informe de mantenimiento</b></p>
    <table width="100%" cellpadding="7" cellspacing="0" class="keep" role="presentation">
      <tr><td width="50%" bgcolor="#f6f7f9" valign="top" style="background-color:#f6f7f9;border:1px solid ${VISUAL.border};font-size:9pt">
        <p style="margin:3pt 0"><b>Fecha del informe:</b> ${html(generatedAt)}</p>
        <p style="margin:3pt 0"><b>Fecha mantenimiento:</b> ${html(formatDate(model.date))}</p>
        <p style="margin:3pt 0"><b>Mantenimiento:</b> ${maintenance}</p>
        ${site}
      </td><td bgcolor="#f6f7f9" valign="top" style="background-color:#f6f7f9;border:1px solid ${VISUAL.border};font-size:9pt">
        <p style="margin:3pt 0"><b>Responsables / Técnicos:</b> ${html(model.responsibleLabel || 'Sin responsable registrado')}</p>
        <p style="margin:3pt 0"><b>Total de dispositivos:</b> ${model.total}</p>
        <p style="margin:3pt 0"><b>Evidencias:</b> ${model.evidenceCount}</p>
        <p style="margin:3pt 0"><b>Salud general:</b> ${html(healthText)}</p>
      </td></tr>
    </table>
    ${sectionBand('Resumen general')}
    <table width="100%" cellpadding="5" cellspacing="0" role="presentation" class="keep"><tr>
      ${metricTile('Total dispositivos', model.total, VISUAL.ink)}
      ${metricTile('En buen estado', model.healthy, VISUAL.ok)}
      ${metricTile('Dispositivos dañados', model.damaged, VISUAL.danger)}
      ${metricTile('Salud general', healthText, healthColor)}
    </tr></table>
    <p style="font-size:9pt;color:${VISUAL.muted}">Evaluados: <b>${model.evaluated}</b> · Sin evaluar: <b>${model.pending}</b> · Cobertura de evaluación: <b>${completion}%</b>.</p>
    <table width="100%" cellpadding="5" cellspacing="0" role="presentation"><tr>
      <td width="42%" valign="top" style="border:1px solid ${VISUAL.border}">
        ${sectionBand('Salud del sistema')}
        <table width="100%" role="presentation" cellpadding="3"><tr>
          <td width="46%" align="center" valign="middle">
            <img src="data:image/png;base64,${donut}" alt="Gráfico de salud del sistema" width="108" height="108">
            <p style="font-size:21pt;color:${healthColor};margin:1pt 0"><b>${html(healthText)}</b></p>
          </td>
          <td valign="middle" style="font-size:9pt">
            <p style="color:${VISUAL.ok}"><b>Buenos:</b> ${model.healthy} (${pct(model.healthy)})</p>
            <p style="color:${VISUAL.danger}"><b>Con fallas:</b> ${model.damaged} (${pct(model.damaged)})</p>
            <p style="color:${VISUAL.muted}">Sin evaluar: ${model.pending}</p>
          </td></tr></table>
        ${stackedBar({ sanos: model.healthy, danados: model.damaged }, model.evaluated)}
        <p style="font-size:8pt;color:${VISUAL.muted}">Salud = equipos sanos / equipos evaluados.</p>
      </td>
      <td width="58%" valign="top" style="border:1px solid ${VISUAL.border}">
        ${sectionBand('Distribución por tipo de dispositivo')}
        <p style="font-size:8pt;color:${VISUAL.muted}"><span style="color:${VISUAL.ok}">● Buenos</span> · <span style="color:${VISUAL.danger}">● Dañados</span> · ● Sin evaluar</p>
        <table width="100%" cellpadding="3" cellspacing="0" style="border-collapse:collapse">
          <tr bgcolor="#e7e8eb" style="background-color:#e7e8eb;font-size:8pt"><th>Tipo</th><th>Distribución</th><th>Total</th><th>Fallas</th></tr>
          ${categories}
        </table>
      </td></tr></table>
    ${sectionBand(filterTitle)}
    <p style="font-size:8pt;color:${VISUAL.muted}">${model.rows.length} dispositivos incluidos. Prioridad: Crítica → Moderada → Leve → Sin clasificar → Sanos → Sin evaluar.</p>
    <table class="data-grid" width="100%" cellpadding="5" cellspacing="0">
      <thead><tr>
        <th width="19%">Dispositivo / Responsable</th><th width="12%">Tipo</th><th width="15%">Ubicación</th>
        <th width="12%">Estado</th><th width="10%">Funcionamiento</th><th width="32%">Observaciones</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${sectionBand('Recomendaciones')}
    <table width="100%" cellpadding="10" cellspacing="0" role="presentation"><tr>
      <td bgcolor="#f6f7f9" style="background-color:#f6f7f9;border:1px solid ${VISUAL.border}">
        <p style="font-size:10pt;color:${VISUAL.muted}"><i>Escriba aquí las recomendaciones del mantenimiento...</i></p>
        <p>&nbsp;</p><p>&nbsp;</p>
      </td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:12pt"><tr>
      <td bgcolor="${VISUAL.red}" height="4" style="background-color:${VISUAL.red};font-size:1pt">&nbsp;</td>
    </tr></table>
    <p align="right" style="font-size:8pt;color:${VISUAL.muted}">DMS Solutions Provider · Documento editable en Google Docs</p>
    </body></html>`;
}

/**
 * El importador HTML de Drive no garantiza CSS circular ni imágenes remotas.
 * Se fija A4 vertical y se comprueba la presencia del logo mediante Docs API.
 * Si la conversión omite el PNG corporativo se inserta usando su URL pública.
 * El contenido, tablas y recomendaciones siguen siendo editables.
 */
export async function finalizeMaintenanceVisualDoc({ docsApi, documentId }) {
  const doc = await docsApi.documents.get({
    documentId,
    fields: 'inlineObjects',
  });
  const embedded = Object.values(doc.data?.inlineObjects || {});
  // El gráfico puede ser la única imagen conservada por Drive. No confundirlo con el logo.
  const logoImported = embedded.some((object) => {
    const image = object.inlineObjectProperties?.embeddedObject;
    const source = image?.imageProperties?.sourceUri || '';
    const alt = [image?.title, image?.description].filter(Boolean).join(' ');
    const width = image?.size?.width?.magnitude;
    const height = image?.size?.height?.magnitude;
    return source === DMS_LOGO_URL || /DMS Solutions Provider/i.test(alt)
      || (Number(width) > Number(height) * 1.4);
  });
  const requests = [{
    updateDocumentStyle: {
      documentStyle: {
        pageSize: {
          width: { magnitude: 595.3, unit: 'PT' },
          height: { magnitude: 841.9, unit: 'PT' },
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
    // Garantizar formato vertical y logo real antes de otorgar el acceso.
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
