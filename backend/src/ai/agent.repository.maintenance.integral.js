import { badRequest, notFound } from '../core/errors.js';
import { assertAiCapability } from './agent.permissions.js';
import {
  active, addRange, aliasQuery, clean, entity, like, many, one, pageLimit, pageOffset, protectedAttachment, source,
} from './agent.repository.shared.js';
import { projectMaintenanceComponentsFromAnswers } from '../services/maintenance-evidence-policy.service.js';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function projectEvidenceFilters(args = {}) {
  return {
    query: clean(args.componentQuery, 250),
    type: clean(args.componentType, 180),
    manufacturer: clean(args.componentManufacturer, 180),
    model: clean(args.componentModel, 180),
    serial: clean(args.componentSerial, 180),
    mac: clean(args.componentMac, 180),
  };
}

function hasProjectEvidenceFilters(args = {}) {
  return Object.values(projectEvidenceFilters(args)).some(Boolean);
}

function projectEvidenceComponent(row = {}) {
  if (String(row.projectTargetType || '').toUpperCase() !== 'COMPONENTE') return null;
  const componentId = clean(row.projectComponentLocalId, 250);
  if (!componentId) return null;
  return projectMaintenanceComponentsFromAnswers(row.answersJson)
    .find((component) => component.localId === componentId) || null;
}

function projectEvidenceComponentMatches(component, filters = {}) {
  if (!component) return false;
  const includes = (value, expected) => !expected || normalize(value).includes(normalize(expected));
  if (!includes(component.type, filters.type)) return false;
  if (!includes(component.manufacturer, filters.manufacturer)) return false;
  if (!includes(component.model, filters.model)) return false;
  if (!includes(component.serial, filters.serial)) return false;
  if (!includes(component.mac, filters.mac)) return false;
  if (filters.query) {
    const text = normalize([
      component.relationLabel, component.type, component.name, component.manufacturer,
      component.model, component.serial, component.mac,
      ...Object.entries(component.answers || {}).flatMap(([key, value]) => [key, value]),
    ].filter(Boolean).join(' '));
    if (!text.includes(normalize(filters.query))) return false;
  }
  return true;
}

