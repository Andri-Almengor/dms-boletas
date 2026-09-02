import {
  exportActivityReport as exportTechnicalActivityReport,
  formatDuration,
} from './activityReportExport';

export { formatDuration };

const TIME_ZONE = 'America/Costa_Rica';
const SECTION_LABELS = Object.freeze({
  INICIO: 'Inicio',
  AGENDA: 'Agenda',
  BOLETAS: 'Boletas',
  MANTENIMIENTOS: 'Mantenimientos',
  DISPOSITIVOS: 'Dispositivos de mantenimiento',
  CASOS: 'Casos de clientes',
  CLIENTES: 'Clientes',
  CREDENCIALES: 'Credenciales',
  CATALOGOS: 'Catálogos',
  USUARIOS: 'Usuarios',
  CONOCIMIENTO: 'Base de conocimientos',
  ASISTENTE: 'Asistente DMS',
  METRICAS: 'Métricas y reportes',
  ENCUESTAS: 'Encuestas',
  INTEGRACIONES: 'Integraciones',
  ADMINISTRACION: 'Administración',
  OTROS: 'Otras secciones',
});

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function humanSection(value) {
  const key = clean(value, 'OTROS').toUpperCase();
  return SECTION_LABELS[key] || key.charAt(0) + key.slice(1).toLowerCase();
}

function humanDate(value) {
  const raw = clean(value);
  if (!raw) return '';
  const source = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('es-CR', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: TIME_ZONE,
  });
}

function reportDateTime(value) {
  return new Date(value || Date.now()).toLocaleString('es-CR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE,
  });
}

function naturalJoin(items = []) {
  const values = items.map((item) => clean(item)).filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
}

