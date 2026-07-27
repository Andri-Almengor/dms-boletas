import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { assistantDeviceCatalogHandlers } from './assistant-device-catalog.module.js';

const DEFAULT_ALIASES = {
  rn: ['junta administrativa del registro nacional', 'registro nacional'],
  registro: ['junta administrativa del registro nacional', 'registro nacional'],
  asamblea: ['asamblea legislativa de costa rica', 'asamblea legislativa'],
  bcr: ['banco de costa rica'],
  bccr: ['banco central de costa rica'],
  ice: ['instituto costarricense de electricidad'],
  ins: ['instituto nacional de seguros'],
  aya: ['acueductos y alcantarillados'],
  ccss: ['caja costarricense de seguro social'],
};

const CATEGORY_ALIASES = [
  ['Cámara', ['camara', 'camaras', 'cctv', 'videovigilancia']],
  ['Puertas', ['puerta', 'puertas', 'control de acceso', 'control acceso', 'accesos']],
  ['Servidor', ['servidor', 'servidores']],
  ['Grabador', ['grabador', 'grabadores', 'nvr', 'dvr', 'recording server']],
  ['Bocinas', ['bocina', 'bocinas', 'audio']],
  ['Sensor Perimetral', ['sensor perimetral', 'sensores perimetrales']],
  ['Sensor Movimiento', ['sensor movimiento', 'sensor de movimiento', 'sensores de movimiento']],
  ['Sensor de Ruptura', ['sensor ruptura', 'sensor de ruptura', 'sensores de ruptura']],
  ['Impresora', ['impresora', 'impresoras']],
  ['Gabinete', ['gabinete', 'gabinetes']],
  ['VideoWall', ['videowall', 'video wall']],
];

const KNOWN_CHECKLISTS = {
  Cámara: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    visualizacion: 'Visualización', grabacion: 'Grabación', enfoque: 'Enfoque', imagen: 'Imagen',
  },
  Puertas: {
    lector: 'Lector', cerradura: 'Cerradura', funcion: 'Función', contactos: 'Contactos',
    alimentacion: 'Alimentación', conexion: 'Conexión', apertura: 'Apertura', cierre: 'Cierre',
  },
  Servidor: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexiones: 'Conexiones', servicios: 'Servicios',
    almacenamiento: 'Almacenamiento', respaldo: 'Respaldo',
  },
  Grabador: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexiones: 'Conexiones', grabacion: 'Grabación',
    visualizacion: 'Visualización', almacenamiento: 'Almacenamiento',
  },
  Bocinas: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje', pruebaSonido: 'Prueba de sonido',
  },
  'Sensor Perimetral': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje', pruebaDeteccion: 'Prueba de detección',
  },
  'Sensor Movimiento': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje', pruebaDeteccion: 'Prueba de movimiento',
  },
  'Sensor de Ruptura': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje', pruebaDeteccion: 'Prueba de ruptura',
  },
  Impresora: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', consumibles: 'Consumibles', pruebaImpresion: 'Prueba de impresión',
  },
  Gabinete: { limpieza: 'Limpieza', conexiones: 'Conexiones', mediciones: 'Mediciones', respaldo: 'Respaldo' },
  VideoWall: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    visualizacion: 'Visualización', calibracion: 'Calibración',
  },
};

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function active(row = {}) {
  const enabled = normalized(row.Activo ?? 'true');
  const status = normalized(row.Estado || '');
  return !['false', '0', 'no'].includes(enabled) && status !== 'inactivo';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function costaRicaToday() {
  const date = new Date(Date.now() - (6 * 60 * 60 * 1000));
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay(),
  };
}

