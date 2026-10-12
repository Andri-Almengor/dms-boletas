import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MAX_BULK_MAINTENANCE_DEVICES,
  parseBulkMaintenanceDeviceNames,
} from '../../src/features/maintenance/maintenanceDeviceState.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('acepta nombres separados por tabulaciones, saltos de línea y CRLF sin perder espacios internos', () => {
  assert.deepEqual(
    parseBulkMaintenanceDeviceNames('  Cámara uno\tcamara dos\r\ncamara tres\n\n\tPuerta de emergencia  '),
    ['Cámara uno', 'camara dos', 'camara tres', 'Puerta de emergencia'],
  );
  assert.deepEqual(parseBulkMaintenanceDeviceNames('\t\n \t '), []);
  assert.deepEqual(parseBulkMaintenanceDeviceNames(null), []);
  assert.deepEqual(parseBulkMaintenanceDeviceNames('Cámara uno\tCámara uno'), ['Cámara uno', 'Cámara uno']);
  assert.ok(MAX_BULK_MAINTENANCE_DEVICES >= 54);
});

test('ofrece creación masiva en las tarjetas de ubicación para mantenimiento y proyecto', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  assert.match(inventory, /onAddDeviceList/);
  assert.match(inventory, /onAddDeviceList\(group\)/);
  assert.match(inventory, /pending && canEdit/);
  assert.match(inventory, /group\.available && !group\.legacy/);
  assert.match(detail, /onAddDeviceList=\{\(location\) => addDevice\(location, true\)\}/);
  assert.match(detail, /bulk=\{quickDeviceBulk\}/);
  assert.match(detail, /availableDeviceTypes=\{maintenanceCatalogs\.deviceTypes\}/);
});

test('registra solo nombre, tipo, ubicación y defaults pendientes por el alta existente con IDs estables', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  assert.match(creator, /createMaintenanceDevice\(bulkSelectedType\.key, maintenanceType\)/);
  assert.match(creator, /nombre: item\.name/);
  assert.match(creator, /tipoDispositivoId: String\(bulkSelectedType\.typeId/);
  assert.match(creator, /ubicacionEquipoId: bulkLocationId/);
  assert.match(creator, /maintenanceDevicePayload\(draft, maintenanceId, maintenanceType\)/);
  assert.match(creator, /MODULE_ROUTES\.maintenance\.deviceCreate/);
  assert.match(creator, /id: createLocalId\('dispositivo'\)/);
  assert.match(creator, /if \(item\.done\) continue/);
  assert.match(creator, /setBulkEntries\(entries\.map/);
  assert.match(creator, /responseIsOfflinePending\(result\)/);
  assert.match(creator, /setBulkOfflinePending/);
  assert.match(creator, /selectedMaintenanceCategories/);
  assert.match(creator, /MAX_BULK_MAINTENANCE_DEVICES/);
  const defaults = source('src/pages/maintenance/maintenanceFormData.js');
  assert.match(defaults, /estado: AUTOMATIC_PENDING_STATE/);
  assert.match(defaults, /respuestas: createEmptyChecklist\(canonicalCategory\)/);
});

test('sin rutas, permisos ni flujo offline paralelo: reutiliza los existentes y conserva edición individual', () => {
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const routes = source('src/services/moduleApi.js');
  const styles = source('src/styles/maintenance-device-mobile-ux.css');
  assert.match(routes, /maintenanceDeviceCreate/);
  assert.match(routes, /queueOfflineWrite/);
  assert.match(creator, /<MaintenanceDeviceEditor/);
  assert.match(creator, /await onCreated\?\.\(feedback\)/);
  assert.match(styles, /maintenance-bulk-device-form__fields/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
