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
  assert.match(editor, /validateMaintenanceFaultDetails\(validatedDevice, \{ projectMode \}\)/);
  assert.match(editor, /!faultDetails\.valid/g);
  assert.match(editor, /showFaultSeverity && <div className="maintenance-device-fault-severity"/);
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
  assert.doesNotMatch(editor, /<Choice label="Estado"/);
  assert.match(editor, /Estado automático del dispositivo/);
  assert.match(editor, /next\.estado = effectiveMaintenanceDeviceState/);
  assert.match(editor, /if \(next\.estado === 'Correcto'\) next\.gravedadFalla = ''/);
  assert.match(editor, /Para guardar:/);
  assert.match(editor, /Gravedad seleccionada:/);
});

test('la gravedad participa en la resolución de conflictos y la confirmación usa el resultado del servidor', () => {
  const syncBase = source('src/services/maintenanceSyncBase.js');
  const syncBackend = source('backend/src/services/maintenance-sync-conflict.patch.js');
  const persistence = source('src/services/maintenanceDevicePersistence.js');
  assert.match(syncBase, /GravedadFalla: \['gravedadFalla'\]/);
  assert.match(syncBackend, /GravedadFalla: \['gravedadFalla'\]/);
  assert.match(persistence, /estado: saved\.Estado/);
  assert.match(persistence, /gravedadFalla: saved\.GravedadFalla/);
});

test('el catálogo administrativo controla la polaridad; el snapshot activo no toma configuración del cliente', () => {
  const admin = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const catalog = source('backend/src/services/maintenance-question-catalog.service.js');
  const backend = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  assert.match(admin, /Efecto en el estado automático/);
  assert.match(admin, /healthFailureAnswer: 'No'/);
  assert.match(admin, /healthFailureAnswer: 'Sí'/);
  assert.match(admin, /affectsDeviceHealth: false/);
  assert.match(catalog, /config: parseMaintenanceQuestionConfig\(question\.ConfiguracionJSON\)/);
  assert.match(backend, /La respuesta de falla debe ser Sí o No/);
});

test('observaciones inválidas muestran contador accesible y bloqueo visible en el pie sin cambiar la regla', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const css = source('src/styles/maintenance-device-mobile-ux.css');
  assert.match(editor, /observationLength = maintenanceFaultObservationLength\(device\.observacion\)/);
  assert.match(editor, /observationMinimum = MIN_MAINTENANCE_FAULT_OBSERVATION_LENGTH/);
  assert.match(editor, /Math\.max\(0, observationMinimum - observationLength\)/);
  assert.match(editor, /aria-describedby=\{faultyDevice \? observationHintId : undefined\}/);
  assert.match(editor, /\{observationLength\}\/\{observationMinimum\}/);
  assert.match(editor, /Longitud mínima cumplida/);
  assert.match(editor, /No se puede guardar el dispositivo/);
  assert.equal((editor.match(/aria-describedby=\{saveValidationDescription\}/g) || []).length, 3);
  assert.match(css, /\.maintenance-device-observations \.form-control\[aria-invalid="true"\]/);
  assert.match(css, /background: var\(--danger-soft\)/);
  assert.match(css, /\.maintenance-device-observation-feedback\.is-valid/);
});
