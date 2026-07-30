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

test('los recursos conservan ocho catálogos, detalle, configuración y relaciones cancelables', () => {
  const hook = source('src/features/tickets/useTicketFormResources.js');

  for (const key of ['clients', 'categories', 'failures', 'devices', 'manufacturers', 'models', 'relations', 'users']) {
    assert.match(hook, new RegExp(`\\['${key}'`));
  }
  assert.match(hook, /pageSize: 1000/);
  assert.match(hook, /MODULE_ROUTES\.tickets\.get/);
  assert.match(hook, /MODULE_ROUTES\.config\.get/);
  assert.match(hook, /DEFAULT_CC_EMAILS/);
  assert.match(hook, /fetchClientRelations/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /existingEvidenceCount/);
  assert.match(hook, /setAllEquipmentLocations/);
});

test('la creación rápida conserva todos los tipos y la relación de fabricante', () => {
  const hook = source('src/features/tickets/useTicketQuickCreate.js');
  const service = source('src/features/tickets/ticketQuickCreateService.js');

  assert.match(hook, /El nombre es obligatorio\./);
  assert.match(hook, /reloadCatalogs/);
  assert.match(hook, /appendRelation/);
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
  assert.match(service, /MODULE_ROUTES\.tickets\.autosave/);
  assert.match(service, /MODULE_ROUTES\.tickets\.signatureUpload/);
  assert.match(service, /MODULE_ROUTES\.tickets\.evidenceUpload/);
  assert.match(service, /for \(const item of evidences\)/);
  assert.match(service, /fileToBase64/);
  assert.match(service, /MODULE_ROUTES\.tickets\.finalize/);
  assert.match(service, /MODULE_ROUTES\.tickets\.testFinalize/);
  assert.match(service, /MODULE_ROUTES\.tickets\.generatePdf/);
});