function isUuidLike(value) {
  const text = clean(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    || (text.includes(',') && text.split(',').filter(Boolean).every((part) => /^[0-9a-f-]{30,}$/i.test(part.trim())));
}

function friendlyId(value) {
  const text = clean(value);
  return !text || text.length > 50 || isUuidLike(text) ? '' : text;
}

function actionKind(row = {}) {
  const type = clean(row.type).toUpperCase();
  const text = `${row.action || ''} ${row.actionRoute || ''}`.toUpperCase();
  if (type === 'PAGE_TIME') return 'TIME';
  if (['PAGE_VIEW', 'UI_TAB', 'APP_VISIBILITY'].includes(type)) return 'NAVIGATION';
  if (/LISTAR|CONSULTAR|\.LIST|\.GET|VER_|ABRIR/.test(text)) return 'READ';
  if (/CREAR|CREATE|AGREGAR|ADD|SUBIR|UPLOAD|NUEV/.test(text)) return 'CREATE';
  if (/EDITAR|UPDATE|ACTUALIZAR|AUTOSAVE|GUARDAR|MODIFICAR/.test(text)) return 'UPDATE';
  if (/ELIMINAR|DELETE|BORRAR/.test(text)) return 'DELETE';
  if (/FINALIZAR|FINALIZE|COMPLETAR/.test(text)) return 'FINALIZE';
  if (/REABRIR|REOPEN/.test(text)) return 'REOPEN';
  if (/REENVIAR|RESEND/.test(text)) return 'RESEND';
  if (/GENERAR|REPORT|PDF/.test(text)) return 'GENERATE';
  if (/FIRMAR|SIGNATURE|FIRMA/.test(text)) return 'SIGN';
  return 'OTHER';
}

function entityName(row = {}) {
  const route = clean(row.actionRoute).toLowerCase();
  const raw = clean(row.entity || row.section, 'registro').toLowerCase();
  if (/evidence|evidencia/.test(route) || /evidencia/.test(raw)) {
    return /manten/.test(route) ? 'evidencia de mantenimiento' : 'evidencia de boleta';
  }
  if (/device|dispositivo/.test(route) || /dispositivo/.test(raw)) return 'dispositivo de mantenimiento';
  if (/boleta|ticket/.test(route) || /boleta|ticket/.test(raw)) return 'boleta';
  if (/mantenimiento|maintenance/.test(route) || /mantenimiento|maintenance/.test(raw)) return 'mantenimiento';
  if (/agenda/.test(route) || /agenda/.test(raw)) return 'agenda';
  if (/cliente|client/.test(route) || /cliente|client/.test(raw)) return 'cliente';
  if (/usuario|user/.test(route) || /usuario|user/.test(raw)) return 'usuario';
  if (/conocimiento|knowledge|tutorial/.test(route) || /conocimiento|knowledge|tutorial/.test(raw)) return 'artículo de conocimiento';
  if (/encuesta|survey/.test(route) || /encuesta|survey/.test(raw)) return 'encuesta';
  return raw === 'interfaz' ? 'pantalla del sistema' : raw;
}

function agendaItemsFromDetail(rawDetail) {
  const detail = safeObject(rawDetail) || {};
  const candidates = [
    detail?.respuesta?.items,
    detail?.response?.items,
    detail?.despues?.agendas,
    detail?.after?.agendas,
    detail?.solicitud?.agendas,
    detail?.request?.agendas,
    detail?.agendas,
    detail?.items,
  ];
  return candidates.find((value) => Array.isArray(value) && value.length) || [];
}

function agendaNotificationWasSent(rawDetail) {
  const detail = safeObject(rawDetail) || {};
  return [
    detail?.respuesta?.notification?.sent,
    detail?.response?.notification?.sent,
    detail?.despues?.notification?.sent,
    detail?.after?.notification?.sent,
    detail?.notification?.sent,
  ].some((value) => value === true || String(value).toLowerCase() === 'true');
}

function agendaSummary(items = [], rawDetail = null) {
  if (!items.length) return '';
  const dates = [...new Set(items.map((item) => clean(item.Fecha || item.fecha).slice(0, 10)).filter(Boolean))];
  const datePhrase = dates.length === 1 ? ` para el ${humanDate(dates[0])}` : '';
  const details = items.slice(0, 6).map((item) => {
    const place = clean(item.Detalle || item.detalle, 'sin detalle');
    const start = clean(item.HoraInicio || item.horaInicio).slice(0, 5);
    const end = clean(item.HoraFin || item.horaFin).slice(0, 5);
    const assigned = Array.isArray(item.asignados)
      ? item.asignados.length
      : (Array.isArray(item.usuarioIds) ? item.usuarioIds.length : 0);
    const schedule = start || end ? `, de ${start || '--:--'} a ${end || '--:--'}` : '';
    const people = assigned ? `, con ${assigned} ${assigned === 1 ? 'persona asignada' : 'personas asignadas'}` : '';
    return `${place}${schedule}${people}`;
  });
  if (items.length > 6) details.push(`${items.length - 6} agenda(s) adicional(es)`);
  let sentence = `Creó ${items.length} ${items.length === 1 ? 'agenda' : 'agendas'}${datePhrase}: ${naturalJoin(details)}.`;
  if (agendaNotificationWasSent(rawDetail)) sentence += ' Las notificaciones correspondientes se enviaron correctamente.';
  return sentence;
}

function naturalResult(row = {}) {
  const result = clean(row.result, 'OK').toUpperCase();
  return ['OK', 'SUCCESS', 'CORRECTO', 'COMPLETADO'].includes(result) ? 'Correcto' : 'Con error';
}

function humanizeRow(row = {}) {
  const kind = actionKind(row);
  if (kind === 'TIME') return null;
  const section = humanSection(row.section);
  const entity = entityName(row);
  const id = friendlyId(row.entityId);
  const idText = id ? ` ${id}` : '';
  const agendaItems = agendaItemsFromDetail(row.detail);
  const agendaCreate = kind === 'CREATE' && (section === 'Agenda' || entity === 'agenda');
  let description = '';

  if (kind === 'NAVIGATION') {
    description = clean(row.activityText)
      || (clean(row.type).toUpperCase() === 'UI_TAB' && row.view
        ? `Cambió a la pestaña “${row.view}” en ${section}.`
        : `Entró a ${section}.`);
  } else if (agendaCreate && agendaItems.length) {
    description = agendaSummary(agendaItems, row.detail);
  } else if (clean(row.activityText)) {
    description = clean(row.activityText);
  } else if (kind === 'READ') {
    description = section === 'Agenda'
      ? 'Consultó o actualizó la vista de la agenda.'
      : `Consultó información de ${section.toLowerCase()}.`;
  } else if (kind === 'CREATE') description = `Creó ${entity}${idText}.`;
  else if (kind === 'UPDATE') description = `Actualizó ${entity}${idText}.`;
  else if (kind === 'DELETE') description = `Eliminó ${entity}${idText}.`;
  else if (kind === 'FINALIZE') description = `Finalizó ${entity}${idText}.`;
  else if (kind === 'REOPEN') description = `Reabrió ${entity}${idText}.`;
  else if (kind === 'RESEND') description = `Reenvió una notificación relacionada con ${entity}${idText}.`;
  else if (kind === 'GENERATE') description = `Generó un documento o reporte relacionado con ${entity}${idText}.`;
  else if (kind === 'SIGN') description = `Realizó una acción de firma relacionada con ${entity}${idText}.`;
  else {
    const action = clean(row.action).replace(/_/g, ' ').toLowerCase();
    description = action ? `Realizó la acción “${action}” en ${section}.` : `Realizó una acción en ${section}.`;
  }

  return {
    key: `${kind}|${row.activityId || row.startedAt}|${row.userId}`,
    kind,
    userId: clean(row.userId),
    userName: clean(row.userName, 'Usuario'),
    section,
    description,
    result: naturalResult(row),
    priority: clean(row.priority, 'NORMAL').toUpperCase(),
    date: clean(row.date),
    time: clean(row.time).slice(0, 8),
    dateTimeLabel: clean(row.dateTimeLabel),
    startedAt: clean(row.startedAt),
  };
}

function humanActivityEntries(report = {}) {
  return (report.timeline || [])
    .map(humanizeRow)
    .filter(Boolean)
    .sort((a, b) => clean(a.startedAt).localeCompare(clean(b.startedAt)));
}

function humanTimeRows(report = {}) {
  return (report.pageSummary || [])
    .filter((row) => Number(row.durationSeconds || 0) > 0)
    .map((row) => {
      const sectionLabel = humanSection(row.section);
      const place = clean(row.view) ? `${sectionLabel} · ${clean(row.view)}` : sectionLabel;
      return {
        ...row,
        sectionLabel,
        sentence: `${clean(row.userName, 'Usuario')} permaneció ${formatDuration(row.durationSeconds)} en ${place}.`,
      };
    })
    .sort((a, b) => Number(b.durationSeconds || 0) - Number(a.durationSeconds || 0));
}

function narrative(report, entries) {
  const summary = report.summary || {};
  const users = (report.selectedUsers || []).map((user) => clean(user.name)).filter(Boolean);
  const subject = users.length === 1 ? users[0] : (users.length ? `${users.length} personas` : 'El personal seleccionado');
  const paragraphs = [];
  paragraphs.push(`${subject} registró ${formatDuration(summary.pageTimeSeconds || 0)} de permanencia visible en la aplicación durante el periodo seleccionado.`);

  const topTimes = humanTimeRows(report).slice(0, 3);
  if (topTimes.length) {
    paragraphs.push(`El tiempo de uso se concentró principalmente en ${naturalJoin(topTimes.map((row) => `${row.sectionLabel} (${formatDuration(row.durationSeconds)})`))}.`);
  }

  const operational = entries.filter((entry) => !['READ', 'NAVIGATION'].includes(entry.kind));
  const reads = entries.filter((entry) => entry.kind === 'READ');
  const navigation = entries.filter((entry) => entry.kind === 'NAVIGATION');
  if (operational.length) paragraphs.push(`Se registraron ${operational.length} acciones operativas, incluyendo creaciones, modificaciones, evidencias, eliminaciones, finalizaciones u otras operaciones.`);
  else if (reads.length) paragraphs.push('Durante el periodo se registraron principalmente consultas de información; no se detectaron cambios operativos relevantes.');
  if (navigation.length) paragraphs.push(`También se registraron ${navigation.length} entradas a pantallas o cambios de pestaña para reconstruir el recorrido realizado dentro de la aplicación.`);

  if ((report.agenda || []).length) paragraphs.push(`La agenda contiene ${(report.agenda || []).length} compromiso(s) para las personas seleccionadas dentro del rango consultado.`);
  return paragraphs;
}

function filterDescription(report) {
  const filters = report?.filters || {};
  const users = (report?.selectedUsers || []).map((user) => user.name).join(', ') || 'Todas las personas';
  const sections = (filters.sections || []).length
    ? filters.sections.map(humanSection).join(', ')
    : 'Toda la aplicación';
  let dates = 'Sin límite de fecha';
  if (filters.dateFrom && filters.dateTo && filters.dateFrom === filters.dateTo) dates = humanDate(filters.dateFrom);
  else if (filters.dateFrom || filters.dateTo) dates = `${filters.dateFrom ? humanDate(filters.dateFrom) : 'inicio'} a ${filters.dateTo ? humanDate(filters.dateTo) : 'actualidad'}`;
  const hours = filters.timeFrom || filters.timeTo
    ? `${filters.timeFrom || '00:00'} a ${filters.timeTo || '23:59'}`
    : 'Todo el día';
  return { users, sections, dates, hours };
}

function naturalizedReport(report) {
  const entries = humanActivityEntries(report);
  return {
    ...report,
    timeline: entries.map((entry, index) => ({
      activityId: `legible-${index + 1}`,
      date: entry.date,
      time: entry.time,
      dateTimeLabel: entry.dateTimeLabel || `${humanDate(entry.date)} ${entry.time}`,
      userId: entry.userId,
      userName: entry.userName,
      section: entry.section,
      view: '',
      uiRoute: '',
      actionRoute: '',
      action: entry.description,
      entity: '',
      entityId: '',
      result: entry.result,
      priority: entry.priority,
      detail: '',
      source: 'Resumen legible',
      type: 'HUMAN_ACTIVITY',
    })),
    pageSummary: (report.pageSummary || []).map((row) => ({ ...row, section: humanSection(row.section), route: '', view: clean(row.view) || humanSection(row.section) })),
    coverage: {
      ...report.coverage,
      note: 'El reporte conserva cada evento funcional registrado —incluidas entradas a pantallas, cambios de pestaña, consultas, evidencias y modificaciones—. Únicamente los latidos técnicos de permanencia se consolidan en la sección de tiempo de uso.',
    },
  };
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

function pdfEscape(value) {
  const normalized = String(value ?? '').normalize('NFC');
  const mapping = new Map([
    ['á',225],['é',233],['í',237],['ó',243],['ú',250],['Á',193],['É',201],['Í',205],['Ó',211],['Ú',218],['ñ',241],['Ñ',209],['ü',252],['Ü',220],['¿',191],['¡',161],['°',176],['–',150],['—',151],['“',147],['”',148],['‘',145],['’',146],['•',149],
  ]);
  let output = '';
  for (const character of normalized) {
    const code = character.charCodeAt(0);
    let byte = code <= 255 ? code : mapping.get(character);
    if (byte == null) byte = 63;
    if ([40, 41, 92].includes(byte)) output += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) output += `\\${byte.toString(8).padStart(3, '0')}`;
    else output += String.fromCharCode(byte);
  }
  return output;
}

function wrapLine(value, width = 88) {
  const text = clean(value).replace(/\s+/g, ' ');
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > width) { lines.push(line); line = word; }
    else line = next;
  });
  if (line) lines.push(line);
  return lines;
}

