import { buildSyncDelta } from '../services/sync-delta.service.js';
import { ticketDeliveryHandlers } from './ticket-delivery.module.js';
import { maintenanceProgressChatHandlers } from './maintenance-progress-chat.module.js';

function clean(value) {
  return String(value ?? '').trim();
}

function targetUpsert(delta, resource, entityId) {
  const idField = resource === 'maintenance' ? 'MantenimientoID' : 'BoletaUID';
  return (delta.upserts || []).some((row) => clean(row?.[idField]) === entityId);
}

async function loadDetail(ctx, resource, entityId) {
  if (resource === 'ticket') {
    return ticketDeliveryHandlers.get({
      ...ctx,
      payload: { boletaUid: entityId, id: entityId },
    });
  }
  if (resource === 'maintenance') {
    return maintenanceProgressChatHandlers.get({
      ...ctx,
      payload: { maintenanceId: entityId, MantenimientoID: entityId, id: entityId },
    });
  }
  return null;
}

async function deltaWithConditionalDetail(ctx) {
  const delta = await buildSyncDelta(ctx);
  const resource = clean(ctx.payload?.resource);
  const entityId = clean(ctx.payload?.entityId || ctx.payload?.boletaUid || ctx.payload?.maintenanceId || ctx.payload?.id);
  if (!['ticket', 'maintenance'].includes(resource) || !entityId || delta.fullSnapshotRequired || delta.notModified) return delta;
  if ((delta.removed || []).some((id) => clean(id) === entityId)) {
    return { ...delta, detail: null };
  }
  if (!targetUpsert(delta, resource, entityId)) {
    return { ...delta, notModified: true };
  }
  const detail = await loadDetail(ctx, resource, entityId);
  return { ...delta, detail };
}

export const syncHandlers = Object.freeze({
  delta: deltaWithConditionalDetail,
});
