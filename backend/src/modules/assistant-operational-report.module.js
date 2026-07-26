import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { assistantDeviceCatalogHandlers } from './assistant-device-catalog.module.js';

const DEFAULT_CLIENT_ALIASES = {
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
  { label: 'Cámara', aliases: ['camara', 'camaras', 'cctv', 'videovigilancia'] },
  { label: 'Puertas', aliases: ['puerta', 'puertas', 'control de acceso', 'control acceso', 'accesos'] },
  { label: 'Servidor', aliases: ['servidor', 'servidores'] },
  { label: 'Grabador', aliases: ['grabador', 'grabadores', 'nvr', 'dvr', 'recording server'] },
  { label: 'Bocinas', aliases: ['bocina', 'bocinas', 'audio'] },
  { label: 'Sensor Perimetral', aliases: ['sensor perimetral', 'sensores perimetrales'] },
  { label: 'Sensor Movimiento', aliases: ['sensor movimiento', 'sensor de movimiento', 'sensores de movimiento'] },
  { label: 'Sensor de Ruptura', aliases: ['sensor ruptura', 'sensor de ruptura', 'sensores de ruptura'] },
  { label: 'Impresora', aliases: ['impresora', 'impresoras'] },
  { label: 'Gabinete', aliases: ['gabinete', 'gabinetes'] },
  { label: 'VideoWall', aliases: ['videowall', 'video wall'] },
];

const CHECKLISTS = {
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
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    pruebaSonido: 'Prueba de sonido',
  },
  'Sensor Perimetral': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    pruebaDeteccion: 'Prueba de detección',
  },
  'Sensor Movimiento': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    pruebaDeteccion: 'Prueba de movimiento',
  },
  'Sensor de Ruptura': {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', montaje: 'Montaje',
    pruebaDeteccion: 'Prueba de ruptura',
  },
  Impresora: {
    limpieza: 'Limpieza', alimentacion: 'Alimentación', conexion: 'Conexión', consumibles: 'Consumibles',
    pruebaImpresion: 'Prueba de impresión',
  },
  Gabinete: {
    limpieza: 'Limpieza', conexiones: 'Conexiones', mediciones: 'Mediciones', respaldo: 'Respaldo',
  },
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
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo'
    && normalized(row.Estado || '') !== 'anulada';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function costaRicaParts(date = new Date()) {
  const adjusted = new Date(date.getTime() - (6 * 60 * 60 * 1000));
  return {
    year: adjusted.getUTCFullYear(),
    month: adjusted.getUTCMonth() + 1,
    day: adjusted.getUTCDate(),
    weekday: adjusted.getUTCDay(),
  };
}

function ymd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftDate(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function reportPeriod(question, defaultLatest = true) {
  const text = normalized(question);
  const today = costaRicaParts();
  const todayText = ymd(today);
  const explicitYear = text.match(/\b(20\d{2})\b/)?.[1];
  if (explicitYear) return { mode: 'range', label: `Año ${explicitYear}`, from: `${explicitYear}-01-01`, to: `${explicitYear}-12-31` };
  if (/esta semana|durante la semana|de la semana/.test(text)) {
    const offset = today.weekday === 0 ? -6 : 1 - today.weekday;
    return { mode: 'range', label: 'Semana actual', from: ymd(shiftDate(today, offset)), to: todayText };
  }
  if (/este mes|durante el mes|del mes/.test(text)) {
    return { mode: 'range', label: 'Mes actual', from: ymd({ ...today, day: 1 }), to: todayText };
  }
  if (/este ano|durante el ano|del ano/.test(text)) {
    return { mode: 'range', label: 'Año actual', from: `${today.year}-01-01`, to: todayText };
  }
  if (/hoy|del dia/.test(text)) return { mode: 'range', label: 'Hoy', from: todayText, to: todayText };
  return defaultLatest ? { mode: 'latest', label: 'Registro más reciente', from: '', to: '' } : { mode: 'range', label: 'Todo el historial', from: '', to: '' };
}

function withinPeriod(value, period) {
  if (!period.from || !period.to) return true;
  const date = dateOnly(value);
  return Boolean(date) && date >= period.from && date <= period.to;
}

function canonicalCategory(value) {
  const key = normalized(value);
  const exact = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => normalized(alias) === key));
  if (exact) return exact.label;
  const partial = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => key.includes(normalized(alias)) || normalized(alias).includes(key)));
  return partial?.label || clean(value, 'Sin categoría');
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

