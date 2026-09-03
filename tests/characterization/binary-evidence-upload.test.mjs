import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mapWithConcurrency } from '../../src/utils/asyncPool.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('el pool reutilizable limita concurrencia y conserva el orden', async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapWithConcurrency([30, 10, 20, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(value);
    active -= 1;
    return value * 2;
  });

  assert.equal(maximum, 2);
  assert.deepEqual(result, [60, 20, 40, 10]);
});

test('el cliente binario envía Blob directo y conserva fallback para Apps Script o backend antiguo', () => {
  const client = source('src/services/binaryUploadApi.js');

  assert.match(client, /\/api\/upload\/binary/);
  assert.match(client, /'Content-Type': 'application\/octet-stream'/);
  assert.match(client, /'X-DMS-Route'/);
  assert.match(client, /'X-DMS-Payload'/);
  assert.match(client, /Authorization = `Bearer \$\{sessionToken\}`/);
  assert.match(client, /body: file/);
  assert.match(client, /script\\\.google\\\.com/);
  assert.match(client, /BINARY_UPLOAD_UNAVAILABLE/);
  assert.match(client, /binaryUploadAvailable = false/);
});

test('el endpoint binario reutiliza autenticación, permisos, rate limit y concurrencia existentes', () => {
  const route = source('backend/src/routes/binary-upload.routes.js');
  const app = source('backend/src/app.js');

  assert.match(app, /app\.use\('\/api\/upload\/binary', binaryUploadRouter\)/);
  assert.match(route, /ALLOWED_BINARY_ROUTES/);
  assert.match(route, /express\.raw\(\{ type: 'application\/octet-stream', limit: BINARY_BODY_LIMIT \}\)/);
  assert.match(route, /actionRateLimitMiddleware/);
  assert.match(route, /dispatchAction\(\{/);
  assert.match(route, /runWithActionConcurrency/);
  assert.match(route, /runWithActionSingleFlight/);
  assert.match(route, /recordApiActivityFromToken/);
  assert.match(route, /authorization\?\.replace\(\/\^Bearer/);
  assert.doesNotMatch(route, /authenticate\(/);
  assert.doesNotMatch(route, /permissions\.includes/);
});

test('las rutas binarias conservan exactamente las rutas protegidas existentes', () => {
  const route = source('backend/src/routes/binary-upload.routes.js');
  const actionRouter = source('backend/src/core/action-router.js');

  for (const name of [
    'boletas.evidence.upload',
    'tickets.evidence.upload',
    'maintenance.images.upload',
    'mantenimientos.imagenes.upload',
    'boletas.evidence.large.chunk',
    'tickets.evidence.large.chunk',
    'maintenance.images.large.chunk',
    'mantenimientos.imagenes.grande.bloque',
  ]) {
    assert.match(route, new RegExp(name.replace(/\./g, '\\.'), 'i'));
    assert.match(actionRouter, new RegExp(name.replace(/\./g, '\\.'), 'i'));
  }

  assert.match(actionRouter, /\['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR'\]/);
  assert.match(actionRouter, /largeEvidenceUploadHandlers\.maintenanceChunk, maintenanceEditPermissions/);
});

test('Drive y video reanudable aceptan Buffer sin recodificar a Base64', () => {
  const drive = source('backend/src/infra/drive.repository.js');
  const large = source('backend/src/services/large-evidence-upload.service.js');
  const route = source('backend/src/routes/binary-upload.routes.js');

  assert.match(drive, /Buffer\.isBuffer\(base64\)/);
  assert.match(drive, /return uploadBuffer/);
  assert.match(large, /function chunkBuffer/);
  assert.match(large, /Buffer\.isBuffer\(value\)/);
  assert.match(large, /const buffer = chunkBuffer\(ctx\.payload\.base64\)/);
  assert.match(route, /base64: buffer/);
  assert.doesNotMatch(route, /buffer\.toString\('base64'\)/);
});

test('boletas y mantenimientos usan máximo tres cargas paralelas solo tras confirmar binario', () => {
  const tickets = source('src/features/tickets/ticketPersistenceService.js');
  const maintenance = source('src/services/maintenanceImageBatch.js');
  const large = source('src/services/largeEvidenceUpload.js');

  assert.match(tickets, /EVIDENCE_UPLOAD_CONCURRENCY = 3/);
  assert.match(tickets, /binaryConfirmed = true/);
  assert.match(tickets, /if \(binaryConfirmed\)/);
  assert.match(tickets, /mapWithConcurrency/);
  assert.match(tickets, /for \(const entry of pending\)/);

  assert.match(maintenance, /EVIDENCE_UPLOAD_CONCURRENCY = 3/);
  assert.match(maintenance, /const \[probe, \.\.\.remaining\] = images/);
  assert.match(maintenance, /mapWithConcurrency/);
  assert.match(maintenance, /if \(canUseBinaryUpload\(\)\)/);
  assert.match(maintenance, /for \(const image of remaining\)/);

  assert.match(large, /binaryUploadRequest/);
  assert.match(large, /isBinaryUploadUnavailable/);
  assert.match(large, /fileToBase64/);
});

test('el modal de mantenimiento reutiliza el pipeline compartido y conserva fallos parciales', () => {
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');

  assert.match(uploader, /uploadMaintenanceImagesInBatches/);
  assert.match(uploader, /result\.failed/);
  assert.match(uploader, /uploadedKeys/);
  assert.match(uploader, /setEvidences/);
  assert.doesNotMatch(uploader, /fileToBase64/);
  assert.doesNotMatch(uploader, /uploadLargeMaintenanceEvidence/);
  assert.doesNotMatch(uploader, /requestAvailable/);
});
