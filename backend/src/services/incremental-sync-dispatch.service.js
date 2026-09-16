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

function publicActor(route) {
  return PUBLIC_SYNC_ACTORS.has(String(route || ''))
    ? { user: { UsuarioID: 'CLIENTE', Nombre: 'Cliente' }, permissions: [] }
    : { user: null, permissions: [] };
}

async function authenticatedContext(args = {}) {
  if (!args.sessionToken) return publicActor(args.route);
  return authenticate(args.sessionToken);
}

export async function dispatchActionWithIncrementalSync(args = {}) {
  if (String(args.route || '') === 'sync.delta') {
    const auth = await authenticate(args.sessionToken || '');
    return buildSyncDelta({ ...args, ...auth });
  }

  const result = await dispatchAction(args);
  const mutation = classifyMutationRoute(args.route, args.payload || {}, result);
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