function parentheticalAliases(name) {
  return [...String(name || '').matchAll(/\(([^)]+)\)/g)].map((match) => normalized(match[1])).filter(Boolean);
}

function significantTokens(value) {
  return normalized(value).split(' ').filter((token) => token.length > 2 && !['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'cliente', 'mantenimiento', 'boleta', 'costa', 'rica', 'srl', 'sa'].includes(token));
}

function clientScore(question, client, aliases) {
  const query = normalized(question);
  const name = clientName(client);
  const nameKey = normalized(name);
  if (query.includes(nameKey)) return 1;
  if (parentheticalAliases(name).some((alias) => query.includes(alias))) return 0.995;
  for (const [alias, targets] of Object.entries(aliases)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(query)) continue;
    if (targets.some((target) => nameKey.includes(target) || target.includes(nameKey))) return 0.99;
  }
  const tokens = significantTokens(nameKey);
  const matched = tokens.filter((token) => query.includes(token));
  if (!matched.length) return 0;
  const longest = Math.max(...matched.map((token) => token.length));
  const ratio = matched.length / Math.max(1, tokens.length);
  if (matched.length >= 2 && ratio >= 0.45) return 0.94;
  if (longest >= 7) return 0.86;
  if (longest >= 5) return 0.76;
  return 0.58;
}

function resolveClient({ question, context = {}, clients, configRows }) {
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId);
  if (contextId && !/otro cliente|otra empresa/i.test(question)) {
    const current = clients.find((row) => clientId(row) === contextId);
    if (current) return { status: 'resolved', client: current };
  }
  const aliases = { ...DEFAULT_CLIENT_ALIASES, ...configAliases(configRows) };
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

function isPositive(value) {
  const text = normalized(value);
  return text === 'si' || text.startsWith('si ') || text.includes('correcto') || text.includes('funciona') || text.includes('bien');
}

function isStored(value) {
  const text = normalized(value);
  return text.includes('guardad') || text === 'no esta en uso';
}

function answersForDevice(device, category) {
  const raw = parseObject(device.RespuestasJSON);
  const configured = CHECKLISTS[category] || {};
  const answers = new Map();

  for (const [key, label] of Object.entries(configured)) {
    const capitalized = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const value = raw[key] ?? raw[capitalized] ?? device[capitalized] ?? device[key];
    if (clean(value)) answers.set(label, clean(value));
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!clean(value)) continue;
    const configuredLabel = configured[key] || configured[normalized(key).replace(/ /g, '')];
    const label = configuredLabel || clean(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
    if (!answers.has(label)) answers.set(label, clean(value));
  }
  return [...answers.entries()].map(([question, answer]) => ({ question, answer }));
}

function deviceNeedsAttention(device) {
  const state = normalized(device.Estado);
  if (state.includes('mal') || state.includes('falla') || state.includes('atencion')) return true;
  if (device.Funcionamiento && !isPositive(device.Funcionamiento)) return true;
  const use = normalized(device.EnUso);
  if (device.Funcionamiento && isPositive(device.Funcionamiento) && (isStored(use) || use.includes('uso') || use === 'si')) return false;
  return answersForDevice(device, canonicalCategory(device.Categoria || device.TipoDispositivo))
    .some(({ answer }) => normalized(answer).startsWith('no') && !isStored(answer));
}

function deviceView(device, evidenceCount = 0) {
  const category = canonicalCategory(device.Categoria || device.TipoDispositivo);
  const negativeAnswers = answersForDevice(device, category)
    .filter(({ answer }) => normalized(answer).startsWith('no') && !isStored(answer))
    .map(({ question }) => question);
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
    observation: clean(device.Observacion),
    evidenceCount,
    failedChecks: negativeAnswers.join(', '),
  };
}

