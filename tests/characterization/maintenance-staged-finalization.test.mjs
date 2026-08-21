import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la finalización escalonada usa almacenamiento persistente por job e item', () => {
  const tables = source('backend/src/config/tables.js');
  const storage = source('backend/src/services/maintenance-finalization-job.storage.js');
  assert.match(tables, /MaintenanceFinalizationJobs:\s*\{ id: 'JobID' \}/);
  assert.match(tables, /MaintenanceFinalizationItems:\s*\{ id: 'ItemID' \}/);
  assert.match(storage, /export const FINALIZATION_JOB_SHEET = 'MaintenanceFinalizationJobs'/);
  assert.match(storage, /export const FINALIZATION_ITEM_SHEET = 'MaintenanceFinalizationItems'/);
  assert.match(storage, /createFinalizationItemId\(jobId, type, referenceId, part = 1\)/);
  assert.match(storage, /summarizeFinalizationItems/);
});

test('la capa escalonada se instala después del optimizador anterior', () => {
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');
  const optimized = resume.indexOf("await import('./maintenance-finalization-performance.patch.js')");
  const staged = resume.indexOf("await import('./maintenance-staged-finalization.patch.js')");
  assert.ok(optimized >= 0);
  assert.ok(staged > optimized);
});

test('el clic de finalizar inicia un job y no espera todos los PDF', () => {
  const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');
  assert.match(staged, /enqueueJob\(ctx, id, state\.job\.JobID\)/);
  assert.match(staged, /message: 'La finalización escalonada quedó iniciada/);
  assert.match(staged, /continue: true/);
  assert.doesNotMatch(staged, /runResumableMaintenanceFinalization/);
});

test('el scheduler procesa una boleta por unidad y Drive en lotes acotados', () => {
  const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');
  const tickets = source('backend/src/services/maintenance-staged-ticket.service.js');
  const delivery = source('backend/src/services/maintenance-staged-delivery.service.js');
  assert.match(staged, /processStagedTicketItem\(ctx, id, item\.ReferenciaID\)/);
  assert.match(staged, /MAINTENANCE_FINALIZATION_DRIVE_ITEMS_PER_STEP/);
  assert.match(staged, /MAINTENANCE_FINALIZATION_DRIVE_MAX_IMAGES_PER_STEP/);
  assert.match(tickets, /export async function processStagedTicketItem/);
  assert.match(delivery, /MAINTENANCE_FINALIZATION_DRIVE_IMAGE_CHUNK/);
  assert.match(delivery, /export async function processStagedDriveItem/);
});

test('errores transitorios se aíslan al item y tienen reintento automático limitado', () => {
  const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');
  assert.match(staged, /MAINTENANCE_FINALIZATION_AUTO_RETRY_MAX/);
  assert.match(staged, /if \(transient && attempts < AUTO_RETRY_MAX\)/);
  assert.match(staged, /Estado: 'PENDIENTE'/);
  assert.match(staged, /Estado: 'ERROR'/);
  assert.match(staged, /resetErroredItems/);
});

test('el estado de progreso es liviano y reactiva el worker después de un reinicio', () => {
  const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  assert.match(staged, /ctx\.payload\?\.finalizationStatusOnly/);
  assert.match(staged, /enqueueJob\(ctx, id, job\.JobID\)/);
  assert.match(center, /finalizationStatusOnly: true/);
  assert.match(center, /window\.setInterval\(refreshStatus, 5_000\)/);
  assert.doesNotMatch(center, /No cierre la aplicación/);
  assert.doesNotMatch(center, /maintenance-finalization-blocking/);
});

test('el progreso visible incluye contadores reales de boletas dispositivos y evidencias', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  assert.match(center, /FinalizacionBoletasCompletadas/);
  assert.match(center, /FinalizacionDispositivosCompletados/);
  assert.match(center, /FinalizacionEvidenciasProcesadas/);
  assert.match(center, /Boletas \{ticketDone\}\/\{ticketTotal\}/);
  assert.match(center, /Dispositivos \{deviceDone\}\/\{deviceTotal\}/);
  assert.match(center, /Evidencias \{evidenceDone\}\/\{evidenceTotal\}/);
});
