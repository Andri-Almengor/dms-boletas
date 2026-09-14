import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const storage = source('backend/src/services/maintenance-finalization-job.storage.js');
const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');

function functionBody(text, name, nextName) {
  const start = text.indexOf(`async function ${name}`);
  const end = text.indexOf(`async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `No se encontró ${name}`);
  assert.ok(end > start, `No se encontró el límite de ${name}`);
  return text.slice(start, end);
}

test('etapa 8 limita el snapshot de items a un solo paso del worker', () => {
  assert.match(storage, /new AsyncLocalStorage\(\)/);
  assert.match(storage, /export function runWithFinalizationItemStepSnapshot/);
  assert.match(storage, /finalizationItemStepStorage\.run\(\{ jobId: clean\(jobId\), items: null \}, operation\)/);
  assert.match(staged, /runWithFinalizationItemStepSnapshot\([\s\S]*?\(\) => stepJob\(entry\.ctx, entry\.maintenanceId, jobId\)/);
});

test('las escrituras de items actualizan el snapshot del paso sin volver a materializar toda la lista', () => {
  assert.match(storage, /if \(snapshot\?\.items\) return snapshot\.items/);
  assert.match(storage, /mergeFinalizationItemSnapshot\(snapshot\.items, \[updated\]\)/);
  assert.match(storage, /mergeFinalizationItemSnapshot\(items, jobUpdates\)/);
  assert.match(storage, /current\.push\(\.\.\.creates\)/);

  const ticketStep = functionBody(staged, 'processTicketStep', 'finishTicketPhase');
  const driveStep = functionBody(staged, 'processDriveStep', 'completeJob');
  assert.doesNotMatch(ticketStep, /listFinalizationItems\(/);
  assert.doesNotMatch(driveStep, /listFinalizationItems\(/);
  assert.match(ticketStep, /persistProgress\(ctx, id, job, items, 'BOLETAS'\)/);
  assert.match(driveStep, /persistProgress\(ctx, id, job, items, 'DRIVE'\)/);
});

test('stepJob hace una sola lectura de items y reutiliza ese snapshot para boletas Drive y cierre', () => {
  const step = functionBody(staged, 'stepJob', 'schedulerLoop');
  const reads = step.match(/listFinalizationItems\(job\.JobID\)/g) || [];
  assert.equal(reads.length, 1);
  assert.doesNotMatch(step, /items\s*=\s*await listFinalizationItems/);
  assert.match(step, /const items = await listFinalizationItems\(job\.JobID\)/);
  assert.match(step, /processTicketStep\(ctx, id, job, items\)/);
  assert.match(step, /processDriveStep\(ctx, id, job, items\)/);
  assert.match(step, /completeJob\(ctx, id, job, items\)/);
});

test('progreso estable no genera escrituras redundantes y cambios reales sí conservan persistencia durable', () => {
  const progress = functionBody(staged, 'persistProgress', 'markJobError');
  assert.match(staged, /function progressStateChanged/);
  assert.match(progress, /if \(!changed && !explicitPatch\) return \{ summary, progress, step, message, skipped: true \}/);
  assert.match(progress, /summary\.completedTickets/);
  assert.match(progress, /summary\.completedDevices/);
  assert.match(progress, /summary\.processedEvidences/);
  assert.match(progress, /summary\.totalTickets/);
  assert.match(progress, /summary\.totalDevices/);
  assert.match(progress, /summary\.totalEvidences/);

  const maintenanceWrite = progress.indexOf("await updateRow('Mantenimiento'");
  const jobWrite = progress.indexOf('await updateFinalizationJob(job.JobID');
  assert.ok(maintenanceWrite >= 0 && jobWrite > maintenanceWrite, 'Mantenimiento debe persistirse antes del job marcador');
});

test('la optimización mantiene recuperación por job/item y las salidas finales existentes', () => {
  assert.match(staged, /findFinalizationJobForMaintenance/);
  assert.match(staged, /resetErroredItems/);
  assert.match(staged, /processStagedTicketItem/);
  assert.match(staged, /processStagedDriveItem/);
  assert.match(staged, /finalizeStagedMaintenanceDelivery/);
  assert.match(staged, /ctx\.payload\?\.finalizationStatusOnly/);
  assert.match(staged, /enqueueJob\(ctx, id, job\.JobID\)/);
  assert.match(staged, /Estado: 'FINALIZADO'/);
  assert.match(staged, /EstadoNotificacion: delivery\.notificationState/);
  assert.match(staged, /ImagenesCopiadas: summary\.copied/);
  assert.match(staged, /FirmaEstadoFinalizacion/);
});

test('la suite acumulativa sigue cubriendo fallo reanudación Drive firma correo Chat y PDF', () => {
  const all = source('tests/characterization/all.test.mjs');
  for (const required of [
    'maintenance-staged-finalization.test.mjs',
    'maintenance-finalization-stop-control.test.mjs',
    'maintenance-drive-archive.test.mjs',
    'maintenance-optional-signature-finalization.test.mjs',
    'maintenance-progress-chat.test.mjs',
    'maintenance-ticket-report-quality.test.mjs',
    'normal-ticket-email-only.test.mjs',
    'offline-finalization-resume.test.mjs',
  ]) {
    assert.match(all, new RegExp(required.replaceAll('.', '\\.')));
  }
});