function summarizeCategories(devices) {
  const categories = new Map();
  for (const device of devices) {
    const category = canonicalCategory(device.Categoria || device.TipoDispositivo);
    const current = categories.get(category) || {
      category,
      total: 0,
      good: 0,
      bad: 0,
      checklist: new Map(),
    };
    current.total += 1;
    if (deviceNeedsAttention(device)) current.bad += 1;
    else current.good += 1;

    for (const item of answersForDevice(device, category)) {
      const summary = current.checklist.get(item.question) || { question: item.question, yes: 0, no: 0, other: 0, answered: 0 };
      summary.answered += 1;
      if (isPositive(item.answer)) summary.yes += 1;
      else if (normalized(item.answer).startsWith('no') && !isStored(item.answer)) summary.no += 1;
      else summary.other += 1;
      current.checklist.set(item.question, summary);
    }
    categories.set(category, current);
  }

  return [...categories.values()]
    .map((item) => ({ ...item, checklist: [...item.checklist.values()] }))
    .sort((a, b) => a.category.localeCompare(b.category, 'es'));
}

function maintenanceReference(row = {}) {
  return clean(pick(row, ['MantenimientoRef', 'MantenimientoID', 'MantenimientoRefID', 'maintenanceId']));
}

function clarification(message, options = [], context = {}, resumeQuestion = '') {
  return {
    type: 'clarification', message, answer: message, options, sources: [], suggestions: [], facts: {}, context, resumeQuestion,
  };
}

function source(type, id, label, url) {
  return { type, id: clean(id), label: clean(label), url };
}

function clientOptions(rows) {
  return rows.map((row) => ({ type: 'client', value: clientId(row), label: clientName(row) }));
}

