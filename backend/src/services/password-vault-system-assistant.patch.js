import { forbidden } from '../core/errors.js';
import { readTables } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import {
  canReadPasswordVault,
  queryPasswordVaultForAssistant,
} from '../modules/password-vault.module.js';
import {
  credentialSystemRequestIntent,
  detectCredentialSystemReference,
  matchCredentialSystemRows,
  normalizeVaultSearch,
} from './password-vault-system-search.service.js';

const INSTALL_FLAG = Symbol.for('dms.passwordVaultSystemAssistantPatch');
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

function active(row = {}) {
  return row.Activo !== false
    && clean(row.Activo ?? 'true', 20).toLowerCase() !== 'false'
    && normalizeVaultSearch(row.Estado || 'ACTIVO') !== 'inactivo';
}

function clientId(row = {}) {
  return clean(row.ClienteID || row.id, 220);
}

function clientName(row = {}) {
  return clean(row.Clientes || row.Cliente || row.Nombre || row.RazonSocial, 250) || 'Cliente';
}

function initials(value) {
  return normalizeVaultSearch(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['de', 'del', 'la', 'las', 'el', 'los', 'sa', 's', 'cr'].includes(token))
    .map((token) => token[0])
    .join('');
}

function phraseIn(text, phrase) {
  const source = ` ${normalizeVaultSearch(text)} `;
  const target = normalizeVaultSearch(phrase);
  return Boolean(target) && source.includes(` ${target} `);
}

function clientScore(question, client) {
  const query = normalizeVaultSearch(question);
  const name = normalizeVaultSearch(clientName(client));
  if (!query || !name) return 0;
  if (phraseIn(query, name)) return 1;
  const acronym = initials(clientName(client));
  if (acronym && phraseIn(query, acronym)) return 0.98;
  for (const [alias, targets] of Object.entries(CLIENT_ALIASES)) {
    if (!phraseIn(query, alias)) continue;
    if (targets.some((target) => name.includes(normalizeVaultSearch(target)) || normalizeVaultSearch(target).includes(name))) return 0.99;
  }
  const tokens = name.split(' ').filter((token) => token.length > 3);
  const hits = tokens.filter((token) => phraseIn(query, token)).length;
  if (hits >= 2) return 0.9 + Math.min(0.07, hits / 100);
  if (hits === 1 && tokens.length === 1) return 0.86;
  return 0;
}

