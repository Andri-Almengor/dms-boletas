import { performance } from 'node:perf_hooks';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { dispatchAction } from '../core/action-router.js';
import { sha256 } from '../core/utils.js';
import { selectSyncResourceEvents } from '../core/sync-delta-events.js';
import {
  getSyncCursor,
  getSyncDescriptor,
  readSyncChangesAfter,
} from './sync-change.service.js';
import { syncResourceRegistry } from './sync-resource-registry.js';
import { isCrudSyncResource, materializeCrudDelta } from './sync-crud.service.js';
import { materializeAgendaDelta } from './sync-agenda.service.js';
import { materializeCustomerCaseDelta } from './sync-customer-case.service.js';
import { materializeKnowledgeDelta } from './sync-knowledge.service.js';
import { materializeTicketDelta } from './sync-ticket.service.js';
import { materializeMaintenanceDelta } from './sync-maintenance.service.js';

function clean(value, maxLength = 180) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function buildSyncCacheScope(user = {}, permissions = [], schemaVersion = env.syncSchemaVersion) {
  const userId = clean(user.UsuarioID || user.id || 'anonymous', 180);
  const permissionFingerprint = [...new Set((permissions || []).map(String).filter(Boolean))].sort().join(',');
  return `u:${userId}:${sha256(`${userId}|${permissionFingerprint}|${Number(schemaVersion || 1)}`).slice(0, 24)}`;
}

export { dedupeSyncEvents } from '../core/sync-delta-events.js';

function assertResourceAccess(ctx, resourceSpec = {}) {
  const required = Array.isArray(resourceSpec.permissions)
    ? resourceSpec.permissions
    : resourceSpec.permission ? [resourceSpec.permission] : [];
  if (!required.length) return;
  const permissions = ctx.permissions || [];
  const allowed = permissions.includes('USUARIOS_GESTIONAR')
    || required.some((code) => permissions.includes(code));
  if (!allowed) {
    throw new AppError('FORBIDDEN', 'No tiene permisos para sincronizar este recurso.', 403);
  }
}