function permissions(ctx) {
  const values = new Set(ctx.permissions || []);
  const admin = values.has('USUARIOS_GESTIONAR');
  return {
    maintenance: admin || ['MANTENIMIENTOS_VER', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_VER'].some((code) => values.has(code)),
    tickets: admin || values.has('BOLETAS_VER'),
  };
}

function requestKind(question) {
  const text = normalized(question);
  const action = /(que se hizo|que hicieron|resumen|reporte|trabajo realizado|trabajos realizados|actividades realizadas)/.test(text);
  if (action && /mantenimiento/.test(text)) return 'maintenance';
  if (action && /(boleta|ticket)/.test(text)) return 'tickets';
  if (/(boleta|boletas|ticket|tickets)/.test(text) && /(semana|mes|ano|hoy)/.test(text)) return 'tickets';
  return '';
}

function maintenanceType(row) {
  const text = normalized(`${row.TituloMantenimiento || ''} ${row.DescripcionGeneral || ''}`);
  if (text.includes('preventiv')) return 'mantenimiento preventivo';
  if (text.includes('correctiv')) return 'mantenimiento correctivo';
  return 'mantenimiento técnico';
}

async function maintenanceReport(ctx, client, period, context) {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
  const contextId = clean(context.lastMaintenanceId || context.maintenanceId || context.pageContext?.maintenanceId || (context.pageContext?.entityType === 'maintenance' ? context.pageContext?.entityId : ''));
  let maintenance = contextId
    ? tables.Mantenimiento.find((row) => clean(row.MantenimientoID) === contextId && active(row))
    : null;
  if (!maintenance || !sameClient(maintenance, client)) {
    const matches = tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, period));
    maintenance = sortNewest(matches)[0];
  }
  if (!maintenance) {
    return {
      type: 'answer',
      answer: `No encontré mantenimientos de ${clientName(client)} para ${period.label.toLowerCase()}.`,
      facts: {}, sources: [], suggestions: [], context,
    };
  }

  const maintenanceId = clean(maintenance.MantenimientoID);
  const devices = tables.Evidencia_Mantenimientos.filter((row) => active(row) && maintenanceReference(row) === maintenanceId);
  const evidenceCounts = new Map();
  tables['Mantenimiento imagenes'].filter(active).forEach((row) => {
    const id = clean(row.DispositivoMantenimientoRef);
    evidenceCounts.set(id, (evidenceCounts.get(id) || 0) + 1);
  });

  const categories = summarizeCategories(devices);
  const badDevices = devices.filter(deviceNeedsAttention).map((device) => deviceView(device, evidenceCounts.get(clean(device.EvidenciaMantenimientoID)) || 0));
  const good = Math.max(0, devices.length - badDevices.length);
  const totalEvidence = [...evidenceCounts.values()].reduce((sum, value) => sum + value, 0);
  const categoryText = categories.map((item) => {
    const checks = item.checklist
      .map((check) => `${check.question}: ${check.yes} sí${check.no ? `, ${check.no} no` : ''}${check.other ? `, ${check.other} otro` : ''}`)
      .join('; ');
    return `${item.category}: ${item.total} equipos (${item.good} bien y ${item.bad} con atención)${checks ? `. Verificaciones: ${checks}` : ''}`;
  }).join('\n');

  const answer = [
    `En ${clientName(client)} se realizó un ${maintenanceType(maintenance)} denominado “${clean(maintenance.TituloMantenimiento, 'Mantenimiento')}”, con fecha ${dateOnly(maintenance.Fecha) || 'sin fecha registrada'}.`,
    clean(maintenance.DescripcionGeneral) ? `Descripción general: ${clean(maintenance.DescripcionGeneral)}.` : '',
    `Se registraron ${devices.length} dispositivos: ${good} en condición correcta y ${badDevices.length} que requieren atención. Se asociaron ${totalEvidence} evidencias.`,
    categoryText,
    badDevices.length ? `Los equipos con observaciones o respuestas negativas se muestran en la tabla detallada.` : 'No se encontraron equipos marcados con fallas o respuestas negativas.',
  ].filter(Boolean).join('\n');

  const facts = {
    maintenanceReport: {
      id: maintenanceId,
      title: clean(maintenance.TituloMantenimiento, 'Mantenimiento'),
      date: dateOnly(maintenance.Fecha),
      completionDate: dateOnly(maintenance.FechaFinalizacion),
      status: clean(maintenance.Estado),
      client: clientName(client),
      location: clean(maintenance.Ubicacion),
      description: clean(maintenance.DescripcionGeneral),
      maintenanceType: maintenanceType(maintenance),
      totalDevices: devices.length,
      goodDevices: good,
      badDevices: badDevices.length,
      totalEvidence,
      categories,
      attentionDevices: badDevices,
    },
    maintenance: {
      id: maintenanceId,
      title: clean(maintenance.TituloMantenimiento, 'Mantenimiento'),
      date: dateOnly(maintenance.Fecha),
      status: clean(maintenance.Estado),
      registeredDevices: devices.length,
      description: clean(maintenance.DescripcionGeneral),
    },
    devices: badDevices,
    category: 'Equipos',
  };
  const nextContext = { ...context, lastClientId: clientId(client), lastClientName: clientName(client), lastMaintenanceId: maintenanceId, lastIntent: 'maintenance_report' };
  await audit(ctx, 'ASISTENTE_REPORTE_MANTENIMIENTO', 'Mantenimiento', maintenanceId, null, { totalDevices: devices.length, badDevices: badDevices.length });
  return {
    type: 'answer', answer, facts,
    sources: [source('maintenance', maintenanceId, `${clean(maintenance.TituloMantenimiento, 'Mantenimiento')} · ${dateOnly(maintenance.Fecha)}`, `/mantenimientos/${encodeURIComponent(maintenanceId)}`)],
    suggestions: ['Dame los equipos con fallas', '¿Qué modelos se registraron?', '¿Cuántas evidencias tiene este mantenimiento?'],
    context: nextContext,
  };
}

function ticketSummary(row) {
  const performed = [
    clean(row.Descripcion || row.Descripción),
    clean(row.PruebasRealizadas || row.Pruebas),
    clean(row.Resultado),
  ].filter(Boolean).join(' ');
  return {
    uid: clean(row.BoletaUID),
    number: clean(row.BoletaID || row.BoletaUID),
    date: dateOnly(row.Fecha),
    title: clean(row.Titulo || row.TituloBoleta, 'Boleta de servicio'),
    status: clean(row.Estado, 'Sin estado'),
    reason: clean(row.RazonVisita || row.Razon_visita),
    description: clean(row.Descripcion || row.Descripción),
    tests: clean(row.PruebasRealizadas || row.Pruebas),
    result: clean(row.Resultado),
    recommendations: clean(row.Recomendaciones),
    technicians: clean(row.AsignadoA || row.Responsables),
    location: clean(row.Ubicacion),
    hours: number(row.HorasTotales),
    performed,
  };
}

