import { performance } from 'node:perf_hooks';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { sha256 } from '../core/utils.js';
import {
  getSyncCursor,
  getSyncDescriptor,
  readSyncChangesAfter,
} from './sync-change.service.js';
import { syncResourceRegistry } from './sync-resource-registry.js';
import { materializeTicketDelta } from './sync-ticket.service.js';

function clean(value, maxLength = 180) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function buildSyncCacheScope(user = {}, permissions = [], schemaVersion = env.syncSchemaVersion) {
  const userId = clean(user.UsuarioID || user.id || 'anonymous', 180);
  const permissionFingerprint = [...new Set((permissions || []).map(String).filter(Boolean))].sort().join(',');
  return `u:${userId}:${sha256(`${userId}|${permissionFingerprint}|${Number(schemaVersion || 1)}`).slice(0, 24)}`;
}

export function dedupeSyncEvents(events = [], resource = '') {
  const latest = new Map();
  for (const event of events) {
    if (resource && String(event.Resource || '') !== resource) continue;
    const entityId = clean(event.EntityID);
    if (!entityId) continue;
    latest.set(entityId, event);
  }
  return [...latest.values()].sort((left, right) => Number(left.__rowNumber || 0) - Number(right.__rowNumber || 0));
}

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
} = {}) {
  const cursor = snapshotCursor ?? await getSyncCursor();
  return {
    enabled: Boolean(descriptor?.enabled),
    generation: descriptor?.generation || '',
    schemaVersion: Number(descriptor?.schemaVersion || env.syncSchemaVersion || 1),
    cacheScope: null,
    resource,
    fromCursor: Number(fromCursor || 0),
    cursor,
    snapshotCursor: cursor,
    hasMore: false,
    fullSnapshotRequired: true,
    reason,
    securityInvalidated,
    upserts: [],
    removed: [],
    invalidated: [],
    counts: null,
    eventsScanned: 0,
    eventsDeduped: 0,
  };
}

export async function buildSyncDelta(ctx = {}) {
  const startedAt = performance.now();
  const payload = ctx.payload || {};
  const resource = clean(payload.resource, 80);
  const resourceSpec = syncResourceRegistry[resource];
  if (!resource || !resourceSpec) {
    throw new AppError('SYNC_RESOURCE_INVALID', 'El recurso solicitado no admite sincronización incremental.', 400);
  }
  assertResourceAccess(ctx, resourceSpec);

  const descriptor = await getSyncDescriptor();
  const cacheScope = buildSyncCacheScope(ctx.user, ctx.permissions, descriptor.schemaVersion);
  if (!descriptor.enabled) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor: payload.cursor, reason: 'feature_disabled' })), cacheScope }, startedAt);
  }

  if (descriptor.unsafe) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor: payload.cursor, reason: 'sync_unsafe' })), cacheScope }, startedAt);
  }

  const requestedSchema = Number(payload.schemaVersion || 0);
  if (!payload.generation || clean(payload.generation, 160) !== descriptor.generation) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor: payload.cursor, reason: 'generation_mismatch' })), cacheScope }, startedAt);
  }
  if (!requestedSchema || requestedSchema !== Number(descriptor.schemaVersion)) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor: payload.cursor, reason: 'schema_mismatch' })), cacheScope }, startedAt);
  }

  const fromCursor = Number(payload.cursor || 1);
  if (!Number.isInteger(fromCursor) || fromCursor < 1) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor, reason: 'invalid_cursor' })), cacheScope }, startedAt);
  }

  const scan = await readSyncChangesAfter(fromCursor, { limit: env.syncDeltaMaxEvents });
  if (scan.invalidCursor) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor, reason: 'invalid_cursor', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const incompatibleEvent = scan.events.find((event) => Number(event.SchemaVersion || 0) !== Number(descriptor.schemaVersion));
  if (incompatibleEvent) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor, reason: 'event_schema_mismatch', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const securityChanged = scan.events.some((event) => String(event.Resource || '') === 'security');
  if (securityChanged) {
    return finishResponse({
      ...(await fullSnapshotResponse({
        descriptor,
        resource,
        fromCursor,
        reason: 'security_changed',
        securityInvalidated: true,
        snapshotCursor: scan.cursor,
      })),
      cacheScope,
      eventsScanned: scan.eventsScanned,
    }, startedAt);
  }

  if (scan.eventsScanned >= env.syncDeltaSnapshotThreshold) {
    return finishResponse({ ...(await fullSnapshotResponse({ descriptor, resource, fromCursor, reason: 'delta_too_large', snapshotCursor: scan.cursor })), cacheScope }, startedAt);
  }

  const resourceEvents = dedupeSyncEvents(scan.events, resource);
  if (!resourceEvents.length) {
    return finishResponse({
      enabled: true,
      generation: descriptor.generation,
      schemaVersion: descriptor.schemaVersion,
      cacheScope,
      resource,
      fromCursor,
      cursor: scan.cursor,
      hasMore: scan.hasMore,
      fullSnapshotRequired: false,
      securityInvalidated: false,
      upserts: [],
      removed: [],
      invalidated: [],
      counts: null,
      eventsScanned: scan.eventsScanned,
      eventsDeduped: 0,
    }, startedAt);
  }

  if (resource === 'ticket') {
    const materialized = await materializeTicketDelta(ctx, resourceEvents);
    return finishResponse({
      enabled: true,
      generation: descriptor.generation,
      schemaVersion: descriptor.schemaVersion,
      cacheScope,
      resource,
      fromCursor,
      cursor: scan.cursor,
      hasMore: scan.hasMore,
      fullSnapshotRequired: false,
      securityInvalidated: false,
      upserts: materialized.upserts,
      removed: materialized.removed,
      invalidated: materialized.invalidated,
      counts: materialized.counts,
      eventsScanned: scan.eventsScanned,
      eventsDeduped: resourceEvents.length,
    }, startedAt);
  }

  // Resource-specific authoritative materialization is registered domain by
  // domain. Until a domain is migrated, a changed resource falls back to a
  // snapshot instead of returning incomplete or unauthorized data.
  return finishResponse({
    ...(await fullSnapshotResponse({ descriptor, resource, fromCursor, reason: 'resource_snapshot_required', snapshotCursor: scan.cursor })),
    cacheScope,
    eventsScanned: scan.eventsScanned,
    eventsDeduped: resourceEvents.length,
  }, startedAt);
}
