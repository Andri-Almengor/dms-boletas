import { badRequest, forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { composeAssistantAnswer, interpretAssistantQuestion } from '../services/assistant-gemini.service.js';

const USER_REQUESTS = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const CLIENT_REQUIRED_INTENTS = new Set(['activity_summary', 'latest_ticket', 'latest_maintenance', 'bad_devices', 'device_counts', 'survey_average']);
const STOP_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'para', 'por', 'en', 'sa', 's', 'a', 'ltd', 'cr', 'costa', 'rica']);

const DEFAULT_CLIENT_ALIASES = {
  rn: ['junta administrativa del registro nacional', 'registro nacional'],
  registro: ['junta administrativa del registro nacional', 'registro nacional'],
  'registro nacional': ['junta administrativa del registro nacional', 'registro nacional'],
  asamblea: ['asamblea legislativa de costa rica', 'asamblea legislativa'],
  bcr: ['banco de costa rica'],
  bccr: ['banco central de costa rica'],
  ice: ['instituto costarricense de electricidad'],
  ins: ['instituto nacional de seguros'],
  aya: ['acueductos y alcantarillados'],
  ccss: ['caja costarricense de seguro social'],
  hacienda: ['ministerio de hacienda'],
  salud: ['ministerio de salud'],
};

const CATEGORY_ALIASES = [
  { label: 'Cámara', aliases: ['camara', 'camaras', 'cctv', 'videovigilancia'] },
  { label: 'Puertas', aliases: ['puerta', 'puertas', 'control de acceso', 'control acceso', 'accesos', 'lector', 'lectores', 'cerradura', 'cerraduras'] },
  { label: 'Servidor', aliases: ['servidor', 'servidores'] },
  { label: 'Grabador', aliases: ['grabador', 'grabadores', 'nvr', 'dvr', 'recording server'] },
  { label: 'Bocinas', aliases: ['bocina', 'bocinas', 'audio'] },
  { label: 'Sensor Perimetral', aliases: ['sensor perimetral', 'sensores perimetrales'] },
  { label: 'Sensor Movimiento', aliases: ['sensor movimiento', 'sensor de movimiento', 'sensores de movimiento'] },
  { label: 'Sensor de Ruptura', aliases: ['sensor de ruptura', 'sensor ruptura'] },
  { label: 'Impresora', aliases: ['impresora', 'impresoras'] },
  { label: 'Gabinete', aliases: ['gabinete', 'gabinetes'] },
  { label: 'VideoWall', aliases: ['videowall', 'video wall'] },
];

const EXPECTED_FIELDS = {
  Cámara: 'CantCámaras',
  Puertas: 'CantPuertas',
  Servidor: 'CantServidores',
  Grabador: 'CantGrabadores',
  Bocinas: 'CantBocinas',
  'Sensor Perimetral': 'CantSensoresPerimetrales',
  'Sensor Movimiento': 'CantSensoresMovimiento',
  'Sensor de Ruptura': 'CantSensorRuptura',
  Impresora: 'CantImpresora',
  Gabinete: 'CantGabinetes',
  VideoWall: 'CantVideoWall',
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

function costaRicaDateParts(date = new Date()) {
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

function shiftDate(parts, deltaDays) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function resolvePeriod(period) {
  const todayParts = costaRicaDateParts();
  const today = ymd(todayParts);
  if (period === 'today') return { label: 'Hoy', from: today, to: today };
  if (period === 'current_week') {
    const mondayOffset = todayParts.weekday === 0 ? -6 : 1 - todayParts.weekday;
    return { label: 'Semana actual', from: ymd(shiftDate(todayParts, mondayOffset)), to: today };
  }
  if (period === 'current_month') {
    return { label: 'Mes actual', from: ymd({ ...todayParts, day: 1 }), to: today };
  }
  if (period === 'last_7_days') return { label: 'Últimos 7 días', from: ymd(shiftDate(todayParts, -6)), to: today };
  return { label: 'Todo el historial', from: '', to: '' };
}

function withinPeriod(value, range) {
  const date = dateOnly(value);
  if (!range.from || !range.to) return true;
  return Boolean(date) && date >= range.from && date <= range.to;
}

function canonicalCategory(value) {
  const key = normalized(value);
  const match = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => normalized(alias) === key));
  if (match) return match.label;
  const partial = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => key.includes(normalized(alias)) || normalized(alias).includes(key)));
  return partial?.label || clean(value);
}

