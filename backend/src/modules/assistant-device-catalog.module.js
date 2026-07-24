import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { assistantExpandedHandlers as baseAssistantExpandedHandlers } from './assistant-expanded.module.js';

const CATALOG_TERMS = /\b(fabricante(?:s)?|marca(?:s)?|modelo(?:s)?)\b/i;
const OPERATIONAL_TERMS = /\b(mantenimiento|mantenimientos|cliente|registrad[oa]s?|instalad[oa]s?|actual|reciente|ultimo|ultima|tiene|usan?|utilizan?|inventario)\b/i;

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

function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function canonicalCategory(value) {
  const key = normalized(value);
  const exact = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => normalized(alias) === key));
  if (exact) return exact.label;
  const partial = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => key.includes(normalized(alias)) || normalized(alias).includes(key)));
  return partial?.label || clean(value);
}

function categoryFromQuestion(question) {
  const key = normalized(question);
  const found = CATEGORY_ALIASES.find((item) => item.aliases.some((alias) => key.includes(normalized(alias))));
  return found?.label || '';
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
  try {
    const parsed = JSON.parse(row.Valor || row.Value || row.Configuracion || '{}');
    return Object.fromEntries(Object.entries(parsed).map(([alias, target]) => [normalized(alias), Array.isArray(target) ? target.map(normalized) : [normalized(target)]]));
  } catch {
    return {};
  }
}

function parentheticalAliases(name) {
  return [...String(name || '').matchAll(/\(([^)]+)\)/g)]
    .map((match) => normalized(match[1]))
    .filter(Boolean);
}

function significantTokens(value) {
  return normalized(value)
    .split(' ')
    .filter((token) => token.length > 2 && !['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'cliente', 'mantenimiento', 'costa', 'rica', 'srl', 'sa'].includes(token));
}

function clientScore(question, client, aliases) {
  const query = normalized(question);
  const name = clientName(client);
  const nameKey = normalized(name);
  if (!query || !nameKey) return 0;
  if (query.includes(nameKey)) return 1;
  if (parentheticalAliases(name).some((alias) => query.includes(alias))) return 0.995;

  for (const [alias, targets] of Object.entries(aliases)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(query)) continue;
    if (targets.some((target) => nameKey.includes(target) || target.includes(nameKey))) return 0.99;
  }

  const nameTokens = significantTokens(nameKey);
  const matched = nameTokens.filter((token) => query.includes(token));
  if (!matched.length) return 0;
  const longest = Math.max(...matched.map((token) => token.length));
  const ratio = matched.length / Math.max(nameTokens.length, 1);
  if (matched.length >= 2 && ratio >= 0.45) return 0.94;
  if (longest >= 7) return 0.86;
  if (longest >= 5) return 0.76;
  return 0.58;
}

function resolveClient({ question, context, clients, configRows }) {
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId);
  if (contextId) {
    const found = clients.find((row) => clientId(row) === contextId);
    if (found && !/\b(otro cliente|otra empresa)\b/i.test(question)) return { status: 'resolved', client: found };
  }

  const aliases = { ...DEFAULT_CLIENT_ALIASES, ...configAliases(configRows) };
  const ranked = clients
    .map((client) => ({ client, score: clientScore(question, client, aliases) }))
    .filter((item) => item.score >= 0.58)
    .sort((a, b) => b.score - a.score || clientName(a.client).localeCompare(clientName(b.client), 'es'));

  if (!ranked.length) return { status: 'missing' };
  const best = ranked[0];
  const second = ranked[1];
  if (best.score < 0.72 || (second && best.score < 0.98 && best.score - second.score < 0.08)) {
    return { status: 'ambiguous', options: ranked.slice(0, 5).map((item) => item.client) };
  }
  return { status: 'resolved', client: best.client };
}

function sameClient(row, client) {
  const id = clientId(client);
  return (id && clean(row.ClienteID || row.ClienteRef) === id)
    || normalized(row.Cliente || row.ClienteNombre) === normalized(clientName(client));
}

function sortNewest(rows) {
  return [...rows].sort((left, right) => {
    for (const field of ['Fecha', 'FechaCreacion', 'FechaActualizacion']) {
      const comparison = clean(right[field]).localeCompare(clean(left[field]), 'es');
      if (comparison) return comparison;
    }
    return 0;
  });
}

function maintenanceContextId(context = {}) {
  return clean(context.lastMaintenanceId || context.maintenanceId || context.pageContext?.maintenanceId || (context.pageContext?.entityType === 'maintenance' ? context.pageContext?.entityId : ''));
}

function maintenanceReference(row = {}) {
  return clean(pick(row, ['MantenimientoRef', 'MantenimientoID', 'MantenimientoRefID', 'maintenanceId']));
}

function catalogKind(question) {
  const key = normalized(question);
  const manufacturers = /\b(fabricante(?:s)?|marca(?:s)?)\b/.test(key);
  return manufacturers ? 'manufacturers' : 'models';
}

