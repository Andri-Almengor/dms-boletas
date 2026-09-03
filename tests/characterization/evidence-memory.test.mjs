import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mapFilesSequentially } from '../../src/utils/fileEncoding.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la preparación de archivos mantiene una sola conversión activa', async () => {
  let active = 0;
  let maximum = 0;
  const order = [];
  const result = await mapFilesSequentially([1, 2, 3], async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    order.push(value);
    active -= 1;
    return value * 10;
  });

  assert.equal(maximum, 1);
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(result, [10, 20, 30]);
});

test('la codificación admite cancelación y limpia listeners del FileReader', () => {
  const encoding = source('src/utils/fileEncoding.js');
  assert.match(encoding, /signal\?\.aborted/);
  assert.match(encoding, /reader\.abort\(\)/);
  assert.match(encoding, /removeEventListener\('abort'/);
  assert.match(encoding, /reader\.onload = null/);
  assert.match(encoding, /mapFilesSequentially/);
});

test('mantenimiento conserva límites y evita conversiones paralelas o duplicadas', () => {
  const batch = source('src/services/maintenanceImageBatch.js');

  assert.match(batch, /MAX_FILES_PER_REQUEST = 10/);
  assert.match(batch, /MAX_RAW_BYTES_PER_REQUEST = 10 \* 1024 \* 1024/);
  assert.match(batch, /MAX_METADATA_UPDATES_PER_REQUEST = 80/);
  assert.match(batch, /prepareUploadChunk/);
  assert.match(batch, /mapFilesSequentially/);
  assert.match(batch, /preparedImages/);
  assert.match(batch, /preparedByKey/);
  assert.match(batch, /clearPreparedPayloads/);
  assert.match(batch, /isNetworkError/);
  assert.match(batch, /browserIsOffline/);
  assert.doesNotMatch(batch, /Promise\.all\(chunk\.map/);
});

test('el fallback individual reutiliza el Base64 preparado y conserva la cola offline', () => {
  const batch = source('src/services/maintenanceImageBatch.js');
  assert.match(batch, /prepared\?\.base64/);
  assert.match(batch, /requestAvailable\(MODULE_ROUTES\.maintenance\.imageUpload/);
  assert.match(batch, /requestAvailable\(MODULE_ROUTES\.maintenance\.imageUpdate/);
  assert.match(batch, /if \(missingRoute\(error\)\) uploadBatchAvailable = false/);
  assert.match(batch, /useFallbackForRemaining = true/);
});

test('las evidencias de boleta usan IDs idempotentes y carga secuencial', () => {
  const tickets = source('src/features/tickets/ticketPersistenceService.js');
  assert.match(tickets, /for \(const item of evidences\)/);
  assert.match(tickets, /createLocalId\('evidencia'\)/);
  assert.match(tickets, /evidenciaId: evidenceId/);
  assert.match(tickets, /EvidenciaID: evidenceId/);
  assert.match(tickets, /fileToBase64\(item\.file, \{ signal \}\)/);
  assert.match(tickets, /base64 = ''/);
  assert.doesNotMatch(tickets, /Promise\.all\(evidences/);
});

test('las imágenes se comprimen de forma conservadora antes de entrar al flujo existente', () => {
  const compression = source('src/utils/imageCompression.js');
  const evidence = source('src/utils/evidenceMedia.js');

  assert.match(compression, /EVIDENCE_IMAGE_COMPRESSION_QUALITY = 0\.92/);
  assert.match(compression, /EVIDENCE_IMAGE_MAX_DIMENSION = 2560/);
  assert.match(compression, /EVIDENCE_IMAGE_COMPRESSION_MIN_BYTES = 512 \* 1024/);
  assert.match(compression, /blob\.size >= Number\(file\.size/);
  assert.match(compression, /'gif', 'heic', 'heif', 'svg'/);
  assert.match(compression, /mimeType === 'image\/png' \? undefined : EVIDENCE_IMAGE_COMPRESSION_QUALITY/);
  assert.match(evidence, /import \{ compressEvidenceImage \} from '\.\/imageCompression'/);
  assert.match(evidence, /originalMetadata\.mediaType === 'image'/);
  assert.match(evidence, /await compressEvidenceImage\(originalFile\)/);
  assert.match(evidence, /originalSize: originalMetadata\.size/);
  assert.match(evidence, /optimized,/);
});

test('la liberación local es compartida e idempotente por archivo', () => {
  const lifecycle = source('src/utils/localFileLifecycle.js');
  const uploader = source('src/components/forms/EvidenceUploader.jsx');
  const persistence = source('src/services/maintenanceDevicePersistence.js');
  const editorLifecycle = source('src/features/maintenance/useMaintenanceDeviceEditorLifecycle.js');

  assert.match(lifecycle, /WeakSet/);
  assert.match(lifecycle, /URL\.revokeObjectURL/);
  assert.match(lifecycle, /dms-draft-file-removed/);
  assert.match(lifecycle, /removeDraftFile = true/);
  assert.match(uploader, /releaseLocalFile\(items\[index\]\)/);
  assert.match(persistence, /releaseLocalFiles/);
  assert.match(editorLifecycle, /releaseLocalFiles/);
});