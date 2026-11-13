import { badRequest, forbidden, notFound } from '../core/errors.js';
import { query, withTransaction } from '../infra/postgres.js';
import { findById } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { suggestInventoryMerges } from '../services/assistant-gemini.service.js';
import {
  groupInventoryDevices, candidateInventoryAliases, mergeInventoryAliases,
  buildInventorySnapshot,
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
      + ' AND (EXISTS(SELECT 1 FROM "Mantenimiento" m'
      + ' WHERE ' + active('m') + ' AND m."ClienteID"=c."ClienteID")'
      + ' OR EXISTS(SELECT 1 FROM "Boletas" b'
      + ' WHERE ' + 'b."__valid"=TRUE' + ' AND b."ClienteID"=c."ClienteID"))'
      + ' ORDER BY c."Nombre",c."ClienteID" LIMIT $2 OFFSET $3',
      [term, pageSize + 1, (page - 1) * pageSize], { label: 'inventory.clients.list' }));
    return { items: result.slice(0,pageSize), page, pageSize, hasMore: result.length > pageSize };
  },
  devices: async (ctx) => {
    readGuard(ctx);
    const id = clientId(ctx);
    const page = cap(ctx.payload?.page, 100000, 1);
    const pageSize = cap(ctx.payload?.pageSize, 100, 25);
    const pattern = '%' + clean(ctx.payload?.search).slice(0,120).replace(/[\%_]/g, '\\$&') + '%';
    const summary = await selectOne(
      'SELECT client_id,generated_at,revision,device_count,ai_status FROM dms_client_inventory WHERE client_id=$1',
      [id], 'inventory.client.status');
    if (!summary) return { generated: false, items: [], page, pageSize, hasMore: false };
    const result = rows(await query(
      'SELECT device_id AS id,device_type AS type,device_name AS name,'
      + ' location_name AS location,manufacturer,model,serial,mac'
      + ' FROM dms_client_inventory_devices WHERE client_id=$1'
      + ' AND (device_name ILIKE $2 ESCAPE \'\\\' OR device_type ILIKE $2 ESCAPE \'\\\''
      + ' OR location_name ILIKE $2 ESCAPE \'\\\' OR manufacturer ILIKE $2 ESCAPE \'\\\''
      + ' OR model ILIKE $2 ESCAPE \'\\\' OR serial ILIKE $2 ESCAPE \'\\\')'
      + ' ORDER BY device_type,location_name,device_name,device_id LIMIT $3 OFFSET $4',
      [id, pattern, pageSize + 1, (page - 1) * pageSize], { label: 'inventory.devices.list' }));
    return {
      generated: true, generatedAt: summary.generated_at, revision: summary.revision,
      total: summary.device_count, aiStatus: summary.ai_status,
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
    return {
      device, events: events.slice(0,100), media: media.slice(0,100),
      hasMoreEvents: events.length>100, hasMoreMedia: media.length>100,
    };
  },
  generate: async (ctx) => {
    adminGuard(ctx);
    const id = clientId(ctx);
    const client = await findById('Clientes', id);
    if (!client || client.Activo === false || String(client.Activo).toLowerCase() === 'false') {
      throw badRequest('El cliente ya no está activo.');
    }
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
    let snapshot;
    await withTransaction(async () => {
      await query('SELECT pg_advisory_xact_lock(hashtext($1))', ['client-inventory:'+id],
        { label: 'inventory.generate.lock' });
      // La asignación de IDs históricos se lee BAJO el lock; las generaciones
      // concurrentes no pueden calcular una versión con IDs ya reemplazados.
      const previous = await previousIdMap(id);
      snapshot = buildInventorySnapshot({
        clientId: id, groups, previousSourceIds: previous,
        tickets: source.tickets, ticketEvidence: source.ticketEvidence,
        maintenanceImages: source.maintenanceImages,
      });
      const prior = await selectOne('SELECT revision FROM dms_client_inventory WHERE client_id=$1 FOR UPDATE',
        [id], 'inventory.generate.prior');
      await query(
        'INSERT INTO dms_client_inventory(client_id,generated_at,generated_by,revision,device_count,ai_status)'
        + ' VALUES($1,NOW(),$2,$3,$4,$5)'
        + ' ON CONFLICT(client_id) DO UPDATE SET generated_at=EXCLUDED.generated_at,'
        + ' generated_by=EXCLUDED.generated_by,revision=EXCLUDED.revision,'
        + ' device_count=EXCLUDED.device_count,ai_status=EXCLUDED.ai_status',
        [id,clean(ctx.user.UsuarioID),Number(prior?.revision||0)+1,snapshot.devices.length,aiStatus],
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
    });
    return {
      generated: true, count: snapshot.devices.length, events: snapshot.events.length,
      images: snapshot.media.length, aiStatus,
    };
  },
};