function ymd(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftDate(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function resolvePeriod(question) {
  const text = normalized(question);
  const today = costaRicaToday();
  const todayText = ymd(today);
  const explicitYear = text.match(/\b(20\d{2})\b/)?.[1];
  if (explicitYear) return { mode: 'range', label: `Año ${explicitYear}`, from: `${explicitYear}-01-01`, to: `${explicitYear}-12-31` };
  if (/esta semana|durante la semana|de la semana/.test(text)) {
    const offset = today.weekday === 0 ? -6 : 1 - today.weekday;
    return { mode: 'range', label: 'Semana actual', from: ymd(shiftDate(today, offset)), to: todayText };
  }
  if (/este mes|durante el mes|del mes/.test(text)) return { mode: 'range', label: 'Mes actual', from: ymd({ ...today, day: 1 }), to: todayText };
  if (/este ano|durante el ano|del ano/.test(text)) return { mode: 'range', label: 'Año actual', from: `${today.year}-01-01`, to: todayText };
  if (/hoy|del dia/.test(text)) return { mode: 'range', label: 'Hoy', from: todayText, to: todayText };
  return { mode: 'latest', label: 'Registro más reciente', from: '', to: '' };
}

function withinPeriod(value, period) {
  if (!period.from || !period.to) return true;
  const date = dateOnly(value);
  return Boolean(date) && date >= period.from && date <= period.to;
}

function clientId(row = {}) {
  return clean(pick(row, ['ClienteID', 'id']));
}

function clientName(row = {}) {
  return clean(pick(row, ['Nombre', 'RazonSocial', 'Clientes', 'Cliente']), 'Cliente');
}

function configAliases(rows = []) {
  const row = rows.find((item) => normalized(item.Clave) === 'asistente cliente aliases json');
  if (!row) return {};
  const parsed = parseObject(row.Valor || row.Value || row.Configuracion);
  return Object.fromEntries(Object.entries(parsed).map(([alias, targets]) => [
    normalized(alias),
    (Array.isArray(targets) ? targets : [targets]).map(normalized),
  ]));
}

function nameAliases(name) {
  return [...String(name || '').matchAll(/\(([^)]+)\)/g)].map((match) => normalized(match[1])).filter(Boolean);
}

function significantTokens(value) {
  const ignored = new Set(['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'cliente', 'mantenimiento', 'boleta', 'costa', 'rica', 'srl', 'sa']);
  return normalized(value).split(' ').filter((token) => token.length > 2 && !ignored.has(token));
}

function containsWhole(query, token) {
  return ` ${query} `.includes(` ${token} `);
}

function clientScore(question, client, aliases) {
  const query = normalized(question);
  const nameKey = normalized(clientName(client));
  if (nameKey && query.includes(nameKey)) return 1;
  if (nameAliases(clientName(client)).some((alias) => containsWhole(query, alias))) return 0.995;

  for (const [alias, targets] of Object.entries(aliases)) {
    if (!containsWhole(query, alias)) continue;
    if (targets.some((target) => nameKey.includes(target) || target.includes(nameKey))) return 0.99;
  }

  const tokens = significantTokens(nameKey);
  const matches = tokens.filter((token) => containsWhole(query, token));
  if (!matches.length) return 0;
  const longest = Math.max(...matches.map((token) => token.length));
  const ratio = matches.length / Math.max(1, tokens.length);
  if (matches.length >= 2 && ratio >= 0.4) return 0.94;
  if (longest >= 7) return 0.86;
  if (longest >= 5) return 0.76;
  return 0.58;
}

function resolveClient(question, context, clients, configuration) {
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId);
  if (contextId && !/otro cliente|otra empresa/i.test(question)) {
    const selected = clients.find((row) => clientId(row) === contextId);
    if (selected) return { status: 'resolved', client: selected };
  }

  const aliases = { ...DEFAULT_ALIASES, ...configAliases(configuration) };
  const ranked = clients
    .map((client) => ({ client, score: clientScore(question, client, aliases) }))
    .filter((item) => item.score >= 0.58)
    .sort((a, b) => b.score - a.score || clientName(a.client).localeCompare(clientName(b.client), 'es'));
  if (!ranked.length) return { status: 'missing' };
  if (ranked[0].score < 0.72 || (ranked[1] && ranked[0].score < 0.98 && ranked[0].score - ranked[1].score < 0.08)) {
    return { status: 'ambiguous', options: ranked.slice(0, 5).map((item) => item.client) };
  }
  return { status: 'resolved', client: ranked[0].client };
}

function sameClient(row, client) {
  const id = clientId(client);
  return (id && clean(row.ClienteID || row.ClienteRef) === id)
    || normalized(row.Cliente || row.ClienteNombre) === normalized(clientName(client));
}

function sortNewest(rows) {
  return [...rows].sort((left, right) => {
    for (const field of ['Fecha', 'FechaCreacion', 'FechaActualizacion']) {
      const result = clean(right[field]).localeCompare(clean(left[field]), 'es');
      if (result) return result;
    }
    return number(right.BoletaID) - number(left.BoletaID);
  });
}

function canonicalCategory(value) {
  const key = normalized(value);
  for (const [label, aliases] of CATEGORY_ALIASES) {
    if (aliases.some((alias) => normalized(alias) === key)) return label;
  }
  return clean(value, 'Sin categoría');
}

function humanizeKey(value) {
  return clean(value)
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function answersForDevice(device, category) {
  const raw = parseObject(device.RespuestasJSON);
  const configured = KNOWN_CHECKLISTS[category] || {};
  const answers = new Map();

  for (const [key, label] of Object.entries(configured)) {
    const upper = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const value = raw[key] ?? raw[upper] ?? device[upper] ?? device[key];
    if (clean(value)) answers.set(label, clean(value));
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!clean(value)) continue;
    const label = configured[key] || humanizeKey(key);
    if (!answers.has(label)) answers.set(label, clean(value));
  }
  return [...answers.entries()].map(([question, answer]) => ({ question, answer }));
}

function answerKind(value) {
  const key = normalized(value);
  if (!key) return 'other';
  if (key.startsWith('no') && !key.includes('guardad')) return 'no';
  if (key.startsWith('si') || ['ok', 'correcto', 'bien', 'cumple', 'aprobado'].includes(key)) return 'yes';
  return 'other';
}

function functioningOk(value) {
  const key = normalized(value);
  return key.startsWith('si') || ['correcto', 'bien', 'funciona', 'funcionando'].includes(key);
}

function useStatusOk(value) {
  const key = normalized(value);
  if (!key) return false;
  if (key.startsWith('si') && key.includes('uso')) return true;
  if (key.startsWith('no') && key.includes('guardad')) return true;
  return false;
}

function deviceNeedsAttention(device) {
  const state = normalized(device.Estado);
  if (state.includes('mal') || state.includes('falla') || state.includes('atencion')) return true;
  const hasOperationalStatus = clean(device.Funcionamiento) || clean(device.EnUso);
  if (hasOperationalStatus) return !(functioningOk(device.Funcionamiento) && useStatusOk(device.EnUso));
  return false;
}

function deviceView(device, evidenceCount, maintenanceTitle = '') {
  const category = canonicalCategory(device.Categoria || device.TipoDispositivo);
  const failedChecks = answersForDevice(device, category)
    .filter((item) => answerKind(item.answer) === 'no')
    .map((item) => item.question);
  const observations = [
    clean(device.Observacion),
    failedChecks.length ? `Pruebas con atención: ${failedChecks.join(', ')}` : '',
    maintenanceTitle ? `Mantenimiento: ${maintenanceTitle}` : '',
  ].filter(Boolean);
  return {
    id: clean(device.EvidenciaMantenimientoID),
    category,
    name: clean(device.NombreDispositivo, 'Dispositivo'),
    zone: clean(device.Zona),
    manufacturer: clean(device.Fabricante),
    model: clean(device.Modelo),
    serial: clean(device.Serie),
    functioning: clean(device.Funcionamiento),
    inUse: clean(device.EnUso),
    state: clean(device.Estado, deviceNeedsAttention(device) ? 'Requiere atención' : 'Correcto'),
    observation: observations.join(' · '),
    evidenceCount,
    failedChecks: failedChecks.join(', '),
  };
}

function summarizeCategories(devices) {
  const map = new Map();
  for (const device of devices) {
    const category = canonicalCategory(device.Categoria || device.TipoDispositivo);
    const row = map.get(category) || { category, total: 0, good: 0, bad: 0, checklistMap: new Map() };
    row.total += 1;
    if (deviceNeedsAttention(device)) row.bad += 1;
    else row.good += 1;

    for (const item of answersForDevice(device, category)) {
      const summary = row.checklistMap.get(item.question) || { question: item.question, yes: 0, no: 0, other: 0, answered: 0 };
      summary.answered += 1;
      summary[answerKind(item.answer)] += 1;
      row.checklistMap.set(item.question, summary);
    }
    map.set(category, row);
  }
  return [...map.values()].map(({ checklistMap, ...row }) => ({ ...row, checklist: [...checklistMap.values()] }))
    .sort((a, b) => a.category.localeCompare(b.category, 'es'));
}

function maintenanceReference(row = {}) {
  return clean(pick(row, ['MantenimientoRef', 'MantenimientoID', 'MantenimientoRefID', 'maintenanceId']));
}

function clarification(message, options, context, resumeQuestion) {
  return { type: 'clarification', message, answer: message, options, sources: [], suggestions: [], facts: {}, context, resumeQuestion };
}

function source(type, id, label, url) {
  return { type, id: clean(id), label: clean(label), url };
}

function requestIntent(question) {
  const text = normalized(question);
  const action = /(que se hizo|que hicieron|resumen|reporte|trabajo realizado|trabajos realizados|actividades realizadas)/.test(text);
  if (action && /mantenimiento/.test(text)) return 'maintenance';
  if (action && /(boleta|boletas|ticket|tickets)/.test(text)) return 'tickets';
  if (/(boleta|boletas|ticket|tickets)/.test(text) && /(semana|mes|ano|hoy)/.test(text)) return 'tickets';
  if (action && /(semana|mes|ano|hoy)/.test(text) && !/mantenimiento/.test(text)) return 'tickets';
  return '';
}

function access(ctx) {
  const permissions = new Set(ctx.permissions || []);
  const admin = permissions.has('USUARIOS_GESTIONAR');
  return {
    maintenance: admin || ['MANTENIMIENTOS_VER', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_VER'].some((code) => permissions.has(code)),
    tickets: admin || permissions.has('BOLETAS_VER'),
  };
}

function maintenanceType(row) {
  const key = normalized(`${row.TituloMantenimiento || ''} ${row.DescripcionGeneral || ''}`);
  if (key.includes('preventiv')) return 'mantenimiento preventivo';
  if (key.includes('correctiv')) return 'mantenimiento correctivo';
  return 'mantenimiento técnico';
}

async function buildMaintenanceReport(ctx, client, period, context) {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
  const contextId = clean(context.lastMaintenanceId || context.maintenanceId || context.pageContext?.maintenanceId || (context.pageContext?.entityType === 'maintenance' ? context.pageContext?.entityId : ''));
  let maintenances = tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, period));
  maintenances = sortNewest(maintenances);
  if (period.mode === 'latest') {
    const contextMaintenance = contextId ? maintenances.find((row) => clean(row.MantenimientoID) === contextId) : null;
    maintenances = (contextMaintenance || maintenances[0]) ? [contextMaintenance || maintenances[0]] : [];
  }
  if (!maintenances.length) {
    return { type: 'answer', answer: `No encontré mantenimientos de ${clientName(client)} para ${period.label.toLowerCase()}.`, facts: {}, sources: [], suggestions: [], context };
  }

  const maintenanceById = new Map(maintenances.map((row) => [clean(row.MantenimientoID), row]));
  const ids = new Set(maintenanceById.keys());
  const devices = tables.Evidencia_Mantenimientos.filter((row) => active(row) && ids.has(maintenanceReference(row)));
  const selectedDeviceIds = new Set(devices.map((row) => clean(row.EvidenciaMantenimientoID)));
  const evidenceCounts = new Map();
  tables['Mantenimiento imagenes'].filter(active).forEach((row) => {
    const deviceId = clean(row.DispositivoMantenimientoRef);
    if (!selectedDeviceIds.has(deviceId)) return;
    evidenceCounts.set(deviceId, (evidenceCounts.get(deviceId) || 0) + 1);
  });

  const categories = summarizeCategories(devices);
  const allAttention = devices.filter(deviceNeedsAttention).map((device) => {
    const maintenance = maintenanceById.get(maintenanceReference(device));
    return deviceView(device, evidenceCounts.get(clean(device.EvidenciaMantenimientoID)) || 0, maintenances.length > 1 ? clean(maintenance?.TituloMantenimiento) : '');
  });
  const attentionDevices = allAttention.slice(0, 500);
  const goodDevices = Math.max(0, devices.length - allAttention.length);
  const totalEvidence = devices.reduce((sum, device) => sum + (evidenceCounts.get(clean(device.EvidenciaMantenimientoID)) || 0), 0);

  const maintenanceLines = maintenances.slice(0, 20).map((row) => {
    const parts = [
      `“${clean(row.TituloMantenimiento, 'Mantenimiento')}” (${dateOnly(row.Fecha) || 'sin fecha'})`,
      clean(row.DescripcionGeneral),
    ].filter(Boolean);
    return parts.join(': ');
  }).join('\n');
  const categoryLines = categories.map((category) => {
    const checks = category.checklist.map((item) => {
      const parts = [`${item.yes} sí`];
      if (item.no) parts.push(`${item.no} no`);
      if (item.other) parts.push(`${item.other} otro`);
      return `${item.question}: ${parts.join(', ')}`;
    }).join('; ');
    return `${category.category}: ${category.total} equipos, ${category.good} bien y ${category.bad} con atención${checks ? `. Verificaciones: ${checks}` : ''}.`;
  }).join('\n');

  const first = maintenances[0];
  const intro = maintenances.length === 1
    ? `En ${clientName(client)} se realizó un ${maintenanceType(first)} denominado “${clean(first.TituloMantenimiento, 'Mantenimiento')}”, con fecha ${dateOnly(first.Fecha) || 'sin fecha registrada'}.`
    : `Durante ${period.label.toLowerCase()}, ${clientName(client)} tuvo ${maintenances.length} mantenimientos.`;
  const answer = [
    intro,
    maintenances.length > 1 ? maintenanceLines : (clean(first.DescripcionGeneral) ? `Descripción general: ${clean(first.DescripcionGeneral)}.` : ''),
    `Se registraron ${devices.length} dispositivos: ${goodDevices} en condición correcta y ${allAttention.length} que requieren atención. Se asociaron ${totalEvidence} evidencias.`,
    categoryLines,
    allAttention.length ? `Los equipos con mal funcionamiento se muestran en la tabla detallada.${allAttention.length > attentionDevices.length ? ` Se muestran los primeros ${attentionDevices.length} de ${allAttention.length}.` : ''}` : 'No se encontraron equipos marcados con mal funcionamiento.',
  ].filter(Boolean).join('\n');

  const firstId = clean(first.MantenimientoID);
  const facts = {
    maintenanceReport: {
      id: firstId, title: clean(first.TituloMantenimiento), date: dateOnly(first.Fecha), status: clean(first.Estado),
      client: clientName(client), period: period.label, maintenanceCount: maintenances.length,
      totalDevices: devices.length, goodDevices, badDevices: allAttention.length, totalEvidence, categories,
      attentionDevices, truncated: allAttention.length > attentionDevices.length,
    },
    maintenance: { id: firstId, title: clean(first.TituloMantenimiento), date: dateOnly(first.Fecha), status: clean(first.Estado), registeredDevices: devices.length },
    devices: attentionDevices,
    category: 'Equipos',
  };
  const nextContext = { ...context, lastClientId: clientId(client), lastClientName: clientName(client), lastMaintenanceId: firstId, lastIntent: 'maintenance_report' };
  await audit(ctx, 'ASISTENTE_REPORTE_MANTENIMIENTO', 'Cliente', clientId(client), null, { period: period.label, maintenances: maintenances.length, devices: devices.length, bad: allAttention.length });
  return {
    type: 'answer', answer, facts,
    sources: maintenances.slice(0, 10).map((row) => source('maintenance', row.MantenimientoID, `${clean(row.TituloMantenimiento, 'Mantenimiento')} · ${dateOnly(row.Fecha)}`, `/mantenimientos/${encodeURIComponent(row.MantenimientoID)}`)),
    suggestions: ['Dame los equipos con fallas', '¿Qué modelos se registraron?', '¿Cuántas evidencias tiene este mantenimiento?'],
    context: nextContext,
  };
}

function ticketView(row) {
  const description = clean(pick(row, ['Descripcion', 'Descripción', 'DescripcionTrabajo', 'TrabajoRealizado']));
  const tests = clean(pick(row, ['PruebasRealizadas', 'Pruebas']));
  const result = clean(row.Resultado);
  return {
    uid: clean(row.BoletaUID), number: clean(row.BoletaID || row.BoletaUID), date: dateOnly(row.Fecha),
    title: clean(row.Titulo || row.TituloBoleta, 'Boleta de servicio'), status: clean(row.Estado, 'Sin estado'),
    reason: clean(pick(row, ['RazonVisita', 'Razon_visita'])), description, tests, result,
    recommendations: clean(row.Recomendaciones), technicians: clean(row.AsignadoA || row.Responsables),
    location: clean(row.Ubicacion), hours: number(row.HorasTotales),
  };
}

async function buildTicketReport(ctx, client, period, context) {
  const { Boletas = [] } = await readTables(['Boletas']);
  let rows = sortNewest(Boletas.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, period)));
  if (period.mode === 'latest') rows = rows.slice(0, 1);
  if (!rows.length) {
    return { type: 'answer', answer: `No encontré boletas de ${clientName(client)} para ${period.label.toLowerCase()}.`, facts: {}, sources: [], suggestions: [], context };
  }

  const allTickets = rows.map(ticketView);
  const shownTickets = allTickets.slice(0, 200);
  const finalized = allTickets.filter((row) => normalized(row.status).includes('finaliz')).length;
  const pending = allTickets.filter((row) => normalized(row.status).includes('pend')).length;
  const annulled = allTickets.filter((row) => normalized(row.status).includes('anul')).length;
  const totalHours = Math.round(allTickets.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;
  const details = shownTickets.slice(0, 12).map((ticket) => [
    `Boleta #${ticket.number} del ${ticket.date || 'sin fecha'}: ${ticket.title}.`,
    ticket.reason ? `Motivo: ${ticket.reason}.` : '',
    ticket.description ? `Trabajo realizado: ${ticket.description}.` : '',
    ticket.tests ? `Pruebas: ${ticket.tests}.` : '',
    ticket.result ? `Resultado: ${ticket.result}.` : '',
    ticket.recommendations ? `Recomendaciones: ${ticket.recommendations}.` : '',
  ].filter(Boolean).join(' ')).join('\n');

  const answer = period.mode === 'latest'
    ? `La boleta más reciente de ${clientName(client)} es la #${shownTickets[0].number}, del ${shownTickets[0].date || 'sin fecha registrada'}.\n${details}`
    : `Durante ${period.label.toLowerCase()}, ${clientName(client)} tuvo ${allTickets.length} boletas: ${finalized} finalizadas, ${pending} pendientes y ${annulled} anuladas. Se registraron ${totalHours} horas en total.\n${details}${allTickets.length > 12 ? `\nLa tabla contiene hasta 200 de las ${allTickets.length} boletas encontradas.` : ''}`;

  const facts = {
    ticketReport: { client: clientName(client), period: period.label, total: allTickets.length, finalized, pending, annulled, totalHours, tickets: shownTickets, truncated: allTickets.length > shownTickets.length },
    recentTickets: shownTickets,
  };
  const nextContext = { ...context, lastClientId: clientId(client), lastClientName: clientName(client), lastTicketId: shownTickets[0]?.uid, lastIntent: 'ticket_report' };
  await audit(ctx, 'ASISTENTE_REPORTE_BOLETAS', 'Cliente', clientId(client), null, { period: period.label, total: allTickets.length });
  return {
    type: 'answer', answer, facts,
    sources: shownTickets.slice(0, 10).map((ticket) => source('ticket', ticket.uid, `Boleta #${ticket.number} · ${ticket.title}`, `/boletas/${encodeURIComponent(ticket.uid)}`)),
    suggestions: ['¿Cuál fue el resultado de la última boleta?', 'Dame las boletas de este mes', '¿Qué recomendaciones quedaron pendientes?'],
    context: nextContext,
  };
}

