import { createSyncOutbox } from '../core/sync-outbox.js';
import { env } from '../config/env.js';
import { appendSyncChanges, markSyncUnsafe } from './sync-change.service.js';
import { mutationIdFrom, SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

function clean(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function changesFromClassifications(classifications = [], ctx = {}) {
  const changes = new Map();
  for (const classification of classifications) {
    if (!classification || classification.classification === SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED) continue;
    const entityIds = (classification.entityIds?.length ? classification.entityIds : [classification.entityId])
      .map((value) => clean(value, 180)).filter(Boolean);
    for (const entityId of entityIds.length ? entityIds : ['*']) {
      const change = {
        resource: clean(classification.resource, 80),
        entityId,
        operation: entityId === '*' ? 'INVALIDATE' : classification.operation,
        parentId: clean(classification.parentId, 180),
        actorUserId: clean(ctx.user?.UsuarioID, 180),
        sourceRoute: clean(ctx.route, 160),
        mutationId: mutationIdFrom(ctx.payload || {}),
        metadata: classification.metadata,
      };
      if (!change.resource) continue;
      changes.set(`${change.resource}:${entityId}`, change);
    }
  }
  return [...changes.values()];
}

const syncOutbox = createSyncOutbox({
  append: appendSyncChanges,
  maxEvents: Math.max(1, Number(env.syncDeltaMaxEvents || 250)),
  onFailure: async (error, batch) => {
    const route = clean(batch?.[0]?.sourceRoute || 'unknown', 160);
    await markSyncUnsafe(`outbox:${route}:${error?.code || error?.message || 'flush_failed'}`);
  },
});

export async function queueClassifiedSyncChanges(classifications = [], ctx = {}) {
  if (!env.incrementalSyncEnabled) return { accepted: 0, pending: 0, unsafe: false };
  const changes = changesFromClassifications(classifications, ctx);
  if (!changes.length) return { accepted: 0, pending: syncOutbox.snapshot().pending, unsafe: false };
  return syncOutbox.enqueue(changes);
}

export async function flushSyncOutbox() {
  if (!env.incrementalSyncEnabled) return { ok: true, unsafe: false, batchSize: 0, result: [] };
  return syncOutbox.flush({ drain: true });
}

export function syncOutboxSnapshot() {
  return syncOutbox.snapshot();
}

export { changesFromClassifications };
