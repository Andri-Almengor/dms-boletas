import { badRequest, notFound } from '../core/errors.js';
import { assertAiCapability } from './agent.permissions.js';
import {
  active, addRange, aliasQuery, clean, entity, like, many, one, pageLimit, pageOffset, protectedAttachment, source,
} from './agent.repository.shared.js';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function maintenanceBase(ctx, idValue) {
  assertAiCapability(ctx, 'maintenance');
  const id = clean(idValue, 250);
  if (!id) throw badRequest('Falta maintenanceId.');
  const row = await one(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."UbicacionID" AS "locationId",m."Ubicacion" AS location,
            m."Estado" AS status,m."Fecha" AS date,m."FechaFinalizacion" AS "finishedAt"
       FROM "Mantenimiento" m
      WHERE ${active('m')} AND m."MantenimientoID"=$1 LIMIT 1`,
    [id],
    'ai.integralMaintenance.base',
  );
  if (!row) throw notFound('No se encontró el mantenimiento solicitado.');
  return row;
}

export async function resolveMaintenanceReference(ctx, args = {}) {
  assertAiCapability(ctx, 'maintenance');
  const explicit = clean(args.maintenanceId, 250);
  if (explicit) {
    const row = await maintenanceBase(ctx, explicit);
    return {
      modelData: { resolved: true, maintenance: row, candidates: [row] },
      entities: [entity('maintenance', row.id, row.title || 'Mantenimiento', '/mantenimientos/' + encodeURIComponent(row.id))],
      context: {
        lastMaintenanceId: row.id,
        lastMaintenanceName: row.title || '',
        lastClientId: row.clientId || '',
        lastClientName: row.client || '',
      },
    };
  }

  const reference = aliasQuery(args.reference || args.query);
  if (!reference) throw badRequest('Indique el mantenimiento o cliente de referencia.');
  const rows = await many(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."Ubicacion" AS location,m."Estado" AS status,m."Fecha" AS date,
            m."FechaFinalizacion" AS "finishedAt"
       FROM "Mantenimiento" m
      WHERE ${active('m')} AND (
        m."MantenimientoID"=$1
        OR m."TituloMantenimiento" ILIKE $2 ESCAPE '\\'
        OR m."Cliente" ILIKE $2 ESCAPE '\\'
        OR m."Ubicacion" ILIKE $2 ESCAPE '\\'
      )
      ORDER BY CASE
        WHEN LOWER(COALESCE(m."TituloMantenimiento",''))=LOWER($1) THEN 0
        WHEN LOWER(COALESCE(m."Cliente",''))=LOWER($1) THEN 1
        ELSE 2
      END,
      COALESCE(NULLIF(m."FechaFinalizacion",''),m."Fecha",m."FechaCreacion") DESC NULLS LAST
      LIMIT 8`,
    [reference, like(reference)],
    'ai.integralMaintenance.resolve',
  );

  if (!rows.length) {
    return { modelData: { resolved: false, ambiguous: false, candidates: [], message: 'No se encontró un mantenimiento coincidente.' } };
  }

  const latest = args.latest === true || /\b(ultimo|último|mas reciente|más reciente|reciente)\b/i.test(String(args.reference || args.query || ''));
  const exact = rows.filter((row) => normalize(row.title) === normalize(reference) || normalize(row.id) === normalize(reference));
  const chosen = latest ? rows[0] : (exact.length === 1 ? exact[0] : (rows.length === 1 ? rows[0] : null));
  const candidates = rows.map((row) => ({
    id: row.id,
    title: row.title || 'Mantenimiento',
    clientId: row.clientId || '',
    client: row.client || '',
    location: row.location || '',
    status: row.status || '',
    date: row.date || '',
    finishedAt: row.finishedAt || '',
  }));

  if (!chosen) {
    return {
      modelData: { resolved: false, ambiguous: true, candidates, message: 'Hay varios mantenimientos que coinciden. Solicite una aclaración.' },
      entities: candidates.map((row) => entity('maintenance', row.id, row.title, '/mantenimientos/' + encodeURIComponent(row.id))),
    };
  }

  const selected = candidates.find((row) => row.id === chosen.id);
  return {
    modelData: { resolved: true, maintenance: selected, candidates },
    entities: [entity('maintenance', chosen.id, chosen.title || 'Mantenimiento', '/mantenimientos/' + encodeURIComponent(chosen.id))],
    context: {
      lastMaintenanceId: chosen.id,
      lastMaintenanceName: chosen.title || '',
      lastClientId: chosen.clientId || '',
      lastClientName: chosen.client || '',
    },
  };
}

