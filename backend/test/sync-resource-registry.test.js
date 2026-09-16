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
  assert.equal(evidence.operation, 'UPSERT');
});

test('group mutations emit every changed ticket id once', () => {
  const result = classifyMutationRoute(
    'boletas.finalize',
    { boletaUid: 'B-1' },
    {
      boleta: { BoletaUID: 'B-1' },
      grupoVisitas: {
        visits: [
          { BoletaUID: 'B-1' },
          { BoletaUID: 'B-2' },
          { BoletaUID: 'B-2' },
        ],
      },
    },
  );
  assert.deepEqual(result.entityIds, ['B-1', 'B-2']);
});

test('child deletion invalidates aggregate without deleting aggregate', () => {
  const ticketEvidence = classifyMutationRoute(
    'boletas.evidence.delete',
    { evidenciaId: 'E-1' },
    { EvidenciaID: 'E-1', BoletaUID: 'B-100' },
  );
  assert.equal(ticketEvidence.resource, 'ticket');
  assert.equal(ticketEvidence.operation, 'UPSERT');

  const maintenanceImage = classifyMutationRoute(
    'maintenance.images.delete',
    { maintenanceId: 'M-1', imageId: 'IMG-1' },
    { MantenimientoID: 'M-1' },
  );
  assert.equal(maintenanceImage.resource, 'maintenance');
  assert.equal(maintenanceImage.operation, 'UPSERT');
});

test('aggregate deletion remains DELETE', () => {
  assert.equal(classifyMutationRoute('boletas.annul', { boletaUid: 'B-1' }, {}).operation, 'DELETE');
  assert.equal(classifyMutationRoute('maintenance.delete', { maintenanceId: 'M-1' }, {}).operation, 'DELETE');
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

test('public signatures resolve their actual aggregate type', () => {
  const ticket = classifyMutationRoute(
    'ticket.signature.public.submit',
    {},
    { ticket: { uid: 'B-9', visits: [{ uid: 'B-9' }, { uid: 'B-10' }] }, signed: true },
  );
  assert.equal(ticket.resource, 'ticket');
  assert.equal(ticket.entityId, 'B-9');
  assert.deepEqual(ticket.entityIds, ['B-9', 'B-10']);

  const maintenance = classifyMutationRoute(
    'maintenance.signature.public.submit',
    {},
    { maintenance: { subjectType: 'maintenance', uid: 'M-9' }, signed: true },
  );
  assert.equal(maintenance.resource, 'maintenance');
  assert.equal(maintenance.entityId, 'M-9');

  const testSignature = classifyMutationRoute(
    'maintenance.signature.public.submit',
    {},
    { testMode: true, maintenance: { uid: 'M-9' } },
  );
  assert.equal(testSignature.classification, SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED);
});

test('security writes are invalidations, not catalog synchronization', () => {
  const result = classifyMutationRoute('users.update', { UsuarioID: 'U-5' }, { UsuarioID: 'U-5' });
  assert.equal(result.classification, SYNC_MUTATION_CLASS.SECURITY_INVALIDATION);
  assert.equal(result.resource, 'security');
  assert.equal(result.operation, 'INVALIDATE');
});

test('nested and operational client aliases keep their specific resource', () => {
  const location = classifyMutationRoute(
    'clients.locations.update',
    { ubicacionId: 'L-1' },
    { UbicacionID: 'L-1' },
  );
  assert.equal(location.resource, 'clientLocation');
  assert.equal(location.entityId, 'L-1');

  const equipment = classifyMutationRoute(
    'clients.equipmentLocations.update',
    { ubicacionEquipoId: 'E-1' },
    { UbicacionEquipoID: 'E-1' },
  );
  assert.equal(equipment.resource, 'equipmentLocation');
  assert.equal(equipment.entityId, 'E-1');

  const operationalLocation = classifyMutationRoute(
    'clients.operational.locations.create',
    { ClienteID: 'C-1' },
    { UbicacionID: 'L-2', ClienteID: 'C-1' },
  );
  assert.equal(operationalLocation.resource, 'clientLocation');
  assert.equal(operationalLocation.entityId, 'L-2');

  const operationalContact = classifyMutationRoute(
    'clients.operational.contacts.create',
    { ClienteID: 'C-1' },
    { ContactoID: 'CT-1', ClienteID: 'C-1' },
  );
  assert.equal(operationalContact.resource, 'contact');
  assert.equal(operationalContact.entityId, 'CT-1');
});

test('operational catalog aliases classify as their canonical resources', () => {
  assert.equal(
    classifyMutationRoute('catalog.operational.models.create', {}, { ModeloID: 'MO-1' }).resource,
    'model',
  );
  assert.equal(
    classifyMutationRoute('catalog.operational.deviceTypes.update', {}, { TipoDispositivoID: 'TD-1' }).resource,
    'deviceType',
  );
  assert.equal(
    classifyMutationRoute('catalog.operational.manufacturers.create', {}, { FabricanteID: 'F-1' }).resource,
    'manufacturer',
  );
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
