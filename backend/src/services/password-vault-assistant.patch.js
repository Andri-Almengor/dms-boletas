import { forbidden } from '../core/errors.js';
import { readTables } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import {
  canReadPasswordVault,
  queryPasswordVaultForAssistant,
} from '../modules/password-vault.module.js';

const INSTALL_FLAG = Symbol.for('dms.passwordVaultAssistantPatch');
const CLIENT_ALIASES = Object.freeze({
  rn: ['registro nacional', 'junta administrativa del registro nacional'],
  registro: ['registro nacional', 'junta administrativa del registro nacional'],
  asamblea: ['asamblea legislativa', 'asamblea legislativa de costa rica'],
  bcr: ['banco de costa rica'],
  bccr: ['banco central de costa rica'],
  ice: ['instituto costarricense de electricidad'],
  ins: ['instituto nacional de seguros'],
  aya: ['acueductos y alcantarillados'],
  ccss: ['caja costarricense de seguro social'],
  afz: ['afz'],
});

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
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
    && clean(row.Activo ?? 'true', 20).toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

function clientId(row = {}) {
  return clean(row.ClienteID || row.id, 220);
}

function clientName(row = {}) {
  return clean(row.Clientes || row.Cliente || row.Nombre || row.RazonSocial, 250) || 'Cliente';
}

function initials(value) {
  return normalized(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['de', 'del', 'la', 'las', 'el', 'los', 'sa', 's', 'cr'].includes(token))
    .map((token) => token[0])
    .join('');
}

function clientScore(question, client) {
  const query = normalized(question);
  const name = normalized(clientName(client));
  if (!query || !name) return 0;
  if (query.includes(name)) return 1;
  const acronym = initials(clientName(client));
  if (acronym && new RegExp(`\\b${acronym}\\b`, 'i').test(query)) return 0.98;
  for (const [alias, targets] of Object.entries(CLIENT_ALIASES)) {
    if (!new RegExp(`\\b${normalized(alias)}\\b`, 'i').test(query)) continue;
    if (targets.some((target) => name.includes(normalized(target)) || normalized(target).includes(name))) return 0.99;
  }
  const tokens = name.split(' ').filter((token) => token.length > 3);
  const hits = tokens.filter((token) => query.includes(token)).length;
  if (hits >= 2) return 0.9 + Math.min(0.07, hits / 100);
  if (hits === 1 && tokens.length === 1) return 0.86;
  return 0;
}

function resolveClient(question, clients, context = {}, { required = false } = {}) {
  const ranked = clients
    .map((client) => ({ client, score: clientScore(question, client) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || clientName(left.client).localeCompare(clientName(right.client), 'es'));
  if (ranked.length === 1 || (ranked[0] && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.08))) {
    return { status: 'resolved', client: ranked[0].client };
  }
  if (ranked.length > 1) {
    return { status: 'ambiguous', options: ranked.slice(0, 5).map((item) => item.client) };
  }
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId, 220);
  if (contextId) {
    const client = clients.find((item) => clientId(item) === contextId);
    if (client) return { status: 'resolved', client };
  }
  return required ? { status: 'missing' } : { status: 'none' };
}

function clarification(question, message, clients, context = {}) {
  return {
    type: 'clarification',
    answer: message,
    resumeQuestion: question,
    sources: [],
    suggestions: [],
    options: clients.slice(0, 8).map((client) => ({
      type: 'client',
      value: clientId(client),
      label: clientName(client),
    })),
    context,
  };
}

function credentialIntent(question) {
  const value = normalized(question);
  return /\b(contrasena|contrasenas|password|passwords|credencial|credenciales|clave|claves)\b/.test(value)
    && /\b(usuario|usuarios|sistema|sistemas|camara|camaras|acceso|accesos|lista|listar|dame|mostrar|muestrame|cual|cuales)\b/.test(value);
}

function caseIntent(question) {
  const value = normalized(question);
  return /\b(caso|casos|solicitud|solicitudes)\b/.test(value)
    && /\b(activo|activos|nuevos|nuevo|espera|proceso|finalizado|finalizados|asignar|asignado|asignados|resumen|cuantos|cuantas|queda|quedan|llegaron)\b/.test(value);
}

