import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Stage 6 reuses PREPARE operations and never exposes COMMIT to Gemini', () => {
  const tools = source('backend/src/ai/agent.tools.js');
  const operations = source('backend/src/ai/agent.repository.operations.js');

  assert.ok(tools.includes("prepare_maintenance_device_bulk_create:fn"));
  assert.ok(tools.includes("prepare_maintenance_project_device_update:fn"));
  assert.ok(tools.includes("prepare_maintenance_evidence_upload:fn"));
  assert.equal(/commit_maintenance_project/i.test(tools), false);
  assert.ok(operations.includes('modelCanCommit:false'));
  assert.ok(operations.includes("MAINTENANCE_PROJECT_DEVICE_UPDATE"));
});

test('Project device edits revalidate catalogs questions evidence ownership and concurrency', () => {
  const operations = source('backend/src/ai/agent.repository.operations.js');
  const dynamic = source('backend/src/modules/maintenance-dynamic-questions.module.js');

  assert.ok(operations.includes('readMaintenanceQuestions'));
  assert.ok(operations.includes('resolveManufacturerModel'));
  assert.ok(operations.includes('prepareProjectAnswerStructure'));
  assert.ok(operations.includes('projectComponentEvidence'));
  assert.ok(operations.includes('deviceFingerprint(current)'));
  assert.ok(operations.includes('AI_OPERATION_CONFLICT'));
  assert.ok(operations.includes('maintenanceProgressChatHandlers.deviceUpdate'));
  assert.ok(dynamic.includes('assertProjectEvidenceTargetsStillExist'));
});

test('Project evidence PREPARE uses the existing evidence policy and component identity', () => {
  const operations = source('backend/src/ai/agent.repository.operations.js');

  assert.ok(operations.includes('projectMaintenanceComponentsFromAnswers'));
  assert.ok(operations.includes('loadMaintenanceEvidenceContext'));
  assert.ok(operations.includes('maintenanceEvidenceMetadata'));
  assert.ok(operations.includes("Los Proyectos no usan ANTES/DESPUÉS"));
  assert.ok(operations.includes('ProyectoComponenteLocalID'));
  assert.ok(operations.includes('capturedAt:upload.capturedAt||nowIso()'));
});

test('AI commits explicitly emit maintenance SyncChanges and audit sensitive actions', () => {
  const operations = source('backend/src/ai/agent.repository.operations.js');

  assert.ok(operations.includes('recordClassifiedSyncChange'));
  assert.ok(operations.includes("resource:'maintenance'"));
  assert.ok(operations.includes("route:'ai.operation.commit'"));
  assert.ok(operations.includes('AI_MAINTENANCE_DEVICE_BULK_CREATE'));
  assert.ok(operations.includes('AI_MAINTENANCE_PROJECT_DEVICE_UPDATE'));
  assert.ok(operations.includes('AI_MAINTENANCE_EVIDENCE_UPLOAD'));
});

test('shared maintenance device persistence keeps MAC for every surface', () => {
  const maintenance = source('backend/src/modules/maintenance.module.js');
  const automation = source('backend/src/modules/maintenance-automation.module.js');

  assert.ok(maintenance.includes("DireccionMAC: pick(payload, ['DireccionMAC', 'macAddress', 'mac'], before.DireccionMAC)"));
  assert.ok(automation.includes("DireccionMAC: pick(ctx.payload, ['DireccionMAC', 'macAddress', 'mac'])"));
});

test('failed COMMIT does not remain permanently COMMITTING', () => {
  const operations = source('backend/src/ai/agent.repository.operations.js');

  assert.match(operations, /catch\(error\)\{\s*await finishOperation\(operationId,'FAILED'/);
  assert.ok(operations.includes("code:clean(error?.code||'AI_OPERATION_FAILED'"));
});
