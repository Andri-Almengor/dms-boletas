import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  EMPTY_MAINTENANCE,
  isProjectMaintenance,
  maintenancePayload,
  mapMaintenance,
  normalizeMaintenanceType,
} from '../../src/pages/maintenance/maintenanceFormData.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('mantiene MANTENIMIENTO como modo histórico y acepta PROYECTO explícito', () => {
  assert.equal(normalizeMaintenanceType(''), 'MANTENIMIENTO');
  assert.equal(normalizeMaintenanceType('mantenimiento'), 'MANTENIMIENTO');
  assert.equal(normalizeMaintenanceType('proyecto'), 'PROYECTO');
  assert.equal(isProjectMaintenance('PROYECTO'), true);
  assert.equal(isProjectMaintenance('MANTENIMIENTO'), false);
  assert.equal(EMPTY_MAINTENANCE.tipoMantenimiento, 'MANTENIMIENTO');

  assert.equal(mapMaintenance({ mantenimiento: { MantenimientoID: 'M-1' } }).tipoMantenimiento, 'MANTENIMIENTO');
  assert.equal(mapMaintenance({ mantenimiento: { TipoMantenimiento: 'PROYECTO' } }).tipoMantenimiento, 'PROYECTO');

  const payload = maintenancePayload({ ...EMPTY_MAINTENANCE, titulo: 'Proyecto Zeus', tipoMantenimiento: 'PROYECTO' }, 'M-2');
  assert.equal(payload.TipoMantenimiento, 'PROYECTO');
  assert.equal(payload.tipoMantenimiento, 'PROYECTO');
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
  assert.match(service, /maintenanceQuestionAppliesTo/);
  assert.match(module, /assertMaintenanceDeviceType\(relatedTypeId\)/);
  assert.match(module, /Las relaciones con otros dispositivos deben aplicarse a Proyecto o Ambos/);
  assert.match(hook, /question\.appliesTo === 'AMBOS' \|\| question\.appliesTo === requestedMode/);
  assert.match(admin, /Relacionar otro dispositivo/);
  assert.match(admin, /camposRelacionados/);
  assert.match(admin, /TipoDispositivoRelacionadoID/);
  assert.match(syncBase, /TipoMantenimiento: \['tipoMantenimiento', 'maintenanceType'\]/);
  assert.match(conflictPatch, /TipoMantenimiento: \['tipoMantenimiento', 'maintenanceType'\]/);
});