export async function resolveMaintenanceDevice(ctx, args = {}) {
  const maintenance = await maintenanceBase(ctx, args.maintenanceId);
  const explicit = clean(args.deviceId, 250);
  const reference = clean(args.reference || args.query, 300);
  if (!explicit && !reference) throw badRequest('Indique el dispositivo a resolver.');

  const params = [maintenance.id];
  const clauses = [active('d'), 'd."MantenimientoRef"=$1'];
  if (explicit) {
    params.push(explicit);
    clauses.push('d."EvidenciaMantenimientoID"=$' + params.length);
  } else {
    params.push(like(reference));
    const p = '$' + params.length;
    clauses.push(`(
      d."NombreDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."Categoria" ILIKE ${p} ESCAPE '\\'
      OR d."Zona" ILIKE ${p} ESCAPE '\\'
    )`);
  }

  const rows = await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Zona" AS zone,d."Estado" AS status
       FROM "Evidencia_Mantenimientos" d
      WHERE ${clauses.join(' AND ')}
      ORDER BY d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC LIMIT 12`,
    params,
    'ai.integralMaintenance.device.resolve',
  );

  if (!rows.length) {
    return {
      modelData: {
        resolved: false,
        ambiguous: false,
        maintenance: { id: maintenance.id, title: maintenance.title },
        candidates: [],
        message: 'No se encontró el dispositivo dentro del mantenimiento.',
      },
      context: { lastMaintenanceId: maintenance.id, lastMaintenanceName: maintenance.title || '' },
    };
  }

  const exact = rows.filter((row) => normalize(row.name) === normalize(reference) || row.id === explicit);
  const chosen = exact.length === 1 ? exact[0] : (rows.length === 1 ? rows[0] : null);
  const candidates = rows.map((row) => ({
    id: row.id,
    name: row.name || row.type || 'Dispositivo',
    type: row.type || '',
    zone: row.zone || '',
    status: row.status || '',
  }));

  if (!chosen) {
    return {
      modelData: {
        resolved: false,
        ambiguous: true,
        maintenance: { id: maintenance.id, title: maintenance.title },
        candidates,
        message: 'Hay varios dispositivos coincidentes. Solicite una aclaración.',
      },
      entities: candidates.map((row) => entity('device', row.id, row.name, '/mantenimientos/' + encodeURIComponent(maintenance.id))),
      context: { lastMaintenanceId: maintenance.id, lastMaintenanceName: maintenance.title || '' },
    };
  }

  const selected = candidates.find((row) => row.id === chosen.id);
  return {
    modelData: {
      resolved: true,
      maintenance: { id: maintenance.id, title: maintenance.title },
      device: selected,
      candidates,
    },
    entities: [entity('device', chosen.id, chosen.name || chosen.type || 'Dispositivo', '/mantenimientos/' + encodeURIComponent(maintenance.id))],
    context: {
      lastMaintenanceId: maintenance.id,
      lastMaintenanceName: maintenance.title || '',
      lastDeviceId: chosen.id,
      lastDeviceName: chosen.name || chosen.type || '',
    },
  };
}

export async function searchMaintenanceEvidence(ctx, args = {}) {
  const maintenance = await maintenanceBase(ctx, args.maintenanceId);
  const params = [maintenance.id];
  const clauses = [
    active('mi'),
    active('d'),
    'd."MantenimientoRef"=$1',
    'mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"',
  ];

  if (Array.isArray(args.deviceIds) && args.deviceIds.length) {
    params.push(args.deviceIds.map((value) => clean(value, 250)).filter(Boolean));
    clauses.push('d."EvidenciaMantenimientoID"=ANY($' + params.length + '::text[])');
  }
  if (clean(args.type)) {
    params.push(like(args.type));
    const p = '$' + params.length;
    clauses.push(`(d."TipoDispositivo" ILIKE ${p} ESCAPE '\\' OR d."Categoria" ILIKE ${p} ESCAPE '\\')`);
  }
  if (clean(args.stage)) {
    const normalized = normalize(args.stage);
    const stage = normalized.includes('desp') ? 'Despues' : (normalized.includes('antes') ? 'Antes' : '');
    if (stage) {
      params.push(stage);
      clauses.push('LOWER(COALESCE(mi."Tipo",\'\'))=LOWER($' + params.length + ')');
    }
  }
  if (clean(args.query)) {
    params.push(like(args.query));
    const p = '$' + params.length;
    clauses.push(`(
      mi."Nombre" ILIKE ${p} ESCAPE '\\'
      OR mi."Nota" ILIKE ${p} ESCAPE '\\'
      OR d."NombreDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."Categoria" ILIKE ${p} ESCAPE '\\'
      OR d."Zona" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  if (clean(args.uploaderId)) {
    params.push(clean(args.uploaderId,250));
    clauses.push('mi."CreadoPor"=$' + params.length);
  } else if (clean(args.uploaderName)) {
    params.push(like(args.uploaderName));
    const p='$'+params.length;
    clauses.push(`(uploader."NombreCompleto" ILIKE ${p} ESCAPE '\\' OR uploader."NombreUsuario" ILIKE ${p} ESCAPE '\\')`);
  }
  const mimeCategory=clean(args.mimeCategory,40).toUpperCase();
  if (mimeCategory==='IMAGE') clauses.push(`LOWER(COALESCE(mi."MimeType",'')) LIKE 'image/%'`);
  else if (mimeCategory==='VIDEO') clauses.push(`LOWER(COALESCE(mi."MimeType",'')) LIKE 'video/%'`);
  else if (mimeCategory==='PDF') clauses.push(`LOWER(COALESCE(mi."MimeType",''))='application/pdf'`);
  const period=addRange(clauses,params,'mi."FechaCreacion"',args);

  const counted=await one(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."MimeType",'')) LIKE 'image/%')::bigint AS images,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."MimeType",'')) LIKE 'video/%')::bigint AS videos,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."Tipo",''))='antes')::bigint AS before_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."Tipo",''))='despues')::bigint AS after_count
       FROM "Mantenimiento imagenes" mi
       JOIN "Evidencia_Mantenimientos" d
         ON d."__valid"=TRUE AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=mi."CreadoPor"
      WHERE ${clauses.join(' AND ')}`,
    params,
    'ai.integralMaintenance.evidence.count',
  );

  const queryParams=[...params,pageLimit(args.limit,50),pageOffset(args.offset)];
  const rows = await many(
    `SELECT mi."FotoDispositivoID" AS id,mi."Nombre" AS name,mi."Nota" AS note,mi."Tipo" AS stage,
            mi."MimeType" AS "mimeType",mi."TipoMedio" AS "mediaType",mi."FechaCreacion" AS "createdAt",
            mi."CreadoPor" AS "createdBy",
            COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",mi."CreadoPor") AS "uploadedBy",
            mi."DriveFileID" AS "__file",
            d."EvidenciaMantenimientoID" AS "deviceId",d."NombreDispositivo" AS "deviceName",
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS "deviceType",d."Zona" AS zone
       FROM "Mantenimiento imagenes" mi
       JOIN "Evidencia_Mantenimientos" d
         ON d."__valid"=TRUE AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=mi."CreadoPor"
      WHERE ${clauses.join(' AND ')}
      ORDER BY d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC NULLS LAST,mi."FechaCreacion" ASC NULLS LAST
      LIMIT ${queryParams.length-1} OFFSET ${queryParams.length}`,
    queryParams,
    'ai.integralMaintenance.evidence',
  );

  const items = rows.map((row) => ({
    id: row.id,
    name: row.name || 'Evidencia',
    note: clean(row.note, 1600),
    stage: row.stage || '',
    mimeType: row.mimeType || 'application/octet-stream',
    mediaType: row.mediaType || '',
    createdAt: row.createdAt || '',
    createdBy: row.createdBy || '',
    uploadedBy: row.uploadedBy || row.createdBy || '',
    deviceId: row.deviceId || '',
    deviceName: row.deviceName || row.deviceType || 'Dispositivo',
    deviceType: row.deviceType || '',
    zone: row.zone || '',
  }));

  const attachments = rows.map((row) => protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: 'maintenance:' + maintenance.id,
    evidenceId: row.id,
    kind: 'maintenance-evidence',
    title: row.deviceName || row.name || 'Dispositivo',
    subtitle: [row.stage, row.deviceType, row.zone, row.note].filter(Boolean).join(' · '),
    entityType: 'maintenance',
    entityId: maintenance.id,
  })).filter(Boolean);

  const normalizedStages = [...new Set(items.map((item) => normalize(item.stage)).filter(Boolean))];
  return {
    modelData: {
      maintenance: { id: maintenance.id, title: maintenance.title || 'Mantenimiento', client: maintenance.client || '' },
      total: Number(counted?.total||0),
      totalShown: items.length,
      imageCount: Number(counted?.images||0),
      videoCount: Number(counted?.videos||0),
      beforeCount: Number(counted?.before_count||0),
      afterCount: Number(counted?.after_count||0),
      mimeCategory,
      period,
      items,
    },
    attachments,
    entities: [entity('maintenance', maintenance.id, maintenance.title || 'Mantenimiento', '/mantenimientos/' + encodeURIComponent(maintenance.id))],
    sources: [source('maintenance', maintenance.id, (maintenance.title || 'Mantenimiento') + ' · evidencias', '/mantenimientos/' + encodeURIComponent(maintenance.id))],
    context: {
      lastMaintenanceId: maintenance.id,
      lastMaintenanceName: maintenance.title || '',
      lastClientId: maintenance.clientId || '',
      lastClientName: maintenance.client || '',
      ...(normalizedStages.length === 1 ? { lastEvidenceStage: normalizedStages[0].includes('desp') ? 'DESPUES' : 'ANTES' } : {}),
    },
  };
}

export const maintenanceIntegralRepositoryTools = Object.freeze({
  resolve_maintenance_reference: resolveMaintenanceReference,
  resolve_maintenance_device: resolveMaintenanceDevice,
  search_maintenance_evidence: searchMaintenanceEvidence,
});
