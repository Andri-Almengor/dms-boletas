import { buildSyncDelta } from '../services/sync-delta.service.js';
import { ticketDeliveryHandlers } from './ticket-delivery.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

async function deltaWithConditionalDetail(ctx) {
  const delta = await buildSyncDelta(ctx);
  const resource = clean(ctx.payload?.resource);
  const entityId = clean(ctx.payload?.entityId || ctx.payload?.boletaUid || ctx.payload?.id);
  if (resource !== 'ticket' || !entityId || delta.fullSnapshotRequired || delta.notModified) return delta;
  if ((delta.removed || []).some((id) => clean(id) === entityId)) {
    return { ...delta, detail: null };
  }
  if (!(delta.upserts || []).some((ticket) => clean(ticket?.BoletaUID) === entityId)) {
    return { ...delta, notModified: true };
  }
  const detail = await ticketDeliveryHandlers.get({
    ...ctx,
    payload: { boletaUid: entityId, id: entityId },
  });
  return { ...delta, detail };
}

export const syncHandlers = Object.freeze({
  delta: deltaWithConditionalDetail,
});