async function ticketReport(ctx, client, period, context) {
  const { Boletas = [] } = await readTables(['Boletas']);
  let rows = Boletas.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, period));
  rows = sortNewest(rows);
  if (period.mode === 'latest') rows = rows.slice(0, 1);
  if (!rows.length) {
    return {
      type: 'answer',
      answer: `No encontré boletas de ${clientName(client)} para ${period.label.toLowerCase()}.`,
      facts: {}, sources: [], suggestions: [], context,
    };
  }

  const allTickets = rows.map(ticketSummary);
  const shownTickets = allTickets.slice(0, 200);
  const finalized = allTickets.filter((row) => normalized(row.status).includes('finaliz')).length;
  const pending = allTickets.filter((row) => normalized(row.status).includes('pend')).length;
  const annulled = allTickets.filter((row) => normalized(row.status).includes('anul')).length;
  const totalHours = Math.round(allTickets.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;

  const detail = shownTickets.slice(0, 12).map((ticket) => {
    const parts = [
      `Boleta #${ticket.number} del ${ticket.date || 'sin fecha'}: ${ticket.title}.`,
      ticket.reason ? `Motivo: ${ticket.reason}.` : '',
      ticket.description ? `Trabajo: ${ticket.description}.` : '',
      ticket.tests ? `Pruebas: ${ticket.tests}.` : '',
      ticket.result ? `Resultado: ${ticket.result}.` : '',
      ticket.recommendations ? `Recomendaciones: ${ticket.recommendations}.` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }).join('\n');

  const answer = period.mode === 'latest'
    ? `La boleta más reciente de ${clientName(client)} es la #${shownTickets[0].number}, del ${shownTickets[0].date || 'sin fecha registrada'}.\n${detail}`
    : `Durante ${period.label.toLowerCase()}, ${clientName(client)} tuvo ${allTickets.length} boletas: ${finalized} finalizadas, ${pending} pendientes y ${annulled} anuladas. Se registraron ${totalHours} horas en total.\n${detail}${allTickets.length > 12 ? `\nEl reporte contiene ${allTickets.length} boletas; la tabla muestra hasta 200 registros.` : ''}`;

  const facts = {
    ticketReport: {
      client: clientName(client), period: period.label, total: allTickets.length, finalized, pending, annulled, totalHours,
      tickets: shownTickets, truncated: allTickets.length > shownTickets.length,
    },
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
  const kind = requestKind(clean(ctx.payload?.message || ctx.payload?.question));
  if (!kind) return assistantDeviceCatalogHandlers.chat(ctx);

  const allowed = permissions(ctx);
  if (kind === 'maintenance' && !allowed.maintenance) throw forbidden('No cuenta con permiso para consultar mantenimientos.');
  if (kind === 'tickets' && !allowed.tickets) throw forbidden('No cuenta con permiso para consultar boletas.');

  const question = clean(ctx.payload?.message || ctx.payload?.question);
  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  const { Clientes = [], Configuracion = [] } = await readTables(['Clientes', 'Configuracion']);
  const clients = Clientes.filter(active);
  const resolution = resolveClient({ question, context, clients, configRows: Configuracion });
  if (resolution.status === 'missing') {
    return clarification('¿De qué cliente desea generar el reporte? Puede escribir el nombre completo o una abreviación, por ejemplo RN, Asamblea o BCR.', [], context, question);
  }
  if (resolution.status === 'ambiguous') {
    return clarification('Encontré varios clientes posibles. ¿A cuál se refiere?', clientOptions(resolution.options), context, question);
  }

  const period = reportPeriod(question, true);
  return kind === 'maintenance'
    ? maintenanceReport(ctx, resolution.client, period, context)
    : ticketReport(ctx, resolution.client, period, context);
}

export const assistantOperationalReportHandlers = { chat };
