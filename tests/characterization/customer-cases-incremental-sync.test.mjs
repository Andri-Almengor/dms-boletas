import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const materializerSource = readFileSync(new URL('../../backend/src/services/sync-customer-case.service.js', import.meta.url), 'utf8');
const deltaSource = readFileSync(new URL('../../backend/src/services/sync-delta.service.js', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../../backend/src/services/sync-resource-registry.js', import.meta.url), 'utf8');
const overrideSource = readFileSync(new URL('../../backend/src/services/sync-classification-overrides.service.js', import.meta.url), 'utf8');
const derivedSource = readFileSync(new URL('../../backend/src/services/sync-derived-changes.service.js', import.meta.url), 'utf8');
const frontendServiceSource = readFileSync(new URL('../../src/services/customerCases.js', import.meta.url), 'utf8');
const frontendPageSource = readFileSync(new URL('../../src/pages/cases/CustomerCasesPage.jsx', import.meta.url), 'utf8');
const patchSource = readFileSync(new URL('../../src/services/crudSyncDomain.js', import.meta.url), 'utf8');

test('sync Casos: rutas especiales se atribuyen al agregado correcto', () => {
  assert.match(overrideSource, /'customerCases\.resendTechnicians'/);
  assert.match(overrideSource, /'casos\.cliente\.reenviarTecnicos'/);
  assert.match(overrideSource, /CASE_UPSERT_ROUTES\.has\(normalized\)[\s\S]*upsert\('customerCase', id, normalized\)/);
  assert.match(overrideSource, /'customerCases\.clientLink\.update'/);
  assert.match(overrideSource, /CLIENT_LINK_ROUTES\.has\(normalized\)[\s\S]*upsert\('client', id, normalized\)/);
});

test('sync Casos: procesar un caso propaga la boleta creada/actualizada y reconcilia Agenda', () => {
  assert.match(derivedSource, /CUSTOMER_CASE_PROCESS_ROUTES/);
  assert.match(derivedSource, /result\?\.case\?\.BoletaUID/);
  assert.match(derivedSource, /syncClassification\('ticket', ticketId, route, 'customerCaseProcess'\)/);
  assert.match(derivedSource, /syncClassification\('agenda', '\*', route, 'customerCaseTicketMatching', 'INVALIDATE'\)/);
});

test('sync Casos: finalizar una boleta vinculada propaga el caso finalizado', () => {
  assert.match(derivedSource, /function ticketFinalizationCaseDerivedChanges/);
  assert.match(derivedSource, /result\?\.customerCase\?\.CasoID/);
  assert.match(derivedSource, /syncClassification\('customerCase', caseId, route, 'ticketFinalization'\)/);
});

test('sync Casos: el delta consulta solo IDs cambiados y calcula contadores en PostgreSQL', () => {
  assert.match(materializerSource, /COUNT\(\*\)::bigint AS total/);
  assert.match(materializerSource, /"CasoID"=ANY\(\$1::text\[\]\)/);
  assert.match(materializerSource, /label:'sync\.cases\.counts'/);
  assert.match(materializerSource, /label:'sync\.cases\.changed'/);
  assert.match(materializerSource, /customerCaseView\(row\)/);
  assert.doesNotMatch(materializerSource, /readTable\(/);
});

test('sync Casos: el detalle incremental conserva el handler autoritativo completo', () => {
  assert.match(deltaSource, /resource === 'customerCase'.*materializeCustomerCaseDelta/s);
  assert.match(deltaSource, /resource === 'customerCase'.*return \{ caseId: entityId, id: entityId \}/s);
  assert.match(deltaSource, /\['ticket', 'maintenance', 'customerCase'\]\.includes\(resource\)/);
  assert.match(deltaSource, /authoritativeDetail\(ctx, resourceSpec\.detailRoute, resource, entityId\)/);
  assert.match(registrySource, /customerCase: Object\.freeze\(\{ snapshotRoute: 'customerCases\.list', detailRoute: 'customerCases\.get', permission: 'USUARIOS_GESTIONAR' \}\)/);
});

test('sync Casos: frontend usa IndexedDB\/delta en lista y fuerza frescura al abrir detalle', () => {
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