function pdfBlocks(report) {
  const filters = filterDescription(report);
  const summary = report.summary || {};
  const entries = humanActivityEntries(report);
  const operationalEntries = entries.filter((entry) => !['READ', 'NAVIGATION'].includes(entry.kind));
  const blocks = [
    { type: 'meta', text: `Personas: ${filters.users}` },
    { type: 'meta', text: `Periodo: ${filters.dates} · ${filters.hours}` },
    { type: 'meta', text: `Secciones: ${filters.sections}` },
    { type: 'summary', text: `Tiempo en la app: ${formatDuration(summary.pageTimeSeconds || 0)} · Acciones operativas: ${operationalEntries.length} · Boletas: ${summary.ticketsTouched || 0}` },
    { type: 'summary', text: `Mantenimientos: ${summary.maintenancesTouched || 0} · Dispositivos: ${summary.devicesTouched || 0} · Agendas: ${summary.agendaItems || 0}` },
    { type: 'section', text: 'RESUMEN DEL PERIODO' },
    ...narrative(report, entries).map((text) => ({ type: 'body', text })),
    { type: 'note', text: 'El reporte conserva cada entrada a pantalla, cambio de pestaña, consulta y acción funcional registrada. Los eventos PAGE_TIME de un minuto se consolidan únicamente en Tiempo de uso para evitar repetir cientos de líneas técnicas.' },
    { type: 'section', text: 'TIEMPO DE USO' },
  ];

  const times = humanTimeRows(report);
  if (times.length) times.forEach((row) => blocks.push({ type: 'time', text: row.sentence }));
  else blocks.push({ type: 'empty', text: 'No se registró tiempo visible para el periodo seleccionado.' });

  blocks.push({ type: 'section', text: 'ACTIVIDAD REALIZADA' });
  if (!entries.length) blocks.push({ type: 'empty', text: 'No se registraron acciones o recorridos para los filtros seleccionados.' });
  else entries.forEach((entry) => {
    blocks.push({
      type: entry.priority === 'ALTA' ? 'activityHigh' : 'activity',
      text: `${entry.date ? humanDate(entry.date) : 'Fecha no disponible'} · ${entry.time || '--:--'} · ${entry.userName} · ${entry.section}`,
    });
    blocks.push({
      type: entry.priority === 'ALTA' ? 'bodyHigh' : 'body',
      text: `${entry.description} Resultado: ${entry.result}.`,
    });
  });

  if ((report.agenda || []).length) {
    blocks.push({ type: 'section', text: 'AGENDA PROGRAMADA' });
    report.agenda.forEach((row) => {
      const assigned = (row.assigned || []).map((user) => user.userName).filter(Boolean);
      const ticket = row.ticketUid
        ? 'Tiene una boleta relacionada.'
        : (row.requiresTicket ? 'Requiere boleta y todavía no aparece una relacionada.' : 'No requiere boleta.');
      blocks.push({ type: 'activity', text: `${humanDate(row.date)} · ${row.startTime} a ${row.endTime} · ${row.detail}` });
      blocks.push({ type: 'body', text: `${assigned.length ? `Personas asignadas: ${naturalJoin(assigned)}. ` : ''}${ticket}` });
    });
  }
  return blocks;
}