function stripHtml(value) {
  return clean(value, '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function significantTokens(value) {
  return normalized(value).split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function initials(value) {
  return significantTokens(value).map((token) => token[0]).join('');
}

function levenshtein(left, right) {
  const a = normalized(left);
  const b = normalized(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function similarity(left, right) {
  const a = normalized(left);
  const b = normalized(right);
  const size = Math.max(a.length, b.length);
  return size ? 1 - (levenshtein(a, b) / size) : 1;
}

function clientId(row) {
  return clean(pick(row, ['ClienteID', 'id']));
}

function clientName(row) {
  return clean(pick(row, ['Nombre', 'RazonSocial', 'Clientes', 'Cliente']), 'Cliente');
}

function configAliases(rows = []) {
  const row = rows.find((item) => normalized(item.Clave) === 'asistente cliente aliases json');
  if (!row) return {};
  const parsed = parseJsonObject(row.Valor || row.Value || row.Configuracion);
  return Object.fromEntries(Object.entries(parsed).map(([alias, target]) => [normalized(alias), Array.isArray(target) ? target.map(normalized) : [normalized(target)]]));
}

function clientScore(query, client, aliases) {
  const queryKey = normalized(query);
  const name = clientName(client);
  const nameKey = normalized(name);
  if (!queryKey) return 0;
  if (queryKey === nameKey) return 1;
  if (initials(name) === queryKey.replace(/\s/g, '')) return 0.97;
  const aliasTargets = aliases[queryKey] || [];
  if (aliasTargets.some((target) => nameKey.includes(target) || target.includes(nameKey))) return 0.99;
  if (nameKey.includes(queryKey)) return queryKey.length >= 4 ? 0.93 : 0.82;
  const queryTokens = significantTokens(queryKey);
  const nameTokens = new Set(significantTokens(nameKey));
  if (queryTokens.length && queryTokens.every((token) => nameTokens.has(token))) return 0.9;
  return similarity(queryKey, nameKey) * 0.82;
}

function resolveClient({ query, context = {}, clients, configRows }) {
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId);
  if (!query && contextId) {
    const found = clients.find((row) => clientId(row) === contextId);
    if (found) return { status: 'resolved', client: found, matchType: 'context', confidence: 1 };
  }
  if (!query) return { status: 'missing' };

  const aliases = { ...DEFAULT_CLIENT_ALIASES, ...configAliases(configRows) };
  const ranked = clients
    .map((client) => ({ client, score: clientScore(query, client, aliases) }))
    .filter((item) => item.score >= 0.58)
    .sort((a, b) => b.score - a.score || clientName(a.client).localeCompare(clientName(b.client), 'es'));

  if (!ranked.length) return { status: 'not_found', query };
  const best = ranked[0];
  const second = ranked[1];
  if (best.score < 0.78 || (second && best.score < 0.98 && best.score - second.score < 0.08)) {
    return { status: 'ambiguous', query, options: ranked.slice(0, 5).map((item) => item.client) };
  }
  return { status: 'resolved', client: best.client, matchType: best.score >= 0.98 ? 'exact_or_alias' : 'approximate', confidence: Math.round(best.score * 100) / 100 };
}

function sortNewest(rows, dateFields, numericField = '') {
  return [...rows].sort((left, right) => {
    for (const field of dateFields) {
      const comparison = clean(right[field]).localeCompare(clean(left[field]), 'es');
      if (comparison) return comparison;
    }
    if (numericField) return number(right[numericField]) - number(left[numericField]);
    return 0;
  });
}

function sameClient(row, client) {
  const id = clientId(client);
  return (id && clean(row.ClienteID || row.ClienteRef) === id)
    || normalized(row.Cliente || row.ClienteNombre) === normalized(clientName(client));
}

function ticketSummary(row) {
  return {
    uid: clean(row.BoletaUID),
    number: clean(row.BoletaID || row.BoletaUID),
    title: clean(row.Titulo || row.TituloBoleta, 'Boleta de servicio'),
    date: dateOnly(row.Fecha),
    status: clean(row.Estado, 'Sin estado'),
    reason: clean(row.RazonVisita || row.Razon_visita),
    description: clean(row.Descripcion || row.Descripción),
    tests: clean(row.PruebasRealizadas || row.Pruebas),
    result: clean(row.Resultado),
    recommendations: clean(row.Recomendaciones),
    technicians: clean(row.AsignadoA || row.Responsables),
    location: clean(row.Ubicacion),
  };
}

function maintenanceSummary(row, devices = []) {
  return {
    id: clean(row.MantenimientoID),
    title: clean(row.TituloMantenimiento, 'Mantenimiento'),
    date: dateOnly(row.Fecha),
    completionDate: dateOnly(row.FechaFinalizacion),
    status: clean(row.Estado, 'Sin estado'),
    description: clean(row.DescripcionGeneral),
    responsible: clean(row.Responsables || row.Responsable),
    location: clean(row.Ubicacion),
    registeredDevices: devices.length,
  };
}

function expectedCount(maintenance, category) {
  const field = EXPECTED_FIELDS[category];
  if (!field) return 0;
  const json = parseJsonObject(maintenance.CantidadesJSON);
  return number(json[field] ?? maintenance[field]);
}

function isPositive(value) {
  const text = normalized(value);
  return text === 'si' || text.startsWith('si ') || text.includes('correcto') || text.includes('funciona');
}

function isStored(value) {
  const text = normalized(value);
  return text.includes('guardad') || text === 'no esta en uso';
}

function deviceNeedsAttention(device) {
  const state = normalized(device.Estado);
  if (state.includes('mal') || state.includes('falla') || state.includes('atencion')) return true;
  if (device.Funcionamiento && !isPositive(device.Funcionamiento)) return true;
  const use = normalized(device.EnUso);
  if (device.Funcionamiento && isPositive(device.Funcionamiento) && (isStored(use) || use.includes('uso') || use === 'si')) return false;
  const answers = parseJsonObject(device.RespuestasJSON);
  return Object.values(answers).some((value) => normalized(value).startsWith('no') && !isStored(value));
}

function deviceView(device, imageCount = 0) {
  return {
    id: clean(device.EvidenciaMantenimientoID),
    category: canonicalCategory(device.Categoria || device.TipoDispositivo),
    name: clean(device.NombreDispositivo, 'Dispositivo'),
    zone: clean(device.Zona),
    manufacturer: clean(device.Fabricante),
    model: clean(device.Modelo),
    serial: clean(device.Serie),
    functioning: clean(device.Funcionamiento),
    inUse: clean(device.EnUso),
    state: clean(device.Estado),
    observation: clean(device.Observacion),
    evidenceCount: imageCount,
  };
}

function wordsScore(query, text) {
  const queryTokens = significantTokens(query);
  if (!queryTokens.length) return 0;
  const source = normalized(text);
  let score = 0;
  for (const token of queryTokens) {
    if (source.includes(token)) score += token.length >= 6 ? 3 : 2;
  }
  if (source.includes(normalized(query))) score += 8;
  return score;
}

function clarification(message, options = [], context = {}, resumeQuestion = '') {
  return {
    type: 'clarification',
    message,
    answer: message,
    options,
    sources: [],
    suggestions: [],
    context,
    resumeQuestion,
  };
}

function permissionFlags(ctx) {
  const permissions = new Set(ctx.permissions || []);
  const admin = permissions.has('USUARIOS_GESTIONAR');
  return {
    admin,
    tickets: admin || permissions.has('BOLETAS_VER'),
    maintenance: admin || ['MANTENIMIENTOS_VER', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_VER'].some((code) => permissions.has(code)),
    knowledge: true,
    surveys: admin,
  };
}

function assertCanUse(ctx) {
  const flags = permissionFlags(ctx);
  if (!flags.tickets && !flags.maintenance && !flags.knowledge && !flags.admin) throw forbidden('No cuenta con permiso para usar el asistente.');
  return flags;
}

function rateLimit(ctx) {
  const key = clean(ctx.user?.UsuarioID || ctx.ip, 'anonymous');
  const now = Date.now();
  const recent = (USER_REQUESTS.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw badRequest('Ha realizado muchas consultas seguidas. Espere un momento y vuelva a intentarlo.');
  recent.push(now);
  USER_REQUESTS.set(key, recent);
}

function heuristicInterpretation(question, context = {}) {
  const text = normalized(question);
  let intent = 'general_search';
  if (/como|instal|configur|tutorial|procedimiento|solucion/.test(text)) intent = 'knowledge_search';
  else if (/promedio|encuesta|calificacion/.test(text)) intent = 'survey_average';
  else if (/(camara|puerta|dispositivo).*(mal|falla|atencion)|malas|malos/.test(text)) intent = 'bad_devices';
  else if (/cuant|cantidad|esperad|registrad/.test(text)) intent = 'device_counts';
  else if (/ultima boleta|boleta mas reciente|ultimo ticket/.test(text)) intent = 'latest_ticket';
  else if (/ultimo mantenimiento|mantenimiento mas reciente|que se hizo en el mantenimiento/.test(text)) intent = 'latest_maintenance';
  else if (/que paso|esta semana|este mes|hoy/.test(text)) intent = 'activity_summary';

  let period = '';
  if (text.includes('esta semana')) period = 'current_week';
  else if (text.includes('este mes')) period = 'current_month';
  else if (text.includes('hoy')) period = 'today';
  else if (text.includes('ultimos 7 dias')) period = 'last_7_days';

  const category = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => text.includes(normalized(alias))))?.label || '';
  return {
    intent,
    clientQuery: '',
    categoryQuery: category,
    topicQuery: intent === 'knowledge_search' ? question : '',
    period,
    clarificationNeeded: false,
    clarificationQuestion: '',
    model: 'heuristic',
    context,
  };
}

async function interpret(question, history, context) {
  try {
    return await interpretAssistantQuestion({ question, history, context, today: ymd(costaRicaDateParts()) });
  } catch (error) {
    console.warn(`[assistant] Gemini no pudo interpretar la consulta: ${error.message}`);
    return heuristicInterpretation(question, context);
  }
}

function clientOptions(rows) {
  return rows.map((row) => ({ type: 'client', value: clientId(row), label: clientName(row) }));
}

async function loadPageContext(context, flags) {
  const pageContext = context.pageContext || {};
  const entityType = clean(pageContext.entityType);
  const entityId = clean(pageContext.entityId);
  if (!entityId) return context;
  if (entityType === 'maintenance' && flags.maintenance) {
    const { Mantenimiento = [] } = await readTables(['Mantenimiento']);
    const row = Mantenimiento.find((item) => clean(item.MantenimientoID) === entityId && active(item));
    if (row) return { ...context, lastMaintenanceId: entityId, lastClientId: clean(row.ClienteID || row.ClienteRef), lastClientName: clean(row.Cliente) };
  }
  if (entityType === 'ticket' && flags.tickets) {
    const { Boletas = [] } = await readTables(['Boletas']);
    const row = Boletas.find((item) => clean(item.BoletaUID) === entityId && active(item));
    if (row) return { ...context, lastTicketId: entityId, lastClientId: clean(row.ClienteID), lastClientName: clean(row.Cliente) };
  }
  if (entityType === 'knowledge') return { ...context, lastKnowledgeId: entityId };
  return context;
}

function source(type, id, label, url) {
  return { type, id: clean(id), label: clean(label), url };
}

function fallbackAnswer(intent, facts, interpretedContext) {
  const client = interpretedContext.client || '';
  if (intent === 'latest_ticket') {
    const ticket = facts.ticket;
    if (!ticket) return `No encontré boletas para ${client || 'el cliente indicado'}.`;
    return `La boleta más reciente de ${client} es la #${ticket.number}, del ${ticket.date || 'sin fecha'}. ${ticket.title}. ${ticket.result || ticket.description || 'No tiene un resultado detallado registrado.'}`;
  }
  if (intent === 'latest_maintenance') {
    const maintenance = facts.maintenance;
    if (!maintenance) return `No encontré mantenimientos para ${client || 'el cliente indicado'}.`;
    return `El mantenimiento más reciente de ${client} es del ${maintenance.date || 'sin fecha'}: ${maintenance.title}. ${maintenance.description || 'No tiene descripción general registrada.'} Se registraron ${maintenance.registeredDevices} dispositivos.`;
  }
  if (intent === 'bad_devices') {
    if (!facts.maintenance) return `No encontré un mantenimiento para ${client || 'el cliente indicado'}.`;
    if (!facts.devices?.length) return `No encontré dispositivos que requieran atención en el mantenimiento más reciente de ${client}.`;
    return `Encontré ${facts.devices.length} dispositivo${facts.devices.length === 1 ? '' : 's'} que requiere${facts.devices.length === 1 ? '' : 'n'} atención en ${facts.maintenance.title}: ${facts.devices.map((item) => `${item.name}${item.zone ? ` (${item.zone})` : ''}`).join(', ')}.`;
  }
  if (intent === 'device_counts') {
    return `En el mantenimiento más reciente de ${client}, la categoría ${facts.category} tiene ${facts.registered} registrados y ${facts.expected} esperados.`;
  }
  if (intent === 'survey_average') {
    if (!facts.responded) return `No encontré encuestas respondidas para ${client}.`;
    return `${client} tiene ${facts.responded} encuesta${facts.responded === 1 ? '' : 's'} respondida${facts.responded === 1 ? '' : 's'}, con un promedio general de ${facts.average} sobre 5.`;
  }
  if (intent === 'knowledge_search') {
    if (!facts.articles?.length) return 'No encontré un tutorial publicado que coincida con la consulta. Intente indicar el sistema, marca o procedimiento con más detalle.';
    const article = facts.articles[0];
    return `Encontré el tutorial “${article.title}”. ${article.problem || article.excerpt}`;
  }
  if (intent === 'activity_summary') {
    return `Para ${client}, durante ${interpretedContext.period || 'el periodo consultado'}, se encontraron ${facts.ticketCount} boletas y ${facts.maintenanceCount} mantenimientos.${facts.attentionDevices ? ` Hay ${facts.attentionDevices} dispositivos que requieren atención.` : ''}`;
  }
  return 'Encontré información relacionada, pero necesito una consulta más específica para presentarla correctamente.';
}

async function answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext }) {
  try {
    return await composeAssistantAnswer({ question, interpretation, facts, interpretedContext });
  } catch (error) {
    console.warn(`[assistant] Gemini no pudo redactar la respuesta: ${error.message}`);
    return { answer: fallbackAnswer(interpretation.intent, facts, interpretedContext), suggestions: [], model: 'fallback' };
  }
}

async function executeIntent({ question, interpretation, context, client, flags }) {
  const clientLabel = client ? clientName(client) : clean(context.lastClientName);
  const range = resolvePeriod(interpretation.period || (interpretation.intent === 'activity_summary' ? 'current_week' : 'all'));
  const category = canonicalCategory(interpretation.categoryQuery || context.lastCategory || '');
  const interpretedContext = {
    client: clientLabel,
    clientId: client ? clientId(client) : clean(context.lastClientId),
    category,
    period: range.label,
  };
  const nextContext = {
    ...context,
    lastClientId: interpretedContext.clientId,
    lastClientName: clientLabel,
    lastCategory: category,
    lastIntent: interpretation.intent,
  };

  if (interpretation.intent === 'latest_ticket') {
    if (!flags.tickets) throw forbidden('No cuenta con permiso para consultar boletas.');
    const { Boletas = [] } = await readTables(['Boletas']);
    const ticket = sortNewest(Boletas.filter((row) => active(row) && sameClient(row, client)), ['Fecha', 'FechaCreacion', 'FechaActualizacion'], 'BoletaID')[0];
    const facts = { ticket: ticket ? ticketSummary(ticket) : null };
    if (ticket) nextContext.lastTicketId = clean(ticket.BoletaUID);
    const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext });
    return {
      type: 'answer', ...response, facts,
      sources: ticket ? [source('ticket', ticket.BoletaUID, `Boleta #${ticket.BoletaID || ticket.BoletaUID} · ${ticket.Titulo || 'Servicio'}`, `/boletas/${encodeURIComponent(ticket.BoletaUID)}`)] : [],
      context: nextContext,
    };
  }

  if (interpretation.intent === 'latest_maintenance' || interpretation.intent === 'bad_devices' || interpretation.intent === 'device_counts') {
    if (!flags.maintenance) throw forbidden('No cuenta con permiso para consultar mantenimientos.');
    const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
    let maintenance = null;
    const requestedMaintenanceId = clean(context.lastMaintenanceId || context.pageContext?.maintenanceId);
    if (requestedMaintenanceId) maintenance = tables.Mantenimiento.find((row) => clean(row.MantenimientoID) === requestedMaintenanceId && active(row));
    if (!maintenance || (client && !sameClient(maintenance, client))) {
      maintenance = sortNewest(tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client)), ['Fecha', 'FechaCreacion', 'FechaActualizacion'])[0];
    }
    const devices = maintenance
      ? tables.Evidencia_Mantenimientos.filter((row) => active(row) && clean(row.MantenimientoRef) === clean(maintenance.MantenimientoID))
      : [];
    const imageCounts = new Map();
    tables['Mantenimiento imagenes'].filter(active).forEach((row) => {
      const id = clean(row.DispositivoMantenimientoRef);
      imageCounts.set(id, (imageCounts.get(id) || 0) + 1);
    });
    if (maintenance) nextContext.lastMaintenanceId = clean(maintenance.MantenimientoID);

    if (interpretation.intent === 'latest_maintenance') {
      const facts = { maintenance: maintenance ? maintenanceSummary(maintenance, devices) : null };
      const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext });
      return {
        type: 'answer', ...response, facts,
        sources: maintenance ? [source('maintenance', maintenance.MantenimientoID, `${maintenance.TituloMantenimiento || 'Mantenimiento'} · ${dateOnly(maintenance.Fecha)}`, `/mantenimientos/${encodeURIComponent(maintenance.MantenimientoID)}`)] : [],
        context: nextContext,
      };
    }

    if (interpretation.intent === 'bad_devices') {
      const filtered = devices
        .filter((row) => !category || canonicalCategory(row.Categoria || row.TipoDispositivo) === category)
        .filter(deviceNeedsAttention)
        .map((row) => deviceView(row, imageCounts.get(clean(row.EvidenciaMantenimientoID)) || 0));
      const facts = { maintenance: maintenance ? maintenanceSummary(maintenance, devices) : null, category: category || 'Todos', devices: filtered.slice(0, 100), total: filtered.length };
      const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext });
      return {
        type: 'answer', ...response, facts,
        sources: maintenance ? [source('maintenance', maintenance.MantenimientoID, `${maintenance.TituloMantenimiento || 'Mantenimiento'} · dispositivos con atención`, `/mantenimientos/${encodeURIComponent(maintenance.MantenimientoID)}`)] : [],
        context: nextContext,
      };
    }

    const targetCategory = category || 'Cámara';
    const registered = devices.filter((row) => canonicalCategory(row.Categoria || row.TipoDispositivo) === targetCategory).length;
    const expected = maintenance ? expectedCount(maintenance, targetCategory) : 0;
    const facts = { maintenance: maintenance ? maintenanceSummary(maintenance, devices) : null, category: targetCategory, registered, expected, missing: Math.max(0, expected - registered) };
    const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext: { ...interpretedContext, category: targetCategory } });
    return {
      type: 'answer', ...response, facts,
      sources: maintenance ? [source('maintenance', maintenance.MantenimientoID, `${maintenance.TituloMantenimiento || 'Mantenimiento'} · ${targetCategory}`, `/mantenimientos/${encodeURIComponent(maintenance.MantenimientoID)}`)] : [],
      context: { ...nextContext, lastCategory: targetCategory },
    };
  }

  if (interpretation.intent === 'survey_average') {
    if (!flags.surveys) throw forbidden('Las métricas de encuestas están disponibles únicamente para administradores.');
    const tables = await readTables(['Encuestas', 'EncuestaRespuestas']);
    const surveys = tables.Encuestas.filter((row) => active(row) && sameClient(row, client) && normalized(row.Estado) === 'respondida' && withinPeriod(row.FechaRespuesta || row.FechaCreacion, range));
    const averages = surveys.map((row) => number(row.Promedio)).filter((value) => value > 0);
    const average = averages.length ? Math.round((averages.reduce((sum, value) => sum + value, 0) / averages.length) * 100) / 100 : 0;
    const surveyIds = new Set(surveys.map((row) => clean(row.EncuestaID)));
    const byQuestion = new Map();
    tables.EncuestaRespuestas.filter((row) => surveyIds.has(clean(row.EncuestaID))).forEach((row) => {
      const label = clean(row.PreguntaTexto, 'Pregunta');
      const current = byQuestion.get(label) || { total: 0, count: 0 };
      current.total += number(row.Calificacion);
      current.count += 1;
      byQuestion.set(label, current);
    });
    const facts = {
      responded: surveys.length,
      average,
      period: range.label,
      byQuestion: [...byQuestion.entries()].map(([questionText, value]) => ({ question: questionText, average: Math.round((value.total / value.count) * 100) / 100, responses: value.count })),
    };
    const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext });
    return { type: 'answer', ...response, facts, sources: [source('surveys', clientId(client), `Encuestas de ${clientLabel}`, '/encuestas')], context: nextContext };
  }

  if (interpretation.intent === 'knowledge_search') {
    const tables = await readTables(['KnowledgeArticles', 'KnowledgeCategories', 'KnowledgeArticleCategories']);
    const query = clean(interpretation.topicQuery || question, question);
    const categories = new Map(tables.KnowledgeCategories.filter(active).map((row) => [clean(row.CategoriaConocimientoID), clean(row.Nombre)]));
    const relations = tables.KnowledgeArticleCategories.filter(active);
    const articles = tables.KnowledgeArticles
      .filter((row) => active(row) && normalized(row.Estado || 'PUBLICADO') === 'publicado')
      .map((row) => {
        const id = clean(row.TutorialID);
        const categoryNames = relations
          .filter((relation) => clean(relation.TutorialID) === id)
          .map((relation) => categories.get(clean(relation.CategoriaConocimientoID)))
          .filter(Boolean);
        const text = [row.Titulo, row.ProblemaResuelto, stripHtml(row.ContenidoHTML), categoryNames.join(' ')].join(' ');
        return {
          row,
          score: (wordsScore(query, row.Titulo) * 3) + (wordsScore(query, row.ProblemaResuelto) * 2) + wordsScore(query, text),
          categories: categoryNames,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const facts = {
      query,
      articles: articles.map(({ row, categories: articleCategories }) => ({
        id: clean(row.TutorialID),
        title: clean(row.Titulo, 'Tutorial'),
        problem: clean(row.ProblemaResuelto),
        excerpt: stripHtml(row.ContenidoHTML).slice(0, 1800),
        categories: articleCategories,
      })),
    };
    if (articles[0]) nextContext.lastKnowledgeId = clean(articles[0].row.TutorialID);
    const response = await answerWithGeminiOrFallback({ question, interpretation, facts, interpretedContext: { ...interpretedContext, topic: query } });
    return {
      type: 'answer', ...response, facts,
      sources: articles.map(({ row }) => source('knowledge', row.TutorialID, row.Titulo || 'Tutorial', `/conocimiento/${encodeURIComponent(row.TutorialID)}`)),
      context: nextContext,
    };
  }

  if (interpretation.intent === 'activity_summary' || interpretation.intent === 'general_search') {
    if (!flags.tickets && !flags.maintenance) throw forbidden('No cuenta con permiso para consultar actividad operativa.');
    const tableNames = [];
    if (flags.tickets) tableNames.push('Boletas');
    if (flags.maintenance) tableNames.push('Mantenimiento', 'Evidencia_Mantenimientos');
    const tables = await readTables(tableNames);
    const tickets = flags.tickets ? tables.Boletas.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, range)) : [];
    const maintenances = flags.maintenance ? tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client) && withinPeriod(row.Fecha || row.FechaCreacion, range)) : [];
    const maintenanceIds = new Set(maintenances.map((row) => clean(row.MantenimientoID)));
    const attentionDevices = flags.maintenance ? tables.Evidencia_Mantenimientos.filter((row) => active(row) && maintenanceIds.has(clean(row.MantenimientoRef)) && deviceNeedsAttention(row)) : [];
    const recentTickets = sortNewest(tickets, ['Fecha', 'FechaCreacion'], 'BoletaID').slice(0, 5).map(ticketSummary);
    const recentMaintenances = sortNewest(maintenances, ['Fecha', 'FechaCreacion']).slice(0, 5).map((row) => maintenanceSummary(row, tables.Evidencia_Mantenimientos.filter((device) => clean(device.MantenimientoRef) === clean(row.MantenimientoID) && active(device))));
    const facts = { ticketCount: tickets.length, maintenanceCount: maintenances.length, attentionDevices: attentionDevices.length, recentTickets, recentMaintenances, period: range };
    const response = await answerWithGeminiOrFallback({ question, interpretation: { ...interpretation, intent: 'activity_summary' }, facts, interpretedContext });
    return {
      type: 'answer', ...response, facts,
      sources: [
        ...recentTickets.slice(0, 3).map((ticket) => source('ticket', ticket.uid, `Boleta #${ticket.number} · ${ticket.title}`, `/boletas/${encodeURIComponent(ticket.uid)}`)),
        ...recentMaintenances.slice(0, 3).map((maintenance) => source('maintenance', maintenance.id, `${maintenance.title} · ${maintenance.date}`, `/mantenimientos/${encodeURIComponent(maintenance.id)}`)),
      ],
      context: nextContext,
    };
  }

  return clarification('No pude identificar con seguridad qué información necesita. Indique si desea consultar una boleta, mantenimiento, dispositivo, encuesta o tutorial.', [], nextContext, question);
}