function finishResponse(response, startedAt) {
  const result = {
    ...response,
    handlerMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
  result.responseBytes = Buffer.byteLength(JSON.stringify(result));
  return result;
}

async function fullSnapshotResponse({
  descriptor,
  resource,
  fromCursor,
  reason,
  securityInvalidated = false,
  snapshotCursor = null,
  entityId = '',
} = {}) {
  const cursor = snapshotCursor ?? await getSyncCursor();
  return {
    enabled: Boolean(descriptor?.enabled),
    generation: descriptor?.generation || '',
    schemaVersion: Number(descriptor?.schemaVersion || env.syncSchemaVersion || 1),
    cacheScope: null,
    resource,
    entityId: clean(entityId),
    fromCursor: Number(fromCursor || 0),
    cursor,
    snapshotCursor: cursor,
    hasMore: false,
    fullSnapshotRequired: true,
    notModified: false,
    reason,
    securityInvalidated,
    upserts: [],
    removed: [],
    invalidated: [],
    counts: null,
    detail: null,
    eventsScanned: 0,
    eventsDeduped: 0,
  };
}

function incrementalResponse({
  descriptor,
  cacheScope,
  resource,
  entityId,
  fromCursor,
  scan,
  resourceEvents,
  materialized,
  detail = null,
} = {}) {
  return {
    enabled: true,
    generation: descriptor.generation,
    schemaVersion: descriptor.schemaVersion,
    cacheScope,
    resource,
    entityId,
    fromCursor,
    cursor: scan.cursor,
    hasMore: scan.hasMore,
    fullSnapshotRequired: false,
    notModified: false,
    securityInvalidated: false,
    upserts: materialized.upserts,
    removed: materialized.removed,
    invalidated: materialized.invalidated,
    counts: materialized.counts,
    detail: entityId ? detail : null,
    eventsScanned: scan.eventsScanned,
    eventsDeduped: resourceEvents.length,
  };
}

function detailPayload(resource, entityId) {
  if (resource === 'ticket') return { boletaUid: entityId, id: entityId };
  if (resource === 'maintenance') return { maintenanceId: entityId, id: entityId };
  if (resource === 'agenda') return { agendaId: entityId, id: entityId };
  if (resource === 'customerCase') return { caseId: entityId, id: entityId };
  if (resource === 'knowledgeArticle') return { tutorialId: entityId, id: entityId };
  return { id: entityId };
}

function authoritativeDetail(ctx, route, resource, entityId) {
  return dispatchAction({
    route,
    payload: detailPayload(resource, entityId),
    sessionToken: ctx.sessionToken || '',
    ip: ctx.ip || '',
    userAgent: ctx.userAgent || '',
    origin: ctx.origin || '',
  });
}

async function materializeResourceDelta(ctx, resource, resourceEvents, resourceSpec) {
  if (resource === 'ticket') return materializeTicketDelta(ctx, resourceEvents);
  if (resource === 'maintenance') return materializeMaintenanceDelta(ctx, resourceEvents);
  if (resource === 'agenda') return materializeAgendaDelta(ctx, resourceEvents);
  if (resource === 'customerCase') return materializeCustomerCaseDelta(ctx, resourceEvents);
  if (resource === 'knowledgeArticle') {
    return materializeKnowledgeDelta(
      resourceEvents,
      (entityId) => authoritativeDetail(ctx, resourceSpec.detailRoute, resource, entityId),
    );
  }
  if (isCrudSyncResource(resource)) return materializeCrudDelta(ctx, resource, resourceEvents);
  return null;
}

async function materializeChangedDetail(ctx, resource, resourceSpec, entityId, materialized) {
  if (!entityId) return null;
  if ((materialized.removed || []).map(String).includes(String(entityId))) return null;

  if (isCrudSyncResource(resource)) {
    return materialized.upserts?.[0] || null;
  }
  if (resource === 'agenda') {
    const item = (materialized.upserts || [])
      .find((candidate) => String(candidate?.AgendaID || '') === String(entityId)) || null;
    return item ? { item } : null;
  }
  if (resource === 'knowledgeArticle') {
    return materialized.detailById?.get(String(entityId)) || null;
  }

  if (!['ticket', 'maintenance', 'customerCase'].includes(resource) || !resourceSpec?.detailRoute) return null;
  return authoritativeDetail(ctx, resourceSpec.detailRoute, resource, entityId);
}

export async function buildSyncDelta(ctx = {}) {
  const startedAt = performance.now();
  const payload = ctx.payload || {};
  const resource = clean(payload.resource, 80);
  const entityId = clean(
    payload.entityId
      || payload.boletaUid
      || payload.maintenanceId
      || payload.caseId
      || payload.tutorialId
      || payload.id,
    180,
  );
  const resourceSpec = syncResourceRegistry[resource];
  if (!resource || !resourceSpec) {
    throw new AppError('SYNC_RESOURCE_INVALID', 'El recurso solicitado no admite sincronización incremental.', 400);
  }
  assertResourceAccess(ctx, resourceSpec);

  const descriptor = await getSyncDescriptor();
  const cacheScope = buildSyncCacheScope(ctx.user, ctx.permissions, descriptor.schemaVersion);
  if (!descriptor.enabled) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor: payload.cursor, reason: 'feature_disabled' })), cacheScope }, startedAt);
  }

  if (descriptor.unsafe) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor: payload.cursor, reason: 'sync_unsafe' })), cacheScope }, startedAt);
  }

  const requestedSchema = Number(payload.schemaVersion || 0);
  if (!payload.generation || clean(payload.generation, 160) !== descriptor.generation) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor: payload.cursor, reason: 'generation_mismatch' })), cacheScope }, startedAt);
  }
  if (!requestedSchema || requestedSchema !== Number(descriptor.schemaVersion)) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor: payload.cursor, reason: 'schema_mismatch' })), cacheScope }, startedAt);
  }

  const fromCursor = Number(payload.cursor || 1);
  if (!Number.isInteger(fromCursor) || fromCursor < 1) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor, reason: 'invalid_cursor' })), cacheScope }, startedAt);
  }

  const scan = await readSyncChangesAfter(fromCursor, { limit: env.syncDeltaMaxEvents });
  if (scan.invalidCursor) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor, reason: scan.reason || 'invalid_cursor', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const incompatibleEvent = scan.events.find((event) => Number(event.SchemaVersion || 0) !== Number(descriptor.schemaVersion));
  if (incompatibleEvent) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor, reason: 'event_schema_mismatch', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const securityChanged = scan.events.some((event) => String(event.Resource || '') === 'security');
  if (securityChanged) {
    return finishResponse({
      ...(await fullSnapshotResponse({
        descriptor,
        resource,
        entityId,
        fromCursor,
        reason: 'security_changed',
        securityInvalidated: true,
        snapshotCursor: scan.cursor,
      })),
      cacheScope,
      eventsScanned: scan.eventsScanned,
    }, startedAt);
  }

  const resourceInvalidated = scan.events.some((event) => (
    String(event.Resource || '') === resource
    && (String(event.Operation || '').toUpperCase() === 'INVALIDATE' || String(event.EntityID || '') === '*')
  ));
  if (resourceInvalidated) {
    return finishResponse({
      ...(await fullSnapshotResponse({
        descriptor,
        resource,
        entityId,
        fromCursor,
        reason: 'resource_invalidated',
        snapshotCursor: scan.cursor,
      })),
      cacheScope,
      eventsScanned: scan.eventsScanned,
    }, startedAt);
  }

  if (scan.eventsScanned >= env.syncDeltaSnapshotThreshold) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor, reason: 'delta_too_large', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const selection = selectSyncResourceEvents(scan.events, resource, entityId);
  const resourceEvents = selection.events;
  if (!resourceEvents.length) {
    return finishResponse({
      enabled: true,
      generation: descriptor.generation,
      schemaVersion: descriptor.schemaVersion,
      cacheScope,
      resource,
      entityId,
      fromCursor,
      cursor: scan.cursor,
      hasMore: scan.hasMore,
      fullSnapshotRequired: false,
      notModified: Boolean(entityId),
      securityInvalidated: false,
      upserts: [],
      removed: [],
      invalidated: [],
      counts: null,
      detail: null,
      eventsScanned: scan.eventsScanned,
      eventsDeduped: 0,
    }, startedAt);
  }

  const materialized = await materializeResourceDelta(ctx, resource, resourceEvents, resourceSpec);
  if (materialized) {
    const detail = await materializeChangedDetail(ctx, resource, resourceSpec, entityId, materialized);
    return finishResponse(incrementalResponse({
      descriptor,
      cacheScope,
      resource,
      entityId,
      fromCursor,
      scan,
      resourceEvents,
      materialized,
      detail,
    }), startedAt);
  }

  return finishResponse({
    ...(await fullSnapshotResponse({ descriptor, resource, entityId, fromCursor, reason: 'resource_snapshot_required', snapshotCursor: scan.cursor })),
    cacheScope,
    eventsScanned: scan.eventsScanned,
    eventsDeduped: resourceEvents.length,
  }, startedAt);
}
