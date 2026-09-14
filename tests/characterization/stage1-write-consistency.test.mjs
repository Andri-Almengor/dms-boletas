import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createUnknownResultError,
  isNetworkError,
  isUnknownResultError,
} from '../../src/services/requestErrors.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Etapa 1: UNKNOWN_RESULT se distingue de un fallo confirmado y solo entra a offline cuando la operación puede reconciliarse', () => {
  const transport = new TypeError('Failed to fetch');
  const queued = createUnknownResultError(transport, {
    clientRequestId: 'req-12345678-abcd-4321-abcd-1234567890ab',
    queueOffline: true,
  });
  const onlineOnly = createUnknownResultError(transport, {
    clientRequestId: 'req-12345678-abcd-4321-abcd-1234567890ab',
    queueOffline: false,
  });

  assert.equal(isUnknownResultError(queued), true);
  assert.equal(queued.code, 'UNKNOWN_RESULT');
  assert.equal(queued.retryable, false);
  assert.equal(isNetworkError(queued), true, 'una operación identificable puede conservarse para reconciliación offline');
  assert.equal(isNetworkError(onlineOnly), false, 'un resultado ambiguo no idempotente no debe convertirse en éxito local');
});

test('Etapa 1: las mutaciones conservan identidad y no reutilizan el retry genérico salvo rechazo seguro del edge', () => {
  const api = source('src/api.js');

  assert.match(api, /target\.__clientRequestId = createLocalId\('req'\)/);
  assert.match(api, /safeMutationRetry[\s\S]*BACKEND_EDGE_THROTTLED/);
  assert.match(api, /ambiguousMutation[\s\S]*createUnknownResultError/);
  assert.match(api, /queueOffline: isOfflineModeEnabled\(\) && mutationCanReplayAfterUnknown\(route, payload\)/);
});

test('Etapa 1: solo creaciones con identidad natural conocida pueden reingresar automáticamente a la cola tras UNKNOWN_RESULT', () => {
  const api = source('src/api.js');
  const helper = api.slice(
    api.indexOf('function mutationCanReplayAfterUnknown'),
    api.indexOf('async function performRequest'),
  );

  assert.match(helper, /boletas\.create/);
  assert.match(helper, /BoletaUID/);
  assert.match(helper, /boletas\.evidence\.upload/);
  assert.match(helper, /EvidenciaID/);
  assert.match(helper, /maintenance\.create/);
  assert.match(helper, /MantenimientoID/);
  assert.match(helper, /maintenance\.devices\.create/);
  assert.match(helper, /EvidenciaMantenimientoID/);
  assert.match(helper, /maintenance\.images\.upload/);
  assert.match(helper, /FotoDispositivoID/);
  assert.doesNotMatch(helper, /clientLocations\.create|manufacturers\.create|models\.create/);
});

test('Etapa 1: CRUD protegido de Etapa 0 permanece byte-identical; la etapa no cambia permisos para conseguir idempotencia', () => {
  const crud = source('backend/src/modules/crud.module.js');
  assert.equal(
    createHash('sha256').update(crud).digest('hex'),
    '9f6c25cfbeaadd8126426012ba2fd6e4d0199687b1493d291b889032f292ca21',
  );
});

test('Etapa 1: autosave de boletas rechaza una revisión cliente anterior a la ya aceptada', () => {
  const api = source('src/api.js');
  const patch = source('backend/src/services/ticket-write-consistency.patch.js');
  const visibility = source('backend/src/services/ticket-visibility.patch.js');

  assert.match(api, /value === 'boletas\.autosave'/);
  assert.match(api, /target\.__clientRevision = nextClientMutationRevision\(\)/);
  assert.match(visibility, /ticket-write-consistency\.patch\.js/);
  assert.match(patch, /clientRevision < previousRevision/);
  assert.match(patch, /autosaved: false/);
  assert.match(patch, /stale: true/);
  assert.match(patch, /MAX_TRACKED_TICKETS = 1_000/);
  assert.match(patch, /while \(acceptedRevisions\.size > MAX_TRACKED_TICKETS\)/);
});

test('Etapa 1: la cola offline conserva exactamente el payload de una operación identificada al reconectar', () => {
  const moduleApi = source('src/services/moduleApi.js');

  assert.match(moduleApi, /enqueueOperation\(\{[\s\S]*payload,/);
  assert.match(moduleApi, /const originalPayload = operation\.payload \|\| \{\}/);
  assert.match(moduleApi, /apiRequest\(route, payload, sessionToken\)/);
});
