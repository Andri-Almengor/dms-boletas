import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { assistantHandlers } from './assistant.module.js';

const CATALOG_TERMS = /\b(fabricante(?:s)?|marca(?:s)?|modelo(?:s)?)\b/i;
const MAINTENANCE_TERMS = /\b(mantenimiento|mantenimientos|cliente|registrad[oa]s?|instalad[oa]s?|tiene|usan?|utilizan?)\b/i;
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

function clientId(row = {}) {
  return clean(pick(row, ['ClienteID', 'id']));
}

function clientName(row = {}) {
  return clean(pick(row, ['Nombre', 'RazonSocial', 'Clientes', 'Cliente']), 'Cliente');
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

function significantTokens(value) {
  return normalized(value)
    .split(' ')
    .filter((token) => token.length > 2 && !['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'cliente', 'mantenimiento', 'costa', 'rica', 'srl', 'sa'].includes(token));
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

function clientScore(question, client, aliases) {
  const query = normalized(question);
  const name = clientName(client);
  const nameKey = normalized(name);
  if (!query || !nameKey) return 0;
  if (query.includes(nameKey)) return 1;
  if (parentheticalAliases(name).some((alias) => query.includes(alias))) return 0.99;

  for (const [alias, targets] of Object.entries(aliases)) {
    if (!query.match(new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`))) continue;
    if (targets.some((target) => nameKey.includes(target) || target.includes(nameKey))) return 0.99;
  }

  const nameTokens = significantTokens(nameKey);
  if (!nameTokens.length) return 0;
  const matched = nameTokens.filter((token) => query.includes(token));
  if (!matched.length) return 0;
  const longest = Math.max(...matched.map((token) => token.length));
  const ratio = matched.length / nameTokens.length;
  if (matched.length >= 2 && ratio >= 0.45) return 0.94;
  if (longest >= 7) return 0.86;
  if (longest >= 5) return 0.76;
  return 0.58;
}

function resolveClient({ question, context, clients, configRows }) {
  const contextId = clean(context.lastClientId || context.clientId || context.pageContext?.clientId);
  if (contextId) {
    const found = clients.find((row) => clientId(row) === contextId);
    if (found && !/\b(otro cliente|otra empresa)\b/i.test(question)) return { status: 'resolved', client: found, confidence: 1, source: 'context' };
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
  return { status: 'resolved', client: best.client, confidence: best.score, source: 'question' };
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

function sameClient(row, client) {
  const id = clientId(client);
  return (id && clean(row.ClienteID || row.ClienteRef) === id)
    || normalized(row.Cliente || row.ClienteNombre) === normalized(clientName(client));
}

function catalogKind(question) {
  const key = normalized(question);
  const models = /\bmodelo(?:s)?\b/.test(key);
  const manufacturers = /\b(fabricante(?:s)?|marca(?:s)?)\b/.test(key);
  if (models && manufacturers) return 'models_and_manufacturers';
  if (manufacturers) return 'manufacturers';
  return 'models';
}

function source(type, id, label, url) {
  return { type, id: clean(id), label: clean(label), url };
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

function canReadMaintenance(ctx) {
  const permissions = new Set(ctx.permissions || []);
  return permissions.has('USUARIOS_GESTIONAR')
    || ['MANTENIMIENTOS_VER', 'MANTENIMIENTOS_CREAR', 'MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_VER'].some((code) => permissions.has(code));
}

function maintenanceContextId(context = {}) {
  return clean(context.lastMaintenanceId || context.maintenanceId || context.pageContext?.maintenanceId || (context.pageContext?.entityType === 'maintenance' ? context.pageContext?.entityId : ''));
}

function clientOptions(rows) {
  return rows.map((row) => ({ type: 'client', value: clientId(row), label: clientName(row) }));
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))];
}

function globalCatalogRows({ kind, category, tables, question }) {
  const types = tables.TiposDispositivo.filter(active);
  const manufacturers = tables.Fabricantes.filter(active);
  const models = tables.Modelos.filter(active);
  const relations = tables.TipoDispositivoFabricantes.filter(active);
  const typeById = new Map(types.map((row) => [clean(row.TipoDispositivoID), row]));
  const manufacturerById = new Map(manufacturers.map((row) => [clean(row.FabricanteID), row]));
  const allowedTypeIds = new Set(
    types
      .filter((row) => !category || canonicalCategory(row.Nombre) === category)
      .map((row) => clean(row.TipoDispositivoID)),
  );
  const mentionedManufacturer = manufacturers.find((row) => normalized(question).includes(normalized(row.Nombre)));

  if (kind === 'manufacturers') {
    let allowedManufacturerIds = new Set(manufacturers.map((row) => clean(row.FabricanteID)));
    if (category) {
      allowedManufacturerIds = new Set([
        ...relations.filter((row) => allowedTypeIds.has(clean(row.TipoDispositivoID))).map((row) => clean(row.FabricanteID)),
        ...models.filter((row) => allowedTypeIds.has(clean(row.TipoDispositivoID))).map((row) => clean(row.FabricanteID)),
      ]);
    }
    return manufacturers
      .filter((row) => allowedManufacturerIds.has(clean(row.FabricanteID)))
      .map((row) => {
        const manufacturerId = clean(row.FabricanteID);
        const relatedModels = models.filter((model) => clean(model.FabricanteID) === manufacturerId && (!category || allowedTypeIds.has(clean(model.TipoDispositivoID))));
        const categories = distinct(relatedModels.map((model) => canonicalCategory(typeById.get(clean(model.TipoDispositivoID))?.Nombre || '')));
        return {
          id: manufacturerId,
          kind: 'Fabricante',
          name: clean(row.Nombre, 'Sin nombre'),
          category: categories.join(', ') || category || 'Todas',
          manufacturer: clean(row.Nombre),
          model: '',
          count: relatedModels.length,
          description: clean(row.Descripcion),
          status: clean(row.Estado, 'ACTIVO'),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  return models
    .filter((row) => !category || allowedTypeIds.has(clean(row.TipoDispositivoID)))
    .filter((row) => !mentionedManufacturer || clean(row.FabricanteID) === clean(mentionedManufacturer.FabricanteID))
    .map((row) => {
      const manufacturer = manufacturerById.get(clean(row.FabricanteID));
      const type = typeById.get(clean(row.TipoDispositivoID));
      return {
        id: clean(row.ModeloID),
        kind: 'Modelo',
        name: clean(row.Nombre, 'Sin nombre'),
        category: canonicalCategory(type?.Nombre || '') || clean(type?.Nombre),
        manufacturer: clean(manufacturer?.Nombre, 'Sin fabricante'),
        model: clean(row.Nombre),
        count: 0,
        description: clean(row.Descripcion),
        status: clean(row.Estado, 'ACTIVO'),
      };
    })
    .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer, 'es') || a.name.localeCompare(b.name, 'es'));
}

function operationalCatalogRows({ kind, category, devices }) {
  const filtered = devices.filter((row) => !category || canonicalCategory(row.Categoria || row.TipoDispositivo) === category);
  const groups = new Map();

  for (const row of filtered) {
    const rowCategory = canonicalCategory(row.Categoria || row.TipoDispositivo) || clean(row.Categoria || row.TipoDispositivo, 'Sin categoría');
    const manufacturer = clean(row.Fabricante, 'Sin fabricante registrado');
    const model = clean(row.Modelo, 'Sin modelo registrado');
    const key = kind === 'manufacturers'
      ? `${normalized(rowCategory)}|${normalized(manufacturer)}`
      : `${normalized(rowCategory)}|${normalized(manufacturer)}|${normalized(model)}`;
    const current = groups.get(key) || {
      id: clean(row.EvidenciaMantenimientoID) || key,
      kind: kind === 'manufacturers' ? 'Fabricante' : 'Modelo',
      name: kind === 'manufacturers' ? manufacturer : model,
      category: rowCategory,
      manufacturer,
      model: kind === 'manufacturers' ? '' : model,
      count: 0,
      description: '',
      status: 'Registrado',
    };
    current.count += 1;
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category, 'es') || a.manufacturer.localeCompare(b.manufacturer, 'es') || a.name.localeCompare(b.name, 'es'));
}

function answerForCatalog({ kind, scope, category, rows, totalDevices, maintenance, client }) {
  const objectLabel = kind === 'manufacturers' ? 'fabricantes' : kind === 'models_and_manufacturers' ? 'combinaciones de fabricante y modelo' : 'modelos';
  const categoryText = category ? ` de ${category}` : '';
  if (!rows.length) {
    if (scope === 'catalog') return `No encontré ${objectLabel}${categoryText} activos en el catálogo.`;
    return `No encontré ${objectLabel}${categoryText} registrados en ${maintenance?.title || 'el mantenimiento consultado'}.`;
  }
  if (scope === 'catalog') return `Encontré ${rows.length} ${objectLabel}${categoryText} activos en el catálogo.`;
  return `En ${maintenance?.title || 'el mantenimiento consultado'}${client ? ` de ${clientName(client)}` : ''} encontré ${rows.length} ${objectLabel}${categoryText}, asociados a ${totalDevices} dispositivo${totalDevices === 1 ? '' : 's'} registrado${totalDevices === 1 ? '' : 's'}.`;
}

async function handleCatalogQuestion(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  const kind = catalogKind(question);
  const category = categoryFromQuestion(question);
  const globalHint = /\b(global|catalogo|catalogos|disponibles|todos|todas)\b/i.test(question);
  const contextualReference = /\b(ese|esa|este|esta|actual|ultimo|ultima|sus)\b/i.test(question);
  const hasMaintenancePage = Boolean(maintenanceContextId(context));
  const wantsOperational = !globalHint && (MAINTENANCE_TERMS.test(question) || hasMaintenancePage || (contextualReference && Boolean(context.lastClientId || context.pageContext?.clientId)));

  const baseTables = await readTables(['Clientes', 'Configuracion']);
  const clients = baseTables.Clientes.filter(active);
  const resolutionContext = wantsOperational ? context : { pageContext: {} };
  const clientResolution = resolveClient({ question, context: resolutionContext, clients, configRows: baseTables.Configuracion });

  if (clientResolution.status === 'ambiguous') {
    return clarification('Encontré varios clientes relacionados con la consulta. ¿A cuál se refiere?', clientOptions(clientResolution.options), context, question);
  }

  let client = clientResolution.status === 'resolved' ? clientResolution.client : null;
  if (client) {
    context.lastClientId = clientId(client);
    context.lastClientName = clientName(client);
  }

  const shouldUseMaintenance = wantsOperational || Boolean(client);
  if (!shouldUseMaintenance) {
    const tables = await readTables(['TiposDispositivo', 'Fabricantes', 'Modelos', 'TipoDispositivoFabricantes']);
    const allRows = globalCatalogRows({ kind, category, tables, question });
    const rows = allRows.slice(0, 200);
    const facts = {
      catalogResults: {
        kind,
        scope: 'catalog',
        title: kind === 'manufacturers' ? `Fabricantes${category ? ` de ${category}` : ''}` : `Modelos${category ? ` de ${category}` : ''}`,
        description: 'Catálogo activo de DMS Boletas',
        category,
        rows,
        totalResults: allRows.length,
        totalDevices: 0,
        truncated: allRows.length > rows.length,
      },
    };
    const result = {
      type: 'answer',
      answer: `${answerForCatalog({ kind, scope: 'catalog', category, rows: allRows, totalDevices: 0 })}${allRows.length > rows.length ? ` Se muestran los primeros ${rows.length}.` : ''}`,
      facts,
      sources: [source('catalog', 'catalogos', 'Catálogos de fabricantes y modelos', '/catalogos')],
      suggestions: ['Lista de fabricantes de cámaras', 'Lista de modelos de puertas', 'Modelos registrados en el último mantenimiento de un cliente'],
      context: { ...context, lastCategory: category, lastIntent: 'catalog_lookup' },
    };
    await audit(ctx, 'CONSULTAR_ASISTENTE_CATALOGO', 'Asistente', clean(ctx.payload?.conversationId || ctx.user?.UsuarioID, 'consulta'), null, { Alcance: 'CATALOGO', Tipo: kind, Categoria: category, Resultados: allRows.length }).catch(() => {});
    return result;
  }

  if (!canReadMaintenance(ctx)) throw forbidden('No cuenta con permiso para consultar dispositivos de mantenimientos.');
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos']);
  const requestedMaintenanceId = maintenanceContextId(context);
  let maintenance = requestedMaintenanceId
    ? tables.Mantenimiento.find((row) => clean(row.MantenimientoID) === requestedMaintenanceId && active(row))
    : null;

  if (!maintenance && client) {
    maintenance = sortNewest(tables.Mantenimiento.filter((row) => active(row) && sameClient(row, client)))[0] || null;
  }

  if (!maintenance) {
    if (!client) {
      return clarification('¿De qué cliente o mantenimiento desea consultar los fabricantes o modelos registrados?', [], context, question);
    }
    return {
      type: 'answer',
      answer: `No encontré mantenimientos activos para ${clientName(client)}.`,
      facts: { catalogResults: { kind, scope: 'maintenance', title: 'Sin resultados', description: '', category, rows: [], totalResults: 0, totalDevices: 0 } },
      sources: [],
      suggestions: ['Ver lista global de fabricantes', 'Ver lista global de modelos'],
      context: { ...context, lastCategory: category, lastIntent: 'catalog_lookup' },
    };
  }

  if (!client) {
    client = clients.find((row) => clientId(row) === clean(maintenance.ClienteID || maintenance.ClienteRef)) || null;
  }
  const maintenanceId = clean(maintenance.MantenimientoID);
  const devices = tables.Evidencia_Mantenimientos.filter((row) => active(row) && clean(row.MantenimientoRef) === maintenanceId);
  const rows = operationalCatalogRows({ kind, category, devices });
  const relevantDevices = devices.filter((row) => !category || canonicalCategory(row.Categoria || row.TipoDispositivo) === category);
  const facts = {
    catalogResults: {
      kind,
      scope: 'maintenance',
      title: kind === 'manufacturers' ? `Fabricantes registrados${category ? ` de ${category}` : ''}` : `Modelos registrados${category ? ` de ${category}` : ''}`,
      description: `${clean(maintenance.TituloMantenimiento, 'Mantenimiento')} · ${dateOnly(maintenance.Fecha) || 'sin fecha'}`,
      category,
      rows: rows.slice(0, 200),
      totalResults: rows.length,
      totalDevices: relevantDevices.length,
      truncated: rows.length > 200,
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
  const result = {
    type: 'answer',
    answer: answerForCatalog({ kind, scope: 'maintenance', category, rows, totalDevices: relevantDevices.length, maintenance: { title: clean(maintenance.TituloMantenimiento) }, client }),
    facts,
    sources: [source('maintenance', maintenanceId, `${clean(maintenance.TituloMantenimiento, 'Mantenimiento')} · fabricantes y modelos`, `/mantenimientos/${encodeURIComponent(maintenanceId)}`)],
    suggestions: [
      category ? `Dispositivos ${category} que requieren atención` : 'Dispositivos que requieren atención',
      'Lista global de fabricantes',
      'Lista global de modelos',
    ],
    context: nextContext,
  };
  await audit(ctx, 'CONSULTAR_ASISTENTE_CATALOGO', 'Asistente', clean(ctx.payload?.conversationId || ctx.user?.UsuarioID, 'consulta'), null, { Alcance: 'MANTENIMIENTO', Tipo: kind, Categoria: category, MantenimientoID: maintenanceId, Resultados: rows.length }).catch(() => {});
  return result;
}

async function chat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  if (!CATALOG_TERMS.test(question)) return assistantHandlers.chat(ctx);
  return handleCatalogQuestion(ctx);
}

export const assistantExpandedHandlers = { chat };
