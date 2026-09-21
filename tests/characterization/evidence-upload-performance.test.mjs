import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la carga reanudable reduce viajes usando bloques de 4 MiB', () => {
  const client = source('src/services/largeEvidenceUpload.js');
  const backend = source('backend/src/services/large-evidence-upload.service.js');

  assert.match(client, /LARGE_EVIDENCE_THRESHOLD_BYTES = 4 \* 1024 \* 1024/);
  assert.match(client, /LARGE_EVIDENCE_CHUNK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(client, /init\?\.chunkBytes \|\| LARGE_EVIDENCE_CHUNK_BYTES/);
  assert.match(backend, /LARGE_VIDEO_THRESHOLD_BYTES = 4 \* 1024 \* 1024/);
  assert.match(backend, /LARGE_VIDEO_CHUNK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(backend, /findTicketEvidenceById/);
  assert.match(backend, /findMaintenanceEvidenceById/);
  assert.doesNotMatch(backend, /readTable\('EvidenciasBoleta', \{ force: true \}\)/);
  assert.doesNotMatch(backend, /readTable\('Mantenimiento imagenes', \{ force: true \}\)/);
});

test('boletas agrupan evidencias, suben a Drive con concurrencia acotada e insertan la base por lote', () => {
  const client = source('src/services/ticketEvidenceBatch.js');
  const backend = source('backend/src/modules/ticket-scalable-evidence.module.js');
  const router = source('backend/src/core/action-router.js');
  const syncRegistry = source('backend/src/services/sync-resource-registry.js');

  assert.match(client, /MAX_FILES_PER_REQUEST = 10/);
  assert.match(client, /MAX_RAW_BYTES_PER_REQUEST = 10 \* 1024 \* 1024/);
  assert.match(client, /mapFilesSequentially/);
  assert.match(client, /boletas\.evidence\.uploadBatch/);
  assert.match(backend, /mapWithConcurrency/);
  assert.match(backend, /env\.ticketEvidenceUploadConcurrency/);
  assert.match(backend, /appendRows\('EvidenciasBoleta'/);
  assert.match(backend, /ticketAccessHandlers\.assertTicketAccess/);
  assert.match(router, /ticketScalableEvidenceHandlers\.uploadBatch/);
  assert.match(router, /\['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR'\]/);
  assert.match(syncRegistry, /boletas\.evidence\.uploadBatch/);
  assert.match(syncRegistry, /tickets\.evidence\.uploadBatch/);
});

test('todos los flujos de boletas reutilizan el uploader rápido', () => {
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const multi = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');
  const persistence = source('src/features/tickets/ticketPersistenceService.js');

  assert.match(detail, /uploadTicketEvidenceItems/);
  assert.match(multi, /uploadTicketEvidenceItems/);
  assert.match(persistence, /uploadTicketEvidenceItems/);
  assert.match(persistence, /Promise\.all\(\[signatureTask, evidenceTask\]\)/);
  assert.doesNotMatch(multi, /for \(let index = 0; index < items\.length/);
});

test('mantenimientos usan lotes en edición, alta rápida y carga rápida de evidencias', () => {
  const batch = source('src/services/maintenanceImageBatch.js');
  const persistence = source('src/services/maintenanceDevicePersistence.js');
  const quickDevice = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const quickEvidence = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const backend = source('backend/src/modules/maintenance-scalable-images.module.js');

  assert.match(batch, /MAINTENANCE_BATCH_RESUMABLE_THRESHOLD_BYTES = MAX_RAW_BYTES_PER_REQUEST/);
  assert.match(batch, /thresholdBytes: MAINTENANCE_BATCH_RESUMABLE_THRESHOLD_BYTES/);
  assert.match(persistence, /Promise\.all\(\[/);
  assert.match(persistence, /updateMaintenanceImagesInBatches/);
  assert.match(persistence, /uploadMaintenanceImagesInBatches/);
  assert.match(quickDevice, /uploadMaintenanceImagesInBatches/);
  assert.match(quickEvidence, /uploadMaintenanceImagesInBatches/);
  assert.doesNotMatch(quickEvidence, /await requestAvailable\(\s*MODULE_ROUTES\.maintenance\.imageUpload/);
  assert.match(backend, /mapWithConcurrency/);
  assert.match(backend, /appendRows\('Mantenimiento imagenes'/);
  assert.match(backend, /TipoMedio: input\.mediaType/);
  assert.match(backend, /DuracionSegundos: input\.durationSeconds/);
});

test('el fallback individual de boleta evita escanear toda la tabla y guarda metadata en el primer insert', () => {
  const tickets = source('backend/src/modules/tickets.module.js');
  const patch = source('backend/src/services/device-media-video-mac.patch.js');

  assert.match(tickets, /findRows\('EvidenciasBoleta', \{ EvidenciaID: requestedId \}, \{ limit: 1 \}\)/);
  assert.match(tickets, /TipoMedio: pick\(ctx\.payload/);
  assert.match(tickets, /DuracionSegundos:/);
  assert.match(tickets, /TamanoBytes:/);
  assert.match(patch, /if \(\s*clean\(result\.TipoMedio\)/);
});
