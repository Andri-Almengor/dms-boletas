import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearAliasPreferences,
  preferredAliasFor,
  requestFirstAvailable,
} from '../../src/services/aliasResolver.js';
import {
  isAbortError,
  isMissingRouteError,
  isNetworkError,
} from '../../src/services/requestErrors.js';

function missingRoute(message = 'Ruta no encontrada') {
  const error = new Error(message);
  error.code = 'ROUTE_NOT_FOUND';
  error.status = 404;
  return error;
}

test('los aliases solo avanzan cuando la ruta realmente no existe', async () => {
  clearAliasPreferences();
  const calls = [];
  const result = await requestFirstAvailable(['legacy.list', 'current.list'], async (route) => {
    calls.push(route);
    if (route === 'legacy.list') throw missingRoute();
    return { route };
  });

  assert.deepEqual(result, { route: 'current.list' });
  assert.deepEqual(calls, ['legacy.list', 'current.list']);
  assert.equal(preferredAliasFor(['legacy.list', 'current.list']), 'current.list');
});

test('el alias válido se prueba primero en solicitudes posteriores', async () => {
  const calls = [];
  const result = await requestFirstAvailable(['legacy.list', 'current.list'], async (route) => {
    calls.push(route);
    return { route };
  });

  assert.deepEqual(result, { route: 'current.list' });
  assert.deepEqual(calls, ['current.list']);
});

test('un error de red no se interpreta como alias inexistente', async () => {
  clearAliasPreferences();
  const calls = [];
  const network = new TypeError('Failed to fetch');

  await assert.rejects(
    requestFirstAvailable(['primary.list', 'secondary.list'], async (route) => {
      calls.push(route);
      throw network;
    }),
    network,
  );
  assert.deepEqual(calls, ['primary.list']);
  assert.equal(isNetworkError(network), true);
  assert.equal(isMissingRouteError(network), false);
});

test('AbortController cancela antes de iniciar otro alias', async () => {
  clearAliasPreferences();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    requestFirstAvailable(['one.list', 'two.list'], async () => {
      calls += 1;
      return {};
    }, { signal: controller.signal }),
    (error) => isAbortError(error),
  );
  assert.equal(calls, 0);
});

test('la detección de rutas faltantes conserva códigos y mensajes históricos', () => {
  assert.equal(isMissingRouteError(missingRoute()), true);
  assert.equal(isMissingRouteError(new Error('Unknown action: clients.list')), true);
  assert.equal(isMissingRouteError(new Error('Handler not found')), true);
  assert.equal(isMissingRouteError(new Error('Error al procesar la ruta por permisos')), false);
});

test('ONLINE_REQUIRED no se convierte en escritura offline cuando el modo está desactivado', () => {
  const error = new Error('No se pudo conectar al servidor. El modo sin conexión está desactivado.');
  error.code = 'ONLINE_REQUIRED';
  assert.equal(isNetworkError(error), false);
});
