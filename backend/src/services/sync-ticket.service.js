import { query } from '../infra/postgres.js';
import { isTicketSyncAdministrator } from '../core/sync-ticket-delta.js';

function clean(value) { return String(value ?? '').trim(); }
function publicPayload(row) { return row?.__payload && typeof row.__payload === 'object' ? { ...row.__payload } : null; }

export async function materializeTicketDelta(ctx = {}, events = []) {
  const entityIds = [...new Set((events || []).map((event) => clean(event?.EntityID)).filter(Boolean))];
  const admin = isTicketSyncAdministrator(ctx);
  const userId = clean(ctx.user?.UsuarioID);
  const params = [];
  let accessSql = '';
  if (!admin) {
    params.push(userId);
    accessSql = ` AND EXISTS (
      SELECT 1 FROM "BoletaAsignados" a
      WHERE a."__valid"=TRUE
        AND a."BoletaUID"=b."BoletaUID"
        AND a."UsuarioID"=$1
        AND LOWER(COALESCE(a."Activo",'true')) <> 'false'
    )`;
  }

  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE UPPER(COALESCE(b."Estado",''))='PENDIENTE')::bigint AS pending,
       COUNT(*) FILTER (WHERE UPPER(COALESCE(b."Estado",''))='FINALIZADA')::bigint AS finished
     FROM "Boletas" b
     WHERE b."__valid"=TRUE
       AND LOWER(COALESCE(b."Activo",'true')) <> 'false'
       AND UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'${accessSql}`,
    params,
    { label: 'sync.ticket.counts' },
  );

  const ticketById = new Map();
  if (entityIds.length) {
    const changedParams = [...params, entityIds];
    const idParam = changedParams.length;
    const changed = await query(
      `SELECT b."BoletaUID", b."__payload"
       FROM "Boletas" b
       WHERE b."__valid"=TRUE
         AND LOWER(COALESCE(b."Activo",'true')) <> 'false'
         AND UPPER(COALESCE(b."Estado",'')) <> 'ANULADA'
         AND b."BoletaUID"=ANY($${idParam}::text[])${accessSql}`,
      changedParams,
      { label: 'sync.ticket.changed' },
    );
    for (const row of changed.rows) ticketById.set(clean(row.BoletaUID), publicPayload(row));
  }

  const assignmentsByTicket = new Map();
  if (entityIds.length) {
    const assignmentParams = [entityIds];
    let userClause = '';
    if (!admin) {
      assignmentParams.push(userId);
      userClause = ` AND "UsuarioID"=$2`;
    }
    const assigned = await query(
      `SELECT "BoletaUID", "UsuarioID"
       FROM "BoletaAsignados"
       WHERE "__valid"=TRUE
         AND LOWER(COALESCE("Activo",'true')) <> 'false'
         AND "BoletaUID"=ANY($1::text[])${userClause}
       ORDER BY "__db_id" ASC`,
      assignmentParams,
      { label: 'sync.ticket.assignments' },
    );
    for (const row of assigned.rows) {
      const id = clean(row.BoletaUID);
      if (!assignmentsByTicket.has(id)) assignmentsByTicket.set(id, new Set());
      assignmentsByTicket.get(id).add(clean(row.UsuarioID));
    }
  }

  const upserts = [];
  const removed = [];
  const seen = new Set();
  for (const event of events || []) {
    const entityId = clean(event?.EntityID);
    if (!entityId || seen.has(entityId)) continue;
    seen.add(entityId);
    if (String(event?.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(entityId);
      continue;
    }
    const ticket = ticketById.get(entityId);
    if (!ticket) {
      removed.push(entityId);
      continue;
    }
    upserts.push({
      ...ticket,
      __sync: { assignedUserIds: [...(assignmentsByTicket.get(entityId) || [])].filter(Boolean).sort() },
    });
  }

  const row = counts.rows[0] || {};
  return {
    upserts,
    removed,
    invalidated: [],
    counts: { pending: Number(row.pending || 0), finished: Number(row.finished || 0) },
  };
}