async function chat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  const intent = requestIntent(question);
  if (!intent) return assistantDeviceCatalogHandlers.chat(ctx);

  const allowed = access(ctx);
  if (intent === 'maintenance' && !allowed.maintenance) throw forbidden('No cuenta con permiso para consultar mantenimientos.');
  if (intent === 'tickets' && !allowed.tickets) throw forbidden('No cuenta con permiso para consultar boletas.');

  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  const { Clientes = [], Configuracion = [] } = await readTables(['Clientes', 'Configuracion']);
  const clients = Clientes.filter(active);
  const resolution = resolveClient(question, context, clients, Configuracion);
  if (resolution.status === 'missing') {
    return clarification('¿De qué cliente desea generar el reporte? Puede escribir el nombre completo o una abreviación, por ejemplo RN, Asamblea o BCR.', [], context, question);
  }
  if (resolution.status === 'ambiguous') {
    return clarification('Encontré varios clientes posibles. ¿A cuál se refiere?', resolution.options.map((row) => ({ type: 'client', value: clientId(row), label: clientName(row) })), context, question);
  }

  const period = resolvePeriod(question);
  return intent === 'maintenance'
    ? buildMaintenanceReport(ctx, resolution.client, period, context)
    : buildTicketReport(ctx, resolution.client, period, context);
}

export const assistantOperationalReportHandlersV2 = { chat };
