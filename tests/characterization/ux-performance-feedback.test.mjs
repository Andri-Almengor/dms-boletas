import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las evidencias intentan primero el thumbnail y deduplican el fallback protegido', () => {
  const contents = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');
  assert.match(contents, /const \[source, setSource\] = useState\(initialSource\)/);
  assert.match(contents, /onError=\{\(\) => \{/);
  assert.match(contents, /protectedMediaCache/);
  assert.match(contents, /protectedMediaRequests/);
  assert.doesNotMatch(contents, /isProtectedGoogleUrl/);
});

test('el mantenimiento muestra ubicaciones conocidas antes de terminar la relación del cliente', () => {
  const resources = source('src/features/maintenance/useMaintenanceResources.js');
  const quickCreator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(resources, /initialEquipmentFromDevices/);
  assert.match(resources, /setAllEquipment\(initialEquipmentFromDevices\(mappedDevices, mappedForm\)\)/);
  assert.match(quickCreator, /if \(initialEquipmentLocation\?\.id\) \{/);
  assert.match(quickCreator, /mergeEquipmentOptions\(locationId\)\.catch/);
});

test('los fabricantes se precargan sin bloquear la apertura del formulario', () => {
  const contents = source('src/features/tickets/useTicketFormResources.js');
  assert.match(contents, /manufacturerMasterStatus/);
  assert.match(contents, /Se inicia al abrir el formulario, sin retrasar la pantalla inicial/);
  assert.match(contents, /manufacturersForType/);
  assert.match(contents, /Respaldo para una precarga fallida/);
});

test('las operaciones largas muestran una pantalla bloqueante con contexto', () => {
  const overlay = source('src/components/feedback/ProcessingOverlay.jsx');
  const ticket = source('src/pages/tickets/TicketFormPage.jsx');
  const maintenance = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const location = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const inlineModal = source('src/components/forms/InlineCreateModal.jsx');

  assert.match(overlay, /aria-busy="true"/);
  assert.match(ticket, /title="Finalizando boleta"|Finalizando boleta/);
  assert.match(ticket, /<ProcessingOverlay open=\{saving\}/);
  assert.match(maintenance, /Guardando dispositivo/);
  assert.match(maintenance, /Finalizando mantenimiento/);
  assert.match(location, /title="Agregando ubicación"/);
  assert.match(inlineModal, /title="Guardando registro"/);
});

test('el inventario móvil conserva nombres completos y separa identidad, estado y acciones', () => {
  const styles = source('src/styles/maintenance-inventory-mobile.css');
  const index = source('src/styles/index.css');

  assert.match(index, /maintenance-inventory-mobile\.css/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /grid-template-columns: 48px minmax\(0, 1fr\) 32px/);
  assert.match(styles, /white-space: normal !important/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /\.maintenance-inventory-mobile-edit/);
  assert.match(styles, /padding-bottom: calc\(var\(--bottom-nav-height\)/);
});
