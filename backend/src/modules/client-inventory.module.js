import { badRequest, forbidden, notFound } from '../core/errors.js';
import { query, withTransaction } from '../infra/postgres.js';
import { findById } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { suggestInventoryMerges, summarizeInventoryDeviceStatuses } from '../services/assistant-gemini.service.js';
import {
  groupInventoryDevices, candidateInventoryAliases, mergeInventoryAliases,
  buildInventorySnapshot, verifiedInventoryCondition,
  applyManualInventoryLinks, validateManualInventorySourceUnion,
} from '../core/client-inventory-domain.js';

const MAX_SOURCE_DEVICES = 20000;
const MAX_SOURCE_TICKETS = 30000;
const MAX_SOURCE_MEDIA = 60000;
const clean = (value) => String(value ?? '').trim();
const active = (alias) => alias + '."__valid"=TRUE AND LOWER(COALESCE(' + alias
  + '."Activo",\'true\')) NOT IN (\'false\',\'0\',\'no\',\'inactivo\')';
const cap = (value, limit, fallback) =>
  Math.max(1, Math.min(limit, Math.floor(Number(value) || fallback)));
const canAdmin = (ctx) => ctx.permissions?.includes('USUARIOS_GESTIONAR');
const canRead = (ctx) => (ctx.permissions || []).some((code) => [
  'USUARIOS_GESTIONAR','MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER',
].includes(code));
const allTickets = (ctx) => canAdmin(ctx) || (ctx.permissions || []).some((code) =>
  ['BOLETAS_ELIMINAR', 'BOLETAS_GESTIONAR'].includes(code));

function readGuard(ctx) {
  if (!ctx?.user?.UsuarioID || !canRead(ctx)) throw forbidden('No cuenta con acceso de lectura al inventario.');
}
function adminGuard(ctx) {
  readGuard(ctx);
  if (!canAdmin(ctx)) throw forbidden('Solo usuarios con acceso administrativo (Administrador o Supervisor) pueden generar o actualizar el inventario.');
}
function clientId(ctx) {
  const id = clean(ctx.payload?.clienteId || ctx.payload?.clientId);
  if (!id || id.length > 160) throw badRequest('Seleccione un cliente válido.');
  return id;
}
function deviceId(ctx) {
  const id = clean(ctx.payload?.deviceId);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) throw badRequest('Dispositivo de inventario inválido.');
  return id;
}
const rows = (result) => result.rows || [];
async function selectOne(sql, params, label) {
  return (await query(sql, params, { label })).rows[0] || null;
}