function categoryMatch(question, categories = []) {
  const query = normalized(question);
  const ranked = categories
    .filter(active)
    .map((category) => {
      const name = normalized(category.Nombre);
      const singular = name.replace(/s$/, '');
      const score = query.includes(name) ? 1 : singular && query.includes(singular) ? 0.92 : 0;
      return { category, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.category || null;
}

function remainingCredentialSearch(question, client, category) {
  const ignored = new Set([
    'dame', 'lista', 'listar', 'muestra', 'muestrame', 'mostrar', 'usuarios', 'usuario',
    'contrasenas', 'contrasena', 'password', 'passwords', 'credenciales', 'credencial',
    'claves', 'clave', 'del', 'de', 'la', 'las', 'el', 'los', 'para', 'cliente', 'sistemas', 'sistema',
    ...normalized(clientName(client)).split(' '),
    ...normalized(category?.Nombre || '').split(' '),
  ]);
  return normalized(question)
    .split(' ')
    .filter((token) => token.length > 2 && !ignored.has(token))
    .join(' ');
}

async function credentialAnswer(ctx, question) {
  if (!canReadPasswordVault(ctx)) {
    throw forbidden('No cuenta con permiso para consultar credenciales de clientes.');
  }
  const tables = await readTables(['Clientes', 'CategoriasCredenciales']);
  const clients = (tables.Clientes || []).filter(active);
  const resolution = resolveClient(question, clients, ctx.payload?.context || {}, { required: true });
  if (resolution.status === 'missing') {
    return clarification(
      question,
      'Indique el cliente de las credenciales que necesita consultar. Por seguridad, el asistente nunca muestra contraseñas de todos los clientes en una sola consulta.',
      clients,
      ctx.payload?.context || {},
    );
  }
  if (resolution.status === 'ambiguous') {
    return clarification(question, 'Encontré varios clientes posibles. Seleccione uno para continuar.', resolution.options, ctx.payload?.context || {});
  }

  const client = resolution.client;
  const category = categoryMatch(question, tables.CategoriasCredenciales || []);
  const search = remainingCredentialSearch(question, client, category);
  let rows = await queryPasswordVaultForAssistant(ctx, {
    clientId: clientId(client),
    categoryId: clean(category?.CategoriaCredencialID, 220),
    search,
    limit: 30,
  });
  if (!rows.length && search) {
    rows = await queryPasswordVaultForAssistant(ctx, {
      clientId: clientId(client),
      categoryId: clean(category?.CategoriaCredencialID, 220),
      search: '',
      limit: 30,
    });
  }

  const categoryLabel = category ? ` en la categoría ${clean(category.Nombre)}` : '';
  return {
    type: 'answer',
    answer: rows.length
      ? `Encontré ${rows.length} credencial${rows.length === 1 ? '' : 'es'} de ${clientName(client)}${categoryLabel}. Las contraseñas se muestran en una tabla sensible y no se guardarán en el historial local del asistente.`
      : `No encontré credenciales activas de ${clientName(client)}${categoryLabel}.`,
    sensitive: rows.length > 0,
    facts: {
      credentialResults: {
        clientId: clientId(client),
        clientName: clientName(client),
        categoryName: clean(category?.Nombre),
        total: rows.length,
        rows,
      },
    },
    sources: [{
      type: 'credentials',
      id: clientId(client),
      label: `Credenciales de ${clientName(client)}`,
      url: `/credenciales?cliente=${encodeURIComponent(clientId(client))}`,
    }],
    suggestions: [
      `Abrir el gestor de contraseñas de ${clientName(client)}`,
      `¿Cuántos casos activos tiene ${clientName(client)}?`,
    ],
    options: [],
    context: {
      ...(ctx.payload?.context || {}),
      lastClientId: clientId(client),
      lastClientName: clientName(client),
      lastIntent: 'credential_search',
    },
  };
}

function parseIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(clean(value));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return clean(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
}

function caseState(row = {}) {
  const value = normalized(row.Estado).replace(/ /g, '_');
  if (value === 'en_proceso' || value === 'proceso') return 'EN_PROCESO';
  if (value.startsWith('finaliz')) return 'FINALIZADO';
  return 'EN_ESPERA';
}

function dateOnly(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function todayCostaRica() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function caseAnswer(ctx, question) {
  const admin = (ctx.permissions || []).includes('USUARIOS_GESTIONAR');
  if (!admin) throw forbidden('Los resúmenes de casos están disponibles únicamente para administradores.');
  const tables = await readTables(['Clientes', 'CasosClientes']);
  const clients = (tables.Clientes || []).filter(active);
  const resolution = resolveClient(question, clients, ctx.payload?.context || {}, { required: false });
  if (resolution.status === 'ambiguous') {
    return clarification(question, 'Encontré varios clientes posibles para el resumen de casos. Seleccione uno.', resolution.options, ctx.payload?.context || {});
  }
  const client = resolution.status === 'resolved' ? resolution.client : null;
  let rows = (tables.CasosClientes || []).filter(active);
  if (client) {
    rows = rows.filter((row) => (
      clean(row.ClienteID, 220) === clientId(client)
      || normalized(row.Cliente) === normalized(clientName(client))
    ));
  }
  const waiting = rows.filter((row) => caseState(row) === 'EN_ESPERA');
  const processing = rows.filter((row) => caseState(row) === 'EN_PROCESO');
  const finalized = rows.filter((row) => caseState(row) === 'FINALIZADO');
  const unassigned = rows.filter((row) => (
    caseState(row) !== 'FINALIZADO'
    && !parseIds(row.TecnicoIDsJSON || row.TecnicoIDs).length
    && !clean(row.TecnicoNombres)
  ));
  const today = todayCostaRica();
  const newToday = rows.filter((row) => dateOnly(row.FechaCreacion) === today);
  const recent = [...rows]
    .sort((left, right) => clean(right.FechaCreacion).localeCompare(clean(left.FechaCreacion)))
    .slice(0, 6)
    .map((row) => ({
      id: clean(row.CasoID, 220),
      number: clean(row.CasoNumero, 100),
      client: clean(row.Cliente, 250),
      reason: clean(row.RazonVisita, 500),
      status: caseState(row),
      requester: clean(row.NombreSolicitante, 250),
      createdAt: clean(row.FechaCreacion, 80),
      assigned: parseIds(row.TecnicoIDsJSON || row.TecnicoIDs).length > 0 || Boolean(clean(row.TecnicoNombres)),
    }));
  const scope = client ? ` de ${clientName(client)}` : '';
  const lines = [
    `Resumen de casos${scope}: ${waiting.length + processing.length} activos, ${waiting.length} en espera, ${processing.length} en proceso y ${finalized.length} finalizados.`,
    `${unassigned.length} caso${unassigned.length === 1 ? '' : 's'} activo${unassigned.length === 1 ? '' : 's'} permanece${unassigned.length === 1 ? '' : 'n'} sin asignar.`,
    newToday.length
      ? `Hoy ingresaron ${newToday.length} caso${newToday.length === 1 ? '' : 's'} nuevo${newToday.length === 1 ? '' : 's'}.`
      : 'Hoy no han ingresado casos nuevos.',
  ];
  if (recent.length) {
    lines.push(`El caso más reciente es ${recent[0].number || 'sin consecutivo'}: ${recent[0].reason || 'sin razón registrada'} (${recent[0].status.replace(/_/g, ' ').toLowerCase()}).`);
  }
  return {
    type: 'answer',
    answer: lines.join('\n'),
    sensitive: false,
    facts: {
      caseSummary: {
        scope: client ? clientName(client) : 'Todos los clientes',
        total: rows.length,
        active: waiting.length + processing.length,
        waiting: waiting.length,
        processing: processing.length,
        finalized: finalized.length,
        unassigned: unassigned.length,
        newToday: newToday.length,
      },
      recentCases: recent,
    },
    sources: [{
      type: 'cases',
      id: client ? clientId(client) : 'all',
      label: client ? `Casos de ${clientName(client)}` : 'Casos de clientes',
      url: '/casos',
    }],
    suggestions: [
      '¿Cuáles casos siguen sin asignar?',
      '¿Cuántos casos nuevos llegaron hoy?',
      ...(client ? [`Dame las credenciales de ${clientName(client)}`] : []),
    ].slice(0, 4),
    options: [],
    context: {
      ...(ctx.payload?.context || {}),
      ...(client ? { lastClientId: clientId(client), lastClientName: clientName(client) } : {}),
      lastIntent: 'case_summary',
    },
  };
}

if (!assistantDynamicMaintenanceQuestionHandlers[INSTALL_FLAG]) {
  const originalChat = assistantDynamicMaintenanceQuestionHandlers.chat;
  assistantDynamicMaintenanceQuestionHandlers.chat = async (ctx) => {
    const question = clean(ctx.payload?.message || ctx.payload?.question, 1200);
    if (credentialIntent(question)) return credentialAnswer(ctx, question);
    if (caseIntent(question)) return caseAnswer(ctx, question);
    return originalChat(ctx);
  };
  assistantDynamicMaintenanceQuestionHandlers[INSTALL_FLAG] = true;
}

export const PASSWORD_VAULT_ASSISTANT_PATCH = Object.freeze({
  installed: true,
  secretsSentToGemini: false,
});