function blockStyle(type) {
  const styles = {
    meta: { font: 'F1', size: 9, leading: 12.5, color: '0.07 0.09 0.13', width: 88, before: 3, after: 1, indent: 0 },
    summary: { font: 'F2', size: 9.2, leading: 13, color: '0.56 0.04 0.07', width: 86, before: 4, after: 2, indent: 0, background: '1 0.95 0.95', pad: 6 },
    section: { font: 'F2', size: 10.5, leading: 14, color: '1 1 1', width: 82, before: 12, after: 5, indent: 1, background: '0.56 0.04 0.07', pad: 7 },
    body: { font: 'F1', size: 9.2, leading: 13, color: '0.08 0.10 0.14', width: 84, before: 4, after: 5, indent: 5 },
    bodyHigh: { font: 'F1', size: 9.2, leading: 13, color: '0.22 0.12 0.05', width: 82, before: 0, after: 6, indent: 11 },
    note: { font: 'F1', size: 8.4, leading: 12, color: '0.45 0.23 0.04', width: 84, before: 7, after: 5, indent: 5, background: '1 0.98 0.92', pad: 7 },
    time: { font: 'F1', size: 9, leading: 12.5, color: '0.08 0.10 0.14', width: 84, before: 3, after: 3, indent: 6, background: '0.97 0.98 0.99', pad: 6 },
    activity: { font: 'F2', size: 8.8, leading: 12, color: '0.22 0.25 0.29', width: 84, before: 6, after: 1, indent: 6, background: '0.97 0.98 0.99', pad: 6 },
    activityHigh: { font: 'F2', size: 8.8, leading: 12, color: '0.49 0.18 0.04', width: 84, before: 6, after: 1, indent: 6, background: '1 0.97 0.93', pad: 6, accent: '0.92 0.35 0.05' },
    empty: { font: 'F1', size: 8.8, leading: 12, color: '0.42 0.45 0.50', width: 84, before: 5, after: 5, indent: 5 },
  };
  return styles[type] || styles.body;
}