async function maintenanceBase(ctx, idValue) {
  assertAiCapability(ctx, 'maintenance');
  const id = clean(idValue, 250);
  if (!id) throw badRequest('Falta maintenanceId.');
  const row = await one(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."UbicacionID" AS "locationId",m."Ubicacion" AS location,
            m."Estado" AS status,COALESCE(NULLIF(m."TipoMantenimiento",''),'MANTENIMIENTO') AS "maintenanceType",
            m."Fecha" AS date,m."FechaFinalizacion" AS "finishedAt"
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
            m."Cliente" AS client,m."Ubicacion" AS location,m."Estado" AS status,
            COALESCE(NULLIF(m."TipoMantenimiento",''),'MANTENIMIENTO') AS "maintenanceType",m."Fecha" AS date,
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
    maintenanceType: String(row.maintenanceType || 'MANTENIMIENTO').toUpperCase(),
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
    if (String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase() === 'PROYECTO') {
      throw badRequest('Los Proyectos no clasifican evidencias como ANTES o DESPUÉS. Filtre por dispositivo o componente relacionado.');
    }
    const normalizedStage = normalize(args.stage);
    const stage = normalizedStage.includes('desp') ? 'Despues' : (normalizedStage.includes('antes') ? 'Antes' : '');
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
      OR mi."ProyectoComponenteNombre" ILIKE ${p} ESCAPE '\\'
      OR project_type."Nombre" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  if (clean(args.uploaderId)) {
    params.push(clean(args.uploaderId, 250));
    clauses.push('mi."CreadoPor"=$' + params.length);
  } else if (clean(args.uploaderName)) {
    params.push(like(args.uploaderName));
    const p = '$' + params.length;
    clauses.push(`(uploader."NombreCompleto" ILIKE ${p} ESCAPE '\\' OR uploader."NombreUsuario" ILIKE ${p} ESCAPE '\\')`);
  }

  const projectFilters = hasProjectEvidenceFilters(args);
  if (clean(args.projectTargetType)) {
    params.push(clean(args.projectTargetType, 40).toUpperCase());
    clauses.push('UPPER(COALESCE(mi."ProyectoDestinoTipo",\'\'))=$' + params.length);
  }
  if (clean(args.componentId)) {
    params.push(clean(args.componentId, 250));
    clauses.push('mi."ProyectoComponenteLocalID"=$' + params.length);
  }
  if (clean(args.componentType)) {
    params.push(like(args.componentType));
    const p = '$' + params.length;
    clauses.push(`(project_type."Nombre" ILIKE ${p} ESCAPE '\\' OR mi."ProyectoComponenteNombre" ILIKE ${p} ESCAPE '\\')`);
    clauses.push(`UPPER(COALESCE(mi."ProyectoDestinoTipo",''))='COMPONENTE'`);
  }
  if (projectFilters) {
    if (String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase() !== 'PROYECTO') {
      return {
        modelData: {
          maintenance: {
            id: maintenance.id,
            title: maintenance.title || 'Mantenimiento',
            client: maintenance.client || '',
            maintenanceType: String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase(),
          },
          total: 0,
          totalShown: 0,
          items: [],
          message: 'Los filtros por componentes relacionados aplican a mantenimientos tipo Proyecto.',
        },
        attachments: [],
        entities: [entity('maintenance', maintenance.id, maintenance.title || 'Mantenimiento', '/mantenimientos/' + encodeURIComponent(maintenance.id))],
        sources: [source('maintenance', maintenance.id, (maintenance.title || 'Mantenimiento') + ' · evidencias', '/mantenimientos/' + encodeURIComponent(maintenance.id))],
        context: {
          lastMaintenanceId: maintenance.id,
          lastMaintenanceName: maintenance.title || '',
          lastClientId: maintenance.clientId || '',
          lastClientName: maintenance.client || '',
        },
      };
    }
    for (const value of Object.values(projectEvidenceFilters(args))) {
      if (!value) continue;
      params.push(like(value));
      clauses.push(`COALESCE(d."RespuestasJSON",'') ILIKE $${params.length} ESCAPE '\\'`);
    }
  }

  const mimeCategory = clean(args.mimeCategory, 40).toUpperCase();
  if (mimeCategory === 'IMAGE') clauses.push(`LOWER(COALESCE(mi."MimeType",'')) LIKE 'image/%'`);
  else if (mimeCategory === 'VIDEO') clauses.push(`LOWER(COALESCE(mi."MimeType",'')) LIKE 'video/%'`);
  else if (mimeCategory === 'PDF') clauses.push(`LOWER(COALESCE(mi."MimeType",''))='application/pdf'`);
  const period = addRange(clauses, params, 'COALESCE(NULLIF(mi."FechaCaptura",\'\'),mi."FechaCreacion")', args);
  const where = clauses.join(' AND ');

  const counted = await one(
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
       LEFT JOIN "TiposDispositivo" project_type
         ON project_type."__valid"=TRUE AND project_type."TipoDispositivoID"=mi."ProyectoComponenteTipoDispositivoID"
      WHERE ${where}`,
    params,
    'ai.integralMaintenance.evidence.count',
  );

  const requestedLimit = pageLimit(args.limit, 50);
  const requestedOffset = pageOffset(args.offset);
  const candidateLimit = projectFilters ? Math.min(250, Math.max(50, (requestedOffset + requestedLimit) * 5)) : requestedLimit;
  const candidateOffset = projectFilters ? 0 : requestedOffset;
  const queryParams = [...params, candidateLimit, candidateOffset];
  const rows = await many(
    `SELECT mi."FotoDispositivoID" AS id,mi."Nombre" AS name,mi."Nota" AS note,mi."Tipo" AS stage,
            mi."MimeType" AS "mimeType",mi."TipoMedio" AS "mediaType",
            COALESCE(NULLIF(mi."FechaCaptura",''),mi."FechaCreacion") AS "capturedAt",
            mi."FechaCreacion" AS "createdAt",mi."ContextoEvidencia" AS "evidenceContext",
            mi."ProyectoDestinoTipo" AS "projectTargetType",mi."ProyectoRelacionClave" AS "projectRelationKey",
            mi."ProyectoComponenteLocalID" AS "projectComponentLocalId",
            mi."ProyectoComponenteTipoDispositivoID" AS "projectComponentTypeId",
            mi."ProyectoComponenteNombre" AS "projectComponentName",
            project_type."Nombre" AS "projectComponentType",
            mi."CreadoPor" AS "createdBy",
            COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",mi."CreadoPor") AS "uploadedBy",
            mi."DriveFileID" AS "__file",
            d."EvidenciaMantenimientoID" AS "deviceId",d."NombreDispositivo" AS "deviceName",
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS "deviceType",
            d."Zona" AS zone,d."RespuestasJSON" AS "answersJson"
       FROM "Mantenimiento imagenes" mi
       JOIN "Evidencia_Mantenimientos" d
         ON d."__valid"=TRUE AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=mi."CreadoPor"
       LEFT JOIN "TiposDispositivo" project_type
         ON project_type."__valid"=TRUE AND project_type."TipoDispositivoID"=mi."ProyectoComponenteTipoDispositivoID"
      WHERE ${where}
      ORDER BY COALESCE(NULLIF(mi."FechaCaptura",''),mi."FechaCreacion") DESC NULLS LAST,
               d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC NULLS LAST
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,
    'ai.integralMaintenance.evidence',
  );

  const filters = projectEvidenceFilters(args);
  const enrichedRows = rows.map((row) => {
    const component = projectEvidenceComponent(row);
    return {
      row,
      component,
      matchesProjectComponentFilters: !projectFilters || projectEvidenceComponentMatches(component, filters),
    };
  });
  const matchedRows = projectFilters
    ? enrichedRows.filter((entry) => entry.matchesProjectComponentFilters)
    : enrichedRows;
  const selectedRows = projectFilters
    ? matchedRows.slice(requestedOffset, requestedOffset + requestedLimit)
    : matchedRows;

  const items = selectedRows.map(({ row, component }) => ({
    id: row.id,
    name: row.name || 'Evidencia',
    note: clean(row.note, 1600),
    stage: String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase() === 'PROYECTO' ? '' : (row.stage || ''),
    mimeType: row.mimeType || 'application/octet-stream',
    mediaType: row.mediaType || '',
    capturedAt: row.capturedAt || row.createdAt || '',
    createdAt: row.createdAt || '',
    createdBy: row.createdBy || '',
    uploadedBy: row.uploadedBy || row.createdBy || '',
    deviceId: row.deviceId || '',
    deviceName: row.deviceName || row.deviceType || 'Dispositivo',
    deviceType: row.deviceType || '',
    zone: row.zone || '',
    projectTargetType: row.projectTargetType || '',
    projectRelationKey: row.projectRelationKey || '',
    projectComponentLocalId: row.projectComponentLocalId || '',
    projectComponentType: component?.type || row.projectComponentType || '',
    projectComponentName: component?.name || row.projectComponentName || '',
    projectComponent: component || undefined,
  }));

  const attachments = selectedRows.map(({ row, component }) => protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: 'maintenance:' + maintenance.id,
    evidenceId: row.id,
    kind: 'maintenance-evidence',
    title: row.deviceName || row.name || 'Dispositivo',
    subtitle: [
      component?.name || row.projectComponentName,
      component?.type || row.projectComponentType,
      row.deviceType,
      row.zone,
      row.capturedAt,
      row.note,
    ].filter(Boolean).join(' · '),
    entityType: 'maintenance',
    entityId: maintenance.id,
  })).filter(Boolean);

  const candidateTotal = Number(counted?.total || 0);
  const exactTotal = !projectFilters || candidateTotal <= candidateLimit;
  const imageCount = projectFilters
    ? (exactTotal ? matchedRows.filter(({ row }) => String(row.mimeType || '').toLowerCase().startsWith('image/')).length : null)
    : Number(counted?.images || 0);
  const videoCount = projectFilters
    ? (exactTotal ? matchedRows.filter(({ row }) => String(row.mimeType || '').toLowerCase().startsWith('video/')).length : null)
    : Number(counted?.videos || 0);
  const normalizedStages = [...new Set(items.map((item) => normalize(item.stage)).filter(Boolean))];
  return {
    modelData: {
      maintenance: {
        id: maintenance.id,
        title: maintenance.title || 'Mantenimiento',
        client: maintenance.client || '',
        maintenanceType: String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase(),
      },
      total: exactTotal ? (projectFilters ? matchedRows.length : candidateTotal) : null,
      candidateTotal: projectFilters ? candidateTotal : undefined,
      totalShown: items.length,
      imageCount,
      videoCount,
      beforeCount: String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase() === 'PROYECTO' ? 0 : Number(counted?.before_count || 0),
      afterCount: String(maintenance.maintenanceType || 'MANTENIMIENTO').toUpperCase() === 'PROYECTO' ? 0 : Number(counted?.after_count || 0),
      mimeCategory,
      period,
      truncated: projectFilters && !exactTotal,
      ...(projectFilters && !exactTotal ? { message: 'Hay más evidencias candidatas que el límite de análisis estructurado. Refine por dispositivo, componente, fabricante o modelo.' } : {}),
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
