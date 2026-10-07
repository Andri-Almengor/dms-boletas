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

test('Project checklist stays editable after devices exist and reuses the existing maintenance update', () => {
  const page = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const counts = source('src/components/maintenance/MaintenanceCountsStep.jsx');
  const builder = source('src/components/maintenance/MaintenanceProjectChecklistBuilder.jsx');
  const backend = source('backend/src/modules/maintenance.module.js');

  assert.ok(counts.includes('<MaintenanceProjectChecklistBuilder'));
  assert.ok(builder.includes("Pendiente / Realizado"));
  assert.ok(builder.includes("Sí / No"));
  assert.ok(builder.includes('selectedCategories(categories, counts)'));
  assert.ok(builder.includes('Number(counts?.[item.countField] || 0) > 0'));
  assert.equal(page.includes('projectChecklistLocked='), false);
  assert.equal(counts.includes('projectChecklistLocked'), false);
  assert.equal(builder.includes('locked = false'), false);
  assert.equal(backend.includes('No se puede modificar el checklist de progreso del Proyecto después de registrar dispositivos'), false);
  assert.ok(backend.includes("await audit(ctx, 'EDITAR_MANTENIMIENTO'"));
});

test('Project checklist uses the shared surface tokens in dark mode instead of light-only fallbacks', () => {
  const styles = source('src/styles/maintenance-project.css');
  const start = styles.indexOf('/* Per-project progress checklist */');
  const end = styles.indexOf('/* Dedicated project-device route.', start);
  const checklistStyles = styles.slice(start, end);

  assert.ok(checklistStyles.includes('background: var(--surface-card, #fff);'));
  assert.ok(checklistStyles.includes('background: var(--surface-low, #f8fafc);'));
  assert.ok(checklistStyles.includes('border: 1px solid var(--outline-soft, #dfe3e8);'));
  assert.equal(checklistStyles.includes('var(--surface-subtle'), false);
  assert.equal(checklistStyles.includes('var(--text-muted'), false);
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
  const projectDetail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');
  const review = source('src/components/maintenance/MaintenanceReviewStep.jsx');
  const progressSummary = source('src/components/maintenance/MaintenanceDeviceProgressSummary.jsx');

  assert.ok(detail.includes('ProyectoChecklistJSON'));
  assert.ok(projectDetail.includes('<MaintenanceProjectProgressChecklist'));
  assert.ok(review.includes('projectChecklistOverallProgress'));
  assert.ok(review.includes('MaintenanceDeviceProgressSummary'));
  assert.ok(progressSummary.includes('progreso checklist'));
  assert.ok(inventory.includes('projectMode'));
});


test('quick device creation receives the same Project checklist as the full form', () => {
  const quick = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');

  assert.ok(quick.includes('normalizeProjectChecklist'));
  assert.ok(quick.includes("pick(row, ['ProyectoChecklistJSON']"));
  assert.ok(quick.includes('projectChecklist={projectChecklist}'));
  assert.ok(form.includes('projectChecklist={state.form.projectChecklist}'));
});


test('backend remains authoritative for Project pending state', () => {
  const backend = source('backend/src/modules/maintenance.module.js');
  const policy = source('backend/src/services/maintenance-project-checklist.service.js');

  assert.ok(policy.includes('projectDeviceProgressSummary'));
  assert.ok(backend.includes("progress.hasChecklist && !progress.complete ? { Estado: 'Pendiente' }"));
  assert.ok((backend.match(/projectDeviceProgressSummary/g) || []).length >= 4);
});
