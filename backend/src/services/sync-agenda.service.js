import { dispatchAction } from '../core/action-router.js';

function clean(value) {
  return String(value ?? '').trim();
}

function inaccessible(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return code === 'FORBIDDEN' || code === 'NOT_FOUND' || status === 403 || status === 404;
}

export async function materializeAgendaDelta(ctx = {}, events = []) {
  const upserts = [];
  const removed = [];
  const seen = new Set();

  for (const event of events || []) {
    const agendaId = clean(event?.EntityID);
    if (!agendaId || agendaId === '*' || seen.has(agendaId)) continue;
    seen.add(agendaId);

    if (String(event?.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(agendaId);
      continue;
    }

    try {
      const response = await dispatchAction({
        route: 'agenda.get',
        payload: { agendaId, id: agendaId },
        sessionToken: ctx.sessionToken || '',
        ip: ctx.ip || '',
        userAgent: ctx.userAgent || '',
        origin: ctx.origin || '',
      });
      const item = response?.item;
      if (item?.AgendaID) upserts.push(item);
      else removed.push(agendaId);
    } catch (error) {
      // Losing an assignment is indistinguishable from deletion for this user's
      // cache. The authoritative agenda.get enforces the exact existing scope.
      if (inaccessible(error)) {
        removed.push(agendaId);
        continue;
      }
      throw error;
    }
  }

  const upsertIds = new Set(upserts.map((item) => clean(item.AgendaID)));
  return {
    upserts,
    removed: [...new Set(removed)].filter((id) => !upsertIds.has(id)),
    invalidated: [],
    counts: null,
  };
}
