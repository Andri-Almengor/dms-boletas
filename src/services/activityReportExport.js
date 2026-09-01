function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}

function detailText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

const DMS_REPORT_THEME = Object.freeze({
  red: '#8F0913',
  redStrong: '#B90D19',
  redSoft: '#FFF1F2',
  ink: '#111827',
  muted: '#6B7280',
  line: '#D1D5DB',
  soft: '#F8FAFC',
  success: '#166534',
  warning: '#92400E',
  danger: '#991B1B',
});

export function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

function fileBase(report) {
  const from = clean(report?.filters?.dateFrom, 'inicio');
  const to = clean(report?.filters?.dateTo, 'hoy');
  return `DMS_Reporte_Actividad_${from}_${to}`.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function reportDateTime(value) {
  return new Date(value || Date.now()).toLocaleString('es-CR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function filterDescription(report) {
  const filters = report?.filters || {};
  const users = (report?.selectedUsers || []).map((user) => user.name).join(', ') || 'Todos';
  const sections = (filters.sections || []).join(', ') || 'Toda la aplicación';
  const dates = `${filters.dateFrom || 'sin límite'} a ${filters.dateTo || 'sin límite'}`;
  const hours = filters.timeFrom || filters.timeTo
    ? `${filters.timeFrom || '00:00'} a ${filters.timeTo || '23:59'}`
    : 'Todo el día';
  return { users, sections, dates, hours };
}

function summaryMetrics(report) {
  const summary = report?.summary || {};
  return [
    ['Acciones', summary.actions || 0],
    ['Tiempo activo', formatDuration(summary.pageTimeSeconds)],
    ['Boletas', summary.ticketsTouched || 0],
    ['Mantenimientos', summary.maintenancesTouched || 0],
    ['Dispositivos', summary.devicesTouched || 0],
    ['Agenda', summary.agendaItems || 0],
  ];
}

function wordTable(headers, rows, options = {}) {
  const body = rows.map((row, index) => {
    const rowClass = options.rowClass?.(row, index) || (index % 2 ? 'row-alt' : '');
    return `<tr class="${escapeHtml(rowClass)}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function wordDocument(report) {
  const filters = filterDescription(report);
  const pageRows = (report.pageSummary || []).map((row) => [
    row.userName,
    row.section,
    row.view || row.route || '—',
    formatDuration(row.durationSeconds),
    row.visits,
  ]);
  const activityRows = (report.timeline || []).map((row) => [
    row.dateTimeLabel,
    row.userName,
    row.section,
    row.view || '',
    row.action,
    row.entity || '',
    row.entityId || '',
    row.result,
    row.priority || '',
    detailText(row.detail),
  ]);
  const agendaRows = (report.agenda || []).map((row) => [
    row.date,
    `${row.startTime} - ${row.endTime}`,
    row.detail,
    row.status,
    row.ticketUid ? `Sí (${row.ticketUid})` : 'No',
    row.assigned.map((user) => user.userName).join(', '),
  ]);
  const summaryCards = summaryMetrics(report)
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Reporte de actividad DMS</title>
<style>
  @page{size:A4;margin:16mm 13mm 16mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:${DMS_REPORT_THEME.ink};font-size:9.5pt;margin:0}
  .report-header{background:${DMS_REPORT_THEME.red};color:#fff;padding:18px 20px;margin:0 0 16px}
  .brand{font-size:8.5pt;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;opacity:.88}
  h1{font-size:22pt;line-height:1.05;margin:5px 0 4px;color:#fff}
  .subtitle{font-size:10pt;margin:0;opacity:.92}
  .meta-grid{display:table;width:100%;border-collapse:separate;border-spacing:7px 5px;margin:0 0 12px}
  .meta-row{display:table-row}
  .meta-cell{display:table-cell;width:50%;padding:9px 10px;background:${DMS_REPORT_THEME.soft};border:1px solid #e5e7eb;border-radius:5px;vertical-align:top}
  .meta-cell span{display:block;color:${DMS_REPORT_THEME.muted};font-size:7.8pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
  .meta-cell strong{font-size:9.5pt}
  .summary-title{font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:${DMS_REPORT_THEME.muted};font-weight:700;margin:13px 0 6px}
  .metrics{display:table;width:100%;table-layout:fixed;border-collapse:separate;border-spacing:5px}
  .metric{display:table-cell;text-align:center;background:${DMS_REPORT_THEME.redSoft};border-top:3px solid ${DMS_REPORT_THEME.redStrong};padding:9px 4px}
  .metric span{display:block;color:${DMS_REPORT_THEME.muted};font-size:7.5pt;margin-bottom:4px}
  .metric strong{font-size:12pt;color:${DMS_REPORT_THEME.red}}
  .coverage{margin:13px 0 18px;padding:10px 12px;background:#fffbeb;border-left:4px solid #d97706;color:#78350f;font-size:8.7pt;line-height:1.45}
  h2{page-break-after:avoid;margin:21px 0 7px;padding:7px 10px;background:${DMS_REPORT_THEME.red};color:#fff;font-size:12pt}
  .section-note{color:${DMS_REPORT_THEME.muted};font-size:8.5pt;margin:0 0 8px}
  .table-wrap{width:100%;overflow:visible}
  table{border-collapse:collapse;width:100%;font-size:7.8pt;margin:0 0 15px;page-break-inside:auto}
  thead{display:table-header-group}
  tr{page-break-inside:avoid;page-break-after:auto}
  th{background:#1f2937;color:#fff;text-align:left;font-weight:700}
  th,td{border:1px solid ${DMS_REPORT_THEME.line};padding:5px 6px;vertical-align:top;line-height:1.35;word-break:break-word}
  tr.row-alt td{background:${DMS_REPORT_THEME.soft}}
  tr.high-priority td{background:#fff7ed}
  tr.high-priority td:first-child{border-left:4px solid #ea580c}
  .empty{padding:12px;border:1px dashed ${DMS_REPORT_THEME.line};background:${DMS_REPORT_THEME.soft};color:${DMS_REPORT_THEME.muted}}
  .footer-note{margin-top:18px;padding-top:7px;border-top:1px solid ${DMS_REPORT_THEME.line};font-size:7.5pt;color:${DMS_REPORT_THEME.muted}}
</style>
</head>
<body>
  <div class="report-header">
    <div class="brand">Digital Management Systems · DMS Boletas</div>
    <h1>Reporte de actividad</h1>
    <p class="subtitle">Trazabilidad de uso, acciones operativas y agenda</p>
  </div>

  <div class="meta-grid">
    <div class="meta-row">
      <div class="meta-cell"><span>Generado</span><strong>${escapeHtml(reportDateTime(report.generatedAt))}</strong></div>
      <div class="meta-cell"><span>Periodo</span><strong>${escapeHtml(filters.dates)} · ${escapeHtml(filters.hours)}</strong></div>
    </div>
    <div class="meta-row">
      <div class="meta-cell"><span>Personas</span><strong>${escapeHtml(filters.users)}</strong></div>
      <div class="meta-cell"><span>Secciones</span><strong>${escapeHtml(filters.sections)}</strong></div>
    </div>
  </div>

  <div class="summary-title">Resumen ejecutivo</div>
  <div class="metrics">${summaryCards}</div>
  <div class="coverage"><strong>Cobertura del reporte:</strong> ${escapeHtml(report?.coverage?.note || 'Sin observaciones de cobertura.')}</div>

  <h2>Tiempo por pestaña / vista</h2>
  <p class="section-note">Tiempo activo medido por persona y vista. Los periodos de inactividad no se contabilizan.</p>
  ${pageRows.length ? wordTable(['Persona','Sección','Pestaña / ruta','Tiempo','Registros'], pageRows) : '<div class="empty">Sin datos de permanencia para el periodo.</div>'}

  <h2>Actividad completa</h2>
  <p class="section-note">Línea de tiempo ordenada cronológicamente. Las filas resaltadas corresponden a actividad de alta prioridad.</p>
  ${activityRows.length
    ? wordTable(['Fecha y hora','Persona','Sección','Vista','Acción','Entidad','ID','Resultado','Prioridad','Detalle'], activityRows, {
      rowClass: (row, index) => String(row[8] || '').toUpperCase() === 'ALTA' ? 'high-priority' : (index % 2 ? 'row-alt' : ''),
    })
    : '<div class="empty">Sin actividad para los filtros seleccionados.</div>'}

  <h2>Agenda</h2>
  <p class="section-note">Programación prevista para las personas incluidas en el reporte.</p>
  ${agendaRows.length ? wordTable(['Fecha','Hora','Destino / detalle','Estado','Boleta','Asignados'], agendaRows) : '<div class="empty">Sin agendas para los filtros seleccionados.</div>'}

  <div class="footer-note">DMS Boletas · Reporte generado automáticamente. La actividad histórica previa a la telemetría exacta depende de la información disponible en Auditoría.</div>
</body>
</html>`;
}

function excelCell(value, style = 'Data') {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function worksheet(name, headers, rows, options = {}) {
  const widths = options.widths || headers.map(() => 95);
  const columns = widths.map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${Math.max(45, Number(width || 95))}"/>`).join('');
  const header = `<Row ss:Height="24">${headers.map((value) => excelCell(value, 'TableHeader')).join('')}</Row>`;
  const body = rows.map((row, index) => {
    const style = options.rowStyle?.(row, index) || (index % 2 ? 'DataAlt' : 'Data');
    return `<Row>${row.map((value) => excelCell(value, style)).join('')}</Row>`;
  }).join('');
  const autoFilter = headers.length ? `<AutoFilter x:Range="R1C1:R${Math.max(1, rows.length + 1)}C${headers.length}" xmlns="urn:schemas-microsoft-com:office:excel"/>` : '';
  return `<Worksheet ss:Name="${escapeXml(name).slice(0, 31)}">
    <Table>${columns}${header}${body}</Table>
    ${autoFilter}
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane>
      <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
    </WorksheetOptions>
  </Worksheet>`;
}

function overviewWorksheet(report, filters) {
  const summary = report.summary || {};
  const rows = [
    ['REPORTE DE ACTIVIDAD DMS BOLETAS', ''],
    ['Generado', reportDateTime(report.generatedAt)],
    ['Personas', filters.users],
    ['Periodo', filters.dates],
    ['Horario', filters.hours],
    ['Secciones', filters.sections],
    ['', ''],
    ['RESUMEN EJECUTIVO', ''],
    ['Acciones', summary.actions || 0],
    ['Tiempo activo', formatDuration(summary.pageTimeSeconds)],
    ['Boletas tocadas', summary.ticketsTouched || 0],
    ['Mantenimientos tocados', summary.maintenancesTouched || 0],
    ['Dispositivos tocados', summary.devicesTouched || 0],
    ['Agendas', summary.agendaItems || 0],
    ['', ''],
    ['COBERTURA DEL REPORTE', report?.coverage?.note || ''],
  ];
  const body = rows.map((row, index) => {
    let style = 'Data';
    if (index === 0) style = 'ReportTitle';
    else if (index === 7 || index === 15) style = 'SectionTitle';
    else if (index >= 8 && index <= 13) style = 'Summary';
    else if (index % 2) style = 'DataAlt';
    return `<Row ss:Height="${index === 0 ? 32 : 21}">${row.map((value) => excelCell(value, style)).join('')}</Row>`;
  }).join('');
  return `<Worksheet ss:Name="Resumen">
    <Table><Column ss:Width="145"/><Column ss:Width="420"/>${body}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>
  </Worksheet>`;
}

function excelDocument(report) {
  const filters = filterDescription(report);
  const activity = (report.timeline || []).map((row) => [
    row.date,
    row.time,
    row.userName,
    row.section,
    row.view || '',
    row.uiRoute || '',
    row.action,
    row.entity || '',
    row.entityId || '',
    row.result,
    row.priority,
    detailText(row.detail),
    row.source,
  ]);
  const pages = (report.pageSummary || []).map((row) => [
    row.userName,
    row.section,
    row.route,
    row.view || '',
    formatDuration(row.durationSeconds),
    Math.round(row.durationSeconds),
    row.visits,
  ]);
  const agenda = (report.agenda || []).map((row) => [
    row.date,
    row.startTime,
    row.endTime,
    row.detail,
    row.status,
    row.requiresTicket ? 'Sí' : 'No',
    row.ticketUid || '',
    row.assigned.map((user) => user.userName).join(', '),
  ]);
  const entities = (report.entitySummary || []).map((row) => [
    row.userName,
    row.section,
    row.entity,
    row.entityId,
    row.actions.join(', '),
    row.firstAt,
    row.lastAt,
  ]);

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Arial" ss:Size="9"/></Style>
    <Style ss:ID="ReportTitle"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="${DMS_REPORT_THEME.red}" ss:Pattern="Solid"/></Style>
    <Style ss:ID="SectionTitle"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="${DMS_REPORT_THEME.redStrong}" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TableHeader"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F2937" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#9CA3AF"/></Borders></Style>
    <Style ss:ID="Data"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style>
    <Style ss:ID="DataAlt"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="${DMS_REPORT_THEME.soft}" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style>
    <Style ss:ID="HighPriority"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="#FFF7ED" ss:Pattern="Solid"/><Font ss:Color="#7C2D12"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#EA580C"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FED7AA"/></Borders></Style>
    <Style ss:ID="Summary"><Font ss:Bold="1" ss:Color="${DMS_REPORT_THEME.red}"/><Interior ss:Color="${DMS_REPORT_THEME.redSoft}" ss:Pattern="Solid"/></Style>
  </Styles>
  ${overviewWorksheet(report, filters)}
  ${worksheet('Actividad', ['Fecha','Hora','Persona','Sección','Vista','Ruta','Acción','Entidad','ID','Resultado','Prioridad','Detalle','Fuente'], activity, {
    widths: [76,55,120,100,115,150,105,100,105,75,65,280,85],
    rowStyle: (row, index) => String(row[10] || '').toUpperCase() === 'ALTA' ? 'HighPriority' : (index % 2 ? 'DataAlt' : 'Data'),
  })}
  ${worksheet('Tiempo por pestaña', ['Persona','Sección','Ruta','Vista','Tiempo','Segundos','Registros'], pages, {
    widths: [120,105,180,135,90,70,70],
  })}
  ${worksheet('Agenda', ['Fecha','Inicio','Fin','Detalle','Estado','Requiere boleta','BoletaUID','Asignados'], agenda, {
    widths: [75,55,55,320,90,90,155,190],
  })}
  ${worksheet('Objetos tocados', ['Persona','Sección','Entidad','ID','Acciones','Primera actividad','Última actividad'], entities, {
    widths: [120,105,115,130,240,125,125],
  })}
</Workbook>`;
}

function pdfEscape(value) {
  const normalized = String(value ?? '').normalize('NFC');
  const mapping = new Map([
    ['á',225],['é',233],['í',237],['ó',243],['ú',250],['Á',193],['É',201],['Í',205],['Ó',211],['Ú',218],['ñ',241],['Ñ',209],['ü',252],['Ü',220],['¿',191],['¡',161],['°',176],['–',150],['—',151],['“',147],['”',148],['‘',145],['’',146],['•',149],['€',128],
  ]);
  let out = '';
  for (const ch of normalized) {
    const code = ch.charCodeAt(0);
    let byte = code <= 255 ? code : mapping.get(ch);
    if (byte == null) byte = 63;
    if (byte === 40 || byte === 41 || byte === 92) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

function wrapLine(value, width = 92) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  });
  if (line) lines.push(line);
  return lines;
}

function pdfBlocks(report) {
  const filters = filterDescription(report);
  const summary = report.summary || {};
  const blocks = [
    { type: 'meta', text: `Generado: ${reportDateTime(report.generatedAt)}` },
    { type: 'meta', text: `Personas: ${filters.users}` },
    { type: 'meta', text: `Periodo: ${filters.dates} · ${filters.hours}` },
    { type: 'meta', text: `Secciones: ${filters.sections}` },
    { type: 'summary', text: `Acciones ${summary.actions || 0}   |   Tiempo activo ${formatDuration(summary.pageTimeSeconds)}   |   Boletas ${summary.ticketsTouched || 0}` },
    { type: 'summary', text: `Mantenimientos ${summary.maintenancesTouched || 0}   |   Dispositivos ${summary.devicesTouched || 0}   |   Agenda ${summary.agendaItems || 0}` },
    { type: 'note', text: `Cobertura: ${report?.coverage?.note || 'Sin observaciones de cobertura.'}` },
    { type: 'section', text: 'TIEMPO POR PESTAÑA / VISTA' },
  ];

  if (!(report.pageSummary || []).length) {
    blocks.push({ type: 'empty', text: 'Sin datos de permanencia para el periodo.' });
  } else {
    (report.pageSummary || []).forEach((row) => {
      blocks.push({
        type: 'table',
        text: `${row.userName}  |  ${row.section}  |  ${row.view || row.route || 'Sin vista'}  |  ${formatDuration(row.durationSeconds)}  |  ${row.visits || 0} registro(s)`,
      });
    });
  }

  blocks.push({ type: 'section', text: 'ACTIVIDAD COMPLETA' });
  if (!(report.timeline || []).length) {
    blocks.push({ type: 'empty', text: 'Sin actividad para los filtros seleccionados.' });
  } else {
    (report.timeline || []).forEach((row) => {
      blocks.push({
        type: String(row.priority || '').toUpperCase() === 'ALTA' ? 'activityHigh' : 'activity',
        text: `${row.dateTimeLabel}  |  ${row.userName}  |  ${row.section}${row.view ? ` / ${row.view}` : ''}  |  ${row.action}  |  ${row.entity || ''}${row.entityId ? ` #${row.entityId}` : ''}  |  ${row.result}`,
      });
      const detail = detailText(row.detail);
      if (detail) blocks.push({ type: 'detail', text: `Detalle: ${detail}` });
    });
  }

  blocks.push({ type: 'section', text: 'AGENDA' });
  if (!(report.agenda || []).length) {
    blocks.push({ type: 'empty', text: 'Sin agendas para los filtros seleccionados.' });
  } else {
    (report.agenda || []).forEach((row) => {
      blocks.push({
        type: 'table',
        text: `${row.date} ${row.startTime}-${row.endTime}  |  ${row.detail}  |  ${row.status}  |  Asignados: ${row.assigned.map((user) => user.userName).join(', ')}${row.ticketUid ? `  |  Boleta: ${row.ticketUid}` : ''}`,
      });
    });
  }
  return blocks;
}

function pdfStyle(type) {
  const styles = {
    meta: { font: 'F1', size: 8.8, leading: 11.5, color: '0.07 0.09 0.13', width: 94, before: 2, indent: 0 },
    summary: { font: 'F2', size: 9, leading: 12, color: '0.56 0.04 0.07', width: 94, before: 2, indent: 0, background: '1 0.95 0.95' },
    note: { font: 'F1', size: 8.2, leading: 11, color: '0.45 0.23 0.04', width: 94, before: 7, indent: 0, background: '1 0.98 0.92' },
    section: { font: 'F2', size: 10.5, leading: 14, color: '1 1 1', width: 88, before: 11, indent: 0, background: '0.56 0.04 0.07' },
    table: { font: 'F1', size: 8, leading: 10.5, color: '0.07 0.09 0.13', width: 98, before: 2, indent: 4 },
    activity: { font: 'F2', size: 8, leading: 10.5, color: '0.07 0.09 0.13', width: 98, before: 3, indent: 4 },
    activityHigh: { font: 'F2', size: 8, leading: 10.5, color: '0.49 0.18 0.04', width: 98, before: 3, indent: 4, background: '1 0.97 0.93', accent: '0.92 0.35 0.05' },
    detail: { font: 'F1', size: 7.4, leading: 9.8, color: '0.34 0.38 0.45', width: 100, before: 0, indent: 14 },
    empty: { font: 'F1', size: 8.2, leading: 11, color: '0.42 0.45 0.50', width: 96, before: 4, indent: 4 },
  };
  return styles[type] || styles.table;
}

function pdfText(commandList, text, x, y, style) {
  commandList.push('BT');
  commandList.push(`/${style.font} ${style.size} Tf`);
  commandList.push(`${style.color} rg`);
  commandList.push(`${x} ${y} Td`);
  commandList.push(`(${pdfEscape(text)}) Tj`);
  commandList.push('ET');
}

function pdfHeaderBand(commands, pageNumber, generatedAt) {
  commands.push('q 0.56 0.04 0.07 rg 0 792 595 50 re f Q');
  pdfText(commands, 'DMS BOLETAS', 42, 819, { font: 'F2', size: 8.5, color: '1 1 1' });
  pdfText(commands, 'Reporte de actividad', 42, 801, { font: 'F2', size: 17, color: '1 1 1' });
  commands.push('q 0.88 0.89 0.91 RG 42 43 m 553 43 l S Q');
  pdfText(commands, `Generado ${reportDateTime(generatedAt)}  ·  Página ${pageNumber}`, 42, 28, { font: 'F1', size: 7.2, color: '0.42 0.45 0.50' });
}

function pdfBlob(report) {
  const blocks = pdfBlocks(report);
  const pageStreams = [];
  let commands = [];
  let pageNumber = 1;
  let y = 766;
  pdfHeaderBand(commands, pageNumber, report.generatedAt);

  function newPage() {
    pageStreams.push(commands.join('\n'));
    commands = [];
    pageNumber += 1;
    y = 766;
    pdfHeaderBand(commands, pageNumber, report.generatedAt);
  }

  blocks.forEach((block) => {
    const style = pdfStyle(block.type);
    const lines = wrapLine(block.text, style.width);
    const blockHeight = style.before + (lines.length * style.leading) + (style.background ? 4 : 0);
    if (y - blockHeight < 58) newPage();
    y -= style.before;

    if (style.background) {
      const height = lines.length * style.leading + 5;
      commands.push(`q ${style.background} rg 38 ${y - height + 4} 519 ${height} re f Q`);
    }
    if (style.accent) {
      const height = lines.length * style.leading + 5;
      commands.push(`q ${style.accent} rg 38 ${y - height + 4} 3 ${height} re f Q`);
    }

    lines.forEach((line) => {
      pdfText(commands, line, 42 + style.indent, y, style);
      y -= style.leading;
    });
    if (style.background) y -= 4;
  });

  pageStreams.push(commands.join('\n'));

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageIds = pageStreams.map((_, index) => 5 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pageStreams.forEach((stream, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function exportActivityReport(report, format = 'PDF') {
  const type = clean(format, 'PDF').toUpperCase();
  const base = fileBase(report);
  if (type === 'WORD' || type === 'DOC') {
    downloadBlob(
      new Blob(['\ufeff', wordDocument(report)], { type: 'application/msword;charset=utf-8' }),
      `${base}.doc`,
    );
    return;
  }
  if (type === 'EXCEL' || type === 'XLS') {
    downloadBlob(
      new Blob(['\ufeff', excelDocument(report)], { type: 'application/vnd.ms-excel;charset=utf-8' }),
      `${base}.xls`,
    );
    return;
  }
  downloadBlob(pdfBlob(report), `${base}.pdf`);
}
