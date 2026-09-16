import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { overrideSyncClassification } from '../../backend/src/services/sync-classification-overrides.service.js';
import { collectDerivedSyncClassifications } from '../../backend/src/services/sync-derived-changes.service.js';

const materializerSource = readFileSync(new URL('../../backend/src/services/sync-customer-case.service.js', import.meta.url), 'utf8');
const deltaSource = readFileSync(new URL('../../backend/src/services/sync-delta.service.js', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../../backend/src/services/sync-resource-registry.js', import.meta.url), 'utf8');
const frontendServiceSource = readFileSync(new URL('../../src/services/customerCases.js', import.meta.url), 'utf8');
const frontendPageSource = readFileSync(new URL('../../src/pages/cases/CustomerCasesPage.jsx', import.meta.url), 'utf8');
const patchSource = readFileSync(new URL('../../src/services/crudSyncDomain.js', import.meta.url), 'utf8');

function findDerived(rows, resource, entityId, operation = 'UPSERT') {
  return rows.find((row) => (
    row.resource === resource
    && String(row.entityId) === String(entityId)
    && row.operation === operation
  ));
}

test('sync Casos: rutas especiales se atribuyen al agregado correcto', () => {
  const resend = overrideSyncClassification({
    route: 'customerCases.resendTechnicians',
    payload: { caseId: 'CASE-1' },
    result: { case: { CasoID: 'CASE-1' } },
    classification: { classification: 'NO_SYNC_REQUIRED' },
  });
  assert.equal(resend.resource, 'customerCase');
  assert.equal(resend.entityId, 'CASE-1');
  assert.equal(resend.operation, 'UPSERT');

  const clientLink = overrideSyncClassification({
    route: 'customerCases.clientLink.update',
    payload: { clientId: 'CLIENT-1' },
    result: { clientId: 'CLIENT-1' },
    classification: { resource: 'customerCase', entityId: 'CLIENT-1', operation: 'UPSERT' },
  });
  assert.equal(clientLink.resource, 'client');
  assert.equal(clientLink.entityId, 'CLIENT-1');
});

test('sync Casos: procesar un caso propaga la boleta creada/actualizada y reconcilia Agenda', async () => {
  const derived = await collectDerivedSyncClassifications({
    route: 'customerCases.process',
    payload: { caseId: 'CASE-1' },
    result: { case: { CasoID: 'CASE-1', BoletaUID: 'TICKET-1' } },
    primaryClassification: { resource: 'customerCase', entityId: 'CASE-1', operation: 'UPSERT' },
  });

  assert.ok(findDerived(derived, 'ticket', 'TICKET-1'));
  assert.ok(findDerived(derived, 'agenda', '*', 'INVALIDATE'));
});

test('sync Casos: finalizar una boleta vinculada propaga el caso finalizado', async () => {
  const derived = await collectDerivedSyncClassifications({
    route: 'boletas.finalize',
    payload: { boletaUid: 'TICKET-1' },
    result: { customerCase: { CasoID: 'CASE-1' } },
    primaryClassification: { resource: 'ticket', entityId: 'TICKET-1', operation: 'UPSERT' },
  });

  assert.ok(findDerived(derived, 'customerCase', 'CASE-1'));
  assert.ok(findDerived(derived, 'agenda', '*', 'INVALIDATE'));
});

test('sync Casos: el delta materializa solo casos cambiados y calcula contadores con una lectura fuente', () => {
  assert.equal((materializerSource.match(/readTable\('CasosClientes'\)/g) || []).length, 1);
  assert.match(materializerSource, /customerCaseView\(row\)/);
  assert.match(materializerSource, /counts\.TOTAL \+= 1/);
  assert.match(materializerSource, /counts\[state\] = Number\(counts\[state\] \|\| 0\) \+ 1/);
  assert.doesNotMatch(materializerSource, /readTable\('EvidenciasCasosClientes'\)/);
});

test('sync Casos: el detalle incremental conserva el handler autoritativo completo', () => {
  assert.match(deltaSource, /resource === 'customerCase'.*materializeCustomerCaseDelta/s);
  assert.match(deltaSource, /resource === 'customerCase'.*return \{ caseId: entityId, id: entityId \}/s);
  assert.match(deltaSource, /\['ticket', 'maintenance', 'customerCase'\]\.includes\(resource\)/);
  assert.match(deltaSource, /route: resourceSpec\.detailRoute/);
  assert.match(registrySource, /customerCase: Object\.freeze\(\{ snapshotRoute: 'customerCases\.list', detailRoute: 'customerCases\.get', permission: 'USUARIOS_GESTIONAR' \}\)/);
});

test('sync Casos: frontend usa IndexedDB/delta en lista y fuerza frescura al abrir detalle', () => {
  assert.match(frontendServiceSource, /requestSynchronizedCollection\(candidates, payload, sessionToken/);
  assert.match(frontendServiceSource, /resource: 'customerCase'/);
  assert.match(frontendServiceSource, /requestSynchronizedDetail\(candidates, payload, sessionToken/);
  assert.match(frontendServiceSource, /forceSync: true/);
  assert.match(frontendPageSource, /subscribeCustomerCaseList\(/);
  assert.match(frontendPageSource, /readCustomerCaseListCache\(casePayload, sessionToken\)/);
});

test('sync Casos: parche de lista conserva estado, búsqueda, orden, counts y modeCounts existente', () => {
  assert.match(patchSource, /customerCaseMatchesQuery/);
  assert.match(patchSource, /normalizeCustomerCaseState/);
  assert.match(patchSource, /FechaCreacion/);
  assert.match(patchSource, /resource === 'customerCase' && delta\.counts/);
  assert.match(patchSource, /shared\.counts = \{ \.\.\.delta\.counts \}/);
  assert.match(patchSource, /\.\.\.original/);
  assert.match(patchSource, /El handler autoritativo actual no aplica el parámetro mode/);
});
