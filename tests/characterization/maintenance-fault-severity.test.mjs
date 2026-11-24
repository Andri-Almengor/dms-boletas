import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
}

test('la gravedad persiste en PostgreSQL, la conversión del dispositivo y SyncChanges existente', () => {
  const sql = source('backend/migrations/025_maintenance_device_fault_severity.sql');
  const catalog = source('backend/src/config/database-tables.js');
  const mapping = source('src/pages/maintenance/maintenanceFormData.js');
  const backend = source('backend/src/modules/maintenance.module.js');
  const sync = source('src/services/maintenanceDevicePersistence.js');
  assert.match(sql, /ALTER TABLE "Evidencia_Mantenimientos"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "GravedadFalla" TEXT/);
  assert.match(catalog, /GravedadFalla/);
  assert.match(mapping, /gravedadFalla: normalizeMaintenanceFaultSeverity/);
  assert.match(mapping, /GravedadFalla: normalizeMaintenanceFaultSeverity/);
  assert.match(backend, /GravedadFalla: normalizeMaintenanceFaultSeverity/);
  assert.match(backend, /assertMaintenanceDeviceFaultDetails\(maintenance, payload\)/);
  assert.match(backend, /assertMaintenanceDeviceFaultDetails\(maintenance, devicePayload\(nextPayload, before\)\)/);
  assert.match(sync, /maintenanceDevicePayload\(requestDevice, maintenanceId\)/);
});

test('se exige en ambos botones del editor, pero no en proyectos; observación indica regla', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  assert.match(editor, /validateMaintenanceFaultDetails\(device, \{ projectMode \}\)/);
  assert.match(editor, /!faultDetails\.valid/g);
  assert.match(editor, /faultyDevice && <div className="maintenance-device-fault-severity"/);
  assert.match(editor, /options=\{MAINTENANCE_FAULT_SEVERITIES\}/);
  assert.match(editor, /Observación \*/);
});

test('el Excel agrega lista desplegable y valida falla sin romper lectura de plantillas anteriores', () => {
  const excel = source('src/features/maintenance/maintenanceDeviceExcel.js');
  assert.match(excel, /addList\('GRAVEDAD_FALLA', MAINTENANCE_FAULT_SEVERITIES\)/);
  assert.match(excel, /column: 11, list: 'GRAVEDAD_FALLA'/);
  assert.match(excel, /validateMaintenanceFaultDetails\(draft/);
  assert.match(excel, /name !== 'Gravedad de falla'/);
  assert.match(excel, /field\('Gravedad de falla'\)/);
});


test('el backend reevalúa el estado con la checklist y valida la gravedad resultante antes de persistir', () => {
  const domain = source('src/utils/maintenanceChecklistStatus.js');
  const backend = source('backend/src/modules/maintenance.module.js');
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  assert.match(domain, /export function maintenanceChecklistHealthFaults/);
  assert.match(domain, /if \(maintenanceChecklistHealthFaults\(device, fallbackQuestions\)\.length\) return 'Mal estado'/);
  assert.match(backend, /effectiveMaintenanceDeviceState\(\{/);
  assert.match(backend, /Estado: deviceState/);
  assert.match(backend, /assertMaintenanceDeviceFaultDetails\(maintenance, payload\)/);
  assert.match(backend, /assertMaintenanceDeviceFaultDetails\(maintenance, devicePayload\(nextPayload, before\)\)/);
  assert.match(editor, /disabledOptions=\{checklistHealthFaults\.length \? \['Correcto'\] : \[\]\}/);
  assert.match(editor, /Para guardar:/);
  assert.match(editor, /Gravedad seleccionada:/);
});
