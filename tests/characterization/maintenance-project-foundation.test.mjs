import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  isProjectMaintenance,
  normalizeMaintenanceType,
} from '../../src/features/maintenance/maintenanceType.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('mantiene MANTENIMIENTO como modo histórico y acepta PROYECTO explícito', () => {
  assert.equal(normalizeMaintenanceType(''), 'MANTENIMIENTO');
  assert.equal(normalizeMaintenanceType('mantenimiento'), 'MANTENIMIENTO');
  assert.equal(normalizeMaintenanceType('proyecto'), 'PROYECTO');
  assert.equal(isProjectMaintenance('PROYECTO'), true);
  assert.equal(isProjectMaintenance('MANTENIMIENTO'), false);
  const formData = source('src/pages/maintenance/maintenanceFormData.js');
  assert.match(formData, /tipoMantenimiento: 'MANTENIMIENTO'/);
  assert.match(formData, /tipoMantenimiento: normalizeMaintenanceType/);
  assert.match(formData, /TipoMantenimiento: normalizeMaintenanceType\(form\.tipoMantenimiento\)/);
});

test('la migración agrega el tipo de mantenimiento y metadatos configurables sin cambiar migraciones aplicadas', () => {
  const migration = source('backend/migrations/016_maintenance_project_foundation.sql');
  assert.match(migration, /"TipoMantenimiento"/);
  assert.match(migration, /"AplicaModo"/);
  assert.match(migration, /"TipoDispositivoRelacionadoID"/);
  assert.match(migration, /"ConfiguracionJSON"/);
  assert.match(migration, /MANTENIMIENTO/);
});

test('las preguntas reutilizan el catálogo existente y aíslan relaciones de Proyecto', () => {
  const service = source('backend/src/services/maintenance-question-catalog.service.js');
  const module = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  const hook = source('src/hooks/useMaintenanceQuestionCatalog.js');
  const admin = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const syncBase = source('src/services/maintenanceSyncBase.js');
  const conflictPatch = source('backend/src/services/maintenance-sync-conflict.patch.js');

  assert.match(service, /RELACION_DISPOSITIVO/);
  assert.match(service, /OPCIONES/);
  assert.match(service, /maintenanceQuestionAppliesTo/);
  assert.match(module, /assertMaintenanceDeviceType\(relatedTypeId\)/);
  assert.match(module, /resolveMaintenanceModeForDevice/);
  assert.match(module, /maintenance\?\.TipoMantenimiento/);
  assert.match(module, /Las relaciones con otros dispositivos deben aplicarse a Proyecto o Ambos/);
  assert.match(hook, /question\.appliesTo === 'AMBOS' \|\| question\.appliesTo === requestedMode/);
  assert.match(admin, /Relacionar otro dispositivo/);
  assert.match(admin, /Lista de opciones/);
  assert.match(admin, /camposRelacionados/);
  assert.match(admin, /TipoDispositivoRelacionadoID/);
  assert.match(syncBase, /TipoMantenimiento: \['tipoMantenimiento', 'maintenanceType'\]/);
  assert.match(conflictPatch, /TipoMantenimiento: \['tipoMantenimiento', 'maintenanceType'\]/);
});