async function loadSources(id) {
  const devices = rows(await query(
    'SELECT d.*,m."TituloMantenimiento" AS "maintenanceTitle",'
    + ' m."Fecha" AS "maintenanceDate",m."FechaFinalizacion" AS "maintenanceFinishedAt",'
    + ' m."DescripcionGeneral" AS "maintenanceDescription",m."Responsables" AS "maintenanceTechnicians"'
    + ' FROM "Evidencia_Mantenimientos" d'
    + ' JOIN "Mantenimiento" m ON m."MantenimientoID"=d."MantenimientoRef"'
    + ' WHERE ' + active('m') + ' AND ' + active('d') + ' AND m."ClienteID"=$1'
    + ' ORDER BY d."FechaTrabajo" ASC NULLS LAST,d."EvidenciaMantenimientoID" ASC LIMIT $2',
    [id, MAX_SOURCE_DEVICES + 1], { label: 'inventory.source.devices' }));
  if (devices.length > MAX_SOURCE_DEVICES) throw badRequest('Este cliente tiene demasiados dispositivos para una generación completa. No se guardó un inventario parcial.');

  const tickets = rows(await query(
    'SELECT b."BoletaUID",b."BoletaID",b."DispositivoID",b."TipoDispositivoID",'
    + ' b."TipoDispositivo",b."UbicacionEquipoID",b."Serie",b."DireccionMAC",'
    + ' b."FabricanteID",b."Fabricante",b."ModeloID",b."Modelo",'
    + ' b."Titulo",b."RazonVisita",b."Descripcion",b."PruebasRealizadas",'
    + ' b."Resultado",b."Recomendaciones",b."Fecha",b."FinalizadaEn",b."FechaCreacion",'
    + ' COALESCE(ass.assignees,\'\') AS assignees'
    + ' FROM "Boletas" b LEFT JOIN ('
    + ' SELECT a."BoletaUID",STRING_AGG(DISTINCT'
    + ' COALESCE(NULLIF(a."NombreUsuarioSnapshot",\'\'),u."NombreCompleto"),\', \') AS assignees'
    + ' FROM "BoletaAsignados" a LEFT JOIN "Usuarios" u ON u."UsuarioID"=a."UsuarioID"'
    + ' JOIN "Boletas" bx ON bx."BoletaUID"=a."BoletaUID" AND bx."ClienteID"=$1'
    + ' WHERE ' + active('a') + ' GROUP BY a."BoletaUID"'
    + ' ) ass ON ass."BoletaUID"=b."BoletaUID"'
    + ' WHERE ' + 'b."__valid"=TRUE' + ' AND b."ClienteID"=$1'
    + ' AND UPPER(COALESCE(b."Estado",\'\')) NOT LIKE \'%ANUL%\''
    + ' ORDER BY b."Fecha" DESC NULLS LAST,b."BoletaUID" LIMIT $2',
    [id, MAX_SOURCE_TICKETS + 1], { label: 'inventory.source.tickets' }));
  if (tickets.length > MAX_SOURCE_TICKETS) throw badRequest('Hay demasiadas boletas para generar el inventario completo de forma segura.');

  const maintenanceImages = rows(await query(
    'SELECT i."FotoDispositivoID",i."DispositivoMantenimientoRef",i."Tipo",'
    + ' i."Nombre",i."MimeType",i."TipoMedio",i."DriveFileID",'
    + ' i."FechaCaptura",i."FechaCreacion"'
    + ' FROM "Mantenimiento imagenes" i'
    + ' JOIN "Evidencia_Mantenimientos" d ON d."EvidenciaMantenimientoID"=i."DispositivoMantenimientoRef"'
    + ' JOIN "Mantenimiento" m ON m."MantenimientoID"=d."MantenimientoRef"'
    + ' WHERE ' + active('i') + ' AND ' + active('d') + ' AND ' + active('m')
    + ' AND m."ClienteID"=$1'
    + ' AND (i."MimeType" LIKE \'image/%\' OR'
    + ' (COALESCE(i."MimeType",\'\')=\'\' AND COALESCE(i."TipoMedio",\'image\')<>\'video\'))'
    + ' ORDER BY i."FotoDispositivoID" LIMIT $2',
    [id, MAX_SOURCE_MEDIA + 1], { label: 'inventory.source.maintenance.media' }));
  if (maintenanceImages.length > MAX_SOURCE_MEDIA) throw badRequest('Hay demasiadas imágenes de mantenimiento para esta generación.');

  const ticketEvidence = rows(await query(
    'SELECT e."EvidenciaID",e."BoletaUID",e."OrigenMantenimientoDispositivoID",'
    + ' e."ArchivoID",e."MimeType",e."TipoMedio",e."FechaCreacion"'
    + ' FROM "EvidenciasBoleta" e JOIN "Boletas" b ON b."BoletaUID"=e."BoletaUID"'
    + ' WHERE ' + active('e') + ' AND ' + 'b."__valid"=TRUE' + ' AND b."ClienteID"=$1'
    + ' AND (e."MimeType" LIKE \'image/%\' OR COALESCE(e."MimeType",\'\')=\'\')'
    + ' ORDER BY e."EvidenciaID" LIMIT $2',
    [id, MAX_SOURCE_MEDIA + 1], { label: 'inventory.source.ticket.media' }));
  if (ticketEvidence.length > MAX_SOURCE_MEDIA) throw badRequest('Hay demasiadas imágenes de boletas para esta generación.');
  return { devices, tickets, maintenanceImages, ticketEvidence };
}

async function bulkInsert(prefix, values, width, label) {
  const size = Math.max(1, Math.floor(1000 / width));
  for (let i = 0; i < values.length; i += size) {
    const batch = values.slice(i, i + size);
    const placeholders = batch.map((_, row) => '('
      + Array.from({ length: width }, (__, col) => '$' + (row * width + col + 1)).join(',') + ')');
    await query(prefix + placeholders.join(','), batch.flat(), { label, write: true });
  }
}


async function manualInventoryLinks(id) {
  return rows(await query(
    'SELECT source_id,canonical_source_id,preferred_device_name FROM dms_client_inventory_manual_links WHERE client_id=$1',
    [id], { label: 'inventory.manualLinks.read' }));
}

async function previousIdMap(id) {
  const existing = rows(await query('SELECT device_id,source_ids FROM dms_client_inventory_devices WHERE client_id=$1',
    [id], { label: 'inventory.previous.ids' }));
  const map = new Map();
  for (const row of existing) {
    for (const sourceId of row.source_ids || []) if (!map.has(sourceId)) map.set(sourceId, row.device_id);
  }
  return map;
}
function ticketVisibilityCondition(alias) {
  return '(' + alias + '.event_type=\'MANTENIMIENTO\' OR $3::boolean OR EXISTS ('
    + 'SELECT 1 FROM "BoletaAsignados" a WHERE ' + active('a')
    + ' AND a."BoletaUID"=' + alias + '.source_id AND a."UsuarioID"=$4))';
}
function mediaVisibilityCondition(alias) {
  return '(' + alias + '.media_type=\'MANTENIMIENTO\' OR $3::boolean OR EXISTS ('
    + 'SELECT 1 FROM "BoletaAsignados" a WHERE ' + active('a')
    + ' AND a."BoletaUID"=' + alias + '.source_id AND a."UsuarioID"=$4))';
}