async function chat(ctx) {
  const flags = assertCanUse(ctx);
  rateLimit(ctx);
  const question = clean(ctx.payload?.message || ctx.payload?.question, '');
  if (!question) throw badRequest('Escriba una pregunta para el asistente.');
  if (question.length > 1200) throw badRequest('La pregunta es demasiado extensa. Redúzcala a un máximo de 1,200 caracteres.');
  const history = Array.isArray(ctx.payload?.history)
    ? ctx.payload.history.slice(-8).map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', text: clean(item.text, 900) }))
    : [];
  let context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  context = await loadPageContext(context, flags);
  const interpretation = await interpret(question, history, context);

  if (interpretation.clarificationNeeded || interpretation.intent === 'clarification') {
    return clarification(interpretation.clarificationQuestion || 'No entendí completamente la solicitud. Indique qué cliente, mantenimiento, boleta o procedimiento desea consultar.', [], context, question);
  }

  const { Clientes = [], Configuracion = [] } = await readTables(['Clientes', 'Configuracion']);
  const clients = Clientes.filter(active);
  let clientResolution = null;

  if (CLIENT_REQUIRED_INTENTS.has(interpretation.intent) || interpretation.clientQuery || context.lastClientId || context.pageContext?.clientId) {
    clientResolution = resolveClient({ query: interpretation.clientQuery, context, clients, configRows: Configuracion });
    if (clientResolution.status === 'missing' && CLIENT_REQUIRED_INTENTS.has(interpretation.intent)) {
      return clarification('¿De qué cliente desea consultar esta información? Puede escribir el nombre completo o una abreviación, por ejemplo RN, Asamblea o BCR.', [], context, question);
    }
    if (clientResolution.status === 'not_found') {
      const similar = clients
        .map((candidate) => ({ client: candidate, score: similarity(clientResolution.query, clientName(candidate)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((item) => item.client);
      return clarification(`No encontré un cliente que coincida claramente con “${clientResolution.query}”. Seleccione una opción o escriba un nombre más específico.`, clientOptions(similar), context, question);
    }
    if (clientResolution.status === 'ambiguous') {
      return clarification(`Encontré varios clientes relacionados con “${clientResolution.query}”. ¿A cuál se refiere?`, clientOptions(clientResolution.options), context, question);
    }
    if (clientResolution.status === 'resolved') {
      context.lastClientId = clientId(clientResolution.client);
      context.lastClientName = clientName(clientResolution.client);
    }
  }

  const result = await executeIntent({
    question,
    interpretation,
    context,
    client: clientResolution?.client || clients.find((row) => clientId(row) === clean(context.lastClientId)) || null,
    flags,
  });

  await audit(
    ctx,
    'CONSULTAR_ASISTENTE',
    'Asistente',
    clean(ctx.payload?.conversationId || ctx.user?.UsuarioID, 'consulta'),
    null,
    {
      Intencion: interpretation.intent,
      ClienteID: result.context?.lastClientId || '',
      FuenteCantidad: result.sources?.length || 0,
      ModeloInterpretacion: interpretation.model || '',
      TipoRespuesta: result.type,
    },
  ).catch((error) => console.warn(`[assistant] No se pudo registrar auditoría: ${error.message}`));

  return {
    ...result,
    interpreted: {
      intent: interpretation.intent,
      clientQuery: interpretation.clientQuery,
      client: result.context?.lastClientName || '',
      category: result.context?.lastCategory || interpretation.categoryQuery || '',
      period: interpretation.period || '',
    },
  };
}

export const assistantHandlers = { chat };