function canReadMaintenance(ctx) {
  const permissions = new Set(ctx.permissions || []);
  return permissions.has('USUARIOS_GESTIONAR')
    || ['MANTENIMIENTOS_VER', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_VER'].some((code) => permissions.has(code));
}

function shouldHandleOperationalCatalog(question, context) {
  if (!CATALOG_TERMS.test(question)) return false;
  if (maintenanceContextId(context)) return true;
  return OPERATIONAL_TERMS.test(question) && !/\b(global|catalogo|catalogos|todos|todas|disponibles)\b/i.test(question);
}

function clarification(message, options = [], context = {}, resumeQuestion = '') {
  return {
    type: 'clarification',
    message,
    answer: message,
    options,
    sources: [],
    suggestions: [],
    facts: {},
    context,
    resumeQuestion,
  };
}

function resolveDeviceIdentity({ row, modelsById, manufacturersById, typesById }) {
  const modelId = clean(pick(row, ['ModeloID', 'modeloId', 'ModeloRef', 'ModelID']));
  const catalogModel = modelId ? modelsById.get(modelId) : null;
  const manufacturerId = clean(pick(row, ['FabricanteID', 'fabricanteId', 'MarcaID'])) || clean(catalogModel?.FabricanteID);
  const typeId = clean(pick(row, ['TipoDispositivoID', 'tipoDispositivoId'])) || clean(catalogModel?.TipoDispositivoID);

  const model = clean(pick(row, ['Modelo', 'modelo', 'ModeloNombre', 'NombreModelo', 'ModeloEquipo', 'Model']))
    || clean(catalogModel?.Nombre);
  const manufacturer = clean(pick(row, ['Fabricante', 'fabricante', 'FabricanteNombre', 'NombreFabricante', 'Marca', 'marca']))
    || clean(manufacturersById.get(manufacturerId)?.Nombre);
  const category = canonicalCategory(pick(row, ['Categoria', 'TipoDispositivo', 'categoria']) || typesById.get(typeId)?.Nombre)
    || clean(typesById.get(typeId)?.Nombre, 'Sin categoría');

  return { model, manufacturer, category, modelId, manufacturerId };
}

function aggregateRows({ kind, category, devices, models, manufacturers, deviceTypes }) {
  const modelsById = new Map(models.map((row) => [clean(row.ModeloID), row]));
  const manufacturersById = new Map(manufacturers.map((row) => [clean(row.FabricanteID), row]));
  const typesById = new Map(deviceTypes.map((row) => [clean(row.TipoDispositivoID), row]));
  const groups = new Map();
  let missingModelCount = 0;
  let missingManufacturerCount = 0;
  let relevantDevices = 0;

  for (const row of devices) {
    const identity = resolveDeviceIdentity({ row, modelsById, manufacturersById, typesById });
    if (category && identity.category !== category) continue;
    relevantDevices += 1;

    if (!identity.model) missingModelCount += 1;
    if (!identity.manufacturer) missingManufacturerCount += 1;

    const name = kind === 'manufacturers'
      ? (identity.manufacturer || 'Sin fabricante registrado')
      : (identity.model || 'Sin modelo registrado');
    const manufacturer = identity.manufacturer || 'Sin fabricante registrado';
    const key = kind === 'manufacturers'
      ? `${normalized(identity.category)}|${normalized(name)}`
      : `${normalized(identity.category)}|${normalized(manufacturer)}|${normalized(name)}`;

    const current = groups.get(key) || {
      id: clean(row.EvidenciaMantenimientoID) || key,
      name,
      manufacturer,
      category: identity.category,
      count: 0,
      description: '',
      status: 'Registrado',
    };
    current.count += 1;
    groups.set(key, current);
  }

  return {
    rows: [...groups.values()].sort((a, b) => a.category.localeCompare(b.category, 'es') || a.manufacturer.localeCompare(b.manufacturer, 'es') || a.name.localeCompare(b.name, 'es')),
    relevantDevices,
    missingModelCount,
    missingManufacturerCount,
  };
}

async function handleOperationalCatalog(ctx) {
  if (!canReadMaintenance(ctx)) throw forbidden('No cuenta con permiso para consultar dispositivos de mantenimientos.');

  const question = clean(ctx.payload?.message || ctx.payload?.question);
  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  const category = categoryFromQuestion(question);
  const kind = catalogKind(question);
  const tables = await readTables([
    'Clientes',
    'Configuracion',
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'Modelos',
    'Fabricantes',
    'TiposDispositivo',
  ]);

  const clients = tables.Clientes.filter(active);
  const clientResolution = resolveClient({ question, context, clients, configRows: tables.Configuracion });
  if (clientResolution.status === 'ambiguous') {
    return clarification(
      'Encontré varios clientes relacionados con la consulta. ¿A cuál se refiere?',
      clientResolution.options.map((row) => ({ type: 'client', value: clientId(row), label: clientName(row) })),
      context,
      question,
    );
  }

  let client = clientResolution.status === 'resolved' ? clientResolution.client : null;
  const requestedMaintenanceId = maintenanceContextId(context);
  let maintenance = requestedMaintenanceId
    ? tables.Mantenimiento.find((row) => active(row) && clean(row.MantenimientoID) === requestedMaintenanceId)
    : null;

  if (!maintenance && client) {
    maintenance = sortNewest(tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client)))[0] || null;
  }

  if (!maintenance) {
    if (!client && !requestedMaintenanceId) return baseAssistantExpandedHandlers.chat(ctx);
    const answer = client
      ? `No encontré mantenimientos activos para ${clientName(client)}.`
      : 'No encontré el mantenimiento indicado.';
    return { type: 'answer', answer, facts: {}, sources: [], suggestions: [], context };
  }

  if (!client) {
    client = clients.find((row) => clientId(row) === clean(maintenance.ClienteID || maintenance.ClienteRef)) || null;
  }

  const maintenanceId = clean(maintenance.MantenimientoID);
  const devices = tables.Evidencia_Mantenimientos.filter((row) => active(row) && maintenanceReference(row) === maintenanceId);
  const aggregated = aggregateRows({
    kind,
    category,
    devices,
    models: tables.Modelos.filter(active),
    manufacturers: tables.Fabricantes.filter(active),
    deviceTypes: tables.TiposDispositivo.filter(active),
  });

  const label = kind === 'manufacturers' ? 'fabricantes' : 'modelos';
  const categoryText = category ? ` de ${category}` : '';
  let answer;
  if (!aggregated.rows.length) {
    answer = `No encontré ${label}${categoryText} registrados en ${clean(maintenance.TituloMantenimiento, 'el mantenimiento consultado')}.`;
  } else {
    answer = `En ${clean(maintenance.TituloMantenimiento, 'el mantenimiento consultado')}${client ? ` de ${clientName(client)}` : ''} encontré ${aggregated.rows.length} ${label}${categoryText} distintos, asociados a ${aggregated.relevantDevices} dispositivo${aggregated.relevantDevices === 1 ? '' : 's'} registrado${aggregated.relevantDevices === 1 ? '' : 's'}.`;
    if (kind === 'models' && aggregated.missingModelCount) answer += ` ${aggregated.missingModelCount} dispositivo${aggregated.missingModelCount === 1 ? '' : 's'} no tiene${aggregated.missingModelCount === 1 ? '' : 'n'} modelo registrado.`;
    if (kind === 'manufacturers' && aggregated.missingManufacturerCount) answer += ` ${aggregated.missingManufacturerCount} dispositivo${aggregated.missingManufacturerCount === 1 ? '' : 's'} no tiene${aggregated.missingManufacturerCount === 1 ? '' : 'n'} fabricante registrado.`;
  }

  const facts = {
    catalogResults: {
      kind,
      scope: 'maintenance',
      title: `${kind === 'manufacturers' ? 'Fabricantes' : 'Modelos'} registrados${categoryText}`,
      description: `${clean(maintenance.TituloMantenimiento, 'Mantenimiento')} · ${dateOnly(maintenance.Fecha) || 'sin fecha'}`,
      category,
      rows: aggregated.rows.slice(0, 200),
      totalResults: aggregated.rows.length,
      totalDevices: aggregated.relevantDevices,
      missingModelCount: aggregated.missingModelCount,
      missingManufacturerCount: aggregated.missingManufacturerCount,
      maintenance: {
        id: maintenanceId,
        title: clean(maintenance.TituloMantenimiento, 'Mantenimiento'),
        date: dateOnly(maintenance.Fecha),
      },
    },
  };

  const nextContext = {
    ...context,
    lastMaintenanceId: maintenanceId,
    lastClientId: client ? clientId(client) : clean(maintenance.ClienteID || maintenance.ClienteRef),
    lastClientName: client ? clientName(client) : clean(maintenance.Cliente),
    lastCategory: category,
    lastIntent: 'catalog_lookup',
  };

  await audit(ctx, 'CONSULTAR_ASISTENTE_MODELOS_MANTENIMIENTO', 'Asistente', clean(ctx.payload?.conversationId || ctx.user?.UsuarioID, 'consulta'), null, {
    MantenimientoID: maintenanceId,
    ClienteID: nextContext.lastClientId,
    Tipo: kind,
    Categoria: category,
    Dispositivos: aggregated.relevantDevices,
    Resultados: aggregated.rows.length,
  }).catch(() => {});

  return {
    type: 'answer',
    answer,
    facts,
    sources: [{
      type: 'maintenance',
      id: maintenanceId,
      label: `${clean(maintenance.TituloMantenimiento, 'Mantenimiento')} · inventario técnico`,
      url: `/mantenimientos/${encodeURIComponent(maintenanceId)}`,
    }],
    suggestions: [
      category ? `Dispositivos ${category} que requieren atención` : 'Dispositivos que requieren atención',
      'Lista global de fabricantes',
      'Lista global de modelos',
    ],
    context: nextContext,
  };
}

async function chat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? ctx.payload.context : {};
  if (!shouldHandleOperationalCatalog(question, context)) return baseAssistantExpandedHandlers.chat(ctx);
  return handleOperationalCatalog(ctx);
}

export const assistantDeviceCatalogHandlers = { chat };
