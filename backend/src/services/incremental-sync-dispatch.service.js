import { dispatchAction } from '../core/action-router.js';
import { authenticate } from './auth.service.js';
import { buildSyncDelta } from './sync-delta.service.js';
import { collectDerivedSyncClassifications } from './sync-derived-changes.service.js';
import { markSyncUnsafe, recordClassifiedSyncChange } from './sync-change.service.js';
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

export async function dispatchActionWithIncrementalSync(args = {}) {
  if (String(args.route || '') === 'sync.delta') {
    const auth = await authenticate(args.sessionToken || '');
    return buildSyncDelta({ ...args, ...auth });
  }

  const result = await dispatchAction(args);
  const mutation = expandMutationEntityIds(
    classifyMutationRoute(args.route, args.payload || {}, result),
    result,
  );
  if (mutation.classification === SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED) return result;

  const auth = await authenticatedContext(args);
  let derived = [];
  try {
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
  await recordClassifiedSyncChange(mutation, context);
  for (const derivedMutation of derived) {
    await recordClassifiedSyncChange(derivedMutation, context);
  }
  return result;
}
