import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MEDIA_PREVIEW_QUEUE_POLICY,
  resetMediaPreviewQueueForTests,
  scheduleMediaPreview,
} from '../../src/services/mediaPreviewQueue.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const mediaPreview = source('src/components/tickets/MediaPreview.jsx');
const ticketMediaSource = source('src/services/ticketMediaSource.js');
const mediaQueue = source('src/services/mediaPreviewQueue.js');
const mediaStream = source('backend/src/services/protected-media-stream.service.js');
const mediaPatch = source('backend/src/services/protected-media-stream.patch.js');
const detailPatch = source('backend/src/services/ticket-detail-read-optimization.patch.js');
const ticketMulti = source('backend/src/modules/ticket-multi.module.js');
const actionConcurrency = source('backend/src/services/action-concurrency.service.js');
const singleFlight = source('backend/src/services/action-single-flight.service.js');
const multiUpload = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');
const detailPage = source('src/pages/tickets/TicketDetailPage.jsx');
const diagnostics = source('backend/src/core/runtime-diagnostics.js');
const observability = source('backend/src/services/performance-observability.service.js');
const concurrency = source('backend/src/middleware/concurrency.middleware.js');
const app = source('backend/src/app.js');

test('las evidencias protegidas no se descargan hasta acercarse al viewport', () => {
  assert.match(mediaPreview, /IntersectionObserver/);
  assert.match(mediaPreview, /rootMargin:\s*'300px 0px'/);
  assert.match(ticketMediaSource, /scheduleMediaPreview/);
  assert.match(ticketMediaSource, /requestTicketProtectedSource/);
  assert.match(mediaPreview, /AbortController/);
  assert.match(mediaPreview, /Reintentar/);
  assert.equal(MEDIA_PREVIEW_QUEUE_POLICY.maxConcurrent, 3);
  assert.match(mediaQueue, /priority/);
});

test('la cola de previews limita concurrencia y deduplica la misma evidencia', async () => {
  resetMediaPreviewQueueForTests();
  let active = 0;
  let peak = 0;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = async () => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await gate;
    active -= 1;
    return calls;
  };

  const jobs = Array.from({ length: 8 }, (_, index) => scheduleMediaPreview(`e-${index}`, task));
  const duplicateA = scheduleMediaPreview('same', task);
  const duplicateB = scheduleMediaPreview('same', task);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 3);
  release();
  await Promise.all([...jobs, duplicateA, duplicateB]);
  assert.equal(calls, 9, 'dos consumidores de la misma evidencia deben compartir una carga');
  resetMediaPreviewQueueForTests();
});