function inventorySourcesKey(device) {
  // Firma estable aunque un inventario previo haya asignado otros IDs.
  return [...(device.sourceIds || [])].map(clean).sort().join('|');
}
function latestInventoryEvents(snapshot) {
  const newest = new Map();
  for (const event of snapshot.events) {
    const previous = newest.get(event.deviceId);
    if (!previous || (event.date || '').localeCompare(previous.date || '') > 0
      || ((event.date || '') === (previous.date || '') && event.key > previous.key)) {
      newest.set(event.deviceId, event);
    }
  }
  return snapshot.devices.map((device) => {
    const event = newest.get(device.deviceId) || null;
    return {
      id: device.deviceId,
      key: inventorySourcesKey(device),
      name: device.name,
      type: device.type,
      latest: event,
    };
  });
}
function recordedCurrentStatus(work) {
  const event = work.latest;
  return {
    condition: 'NO_DETERMINADO',
    summary: event
      ? 'Último registro: ' + clean(event.title || 'Intervención').slice(0, 100) + '. '
        + clean(event.summary || 'Sin observaciones específicas.').slice(0, 240)
      : 'Sin intervenciones registradas para este equipo.',
    date: clean(event?.date),
    sourceType: clean(event?.type),
    sourceId: clean(event?.sourceId),
    eventKey: clean(event?.key),
    origin: 'registro',
    model: '',
  };
}
async function inventoryCurrentStatusBySource(snapshot) {
  const work = latestInventoryEvents(snapshot);
  const results = new Map(work.map((item) => [item.key, recordedCurrentStatus(item)]));
  const total = work.filter((item) => item.latest).length;
  const batches = [];
  const eligible = work.filter((item) => item.latest);
  for (let i = 0; i < eligible.length; i += 60) batches.push(eligible.slice(i, i+60));
  // Presupuesto acotado: NO detener escrituras normales ni mantener
  // la transacción abierta mientras Gemini responde.
  const deadline = Date.now() + 110_000;
  let cursor = 0;
  let unavailable = false;
  let processed = 0;
  const modelNames = new Set();
  async function worker() {
    while (cursor < batches.length && Date.now() < deadline && !unavailable) {
      const batch = batches[cursor++];
      try {
        const response = await summarizeInventoryDeviceStatuses({ devices: batch });
        if (response.model) modelNames.add(response.model);
        const byId = new Map(response.items.map((item) => [item.id, item]));
        for (const workItem of batch) {
          const candidate = byId.get(workItem.id);
          if (!candidate) continue;
          // Si Gemini exagera un estado (ej. "falla" en "sin fallas"),
          // rechazarlo por completo, incluido su texto; conservar registro.
          const condition = verifiedInventoryCondition(candidate.condition, workItem.latest.summary);
          if (condition !== candidate.condition) continue;
          results.set(workItem.key, {
            ...recordedCurrentStatus(workItem),
            condition,
            summary: clean(candidate.summary).slice(0, 260),
            origin: 'gemini',
            model: clean(response.model).slice(0, 100),
          });
          processed++;
        }
      } catch {
        unavailable = true; // el cliente Gemini ya aplicó fallback de modelos
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3,batches.length) }, () => worker()));
  return {
    bySource: results, processed, total,
    status: processed === total ? 'completo'
      : processed ? 'parcial' : 'no_disponible',
    models: [...modelNames].join(',').slice(0, 150),
  };
}

