import { trackSyncWrites, confirmObservedSyncWrites } from '../core/sync-write-observer.js';
import { env } from '../config/env.js';
import { dispatchAction } from '../core/action-router.js';
import { authenticate } from './auth.service.js';
import { buildSyncDelta } from './sync-delta.service.js';
import { overrideSyncClassification } from './sync-classification-overrides.service.js';
import { collectDerivedSyncClassifications } from './sync-derived-changes.service.js';
import { markSyncUnsafe, recordClassifiedSyncChanges } from './sync-change.service.js';
import { classifyMutationRoute, SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

const PUBLIC_SYNC_ACTORS = new Set([
  'ticket.signature.public.submit',
  'boletas.firma.publica.guardar',
  'maintenance.signature.public.submit',
  'mantenimientos.firma.publica.guardar',
  'customerCases.public.submit',
  'casos.cliente.public.submit',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function publicActor(route) {
  return PUBLIC_SYNC_ACTORS.has(String(route || ''))
    ? { user: { UsuarioID: 'CLIENTE', Nombre: 'Cliente' }, permissions: [] }
    : { user: null, permissions: [] };
}

async function authenticatedContext(args = {}) {
  if (!args.sessionToken) return publicActor(args.route);
  return authenticate(args.sessionToken);
}

export function expandMutationEntityIds(classification = {}, result = null) {
  if (classification?.resource !== 'agenda' || !Array.isArray(result?.items)) return classification;
  const entityIds = [...new Set(
    result.items
      .map((item) => clean(item?.AgendaID || item?.agendaId || item?.id))
      .filter(Boolean),
  )];
  if (!entityIds.length) return classification;
  return {
    ...classification,
    entityId: entityIds[0],
    entityIds,
  };
}

export function dispatchActionWithIncrementalSync(args = {}) {
  return trackSyncWrites(() => dispatchTrackedAction(args));
}

async function dispatchTrackedAction(args = {}) {
  if (String(args.route || '') === 'sync.delta') {
    const auth = await authenticate(args.sessionToken || '');
    return buildSyncDelta({ ...args, ...auth });
  }

  if (!env.incrementalSyncEnabled) return dispatchAction(args);
  let result;
  try {
    result = await dispatchAction(args);
  } catch (error) {
    // Some actions persist several rows before a later step fails. Preserve the
    // original error, but never allow the partial write to stay invisible.
    const planned = classifyMutationRoute(args.route, args.payload || {}, {});
    if (planned.classification !== SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED
      || /\.(chunk|bloque)$/.test(String(args.route || ''))) {
      await markSyncUnsafe('mutation_failed_after_possible_write');
    }
    throw error;
  }
  const classified = classifyMutationRoute(args.route, args.payload || {}, result);
  const overridden = overrideSyncClassification({
    route: args.route,
    payload: args.payload || {},
    result,
    classification: classified,
  });
  const mutation = expandMutationEntityIds(overridden, result);
  if (mutation.classification === SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED) return result;

  let auth;
  let derived = [];
  try {
    auth = await authenticatedContext(args);
    derived = await collectDerivedSyncClassifications({
      route: args.route,
      payload: args.payload || {},
      result,
      primaryClassification: mutation,
    });
  } catch (error) {
    await markSyncUnsafe(`${args.route || 'unknown'}:derived:${error?.code || error?.message || 'lookup_failed'}`);
    console.warn(`[sync-change][${args.route || 'unknown'}] cambio derivado no identificable; se fuerza reconciliación: ${error?.code || error?.message || error}`);
    return result;
  }

  const context = {
    route: args.route,
    payload: args.payload || {},
    sessionToken: args.sessionToken || '',
    ...auth,
  };
  const recorded = await recordClassifiedSyncChanges([mutation, ...derived], context);
  if (Array.isArray(recorded) && recorded.length) confirmObservedSyncWrites();
  return result;
}
