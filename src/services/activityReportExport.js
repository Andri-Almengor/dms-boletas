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

function filterDescription(report) {
  const filters = report?.filters || {};
  const users = (report?.selectedUsers || []).map((user) => user.name).join(', ') || 'Todos';
  const sections = (filters.sections || []).join(', ') || 'Toda la aplicación';
  const dates = `${filters.dateFrom || 'sin límite'} a ${filters.dateTo || 'sin límite'}`;
  const hours = filters.timeFrom || filters.timeTo ? `${filters.timeFrom || '00:00'} a ${filters.timeTo || '23:59'}` : 'Todo el día';
  return { users, sections, dates, hours };
}

function wordTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function wordDocument(report) {
  const filters = filterDescription(report);
  const summary = report.summary || {};
  const pageRows = (report.pageSummary || []).map((row) => [row.userName, row.section, row.view || row.route || '—', formatDuration(row.durationSeconds), row.visits]);
  const activityRows = (report.timeline || []).map((row) => [row.dateTimeLabel, row.userName, row.section, row.view || '', row.action, row.entity || '', row.entityId || '', row.result, detailText(row.detail)]);
  const agendaRows = (report.agenda || []).map((row) => [row.date, `${row.startTime} - ${row.endTime}`, row.detail, row.status, row.ticketUid ? `Sí (${row.ticketUid})` : 'No', row.assigned.map((user) => user.userName).join(', ')]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte de actividad DMS</title><style>
    body{font-family:Arial,sans-serif;color:#111827;font-size:10pt}h1{color:#8f0913;font-size:22pt}h2{margin-top:22px;color:#8f0913;font-size:14pt}p{line-height:1.45}.summary{display:block;margin:12px 0;padding:12px;background:#fff5f5;border-left:5px solid #b90d19}.summary b{display:inline-block;margin-right:18px}table{border-collapse:collapse;width:100%;font-size:8.5pt;margin:8px 0 18px}th{background:#b90d19;color:white;text-align:left}th,td{border:1px solid #d1d5db;padding:5px;vertical-align:top}.note{color:#6b7280;font-size:9pt}</style></head><body>
    <h1>Reporte de actividad DMS Boletas</h1>
    <p><strong>Generado:</strong> ${escapeHtml(new Date(report.generatedAt || Date.now()).toLocaleString('es-CR'))}<br>
    <strong>Personas:</strong> ${escapeHtml(filters.users)}<br><strong>Periodo:</strong> ${escapeHtml(filters.dates)} · ${escapeHtml(filters.hours)}<br><strong>Secciones:</strong> ${escapeHtml(filters.sections)}</p>
    <div class="summary"><b>Acciones: ${summary.actions || 0}</b><b>Tiempo activo: ${escapeHtml(formatDuration(summary.pageTimeSeconds))}</b><b>Boletas: ${summary.ticketsTouched || 0}</b><b>Mantenimientos: ${summary.maintenancesTouched || 0}</b><b>Dispositivos: ${summary.devicesTouched || 0}</b><b>Agenda: ${summary.agendaItems || 0}</b></div>
    <p class="note">${escapeHtml(report?.coverage?.note || '')}</p>
    <h2>Tiempo por pestaña / vista</h2>${pageRows.length ? wordTable(['Persona','Sección','Pestaña / ruta','Tiempo','Registros'], pageRows) : '<p>Sin datos de permanencia para el periodo.</p>'}
    <h2>Actividad completa</h2>${activityRows.length ? wordTable(['Fecha y hora','Persona','Sección','Vista','Acción','Entidad','ID','Resultado','Detalle'], activityRows) : '<p>Sin actividad para los filtros seleccionados.</p>'}
    <h2>Agenda</h2>${agendaRows.length ? wordTable(['Fecha','Hora','Destino / detalle','Estado','Boleta','Asignados'], agendaRows) : '<p>Sin agendas para los filtros seleccionados.</p>'}
  </body></html>`;
}

function worksheet(name, headers, rows) {
  const rowXml = [headers, ...rows].map((row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join('')}</Row>`).join('');
  return `<Worksheet ss:Name="${escapeXml(name).slice(0, 31)}"><Table>${rowXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>`;
}

function excelDocument(report) {
  const filters = filterDescription(report);
  const summary = report.summary || {};
  const overview = [
    ['Reporte', 'Actividad DMS Boletas'],
    ['Generado', new Date(report.generatedAt || Date.now()).toLocaleString('es-CR')],
    ['Personas', filters.users],
    ['Periodo', filters.dates],
    ['Horario', filters.hours],
    ['Secciones', filters.sections],
    ['Acciones', summary.actions || 0],
    ['Tiempo activo', formatDuration(summary.pageTimeSeconds)],
    ['Boletas tocadas', summary.ticketsTouched || 0],
    ['Mantenimientos tocados', summary.maintenancesTouched || 0],
    ['Dispositivos tocados', summary.devicesTouched || 0],
    ['Agendas', summary.agendaItems || 0],
    ['Cobertura', report?.coverage?.note || ''],
  ];
  const activity = (report.timeline || []).map((row) => [row.date, row.time, row.userName, row.section, row.view || '', row.uiRoute || '', row.action, row.entity || '', row.entityId || '', row.result, row.priority, detailText(row.detail), row.source]);
  const pages = (report.pageSummary || []).map((row) => [row.userName, row.section, row.route, row.view || '', formatDuration(row.durationSeconds), Math.round(row.durationSeconds), row.visits]);
  const agenda = (report.agenda || []).map((row) => [row.date, row.startTime, row.endTime, row.detail, row.status, row.requiresTicket ? 'Sí' : 'No', row.ticketUid || '', row.assigned.map((user) => user.userName).join(', ')]);
  const entities = (report.entitySummary || []).map((row) => [row.userName, row.section, row.entity, row.entityId, row.actions.join(', '), row.firstAt, row.lastAt]);
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    ${worksheet('Resumen', ['Campo','Valor'], overview)}
    ${worksheet('Actividad', ['Fecha','Hora','Persona','Sección','Vista','Ruta','Acción','Entidad','ID','Resultado','Prioridad','Detalle','Fuente'], activity)}
    ${worksheet('Tiempo por pestaña', ['Persona','Sección','Ruta','Vista','Tiempo','Segundos','Registros'], pages)}
    ${worksheet('Agenda', ['Fecha','Inicio','Fin','Detalle','Estado','Requiere boleta','BoletaUID','Asignados'], agenda)}
    ${worksheet('Objetos tocados', ['Persona','Sección','Entidad','ID','Acciones','Primera actividad','Última actividad'], entities)}
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

function wrapLine(value, width = 105) {
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

function reportPdfLines(report) {
  const filters = filterDescription(report);
  const summary = report.summary || {};
  const lines = [
    'REPORTE DE ACTIVIDAD DMS BOLETAS',
    `Generado: ${new Date(report.generatedAt || Date.now()).toLocaleString('es-CR')}`,
    `Personas: ${filters.users}`,
    `Periodo: ${filters.dates} | Horario: ${filters.hours}`,
    `Secciones: ${filters.sections}`,
    `Acciones: ${summary.actions || 0} | Tiempo activo: ${formatDuration(summary.pageTimeSeconds)} | Boletas: ${summary.ticketsTouched || 0} | Mantenimientos: ${summary.maintenancesTouched || 0} | Dispositivos: ${summary.devicesTouched || 0} | Agenda: ${summary.agendaItems || 0}`,
    '',
    `Cobertura: ${report?.coverage?.note || ''}`,
    '',
    'TIEMPO POR PESTAÑA / VISTA',
  ];
  (report.pageSummary || []).forEach((row) => {
    lines.push(`${row.userName} | ${row.section} | ${row.view || row.route || 'Sin vista'} | ${formatDuration(row.durationSeconds)}`);
  });
  lines.push('', 'ACTIVIDAD COMPLETA');
  (report.timeline || []).forEach((row) => {
    const head = `${row.dateTimeLabel} | ${row.userName} | ${row.section}${row.view ? ` / ${row.view}` : ''} | ${row.action} | ${row.entity || ''}${row.entityId ? ` #${row.entityId}` : ''} | ${row.result}`;
    lines.push(head);
    const detail = detailText(row.detail);
    if (detail) lines.push(`  Detalle: ${detail}`);
  });
  lines.push('', 'AGENDA');
  (report.agenda || []).forEach((row) => {
    lines.push(`${row.date} ${row.startTime}-${row.endTime} | ${row.detail} | ${row.status} | Asignados: ${row.assigned.map((user) => user.userName).join(', ')}${row.ticketUid ? ` | Boleta: ${row.ticketUid}` : ''}`);
  });
  return lines.flatMap((line) => wrapLine(line));
}

function pdfBlob(report) {
  const lines = reportPdfLines(report);
  const linesPerPage = 58;
  const pages = [];
  for (let offset = 0; offset < lines.length; offset += linesPerPage) pages.push(lines.slice(offset, offset + linesPerPage));
  if (!pages.length) pages.push(['Reporte sin datos.']);

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = ['BT', '/F1 8 Tf', '42 800 Td', '11 TL'];
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex) commands.push('T*');
      commands.push(`(${pdfEscape(line)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
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
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function exportActivityReport(report, format = 'PDF') {
  const type = clean(format, 'PDF').toUpperCase();
  const base = fileBase(report);
  if (type === 'WORD' || type === 'DOC') {
    downloadBlob(new Blob(['\ufeff', wordDocument(report)], { type: 'application/msword;charset=utf-8' }), `${base}.doc`);
    return;
  }
  if (type === 'EXCEL' || type === 'XLS') {
    downloadBlob(new Blob(['\ufeff', excelDocument(report)], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${base}.xls`);
    return;
  }
  downloadBlob(pdfBlob(report), `${base}.pdf`);
}