export const clientInventoryHandlers = {
  clients: async (ctx) => {
    readGuard(ctx);
    const search = clean(ctx.payload?.search).slice(0,120);
    const page = cap(ctx.payload?.page, 100000, 1);
    const pageSize = cap(ctx.payload?.pageSize, 100, 25);
    const term = '%' + search.replace(/[\%_]/g, '\\$&') + '%';
    const result = rows(await query(
      'SELECT c."ClienteID" AS id,c."Nombre" AS name,'
      + ' s.generated_at AS "generatedAt",s.device_count AS "deviceCount",'
      + ' s.revision,s.ai_status AS "aiStatus"'
      + ' FROM "Clientes" c LEFT JOIN dms_client_inventory s ON s.client_id=c."ClienteID"'
      + ' WHERE ' + active('c') + ' AND c."Nombre" ILIKE $1 ESCAPE \'\\\''
      // Solo clientes que tienen al menos un mantenimiento operativo.
      // No incluir clientes con únicamente boletas ni exigir dispositivos ya cargados.
      + ' AND EXISTS(SELECT 1 FROM "Mantenimiento" m'
      + ' WHERE ' + active('m') + ' AND m."ClienteID"=c."ClienteID")'
      + ' ORDER BY c."Nombre",c."ClienteID" LIMIT $2 OFFSET $3',
      [term, pageSize + 1, (page - 1) * pageSize], { label: 'inventory.clients.list' }));
    return { items: result.slice(0,pageSize), page, pageSize, hasMore: result.length > pageSize };
  },
  devices: async (ctx) => {
    const namesOnly = ctx.payload?.namesOnly === true;
    if (namesOnly) {
      // La boleta solo necesita sugerencias de nombres. No elevar permisos
      // para consultar el inventario completo, historiales ni identificadores.
      const ticketRead = (ctx.permissions || []).some((permission) =>
        ['BOLETAS_CREAR', 'BOLETAS_EDITAR'].includes(permission));
      if (!ctx?.user?.UsuarioID || (!ticketRead && !canRead(ctx))) {
        throw forbidden('No cuenta con acceso a las sugerencias de dispositivos.');
      }
    } else {
      readGuard(ctx);
    }
    const id = clientId(ctx);
    const page = cap(ctx.payload?.page, 100000, 1);
    const pageSize = cap(ctx.payload?.pageSize, 100, 25);
    const pattern = '%' + clean(ctx.payload?.search).slice(0,120).replace(/[\%_]/g, '\\$&') + '%';
    const summary = await selectOne(
      'SELECT client_id,generated_at,revision,device_count,ai_status FROM dms_client_inventory WHERE client_id=$1',
      [id], 'inventory.client.status');
    if (!summary) return { generated: false, items: [], page, pageSize, hasMore: false };
    if (namesOnly) {
      // No se ejecuta si el cliente no tiene inventario generado. El nombre se
      // conserva tal cual, sin implicar asignación, vinculación o alta de equipo.
      // Normalizar acentos para que "camara" encuentre "Cámara", sin depender
      // de extensiones PostgreSQL o cargar las tablas completas.
      const search = clean(ctx.payload?.search).slice(0, 120)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
      const limit = cap(ctx.payload?.pageSize, 30, 20);
      const matches = rows(await query(
        'SELECT DISTINCT device_name AS name FROM dms_client_inventory_devices'
        + ' WHERE client_id=$1 AND TRIM(device_name)<>\'\''
        + ' AND translate(lower(device_name),\'áéíóúüñ\',\'aeiouun\')'
        + ' LIKE $2 ESCAPE \'\\\''
        + ' ORDER BY name LIMIT $3',
        [id, pattern, limit + 1], { label: 'inventory.devices.suggestNames' }));
      return {
        generated: true,
        items: matches.slice(0, limit).map((item) => ({ name: item.name })),
        hasMore: matches.length > limit,
      };
    }
    const equipmentLocationId = clean(ctx.payload?.equipmentLocationId);
    // El modal Agregar ubicación reutiliza esta lectura del inventario:
    // filtra por ID estructurado y no por nombre de zona (potencialmente ambiguo).
    const filterSql = ' FROM dms_client_inventory_devices WHERE client_id=$1'
      + ' AND (device_name ILIKE $2 ESCAPE \'\\\' OR device_type ILIKE $2 ESCAPE \'\\\''
      + ' OR location_name ILIKE $2 ESCAPE \'\\\' OR manufacturer ILIKE $2 ESCAPE \'\\\''
      + ' OR model ILIKE $2 ESCAPE \'\\\' OR serial ILIKE $2 ESCAPE \'\\\')'
      + (equipmentLocationId ? ' AND details->>\'equipmentLocationId\'=$5' : '');
    // Conteo filtrado exacto para "Página 1/5" sin cargar todos los equipos.
    const [pageResult, countResult] = await Promise.all([
      query('SELECT device_id AS id,device_type AS type,device_name AS name,'
        + ' location_name AS location,manufacturer,model,serial,mac'
        + filterSql
        + ' ORDER BY device_type,location_name,device_name,device_id LIMIT $3 OFFSET $4',
        equipmentLocationId
          ? [id, pattern, pageSize + 1, (page - 1) * pageSize, equipmentLocationId]
          : [id, pattern, pageSize + 1, (page - 1) * pageSize], { label: 'inventory.devices.list' }),
      query('SELECT COUNT(*)::integer AS count'
        + (equipmentLocationId ? filterSql.replace('=$5', '=$3') : filterSql),
        equipmentLocationId ? [id, pattern, equipmentLocationId] : [id, pattern],
        { label: 'inventory.devices.count' }),
    ]);
    const result = rows(pageResult);
    const totalFiltered = Number(countResult.rows?.[0]?.count || 0);
    return {
      generated: true, generatedAt: summary.generated_at, revision: summary.revision,
      total: summary.device_count, totalFiltered, aiStatus: summary.ai_status,
      items: result.slice(0,pageSize), page, pageSize, hasMore: result.length > pageSize,
    };
  },
  detail: async (ctx) => {
    readGuard(ctx);
    const id = clientId(ctx), target = deviceId(ctx);
    const device = await selectOne(
      'SELECT device_id AS id,device_type AS type,device_name AS name,'
      + ' location_name AS location,manufacturer,model,serial,mac,source_ids,details'
      + ' FROM dms_client_inventory_devices WHERE client_id=$1 AND device_id=$2',
      [id,target], 'inventory.device.detail');
    if (!device) throw notFound('El dispositivo no existe en este inventario.');
    const permission = allTickets(ctx), userId = clean(ctx.user.UsuarioID);
    const eventOffset = Math.max(0, Math.min(100000, Number(ctx.payload?.eventOffset) || 0));
    const mediaOffset = Math.max(0, Math.min(100000, Number(ctx.payload?.mediaOffset) || 0));
    const loadEvents = ctx.payload?.includeEvents !== false;
    const loadMedia = ctx.payload?.includeMedia !== false;
    const events = loadEvents ? rows(await query(
      'SELECT e.event_key AS id,e.event_type AS type,e.source_id AS "sourceId",'
      + ' e.occurred_at AS date,e.title,e.summary,e.technicians'
      + ' FROM dms_client_inventory_events e WHERE e.client_id=$1 AND e.device_id=$2'
      + ' AND ' + ticketVisibilityCondition('e')
      + ' ORDER BY e.occurred_at DESC,e.event_key DESC LIMIT $5 OFFSET $6',
      [id,target,permission,userId,101,eventOffset], { label: 'inventory.device.events' })) : [];
    const media = loadMedia ? rows(await query(
      'SELECT e.media_key AS id,e.media_type AS type,e.source_id AS "sourceId",'
      + ' e.evidence_id AS "evidenceId",e.occurred_at AS date,e.label,'
      + ' e.mime_type AS "mimeType",e.file_id AS "fileId"'
      + ' FROM dms_client_inventory_media e WHERE e.client_id=$1 AND e.device_id=$2'
      + ' AND ' + mediaVisibilityCondition('e')
      + ' ORDER BY e.occurred_at DESC,e.media_key DESC LIMIT $5 OFFSET $6',
      [id,target,permission,userId,101,mediaOffset], { label: 'inventory.device.media' })) : [];
    const current = device.details?.currentStatus;
    // Las peticiones de solo medios nunca deben usar includeEvents=false para
    // eludir el filtro de visibilidad del último registro.
    if (!loadEvents && device.details) {
      device.details = { ...device.details, currentStatus: null };
    }
    // No filtrar historial protegido mediante el resumen persistido por el admin.
    // Si el último registro es una boleta no visible para este técnico, mostrar
    // únicamente la intervención visible más reciente y NO el texto de Gemini.
    if (loadEvents && current?.sourceType === 'BOLETA'
      && !events.some((entry) => entry.id === current.eventKey)) {
      const visible = events[0];
      device.details = {
        ...device.details,
        currentStatus: visible ? {
          condition: 'NO_DETERMINADO',
          summary: 'Último trabajo visible: ' + clean(visible.title).slice(0, 130)
            + '. ' + clean(visible.summary).slice(0, 220),
          date: clean(visible.date),
          sourceType: clean(visible.type),
          sourceId: clean(visible.sourceId),
          eventKey: clean(visible.id),
          origin: 'registro',
        } : null,
      };
    }
    return {
      device, events: events.slice(0,100), media: media.slice(0,100),
      hasMoreEvents: events.length>100, hasMoreMedia: media.length>100,
    };
  },
  /**
   * Unión manual INMEDIATA de dos fichas del mismo cliente, persistida en
   * vínculos históricos que sobreviven a la reconstrucción del inventario.
   * Ninguna boleta, evidencia ni mantenimiento operativo se modifica.
   */
  link: async (ctx) => {
    adminGuard(ctx); // Administrador y Supervisor comparten USUARIOS_GESTIONAR
    const id = clientId(ctx);
    const keepId = clean(ctx.payload?.keepDeviceId);
    const mergeId = clean(ctx.payload?.mergeDeviceId);
    const requestKey = clean(ctx.payload?.requestKey);
    const expectedRevision = Number(ctx.payload?.expectedRevision);
    if (!/^[a-f0-9]{32}$/.test(keepId) || !/^[a-f0-9]{32}$/.test(mergeId) || keepId === mergeId) {
      throw badRequest('Seleccione dos dispositivos distintos del mismo inventario.');
    }
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)) {
      throw badRequest('La operación requiere una clave de idempotencia válida.');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw badRequest('Falta la revisión del inventario. Recargue la lista antes de vincular.');
    }
    const userId = clean(ctx.user.UsuarioID);
    let outcome;
    await withTransaction(async () => {
      await query('SELECT pg_advisory_xact_lock(hashtext($1))',
        ['client-inventory:'+id], { label: 'inventory.link.lock' });
      const repeated = await selectOne(
        'SELECT kept_device_id,merged_device_id FROM dms_client_inventory_manual_link_requests'
        + ' WHERE client_id=$1 AND request_key=$2',
        [id, requestKey], 'inventory.link.idempotency');
      if (repeated) {
        if (repeated.kept_device_id !== keepId || repeated.merged_device_id !== mergeId) {
          throw badRequest('La clave de operación ya se utilizó para otros equipos.');
        }
        outcome = { linked: true, alreadyLinked: true, keptDeviceId: keepId };
        return;
      }
      const inventory = await selectOne(
        'SELECT revision,device_count FROM dms_client_inventory WHERE client_id=$1 FOR UPDATE',
        [id], 'inventory.link.version');
      if (!inventory) throw notFound('Primero debe generar el inventario del cliente.');
      if (Number(inventory.revision) !== expectedRevision) {
        throw badRequest('El inventario cambió. Recargue la lista antes de vincular dispositivos.');
      }
      const devices = rows(await query(
        'SELECT device_id,device_type,device_name,serial,mac,source_ids,details'
        + ' FROM dms_client_inventory_devices WHERE client_id=$1'
        + ' AND device_id IN ($2,$3) ORDER BY device_id FOR UPDATE',
        [id,keepId,mergeId], { label: 'inventory.link.resolve' }));
      const keep = devices.find((row) => row.device_id === keepId);
      const remove = devices.find((row) => row.device_id === mergeId);
      if (!keep || !remove) throw notFound('Uno de los dispositivos ya no existe. Recargue el inventario.');
      const sourceIds = [...new Set([...(keep.source_ids || []),...(remove.source_ids || [])].map(clean).filter(Boolean))];
      if (!sourceIds.length || sourceIds.length !== (keep.source_ids || []).length + (remove.source_ids || []).length) {
        throw badRequest('No es posible vincular dispositivos con evidencias históricas repetidas o vacías.');
      }
      const original = rows(await query(
        'SELECT d."EvidenciaMantenimientoID",d."TipoDispositivo",d."Serie",d."DireccionMAC"'
        + ' FROM "Evidencia_Mantenimientos" d'
        + ' JOIN "Mantenimiento" m ON m."MantenimientoID"=d."MantenimientoRef"'
        + ' WHERE ' + active('m') + ' AND ' + active('d')
        + ' AND m."ClienteID"=$1 AND d."EvidenciaMantenimientoID"=ANY($2::text[])',
        [id,sourceIds], { label: 'inventory.link.sourceValidation' }));
      if (original.length !== sourceIds.length || !validateManualInventorySourceUnion(original)) {
        throw badRequest('No se pueden unir equipos con distinto tipo, serie o MAC, ni referencias históricas inválidas.');
      }
      // Conservar el nombre y atributos del equipo principal, y todos los
      // nombres secundarios para búsquedas e identificación de la ficha.
      const aliases = [...new Set([
        ...(Array.isArray(keep.details?.aliases) ? keep.details.aliases : [keep.device_name]),
        ...(Array.isArray(remove.details?.aliases) ? remove.details.aliases : [remove.device_name]),
        keep.device_name,remove.device_name,
      ].map(clean).filter(Boolean))];
      const last = await selectOne(
        'SELECT event_key AS key,event_type AS type,source_id AS "sourceId",'
        + ' occurred_at AS date,title,summary FROM dms_client_inventory_events'
        + ' WHERE client_id=$1 AND device_id IN ($2,$3)'
        + ' ORDER BY occurred_at DESC,event_key DESC LIMIT 1',
        [id,keepId,mergeId], 'inventory.link.lastEvent');
      const details = {
        ...(keep.details || {}),
        aliases,
        manualLinked: true,
        currentStatus: recordedCurrentStatus({ latest: last || null }),
      };
      const anchor = clean((keep.source_ids || [])[0]);
      if (!anchor) throw badRequest('El equipo principal no tiene una referencia histórica válida.');
      // El mapa se escribe bajo el mismo lock de inventory.generate: nunca se
      // perderá aunque se ejecute Actualizar inventario en otro servidor.
      await query(
        'INSERT INTO dms_client_inventory_manual_links'
        + '(client_id,source_id,canonical_source_id,preferred_device_name,linked_by,linked_at)'
        + ' SELECT $1,s.source_id,$3,$4,$5,NOW() FROM unnest($2::text[]) AS s(source_id)'
        + ' ON CONFLICT(client_id,source_id) DO UPDATE SET'
        + ' canonical_source_id=EXCLUDED.canonical_source_id,'
        + ' preferred_device_name=EXCLUDED.preferred_device_name,'
        + ' linked_by=EXCLUDED.linked_by,linked_at=EXCLUDED.linked_at',
        [id,sourceIds,anchor,keep.device_name,userId], { label: 'inventory.link.persist', write: true });
      await query(
        'UPDATE dms_client_inventory_devices SET source_ids=$3,details=$4::jsonb'
        + ' WHERE client_id=$1 AND device_id=$2',
        [id,keepId,sourceIds,JSON.stringify(details)],
        { label: 'inventory.link.updateKept', write: true });
      await query(
        'INSERT INTO dms_client_inventory_events'
        + '(client_id,device_id,event_key,event_type,source_id,occurred_at,title,summary,technicians)'
        + ' SELECT client_id,$2,event_key,event_type,source_id,occurred_at,title,summary,technicians'
        + ' FROM dms_client_inventory_events WHERE client_id=$1 AND device_id=$3'
        + ' ON CONFLICT(client_id,device_id,event_key) DO NOTHING',
        [id,keepId,mergeId], { label: 'inventory.link.mergeEvents', write: true });
      await query(
        'INSERT INTO dms_client_inventory_media'
        + '(client_id,device_id,media_key,media_type,source_id,evidence_id,occurred_at,label,mime_type,file_id)'
        + ' SELECT client_id,$2,media_key,media_type,source_id,evidence_id,occurred_at,label,mime_type,file_id'
        + ' FROM dms_client_inventory_media WHERE client_id=$1 AND device_id=$3'
        + ' ON CONFLICT(client_id,device_id,media_key) DO NOTHING',
        [id,keepId,mergeId], { label: 'inventory.link.mergeMedia', write: true });
      await query('DELETE FROM dms_client_inventory_devices WHERE client_id=$1 AND device_id=$2',
        [id,mergeId], { label: 'inventory.link.deleteDuplicate', write: true });
      await query(
        'UPDATE dms_client_inventory SET device_count=device_count-1,revision=revision+1 WHERE client_id=$1',
        [id], { label: 'inventory.link.versionIncrement', write: true });
      await query(
        'INSERT INTO dms_client_inventory_manual_link_requests'
        + '(client_id,request_key,kept_device_id,merged_device_id,linked_by) VALUES($1,$2,$3,$4,$5)',
        [id,requestKey,keepId,mergeId,userId],
        { label: 'inventory.link.request', write: true });
      outcome = {
        linked: true, alreadyLinked: false, keptDeviceId: keepId,
        revision: expectedRevision + 1, deviceCount: Number(inventory.device_count) - 1,
      };
    });
    if (!outcome.alreadyLinked) {
      await audit(ctx, 'VINCULAR_DISPOSITIVOS_INVENTARIO', 'Clientes', id, null, {
        principal: keepId, duplicado: mergeId, revision: outcome.revision,
      });
    }
    return outcome;
  },
  generate: async (ctx) => {
    adminGuard(ctx);
    const id = clientId(ctx);
    const client = await findById('Clientes', id);
    if (!client || client.Activo === false || String(client.Activo).toLowerCase() === 'false') {
      throw badRequest('El cliente ya no está activo.');
    }
    // La misma regla rige en backend; no confiar en la lista ni admitir
    // generaciones manuales para clientes que únicamente tienen boletas.
    const maintenance = await selectOne(
      'SELECT m."MantenimientoID" FROM "Mantenimiento" m'
      + ' WHERE ' + active('m') + ' AND m."ClienteID"=$1 LIMIT 1',
      [id], 'inventory.client.hasMaintenance');
    if (!maintenance) throw badRequest('Este cliente no tiene mantenimientos registrados.');
    // Única vía de actualización: acción explícita con permisos administrativos (incluye Supervisor).
    const source = await loadSources(id);
    let groups = groupInventoryDevices(source.devices);
    let aiStatus = 'sin_candidatos';
    const candidates = candidateInventoryAliases(groups);
    if (candidates.length) {
      try {
        const suggestion = await suggestInventoryMerges({ candidates });
        groups = mergeInventoryAliases(groups, candidates, suggestion.merges);
        aiStatus = 'analizado:' + clean(suggestion.model).slice(0,80);
      } catch {
        // Sin Gemini no se adivinan equivalencias de riesgo: solo exactas.
        aiStatus = 'gemini_no_disponible';
      }
    }
    // La unión humana prevalece sobre el reconocimiento automático/Gemini.
    // Leer antes para elaborar resúmenes fuera del lock; volver a consultar
    // dentro de la transacción para no perder vínculos concurrentes.
    const preparedGroups = applyManualInventoryLinks(groups, await manualInventoryLinks(id));
    // Solo se consulta Gemini al generar/actualizar, nunca al abrir el detalle.
    // Se prepara fuera de la transacción para no bloquear PostgreSQL.
    const preview = buildInventorySnapshot({
      clientId: id, groups: preparedGroups, tickets: source.tickets,
      ticketEvidence: source.ticketEvidence, maintenanceImages: source.maintenanceImages,
    });
    const currentStates = await inventoryCurrentStatusBySource(preview);
    let snapshot;
    await withTransaction(async () => {
      await query('SELECT pg_advisory_xact_lock(hashtext($1))', ['client-inventory:'+id],
        { label: 'inventory.generate.lock' });
      // La asignación de IDs históricos se lee BAJO el lock; las generaciones
      // concurrentes no pueden calcular una versión con IDs ya reemplazados.
      const previous = await previousIdMap(id);
      const currentGroups = applyManualInventoryLinks(groups, await manualInventoryLinks(id));
      snapshot = buildInventorySnapshot({
        clientId: id, groups: currentGroups, previousSourceIds: previous,
        tickets: source.tickets, ticketEvidence: source.ticketEvidence,
        maintenanceImages: source.maintenanceImages,
      });
      const latestById = new Map(latestInventoryEvents(snapshot).map((item) => [item.id, item]));
      for (const device of snapshot.devices) {
        // Si se vinculó otro registro mientras Gemini estaba procesando,
        // el resumen calculado antes del lock no corresponde al nuevo grupo.
        // En ese caso usar únicamente el registro más reciente, sin inventar.
        device.details.currentStatus = currentStates.bySource.get(inventorySourcesKey(device))
          || recordedCurrentStatus(latestById.get(device.deviceId) || { latest: null });
      }
      const prior = await selectOne('SELECT revision FROM dms_client_inventory WHERE client_id=$1 FOR UPDATE',
        [id], 'inventory.generate.prior');
      await query(
        'INSERT INTO dms_client_inventory(client_id,generated_at,generated_by,revision,device_count,ai_status)'
        + ' VALUES($1,NOW(),$2,$3,$4,$5)'
        + ' ON CONFLICT(client_id) DO UPDATE SET generated_at=EXCLUDED.generated_at,'
        + ' generated_by=EXCLUDED.generated_by,revision=EXCLUDED.revision,'
        + ' device_count=EXCLUDED.device_count,ai_status=EXCLUDED.ai_status',
        [id,clean(ctx.user.UsuarioID),Number(prior?.revision||0)+1,snapshot.devices.length,
          aiStatus + ';estado:' + currentStates.status + ':' + currentStates.processed + '/' + currentStates.total],
        { label: 'inventory.generate.snapshot', write: true });
      await query('DELETE FROM dms_client_inventory_devices WHERE client_id=$1',
        [id], { label: 'inventory.generate.replace', write: true });
      await bulkInsert(
        'INSERT INTO dms_client_inventory_devices(client_id,device_id,device_type,device_name,location_name,manufacturer,model,serial,mac,source_ids,details) VALUES ',
        snapshot.devices.map((d) => [id,d.deviceId,d.type,d.name,d.location,d.manufacturer,d.model,
          d.serial,d.mac,d.sourceIds,JSON.stringify(d.details)]),
        11,'inventory.generate.devices');
      await bulkInsert(
        'INSERT INTO dms_client_inventory_events(client_id,device_id,event_key,event_type,source_id,occurred_at,title,summary,technicians) VALUES ',
        snapshot.events.map((e) => [id,e.deviceId,e.key,e.type,e.sourceId,e.date,e.title,e.summary,e.technicians]),
        9,'inventory.generate.events');
      await bulkInsert(
        'INSERT INTO dms_client_inventory_media(client_id,device_id,media_key,media_type,source_id,evidence_id,occurred_at,label,mime_type,file_id) VALUES ',
        snapshot.media.map((e) => [id,e.deviceId,e.key,e.type,e.sourceId,e.evidenceId,e.date,e.label,e.mimeType,e.fileId]),
        10,'inventory.generate.media');
    });
    await audit(ctx, 'GENERAR_INVENTARIO_CLIENTE', 'Clientes', id, null, {
      dispositivos: snapshot.devices.length, eventos: snapshot.events.length,
      imagenes: snapshot.media.length, aiStatus,
      resumenEstado: currentStates.status, resumenGemini: currentStates.processed,
    });
    return {
      generated: true, count: snapshot.devices.length, events: snapshot.events.length,
      images: snapshot.media.length, aiStatus,
      currentStatus: currentStates.status, summarized: currentStates.processed,
    };
  },
};
