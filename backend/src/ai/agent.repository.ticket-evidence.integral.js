import { badRequest, notFound } from '../core/errors.js';
import { appendTicketVisibility, assertAiCapability } from './agent.permissions.js';
import {
  addRange, clean, entity, like, many, one, pageLimit, pageOffset, protectedAttachment, source,
} from './agent.repository.shared.js';

function evidenceCategoryClause(category, alias = 'e') {
  const value = clean(category, 40).toUpperCase();
  if (!value) return '';
  const mime = `LOWER(COALESCE(${alias}."MimeType",''))`;
  if (value === 'IMAGE') return `${mime} LIKE 'image/%'`;
  if (value === 'VIDEO') return `${mime} LIKE 'video/%'`;
  if (value === 'PDF') return `${mime}='application/pdf'`;
  if (value === 'DOCUMENT') {
    return `(
      ${mime} LIKE 'text/%'
      OR ${mime} IN (
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet'
      )
    )`;
  }
  if (value === 'OTHER') {
    return `(
      ${mime} NOT LIKE 'image/%'
      AND ${mime} NOT LIKE 'video/%'
      AND ${mime}<>'application/pdf'
      AND ${mime} NOT LIKE 'text/%'
      AND ${mime} NOT IN (
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet'
      )
    )`;
  }
  return '';
}

async function accessibleTicket(ctx, reference) {
  assertAiCapability(ctx, 'tickets');
  const value = clean(reference, 250);
  if (!value) throw badRequest('Indique ticketId o ticketNumber.');
  const params = [value];
  const visibility = appendTicketVisibility(ctx, params, 'b');
  const row = await one(
    `SELECT b."BoletaUID" AS uid,b."BoletaID" AS number,b."Titulo" AS title,
            b."FirmaArchivoID" AS "__signatureFile",b."FirmaMimeType" AS "__signatureMime"
       FROM "Boletas" b
      WHERE b."__valid"=TRUE
        AND UPPER(COALESCE(b."Estado",''))<>'ANULADA'
        AND (b."BoletaUID"=$1 OR b."BoletaID"=$1)
        AND ${visibility}
      LIMIT 1`,
    params,
    'ai.ticketEvidence.ticket',
  );
  if (!row) throw notFound('No se encontró la boleta o no está dentro de su alcance.');
  return row;
}

export async function searchTicketEvidence(ctx, args = {}) {
  assertAiCapability(ctx, 'tickets');
  const category = clean(args.mimeCategory, 40).toUpperCase();

  if (category === 'SIGNATURE') {
    const ticket = await accessibleTicket(ctx, args.ticketId || args.ticketNumber);
    const signature = clean(ticket.__signatureFile) ? protectedAttachment(ctx, {
      fileId: ticket.__signatureFile,
      mimeType: ticket.__signatureMime || 'image/png',
      scopeId: ticket.uid,
      evidenceId: ticket.uid,
      kind: 'signature',
      title: 'Firma de la boleta #' + (ticket.number || ticket.uid),
      subtitle: 'Firma asociada a la boleta',
      entityType: 'ticket',
      entityId: ticket.uid,
    }) : null;
    return {
      modelData: {
        total: signature ? 1 : 0,
        totalShown: signature ? 1 : 0,
        mimeCategory: 'SIGNATURE',
        ticket: { uid: ticket.uid, number: ticket.number || ticket.uid, title: ticket.title || '' },
        items: signature ? [{
          id: 'signature:' + ticket.uid,
          name: 'Firma',
          mimeType: ticket.__signatureMime || 'image/png',
          category: 'SIGNATURE',
        }] : [],
      },
      attachments: signature ? [signature] : [],
      entities: [entity('ticket', ticket.uid, 'Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
      sources: [source('ticket', ticket.uid, 'Firma · Boleta #' + (ticket.number || ticket.uid), '/boletas/' + encodeURIComponent(ticket.uid))],
      context: { lastTicketId: ticket.uid, lastTicketNumber: ticket.number || ticket.uid },
    };
  }

  const params = [];
  const clauses = [
    'e."__valid"=TRUE',
    `LOWER(COALESCE(e."Activo",'true')) <> 'false'`,
    'b."__valid"=TRUE',
    `UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'`,
    appendTicketVisibility(ctx, params, 'b'),
  ];

  const ticketRef = clean(args.ticketId || args.ticketNumber, 250);
  if (ticketRef) {
    params.push(ticketRef);
    clauses.push(`(b."BoletaUID"=$${params.length} OR b."BoletaID"=$${params.length})`);
  }
  if (clean(args.uploaderId)) {
    params.push(clean(args.uploaderId, 250));
    clauses.push(`e."CreadoPor"=$${params.length}`);
  } else if (clean(args.uploaderName)) {
    params.push(like(args.uploaderName));
    const p = '$' + params.length;
    clauses.push(`(uploader."NombreCompleto" ILIKE ${p} ESCAPE '\\' OR uploader."NombreUsuario" ILIKE ${p} ESCAPE '\\')`);
  }
  if (clean(args.query)) {
    params.push(like(args.query));
    const p = '$' + params.length;
    clauses.push(`(
      e."Nombre" ILIKE ${p} ESCAPE '\\'
      OR e."Nota" ILIKE ${p} ESCAPE '\\'
      OR e."NombreArchivo" ILIKE ${p} ESCAPE '\\'
      OR b."Titulo" ILIKE ${p} ESCAPE '\\'
      OR b."Cliente" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  const categoryClause = evidenceCategoryClause(category);
  if (categoryClause) clauses.push(categoryClause);
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
    'ai.ticketEvidence.count',
  );

  const queryParams = [...params, pageLimit(args.limit, 30), pageOffset(args.offset)];
  const rows = await many(
    `SELECT e."EvidenciaID" AS id,e."BoletaUID" AS "ticketId",
            b."BoletaID" AS "ticketNumber",b."Titulo" AS "ticketTitle",b."Cliente" AS client,
            e."Nombre" AS name,e."Nota" AS note,e."NombreArchivo" AS "fileName",
            e."MimeType" AS "mimeType",e."TipoMedio" AS "mediaType",e."TamanoBytes" AS size,
            e."FechaCreacion" AS "createdAt",e."CreadoPor" AS "createdBy",
            COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",e."CreadoPor") AS "uploadedBy",
            e."OrigenMantenimientoDispositivoID" AS "deviceId",e."ArchivoID" AS "__file"
       FROM "EvidenciasBoleta" e
       JOIN "Boletas" b ON b."BoletaUID"=e."BoletaUID"
       LEFT JOIN "Usuarios" uploader
         ON uploader."__valid"=TRUE AND uploader."UsuarioID"=e."CreadoPor"
      WHERE ${where}
      ORDER BY e."FechaCreacion" DESC NULLS LAST,e."__db_id" DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams,
    'ai.ticketEvidence.items',
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
    size: row.size || '',
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

  return {
    modelData: {
      total: Number(counted?.total || 0),
      totalShown: items.length,
      mimeCategory: category || '',
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
    context: items.length === 1 ? { lastTicketId: items[0].ticketId, lastTicketNumber: items[0].ticketNumber } : {},
  };
}

export const ticketIntegralRepositoryTools = Object.freeze({
  search_ticket_evidence: searchTicketEvidence,
});