function explicitClientResolution(question, clients) {
  const ranked = clients
    .map((client) => ({ client, score: clientScore(question, client) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || clientName(left.client).localeCompare(clientName(right.client), 'es'));
  if (!ranked.length) return { status: 'none' };
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.08) {
    return { status: 'resolved', client: ranked[0].client };
  }
  return { status: 'ambiguous', options: ranked.slice(0, 8).map((item) => item.client) };
}

function clientOptions(clients) {
  return clients.slice(0, 8).map((client) => ({
    type: 'client',
    value: clientId(client),
    label: clientName(client),
  }));
}

function clarification(question, message, clients, context = {}) {
  return {
    type: 'clarification',
    answer: message,
    resumeQuestion: question,
    sources: [],
    suggestions: [],
    options: clientOptions(clients),
    context,
  };
}

function likelyCredentialQuestion(question) {
  return /\b(contrasena|contrasenas|password|passwords|clave|claves|credencial|credenciales|usuario|usuarios|login|cuenta|acceso)\b/.test(normalizeVaultSearch(question));
}

function uniqueClientsFromMatches(matches, clientsById) {
  const ids = [...new Set(matches.map((item) => clean(item.row.ClienteID, 220)).filter(Boolean))];
  return ids.map((id) => clientsById.get(id)).filter(Boolean);
}

function contextClient(context, clientsById, matches) {
  const id = clean(context?.lastClientId || context?.clientId || context?.pageContext?.clientId, 220);
  if (!id) return null;
  const client = clientsById.get(id);
  if (!client) return null;
  if (!matches.length || matches.some((item) => clean(item.row.ClienteID, 220) === id)) return client;
  return null;
}

async function fetchMatchedCredentials(ctx, client, matches) {
  const ids = new Set(matches.map((item) => clean(item.row.CredencialID, 220)).filter(Boolean));
  const groups = new Map();
  for (const item of matches) {
    const categoryId = clean(item.row.CategoriaCredencialID, 220);
    const name = clean(item.row.Nombre, 250);
    if (!name) continue;
    groups.set(`${categoryId}|${normalizeVaultSearch(name)}`, { categoryId, name });
  }

  const results = [];
  for (const group of [...groups.values()].slice(0, 20)) {
    const rows = await queryPasswordVaultForAssistant(ctx, {
      clientId: clientId(client),
      categoryId: group.categoryId,
      search: group.name,
      limit: 50,
    });
    results.push(...rows);
  }

  const unique = new Map();
  for (const row of results) {
    if (ids.has(clean(row.id, 220))) unique.set(clean(row.id, 220), row);
  }
  return [...unique.values()].sort((left, right) => (
    clean(left.categoryName).localeCompare(clean(right.categoryName), 'es')
    || clean(left.name).localeCompare(clean(right.name), 'es')
    || clean(left.username).localeCompare(clean(right.username), 'es')
  ));
}

async function systemCredentialAnswer(ctx, question, tables) {
  if (!canReadPasswordVault(ctx)) {
    throw forbidden('No cuenta con permiso para consultar credenciales de clientes.');
  }

  const clients = (tables.Clientes || []).filter(active);
  const clientsById = new Map(clients.map((client) => [clientId(client), client]));
  const categories = (tables.CategoriasCredenciales || []).filter(active);
  const categoriesById = new Map(categories.map((category) => [clean(category.CategoriaCredencialID, 220), category]));
  const credentials = (tables.CredencialesClientes || []).filter(active);
  const allMatches = matchCredentialSystemRows(question, credentials, categoriesById);
  const reference = detectCredentialSystemReference(question);
  const systemLabel = reference?.label || clean(allMatches[0]?.row?.Nombre, 250) || 'el sistema solicitado';
  const context = ctx.payload?.context || {};

  const explicit = explicitClientResolution(question, clients);
  if (explicit.status === 'ambiguous') {
    return clarification(question, `Encontré varios clientes posibles para consultar ${systemLabel}. Seleccione uno antes de mostrar credenciales.`, explicit.options, context);
  }

  let client = explicit.status === 'resolved' ? explicit.client : null;
  if (!client) client = contextClient(context, clientsById, allMatches);

  if (!client) {
    const matchingClients = uniqueClientsFromMatches(allMatches, clientsById);
    if (matchingClients.length === 1) {
      [client] = matchingClients;
    } else if (matchingClients.length > 1) {
      return clarification(
        question,
        `Encontré credenciales relacionadas con ${systemLabel} en varios clientes. Seleccione el cliente correcto para continuar.`,
        matchingClients,
        context,
      );
    } else {
      return clarification(
        question,
        `No pude identificar el cliente de ${systemLabel}. Indique el cliente para realizar una búsqueda segura y específica.`,
        clients,
        context,
      );
    }
  }

  const selectedMatches = allMatches.filter((item) => clean(item.row.ClienteID, 220) === clientId(client));
  if (!selectedMatches.length) {
    return {
      type: 'answer',
      answer: `No encontré una credencial activa asociada con ${systemLabel} para ${clientName(client)}. Puede revisar el nombre registrado del sistema o abrir el gestor de contraseñas del cliente.`,
      sensitive: false,
      facts: { credentialResults: { clientId: clientId(client), clientName: clientName(client), total: 0, rows: [] } },
      sources: [{ type: 'credentials', id: clientId(client), label: `Credenciales de ${clientName(client)}`, url: `/credenciales?cliente=${encodeURIComponent(clientId(client))}` }],
      suggestions: [`Abrir el gestor de contraseñas de ${clientName(client)}`],
      options: [],
      context: { ...context, lastClientId: clientId(client), lastClientName: clientName(client), lastIntent: 'credential_system_search' },
    };
  }

  const rows = await fetchMatchedCredentials(ctx, client, selectedMatches);
  return {
    type: 'answer',
    answer: rows.length
      ? `Encontré ${rows.length} credencial${rows.length === 1 ? '' : 'es'} relacionada${rows.length === 1 ? '' : 's'} con ${systemLabel} para ${clientName(client)}. La información se muestra en una tabla sensible y no se guardará en el historial local.`
      : `Encontré una referencia a ${systemLabel} para ${clientName(client)}, pero no fue posible recuperar una credencial activa.`,
    sensitive: rows.length > 0,
    facts: {
      credentialResults: {
        clientId: clientId(client),
        clientName: clientName(client),
        systemName: systemLabel,
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
      ...context,
      lastClientId: clientId(client),
      lastClientName: clientName(client),
      lastSystemName: systemLabel,
      lastIntent: 'credential_system_search',
    },
  };
}

if (!assistantDynamicMaintenanceQuestionHandlers[INSTALL_FLAG]) {
  const originalChat = assistantDynamicMaintenanceQuestionHandlers.chat;
  assistantDynamicMaintenanceQuestionHandlers.chat = async (ctx) => {
    const question = clean(ctx.payload?.message || ctx.payload?.question, 1200);
    if (!likelyCredentialQuestion(question)) return originalChat(ctx);

    const tables = await readTables(['Clientes', 'CategoriasCredenciales', 'CredencialesClientes']);
    const categoriesById = new Map((tables.CategoriasCredenciales || []).map((category) => [clean(category.CategoriaCredencialID, 220), category]));
    if (!credentialSystemRequestIntent(question, tables.CredencialesClientes || [], categoriesById)) return originalChat(ctx);
    return systemCredentialAnswer(ctx, question, tables);
  };
  assistantDynamicMaintenanceQuestionHandlers[INSTALL_FLAG] = true;
}

export const PASSWORD_VAULT_SYSTEM_ASSISTANT_PATCH = Object.freeze({
  installed: true,
  secretsSentToGemini: false,
  supportsSystemName: true,
  supportsUniqueClientResolution: true,
});
