import { badRequest, notFound } from '../core/errors.js';
import { appendTicketVisibility, assertAiCapability } from './agent.permissions.js';
import {
  addRange, aliasQuery, clean, entity, like, many, normalizeTicketStatus, one,
  pageLimit, pageOffset, protectedAttachment, source, ticketDateColumn,
} from './agent.repository.shared.js';

export async function searchTickets(ctx, args = {}) {
  assertAiCapability(ctx, 'tickets');
  const params = [];
  const clauses = ['b."__valid"=TRUE', `UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'`];
  clauses.push(appendTicketVisibility(ctx, params, 'b'));

  const q = aliasQuery(args.query);
  if (q) {
    params.push(like(q));
    const p = '$' + params.length;
    clauses.push(`(
      b."BoletaID" ILIKE ${p} ESCAPE '\\'
      OR b."BoletaUID" ILIKE ${p} ESCAPE '\\'
      OR b."Titulo" ILIKE ${p} ESCAPE '\\'
      OR b."Cliente" ILIKE ${p} ESCAPE '\\'
      OR b."Ubicacion" ILIKE ${p} ESCAPE '\\'
      OR b."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR b."Modelo" ILIKE ${p} ESCAPE '\\'
      OR b."Serie" ILIKE ${p} ESCAPE '\\'
      OR b."RazonVisita" ILIKE ${p} ESCAPE '\\'
      OR b."Descripcion" ILIKE ${p} ESCAPE '\\'
      OR b."Resultado" ILIKE ${p} ESCAPE '\\'
    )`);
  }

  const status = normalizeTicketStatus(args.status);
  if (status) {
    params.push(status);
    clauses.push(`UPPER(COALESCE(b."Estado",''))=$${params.length}`);
  }
  if (clean(args.clientId)) {
    params.push(clean(args.clientId, 250));
    clauses.push(`b."ClienteID"=$${params.length}`);
  } else if (clean(args.clientQuery)) {
    params.push(like(aliasQuery(args.clientQuery)));
    clauses.push(`b."Cliente" ILIKE $${params.length} ESCAPE '\\'`);
  }

  if (clean(args.technicianId) || clean(args.technicianName)) {
    const pieces = [];
    if (clean(args.technicianId)) {
      params.push(clean(args.technicianId, 250));
      pieces.push(`ba_target."UsuarioID"=$${params.length}`);
    }
    if (clean(args.technicianName)) {
      params.push(like(args.technicianName));
      const p = '$' + params.length;
      pieces.push(`(u_target."NombreCompleto" ILIKE ${p} ESCAPE '\\' OR u_target."NombreUsuario" ILIKE ${p} ESCAPE '\\')`);
    }
    clauses.push(`EXISTS (
      SELECT 1 FROM "BoletaAsignados" ba_target
      LEFT JOIN "Usuarios" u_target
        ON u_target."__valid"=TRUE AND u_target."UsuarioID"=ba_target."UsuarioID"
      WHERE ba_target."__valid"=TRUE
        AND LOWER(COALESCE(ba_target."Activo",'true')) <> 'false'
        AND ba_target."BoletaUID"=b."BoletaUID"
        AND (${pieces.join(' OR ')})
    )`);
  }

  const range = addRange(clauses, params, ticketDateColumn('b'), args);
  const where = clauses.join(' AND ');
  const counted = await one(
    `SELECT COUNT(*)::bigint AS total FROM "Boletas" b WHERE ${where}`,
    params,
    'ai.tickets.search.count',
  );
  const queryParams = [...params, pageLimit(args.limit, 20), pageOffset(args.offset)];
  const rows = await many(
    `SELECT b."BoletaUID" AS uid, b."BoletaID" AS number, b."Titulo" AS title,
            b."Estado" AS status, b."Fecha" AS date, b."FinalizadaEn" AS "finishedAt",
            b."ClienteID" AS "clientId", b."Cliente" AS client, b."Ubicacion" AS location,
            b."TipoDispositivo" AS "deviceType", b."Fabricante" AS manufacturer,
            b."Modelo" AS model, b."Serie" AS serial, b."RazonVisita" AS reason,
            b."Descripcion" AS description, b."Resultado" AS result,
            b."HorasTotales" AS hours
       FROM "Boletas" b
      WHERE ${where}
      ORDER BY ${ticketDateColumn('b')} DESC NULLS LAST, b."BoletaID" DESC NULLS LAST
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams,
    'ai.tickets.search.items',
  );

  const items = rows.map((row) => ({
    uid: row.uid,
    number: row.number || row.uid,
    title: row.title || 'Boleta de servicio',
    status: row.status || '',
    date: row.date || '',
    finishedAt: row.finishedAt || '',
    clientId: row.clientId || '',
    client: row.client || '',
    location: row.location || '',
    deviceType: row.deviceType || '',
    manufacturer: row.manufacturer || '',
    model: row.model || '',
    serial: row.serial || '',
    reason: clean(row.reason, 1200),
    description: clean(row.description, 2200),
    result: clean(row.result, 1800),
    hours: row.hours || '',
  }));
  return {
    modelData: { total: Number(counted?.total || 0), totalShown: items.length, period: range, items },
    entities: items.map((item) => entity('ticket', item.uid, 'Boleta #' + item.number, '/boletas/' + encodeURIComponent(item.uid), { status: item.status })),
    sources: items.slice(0, 8).map((item) => source('ticket', item.uid, 'Boleta #' + item.number + ' · ' + item.title, '/boletas/' + encodeURIComponent(item.uid))),
    context: items.length === 1 ? {
      lastTicketId: items[0].uid,
      lastTicketNumber: items[0].number,
      lastClientId: items[0].clientId,
      lastClientName: items[0].client,
    } : {},
  };
}

async function accessibleTicket(ctx, refValue) {
  assertAiCapability(ctx, 'tickets');
  const ref = clean(refValue, 250);
  if (!ref) throw badRequest('Falta ticketId o número de boleta.');
  const params = [ref];
  const visibility = appendTicketVisibility(ctx, params, 'b');
  const row = await one(
    `SELECT b."BoletaUID" AS uid, b."BoletaID" AS number, b."Titulo" AS title,
            b."Estado" AS status, b."Fecha" AS date, b."HoraInicio" AS "startTime",
            b."HoraFinal" AS "endTime", b."HorasTotales" AS hours,
            b."ClienteID" AS "clientId", b."Cliente" AS client, b."UbicacionID" AS "locationId",
            b."Ubicacion" AS location, b."SupervisorID" AS "supervisorId", b."Supervisor" AS supervisor,
            b."Categoria" AS category, b."TipoDispositivo" AS "deviceType",
            b."Fabricante" AS manufacturer, b."Modelo" AS model, b."Serie" AS serial,
            b."RazonVisita" AS reason, b."Descripcion" AS description,
            b."PruebasRealizadas" AS tests, b."Resultado" AS result,
            b."Recomendaciones" AS recommendations, b."TipoFalla" AS failure,
            b."CreadoPor" AS "createdBy", b."ActualizadoPor" AS "updatedBy",
            b."FechaCreacion" AS "createdAt", b."FechaActualizacion" AS "updatedAt",
            b."FinalizadaEn" AS "finishedAt", b."GrupoVisitaID" AS "visitGroupId",
            b."NumeroVisita" AS "visitNumber", b."BoletaPrincipalUID" AS "mainTicketId",
            b."OrigenMantenimientoID" AS "maintenanceId", b."OrigenCasoID" AS "caseId",
            b."FirmaArchivoID" AS "__signatureFile", b."FirmaMimeType" AS "__signatureMime",
            COALESCE(NULLIF(creator."NombreCompleto",''),creator."NombreUsuario",b."CreadoPor") AS "createdByName",
            COALESCE(NULLIF(updater."NombreCompleto",''),updater."NombreUsuario",b."ActualizadoPor") AS "updatedByName"
       FROM "Boletas" b
       LEFT JOIN "Usuarios" creator ON creator."__valid"=TRUE AND creator."UsuarioID"=b."CreadoPor"
       LEFT JOIN "Usuarios" updater ON updater."__valid"=TRUE AND updater."UsuarioID"=b."ActualizadoPor"
      WHERE b."__valid"=TRUE
        AND (b."BoletaUID"=$1 OR b."BoletaID"=$1)
        AND ${visibility}
      ORDER BY b."__db_id" DESC
      LIMIT 1`,
    params,
    'ai.tickets.accessible',
  );
  if (!row) throw notFound('No se encontró la boleta o no está dentro de su alcance.');
  return row;
}

export async function getTicket(ctx, args = {}) {
  const row = await accessibleTicket(ctx, args.ticketId || args.number);
  const relationPromise = row.visitGroupId ? (async () => {
    const params = [row.visitGroupId];
    const visibility = appendTicketVisibility(ctx, params, 'related');
    return many(
      `SELECT related."BoletaUID" AS uid, related."BoletaID" AS number,
              related."Titulo" AS title, related."Estado" AS status,
              related."Fecha" AS date, related."NumeroVisita" AS "visitNumber"
         FROM "Boletas" related
        WHERE related."__valid"=TRUE
          AND related."GrupoVisitaID"=$1
          AND ${visibility}
        ORDER BY CASE
                   WHEN COALESCE(related."NumeroVisita",'') ~ '^[0-9]+$'
                   THEN related."NumeroVisita"::integer
                 END NULLS LAST,
                 related."Fecha" ASC NULLS LAST,
                 related."BoletaID" ASC NULLS LAST
        LIMIT 30`,
      params,
      'ai.tickets.relatedVisits',
    );
  })() : Promise.resolve([]);

  const [assignments, evidenceCount, relatedVisits] = await Promise.all([
    many(
      `SELECT u."UsuarioID" AS id, u."NombreCompleto" AS name, u."NombreUsuario" AS username
         FROM "BoletaAsignados" ba
         LEFT JOIN "Usuarios" u ON u."__valid"=TRUE AND u."UsuarioID"=ba."UsuarioID"
        WHERE ba."__valid"=TRUE
          AND LOWER(COALESCE(ba."Activo",'true')) <> 'false'
          AND ba."BoletaUID"=$1
        ORDER BY COALESCE(u."NombreCompleto",ba."NombreUsuarioSnapshot") ASC`,
      [row.uid],
      'ai.tickets.assignments',
    ),
    one(
      `SELECT COUNT(*)::bigint AS total
         FROM "EvidenciasBoleta" e
        WHERE e."__valid"=TRUE
          AND LOWER(COALESCE(e."Activo",'true')) <> 'false'
          AND e."BoletaUID"=$1`,
      [row.uid],
      'ai.tickets.evidenceCount',
    ),
    relationPromise,
  ]);

  const item = {
    uid: row.uid,
    number: row.number || row.uid,
    title: row.title || 'Boleta de servicio',
    status: row.status || '',
    date: row.date || '',
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    hours: row.hours || '',
    clientId: row.clientId || '',
    client: row.client || '',
    locationId: row.locationId || '',
    location: row.location || '',
    supervisorId: row.supervisorId || '',
    supervisor: row.supervisor || '',
    category: row.category || '',
    deviceType: row.deviceType || '',
    manufacturer: row.manufacturer || '',
    model: row.model || '',
    serial: row.serial || '',
    failure: row.failure || '',
    reason: clean(row.reason, 2200),
    description: clean(row.description, 4200),
    tests: clean(row.tests, 4200),
    result: clean(row.result, 4200),
    recommendations: clean(row.recommendations, 3200),
    technicians: assignments.map((a) => ({ id: a.id || '', name: a.name || a.username || a.id || '' })),
    evidenceCount: Number(evidenceCount?.total || 0),
    createdBy: row.createdBy || '',
    createdByName: row.createdByName || row.createdBy || '',
    updatedBy: row.updatedBy || '',
    updatedByName: row.updatedByName || row.updatedBy || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    finishedAt: row.finishedAt || '',
    visitGroupId: row.visitGroupId || '',
    visitNumber: row.visitNumber || '',
    mainTicketId: row.mainTicketId || '',
    maintenanceId: row.maintenanceId || '',
    caseId: row.caseId || '',
    relatedVisits: relatedVisits.map((visit) => ({
      uid: visit.uid,
      number: visit.number || visit.uid,
      title: visit.title || '',
      status: visit.status || '',
      date: visit.date || '',
      visitNumber: visit.visitNumber || '',
    })),
  };
  return {
    modelData: item,
    entities: [entity('ticket', item.uid, 'Boleta #' + item.number, '/boletas/' + encodeURIComponent(item.uid), { status: item.status })],
    sources: [source('ticket', item.uid, 'Boleta #' + item.number + ' · ' + item.title, '/boletas/' + encodeURIComponent(item.uid))],
    context: {
      lastTicketId: item.uid,
      lastTicketNumber: item.number,
      lastClientId: item.clientId,
      lastClientName: item.client,
      ...(item.maintenanceId ? { lastMaintenanceId: item.maintenanceId } : {}),
      ...(item.caseId ? { lastCaseId: item.caseId } : {}),
    },
  };
}

export async function getTicketEvidence(ctx, args = {}) {
  const ticket = await accessibleTicket(ctx, args.ticketId || args.number);
  const rows = await many(
    `SELECT e."EvidenciaID" AS id, e."Nombre" AS name, e."Nota" AS note,
            e."NombreArchivo" AS "fileName", e."MimeType" AS "mimeType",
            e."TipoMedio" AS "mediaType", e."TamanoBytes" AS size,
            e."FechaCreacion" AS "createdAt", e."CreadoPor" AS "createdBy",
            COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",e."CreadoPor") AS "uploadedBy",
            e."OrigenMantenimientoDispositivoID" AS "deviceId",
            e."ArchivoID" AS "__file"
       FROM "EvidenciasBoleta" e
       LEFT JOIN "Usuarios" uploader ON uploader."__valid"=TRUE AND uploader."UsuarioID"=e."CreadoPor"
      WHERE e."__valid"=TRUE
        AND LOWER(COALESCE(e."Activo",'true')) <> 'false'
        AND e."BoletaUID"=$1
      ORDER BY e."FechaCreacion" ASC NULLS LAST, e."Orden" ASC NULLS LAST, e."__db_id" ASC
      LIMIT $2`,
    [ticket.uid, pageLimit(args.limit, 30)],
    'ai.tickets.evidence',
  );
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name || row.fileName || 'Evidencia',
    note: clean(row.note, 1600),
    fileName: row.fileName || '',
    mimeType: row.mimeType || 'application/octet-stream',
    mediaType: row.mediaType || '',
    size: row.size || '',
    createdAt: row.createdAt || '',
    createdBy: row.createdBy || '',
    uploadedBy: row.uploadedBy || row.createdBy || '',
    deviceId: row.deviceId || '',
  }));
  const attachments = rows.map((row) => protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: ticket.uid,
    evidenceId: row.id,
    kind: 'evidence',
    title: row.name || row.fileName || 'Evidencia',
    subtitle: row.note || '',
    entityType: 'ticket',
    entityId: ticket.uid,
  })).filter(Boolean);

  if (args.includeSignature !== false && clean(ticket.__signatureFile)) {
    const signature = protectedAttachment(ctx, {
      fileId: ticket.__signatureFile,
      mimeType: ticket.__signatureMime || 'image/png',
      scopeId: ticket.uid,
      evidenceId: ticket.uid,
      kind: 'signature',
      title: 'Firma de la boleta #' + (ticket.number || ticket.uid),
      subtitle: 'Firma asociada a la boleta',
      entityType: 'ticket',
      entityId: ticket.uid,
    });
    if (signature) attachments.push(signature);
  }

  return {
    modelData: {
      ticket: { uid: ticket.uid, number: ticket.number || ticket.uid, title: ticket.title || '' },
      totalShown: items.length,
      items,
      signatureAvailable: Boolean(clean(ticket.__signatureFile)),
    },
    attachments,
    entities: [entity('ticket', ticket.uid, 'Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
    sources: [source('ticket', ticket.uid, 'Evidencias · Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
    context: { lastTicketId: ticket.uid, lastTicketNumber: ticket.number || ticket.uid },
  };
}

export async function getTicketHistory(ctx, args = {}) {
  const ticket = await accessibleTicket(ctx, args.ticketId || args.number);
  const rows = await many(
    `SELECT a."Accion" AS action, a."UsuarioID" AS "userId",
            a."UsuarioNombre" AS "userName", a."Fecha" AS date
       FROM "Auditoria" a
      WHERE a."__valid"=TRUE AND a."EntidadID"=$1
      ORDER BY a."Fecha" DESC NULLS LAST
      LIMIT $2`,
    [ticket.uid, pageLimit(args.limit, 30)],
    'ai.tickets.history',
  );
  return {
    modelData: {
      ticket: { uid: ticket.uid, number: ticket.number || ticket.uid, title: ticket.title || '' },
      createdAt: ticket.createdAt || '',
      updatedAt: ticket.updatedAt || '',
      finishedAt: ticket.finishedAt || '',
      events: rows,
    },
    entities: [entity('ticket', ticket.uid, 'Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
    sources: [source('ticket', ticket.uid, 'Historial · Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
    context: { lastTicketId: ticket.uid, lastTicketNumber: ticket.number || ticket.uid },
  };
}

export async function getTechnicianActivity(ctx, args = {}) {
  assertAiCapability(ctx, 'tickets');
  const queryText = clean(args.technicianId || args.technician || args.technicianName, 250);
  if (!queryText) throw badRequest('Indique el técnico a consultar.');

  const params = [];
  const ownScope = appendTicketVisibility(ctx, params, 'b_scope');
  params.push(queryText);
  const exactParam = '$' + params.length;
  params.push(like(queryText));
  const nameParam = '$' + params.length;

  const candidates = await many(
    `SELECT DISTINCT u."UsuarioID" AS id, u."NombreCompleto" AS name, u."NombreUsuario" AS username
       FROM "Usuarios" u
      WHERE u."__valid"=TRUE
        AND UPPER(COALESCE(u."Estado",'ACTIVO'))='ACTIVO'
        AND (
          u."UsuarioID"=${exactParam}
          OR u."NombreCompleto" ILIKE ${nameParam} ESCAPE '\\'
          OR u."NombreUsuario" ILIKE ${nameParam} ESCAPE '\\'
        )
        AND EXISTS (
          SELECT 1
            FROM "BoletaAsignados" ba_scope
            JOIN "Boletas" b_scope
              ON b_scope."__valid"=TRUE
             AND b_scope."BoletaUID"=ba_scope."BoletaUID"
           WHERE ba_scope."__valid"=TRUE
             AND LOWER(COALESCE(ba_scope."Activo",'true')) <> 'false'
             AND ba_scope."UsuarioID"=u."UsuarioID"
             AND ${ownScope}
        )
      ORDER BY u."NombreCompleto" ASC
      LIMIT 5`,
    params,
    'ai.technician.resolve',
  );

  let technician = candidates.find((item) => item.id === queryText);
  if (!technician && candidates.length === 1) technician = candidates[0];
  if (!technician) {
    return {
      modelData: {
        ambiguous: candidates.length > 1,
        message: candidates.length
          ? 'Hay varias personas que coinciden.'
          : 'No se encontró el técnico dentro de su alcance.',
        candidates,
      },
      entities: candidates.map((item) => entity(
        'user',
        item.id,
        item.name || item.username || item.id,
        '/usuarios/' + encodeURIComponent(item.id),
      )),
    };
  }

  const statParams = [technician.id];
  const clauses = [
    'b."__valid"=TRUE',
    `UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'`,
    `EXISTS (
      SELECT 1
        FROM "BoletaAsignados" ba_target
       WHERE ba_target."__valid"=TRUE
         AND LOWER(COALESCE(ba_target."Activo",'true')) <> 'false'
         AND ba_target."BoletaUID"=b."BoletaUID"
         AND ba_target."UsuarioID"=$1
    )`,
  ];
  clauses.push(appendTicketVisibility(ctx, statParams, 'b'));
  const range = addRange(clauses, statParams, ticketDateColumn('b'), args);
  const where = clauses.join(' AND ');

  const summary = await one(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE UPPER(COALESCE(b."Estado",''))='FINALIZADA')::bigint AS finished,
            COUNT(*) FILTER (WHERE UPPER(COALESCE(b."Estado",''))='PENDIENTE')::bigint AS pending,
            COUNT(DISTINCT NULLIF(b."ClienteID",''))::bigint AS clients
       FROM "Boletas" b
      WHERE ${where}`,
    statParams,
    'ai.technician.summary',
  );

  const queryParams = [...statParams, pageLimit(args.limit, 30)];
  const rows = await many(
    `SELECT b."BoletaUID" AS uid, b."BoletaID" AS number, b."Titulo" AS title,
            b."Estado" AS status, b."Fecha" AS date, b."FinalizadaEn" AS "finishedAt",
            b."Cliente" AS client, b."RazonVisita" AS reason,
            b."Descripcion" AS description, b."Resultado" AS result
       FROM "Boletas" b
      WHERE ${where}
      ORDER BY ${ticketDateColumn('b')} DESC NULLS LAST, b."BoletaID" DESC NULLS LAST
      LIMIT $${queryParams.length}`,
    queryParams,
    'ai.technician.items',
  );

  const items = rows.map((row) => ({
    uid: row.uid,
    number: row.number || row.uid,
    title: row.title || 'Boleta de servicio',
    status: row.status || '',
    date: row.date || '',
    finishedAt: row.finishedAt || '',
    client: row.client || '',
    reason: clean(row.reason, 1200),
    description: clean(row.description, 2200),
    result: clean(row.result, 1800),
  }));

  return {
    modelData: {
      technician: { id: technician.id, name: technician.name || technician.username || technician.id },
      period: range,
      total: Number(summary?.total || 0),
      finished: Number(summary?.finished || 0),
      pending: Number(summary?.pending || 0),
      clients: Number(summary?.clients || 0),
      totalShown: items.length,
      items,
    },
    entities: [
      entity('user', technician.id, technician.name || technician.username || technician.id, '/usuarios/' + encodeURIComponent(technician.id)),
      ...items.map((item) => entity('ticket', item.uid, 'Boleta #' + item.number, '/boletas/' + encodeURIComponent(item.uid))),
    ],
    sources: items.slice(0, 8).map((item) => source(
      'ticket',
      item.uid,
      'Boleta #' + item.number + ' · ' + item.title,
      '/boletas/' + encodeURIComponent(item.uid),
    )),
    context: {
      lastUserId: technician.id,
      lastUserName: technician.name || technician.username || technician.id,
    },
  };
}


export async function searchEvidenceActivity(ctx, args = {}) {
  assertAiCapability(ctx, 'tickets');
  const params = [];
  const clauses = [
    'e."__valid"=TRUE',
    `LOWER(COALESCE(e."Activo",'true')) <> 'false'`,
    'b."__valid"=TRUE',
    `UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'`,
    appendTicketVisibility(ctx, params, 'b'),
  ];

  if (clean(args.uploaderId)) {
    params.push(clean(args.uploaderId, 250));
    clauses.push(`e."CreadoPor"=$${params.length}`);
  } else if (clean(args.technicianName || args.technician)) {
    params.push(like(args.technicianName || args.technician));
    const p = '$' + params.length;
    clauses.push(`(
      uploader."NombreCompleto" ILIKE ${p} ESCAPE '\\'
      OR uploader."NombreUsuario" ILIKE ${p} ESCAPE '\\'
    )`);
  }

  if (clean(args.ticketId)) {
    params.push(clean(args.ticketId, 250));
    clauses.push(`(b."BoletaUID"=$${params.length} OR b."BoletaID"=$${params.length})`);
  }

  if (clean(args.mimeType)) {
    params.push(like(args.mimeType));
    clauses.push(`e."MimeType" ILIKE $${params.length} ESCAPE '\\'`);
  }

  const period = addRange(clauses, params, 'e."FechaCreacion"', args);
  const where = clauses.join(' AND ');
  const counted = await one(
    `SELECT COUNT(*)::bigint AS total
       FROM "EvidenciasBoleta" e
       JOIN "Boletas" b ON b."BoletaUID"=e."BoletaUID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=e."CreadoPor"
      WHERE ${where}`,
    params,
    'ai.evidenceActivity.count',
  );

  const queryParams = [...params, pageLimit(args.limit, 30), pageOffset(args.offset)];
  const rows = await many(
    `SELECT e."EvidenciaID" AS id, e."BoletaUID" AS "ticketId",
            b."BoletaID" AS "ticketNumber", b."Titulo" AS "ticketTitle",
            b."Cliente" AS client, e."Nombre" AS name, e."Nota" AS note,
            e."NombreArchivo" AS "fileName", e."MimeType" AS "mimeType",
            e."TipoMedio" AS "mediaType", e."FechaCreacion" AS "createdAt",
            e."CreadoPor" AS "createdBy",
            COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",e."CreadoPor") AS "uploadedBy",
            e."OrigenMantenimientoDispositivoID" AS "deviceId",
            e."ArchivoID" AS "__file"
       FROM "EvidenciasBoleta" e
       JOIN "Boletas" b ON b."BoletaUID"=e."BoletaUID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=e."CreadoPor"
      WHERE ${where}
      ORDER BY e."FechaCreacion" DESC NULLS LAST, e."__db_id" DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams,
    'ai.evidenceActivity.items',
  );

  const items = rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    ticketNumber: row.ticketNumber || row.ticketId,
    ticketTitle: row.ticketTitle || '',
    client: row.client || '',
    name: row.name || row.fileName || 'Evidencia',
    note: clean(row.note, 1600),
    fileName: row.fileName || '',
    mimeType: row.mimeType || 'application/octet-stream',
    mediaType: row.mediaType || '',
    createdAt: row.createdAt || '',
    createdBy: row.createdBy || '',
    uploadedBy: row.uploadedBy || row.createdBy || '',
    deviceId: row.deviceId || '',
  }));

  const attachments = rows.map((row) => protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: row.ticketId,
    evidenceId: row.id,
    kind: 'evidence',
    title: row.name || row.fileName || 'Evidencia',
    subtitle: [
      'Boleta #' + (row.ticketNumber || row.ticketId),
      row.client,
      row.uploadedBy,
      row.createdAt,
    ].filter(Boolean).join(' · '),
    entityType: 'ticket',
    entityId: row.ticketId,
  })).filter(Boolean);

  const uploaderNames = [...new Set(items.map((item) => item.uploadedBy).filter(Boolean))];
  return {
    modelData: {
      total: Number(counted?.total || 0),
      totalShown: items.length,
      period,
      items,
    },
    attachments,
    entities: items.slice(0, 30).map((item) => entity(
      'ticket',
      item.ticketId,
      'Boleta #' + item.ticketNumber,
      '/boletas/' + encodeURIComponent(item.ticketId),
    )),
    sources: items.slice(0, 10).map((item) => source(
      'ticket',
      item.ticketId,
      'Boleta #' + item.ticketNumber + ' · ' + item.name,
      '/boletas/' + encodeURIComponent(item.ticketId),
    )),
    context: uploaderNames.length === 1 ? { lastUserName: uploaderNames[0] } : {},
  };
}

export const ticketRepositoryTools = Object.freeze({
  search_tickets: searchTickets,
  get_ticket: getTicket,
  get_ticket_evidence: getTicketEvidence,
  get_ticket_history: getTicketHistory,
  get_technician_activity: getTechnicianActivity,
  search_evidence_activity: searchEvidenceActivity,
});
