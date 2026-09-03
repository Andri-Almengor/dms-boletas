import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('la página delega recursos, creación rápida y persistencia', () => {
  const page = source('src/pages/tickets/TicketFormPage.jsx');

  assert.match(page, /useTicketFormResources/);
  assert.match(page, /useTicketQuickCreate/);
  assert.match(page, /useTicketPersistence/);
  assert.doesNotMatch(page, /async function loadCatalogs/);
  assert.doesNotMatch(page, /async function uploadAssets/);
  assert.doesNotMatch(page, /async function saveBase/);
  assert.doesNotMatch(page, /async function submitModal/);
  assert.doesNotMatch(page, /MODULE_ROUTES/);
  assert.ok(page.split('\n').length < 450, 'TicketFormPage debe mantenerse enfocado en presentación y navegación');
});

test('los recursos conservan catálogos pequeños y difieren los catálogos dependientes', () => {
  const hook = source('src/features/tickets/useTicketFormResources.js');

  for (const key of ['clients', 'categories', 'failures', 'devices', 'users']) {
    assert.match(hook, new RegExp(`${key}: \\{ routes:`));
  }
  assert.match(hook, /const CLIENT_PAGE_SIZE = 80/);
  assert.doesNotMatch(hook, /manufacturers: \{ routes:/);
  assert.doesNotMatch(hook, /models: \{ routes:/);
  assert.doesNotMatch(hook, /relations: \{ routes:/);
  assert.match(hook, /MODULE_ROUTES\.manufacturers\.list/);
  assert.match(hook, /MODULE_ROUTES\.deviceManufacturers\.list/);
  assert.match(hook, /MODULE_ROUTES\.models\.list/);
  assert.match(hook, /tipoDispositivoId: normalizedTypeId/);
  assert.match(hook, /fabricanteId: normalizedManufacturerId/);
  assert.match(hook, /MODULE_ROUTES\.tickets\.get/);
  assert.match(hook, /MODULE_ROUTES\.config\.get/);
  assert.match(hook, /DEFAULT_CC_EMAILS/);
  assert.match(hook, /fetchClientRelations/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /existingEvidenceCount/);
  assert.match(hook, /setAllEquipmentLocations/);
});

test('la página conecta búsqueda remota y mantiene etiquetas históricas', () => {
  const page = source('src/pages/tickets/TicketFormPage.jsx');
  const select = source('src/components/forms/DependentSelect.jsx');

  assert.match(page, /onSearch=\{searchClients\}/);
  assert.match(page, /selectedLabel=\{form\.cliente\}/);
  assert.match(page, /selectedLabel=\{form\.fabricante\}/);
  assert.match(page, /selectedLabel=\{form\.modelo\}/);
  assert.match(page, /loading=\{catalogLoading\.manufacturers\}/);
  assert.match(page, /loading=\{catalogLoading\.models\}/);
  assert.match(select, /onSearch/);
  assert.match(select, /searchDelay = 300/);
  assert.match(select, /selectedLabel = ''/);
  assert.match(select, /window\.setTimeout/);
});

test('la creación rápida conserva todos los tipos y actualiza el catálogo local', () => {
  const hook = source('src/features/tickets/useTicketQuickCreate.js');
  const service = source('src/features/tickets/ticketQuickCreateService.js');

  assert.match(hook, /El nombre es obligatorio\./);
  assert.match(hook, /appendCatalog/);
  assert.match(hook, /appendRelation/);
  assert.match(hook, /INLINE_CATALOGS/);
  for (const type of ['location', 'equipment', 'supervisor', 'category', 'failure', 'device', 'manufacturer', 'model']) {
    assert.match(service, new RegExp(`type === '${type}'`));
  }
  assert.match(service, /MODULE_ROUTES\.deviceManufacturers\.create/);
  assert.match(service, /tipoDispositivoId: form\.tipoDispositivoId/);
  assert.match(service, /fabricanteId: form\.fabricanteId/);
  assert.match(service, /recibeCorreo: true/);
});

test('la persistencia conserva autosave, archivos y acciones finales', () => {
  const hook = source('src/features/tickets/useTicketPersistence.js');
  const service = source('src/features/tickets/ticketPersistenceService.js');

  assert.match(hook, /1800/);
  assert.match(hook, /validateTicketForm/);
  assert.match(hook, /Registre la firma antes de continuar\./);
  assert.match(hook, /await clearDraft\(\)/);
  assert.match(hook, /await deleteDraft\(recoveryDraftKey\)/);
  assert.match(hook, /recoveryRoute = editing \? `\/boletas\/\$\{boletaUid\}\/editar` : '\/boletas\/nueva'/);
  const controlledDelete = hook.indexOf('await clearDraft()');
  const routeDelete = hook.indexOf('await deleteDraft(recoveryDraftKey)');
  const navigation = hook.indexOf('navigate(`/boletas/${encodeURIComponent(uid)}`)');
  assert.ok(controlledDelete >= 0 && routeDelete > controlledDelete, 'La captura por ruta debe limpiarse después del borrador controlado');
  assert.ok(navigation > routeDelete, 'La navegación debe esperar a que ambos borradores hayan sido eliminados');
  assert.match(service, /MODULE_ROUTES\.tickets\.autosave/);
  assert.match(service, /MODULE_ROUTES\.tickets\.signatureUpload/);
  assert.match(service, /MODULE_ROUTES\.tickets\.evidenceUpload/);
  assert.match(service, /EVIDENCE_UPLOAD_CONCURRENCY = 3/);
  assert.match(service, /binaryConfirmed/);
  assert.match(service, /mapWithConcurrency/);
  assert.match(service, /for \(const entry of pending\)/);
  assert.match(service, /fileToBase64/);
  assert.match(service, /MODULE_ROUTES\.tickets\.finalize/);
  assert.match(service, /MODULE_ROUTES\.tickets\.testFinalize/);
  assert.match(service, /MODULE_ROUTES\.tickets\.generatePdf/);
});

test('la creación de boletas bloquea dobles toques y reutiliza el mismo identificador antes de consumir un consecutivo', () => {
  const hook = source('src/features/tickets/useTicketPersistence.js');
  const backend = source('backend/src/modules/tickets.module.js');

  assert.match(hook, /const createTicketUidRef = useRef\(''\)/);
  assert.match(hook, /const createActionInFlightRef = useRef\(false\)/);
  assert.match(hook, /createTicketUidRef\.current = createLocalId\('boleta'\)/);
  assert.match(hook, /if \(!editing && createActionInFlightRef\.current\) return null/);
  assert.match(hook, /if \(!editing\) createActionInFlightRef\.current = true/);
  assert.match(hook, /boletaUid: editing \? boletaUid : createTicketUidRef\.current/);
  assert.match(hook, /if \(!editing\) createActionInFlightRef\.current = false/);
  assert.match(hook, /if \(editing \|\| !completed\)/);

  const existingCheck = backend.indexOf('const existing = rows.find');
  const consecutiveAssignment = backend.indexOf('BoletaID: nextTicketNumber(rows)');
  assert.ok(existingCheck >= 0, 'El backend debe buscar primero una boleta con el BoletaUID solicitado');
  assert.ok(consecutiveAssignment > existingCheck, 'La deduplicación debe ocurrir antes de asignar un consecutivo nuevo');
  assert.match(backend, /if \(existing\) \{/);
  assert.match(backend, /return enrichTicket\(existing\)/);
});