function pdfText(commands, text, x, y, style) {
  commands.push('BT');
  commands.push(`/${style.font} ${style.size} Tf`);
  commands.push(`${style.color} rg`);
  commands.push(`${x} ${y} Td`);
  commands.push(`(${pdfEscape(text)}) Tj`);
  commands.push('ET');
}

function pdfHeader(commands, pageNumber, generatedAt) {
  commands.push('q 0.56 0.04 0.07 rg 0 792 595 50 re f Q');
  pdfText(commands, 'DMS BOLETAS', 42, 819, { font: 'F2', size: 8.5, color: '1 1 1' });
  pdfText(commands, 'Reporte de actividad', 42, 801, { font: 'F2', size: 17, color: '1 1 1' });
  commands.push('q 0.88 0.89 0.91 RG 42 43 m 553 43 l S Q');
  pdfText(commands, `Generado ${reportDateTime(generatedAt)} · Página ${pageNumber}`, 42, 28, { font: 'F1', size: 7.2, color: '0.42 0.45 0.50' });
}

function naturalPdfBlob(report) {
  const blocks = pdfBlocks(report);
  const streams = [];
  let commands = [];
  let pageNumber = 1;
  let y = 766;
  pdfHeader(commands, pageNumber, report.generatedAt);

  function newPage() {
    streams.push(commands.join('\n'));
    commands = [];
    pageNumber += 1;
    y = 766;
    pdfHeader(commands, pageNumber, report.generatedAt);
  }

  for (const block of blocks) {
    const style = blockStyle(block.type);
    const lines = wrapLine(block.text, style.width);
    const pad = Number(style.pad || 0);
    const before = Number(style.before || 0);
    const after = Number(style.after || 0);
    const textHeight = style.size + Math.max(0, lines.length - 1) * style.leading;
    const renderHeight = textHeight + (pad * 2) + 3;
    const totalHeight = before + renderHeight + after;
    if (y - totalHeight < 58) newPage();
    y -= before;
    const top = y;
    const bottom = top - renderHeight;
    if (style.background) commands.push(`q ${style.background} rg 38 ${bottom} 519 ${renderHeight} re f Q`);
    if (style.accent) commands.push(`q ${style.accent} rg 38 ${bottom} 4 ${renderHeight} re f Q`);
    let textY = top - pad - style.size;
    lines.forEach((line) => {
      pdfText(commands, line, 42 + style.indent, textY, style);
      textY -= style.leading;
    });
    y = bottom - after;
  }
  streams.push(commands.join('\n'));

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageIds = streams.map((_, index) => 5 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  streams.forEach((stream, index) => {
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
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

export function exportActivityReport(report, format = 'PDF') {
  const type = clean(format, 'PDF').toUpperCase();
  if (type === 'PDF') {
    downloadBlob(naturalPdfBlob(report), `${fileBase(report)}.pdf`);
    return;
  }
  exportTechnicalActivityReport(naturalizedReport(report), type);
}
