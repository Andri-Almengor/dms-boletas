import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMutationRoute,
  mutationIdFrom,
  SYNC_MUTATION_CLASS,
} from '../src/services/sync-resource-registry.js';

test('ticket mutations collapse to the ticket aggregate root', () => {
  const update = classifyMutationRoute('boletas.update', { boletaUid: 'B-100' }, { boleta: { BoletaUID: 'B-100' } });
  assert.equal(update.classification, SYNC_MUTATION_CLASS.SYNC_RESOURCE);
  assert.equal(update.resource, 'ticket');
  assert.equal(update.entityId, 'B-100');
  assert.equal(update.operation, 'UPSERT');

  const evidence = classifyMutationRoute(
    'boletas.evidence.update',
    { evidenciaId: 'E-1' },
    { EvidenciaID: 'E-1', BoletaUID: 'B-100' },
  );
  assert.equal(evidence.resource, 'ticket');
  assert.equal(evidence.entityId, 'B-100');
});

test('throttled autosave and unfinished media chunks do not emit changes', () => {
  const throttled = classifyMutationRoute('boletas.autosave', { boletaUid: 'B-1' }, { throttled: true });
  assert.equal(throttled.classification, SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED);
  assert.equal(throttled.reason, 'autosave_throttled');

  const chunk = classifyMutationRoute('boletas.evidence.large.chunk', { boletaUid: 'B-1' }, { completed: false });
  assert.equal(chunk.classification, SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED);
  assert.equal(chunk.reason, 'media_chunk');
});

test('only the final large media chunk can invalidate its aggregate', () => {
  const result = classifyMutationRoute(
    'boletas.evidence.large.chunk',
    { boletaUid: 'B-1' },
    { completed: true, BoletaUID: 'B-1' },
  );
  assert.equal(result.classification, SYNC_MUTATION_CLASS.SYNC_RESOURCE);
  assert.equal(result.resource, 'ticket');
  assert.equal(result.entityId, 'B-1');
});

test('security writes are invalidations, not catalog synchronization', () => {
  const result = classifyMutationRoute('users.update', { UsuarioID: 'U-5' }, { UsuarioID: 'U-5' });
  assert.equal(result.classification, SYNC_MUTATION_CLASS.SECURITY_INVALIDATION);
  assert.equal(result.resource, 'security');
  assert.equal(result.operation, 'INVALIDATE');
});

test('read routes do not create sync events', () => {
  const result = classifyMutationRoute('catalog.models.list', {}, null);
  assert.equal(result.classification, SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED);
});

test('mutation id extraction is bounded and accepts compatibility aliases', () => {
  assert.equal(mutationIdFrom({ mutationId: 'abc' }), 'abc');
  assert.equal(mutationIdFrom({ MutationID: 'xyz' }), 'xyz');
  assert.equal(mutationIdFrom({ mutationId: 'x'.repeat(500) }).length, 160);
});
