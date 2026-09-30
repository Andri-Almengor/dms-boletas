import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Project progress checklist uses additive columns instead of parallel storage', () => {
  const migration = source('backend/migrations/019_maintenance_project_progress_checklist.sql');
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "ProyectoChecklistJSON"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "ProyectoProgresoJSON"'));
  assert.equal(/CREATE\s+TABLE/i.test(migration), false);
});

test('Project checklist reuses existing maintenance and device write routes', () => {
  const api = source('src/services/moduleApi.js');
  const form = source('src/pages/maintenance/maintenanceFormData.js');
  assert.ok(form.includes('ProyectoChecklistJSON'));
  assert.ok(form.includes('ProyectoProgresoJSON'));
  assert.equal(api.includes('maintenance.projectChecklist.'), false);
  assert.equal(api.includes('maintenance.projectProgress.'), false);
});

test('Project checklist is configured from selected device groups and locked after devices exist', () => {
  const page = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const counts = source('src/components/maintenance/MaintenanceCountsStep.jsx');
  const builder = source('src/components/maintenance/MaintenanceProjectChecklistBuilder.jsx');
  const backend = source('backend/src/modules/maintenance.module.js');

  assert.ok(page.includes('projectChecklistLocked={editing && state.devices.length > 0}'));
  assert.ok(counts.includes('<MaintenanceProjectChecklistBuilder'));
  assert.ok(builder.includes("Pendiente / Realizado"));
  assert.ok(builder.includes("Sí / No"));
  assert.ok(builder.includes('selectedCategories(categories, counts)'));
  assert.ok(builder.includes('Number(counts?.[item.countField] || 0) > 0'));
  assert.ok(backend.includes('No se puede modificar el checklist de progreso del Proyecto después de registrar dispositivos'));
  assert.ok(backend.includes('sameProjectChecklist(before.ProyectoChecklistJSON'));
});

test('Project device progress supports pending notes without blocking device save', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const progress = source('src/components/maintenance/MaintenanceProjectProgressChecklist.jsx');

  assert.ok(editor.includes('<MaintenanceProjectProgressChecklist'));
  assert.ok(editor.includes("projectProgress?.total > 0 && !projectProgress.complete"));
  assert.ok(progress.includes('Nota del pendiente'));
  assert.ok(progress.includes("['PENDIENTE', 'REALIZADO']"));
  assert.ok(progress.includes("['SI', 'NO']"));

  const submitExpression = editor.slice(editor.indexOf('const submitDisabled'), editor.indexOf('return <div className="maintenance-device-editor"'));
  assert.equal(submitExpression.includes('projectProgress'), false);
});

test('Project progress participates in sync conflicts and offline maintenance payloads', () => {
  const sync = source('src/services/maintenanceSyncBase.js');
  const conflicts = source('backend/src/services/maintenance-sync-conflict.patch.js');
  const api = source('src/services/moduleApi.js');

  assert.ok(sync.includes("ProyectoChecklistJSON: ['projectChecklist']"));
  assert.ok(sync.includes("ProyectoProgresoJSON: ['projectProgress', 'proyectoProgreso']"));
  assert.ok(conflicts.includes("ProyectoChecklistJSON: ['projectChecklist']"));
  assert.ok(conflicts.includes("ProyectoProgresoJSON: ['projectProgress', 'proyectoProgreso']"));
  assert.ok(api.includes('...payload'));
  assert.ok(api.includes('...result'));
});

test('Project detail and review expose progress while maintenance normal remains separate', () => {
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const review = source('src/components/maintenance/MaintenanceReviewStep.jsx');

  assert.ok(detail.includes('ProyectoChecklistJSON'));
  assert.ok(inventory.includes('<MaintenanceProjectProgressChecklist'));
  assert.ok(review.includes('projectChecklistOverallProgress'));
  assert.ok(review.includes('progreso checklist'));
  assert.ok(inventory.includes('projectMode'));
});