test('media de boletas usa streaming HTTP y Range sin Buffer/base64 en el camino normal', () => {
  assert.match(mediaStream, /Readable\.fromWeb/);
  assert.match(mediaStream, /Range:\s*range/);
  assert.match(mediaStream, /Content-Range|content-range/i);
  assert.match(mediaStream, /Accept-Ranges/);
  assert.match(mediaStream, /stream\.pipe\(res\)/);
  assert.doesNotMatch(mediaStream, /downloadAsDataUrl|toString\(['"]base64['"]\)/);
  assert.match(mediaStream, /DRIVE_FILE_NOT_FOUND/);
  assert.match(mediaStream, /DRIVE_FILE_FORBIDDEN/);
  assert.match(mediaStream, /DRIVE_RATE_LIMITED/);
});

test('token temporal queda acotado a boleta evidencia usuario y sesión y expira', () => {
  for (const field of ['boletaUid', 'evidenceId', 'userId', 'sessionHash', 'exp']) {
    assert.match(mediaStream, new RegExp(`\\b${field}\\b`));
  }
  assert.match(mediaStream, /TOKEN_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(mediaStream, /MAX_ACTIVE_GRANTS\s*=\s*1_000/);
  assert.match(mediaStream, /timingSafeEqual/);
  assert.doesNotMatch(mediaStream, /permissions\.create|anyone/);
});

test('una evidencia debe validar pertenencia y acceso antes de emitir streamUrl', () => {
  const accessIndex = mediaPatch.indexOf('ticketAccessHandlers.assertTicketAccess(ctx, ticket)');
  const streamIndex = mediaPatch.indexOf("return ticketStreamResult(row, ticket, ctx, 'evidence')");
  assert.ok(accessIndex >= 0 && streamIndex > accessIndex, 'el acceso debe validarse antes de crear el stream');
  assert.match(mediaPatch, /requestedFileId[\s\S]+requestedFileId !== actualFileId/);
  assert.match(mediaPatch, /rowTicketId !== requestedTicketId/);
});

test('evidencia inexistente devuelve notFound antes de tocar propiedades de null', () => {
  const missingGuard = mediaPatch.indexOf("if (!row || !isActive(row)) throw notFound('La evidencia solicitada ya no está disponible.')");
  const propertyRead = mediaPatch.indexOf('const rowTicketId = clean(row.BoletaUID)');
  assert.ok(missingGuard >= 0 && propertyRead > missingGuard, 'el guard null debe ejecutarse antes de leer row.BoletaUID');
  assert.match(mediaPatch, /function isActive\(row\) \{\s*return Boolean\(row\)/);
  assert.match(mediaPatch, /function isVideo\(row\) \{\s*return Boolean\(row\)/);
});

test('streams de media conservan http-all y reservan capacidad foreground', () => {
  assert.match(concurrency, /name:\s*'http-media'/);
  assert.match(concurrency, /requestPath === '\/api\/media\/stream'/);
  assert.match(concurrency, /releaseMedia = await mediaRequests\.acquire/);
  assert.match(concurrency, /releaseAll = await allRequests\.acquire/);
  assert.match(concurrency, /foregroundReserve/);
});

test('media.get y sync.delta no compiten con finalizaciones en el carril pesado', () => {
  const readStart = actionConcurrency.indexOf('function isReadRoute');
  const heavyStart = actionConcurrency.indexOf('function isHeavyRoute');
  const busyStart = actionConcurrency.indexOf('function addBusyContext');
  assert.ok(readStart >= 0 && heavyStart > readStart && busyStart > heavyStart);
  const readClassifier = actionConcurrency.slice(readStart, heavyStart);
  const heavyClassifier = actionConcurrency.slice(heavyStart, busyStart);
  assert.match(readClassifier, /value === 'sync\.delta'/);
  assert.match(readClassifier, /\.media\.get/);
  assert.doesNotMatch(heavyClassifier, /\.media\.get/);
});

test('tickets.get evita el enriquecimiento base duplicado y conserva ambas validaciones de acceso', () => {
  assert.match(detailPatch, /__ticketDetailRow/);
  assert.match(detailPatch, /ticketAccessHandlers\.assertTicketAccess/);
  assert.match(detailPatch, /assertTicketPayloadAccess/);
  assert.match(detailPatch, /ticketMultiHandlers\.get/);
  assert.match(app, /ticket-detail-read-optimization\.patch/);
});

test('tickets.get obtiene la boleta por ID sin descargar la tabla completa', () => {
  assert.match(detailPatch, /findById\('Boletas', ticketId\)/);
  assert.doesNotMatch(detailPatch, /readTable\('Boletas'\)|snapshot\.read\('Boletas',\s*\{\s*force:\s*true\s*\}\)/);
  assert.match(detailPatch, /createTicketDetailSnapshot\(ticket\)/);
});

test('detalle con referencias completas no relee cuatro catálogos solo para confirmar etiquetas', () => {
  assert.match(ticketMulti, /function hasCompleteStoredCatalogReferences/);
  assert.match(ticketMulti, /if \(snapshot && hasCompleteStoredCatalogReferences\(ticket\)\) return ticket;/);
  assert.match(ticketMulti, /const normalized = await normalizeCatalogPayload\(ticket, snapshot\);/);
});

test('tickets.get tiene single-flight por boleta y sesión sin afectar candidatos de vinculación', () => {
  assert.match(singleFlight, /ticket-get:/);
  assert.match(singleFlight, /boletas\.get/);
  assert.match(singleFlight, /tickets\.get/);
  assert.match(singleFlight, /visitLinkCandidates === true/);
});

test('CRUD y carga múltiple de evidencias no recargan la SPA completa', () => {
  assert.doesNotMatch(multiUpload, /window\.location\.reload/);
  assert.match(multiUpload, /dms-ticket-evidence-uploaded/);
  assert.match(multiUpload, /items\.slice\(uploadedCount\)/);
  assert.match(detailPage, /patchEvidence\(result\)/);
  assert.match(detailPage, /removeEvidence\(evidenceId\)/);
});

test('errores lentos quedan atribuibles sin registrar payloads ni contenido de archivo', () => {
  assert.match(diagnostics, /message:\s*sanitizeText/);
  assert.match(diagnostics, /stack:\s*safeStack/);
  assert.match(diagnostics, /requestId/);
  assert.match(diagnostics, /phase/);
  assert.match(observability, /event\s*=\s*totalDurationMs > 10_000 \? 'very_slow_action'/);
  assert.match(observability, /totalDurationMs > 3_000 \? 'slow_action'/);
  assert.match(observability, /sheetsReadMs/);
  assert.match(observability, /sheetsQueueMs/);
  assert.match(observability, /driveMs/);
  assert.match(observability, /responseBytes/);
  assert.match(observability, /topActionsBySheetsReads/);
  assert.match(observability, /topTablesByApiCalls/);
});
