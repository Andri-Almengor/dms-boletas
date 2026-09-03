import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createUploadPressureGate } from '../../backend/src/core/upload-pressure.js';
import { createBackgroundTaskQueue } from '../../backend/src/services/background-task-queue.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MB = 1024 * 1024;
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('la presión de memoria rechaza antes de reservar un archivo que comprometería el backend', () => {
  const gate = createUploadPressureGate({
    softLimitBytes: 384 * MB,
    reserveBytes: 48 * MB,
    maxInFlightBytes: 64 * MB,
    maxRequestBytes: 32 * MB,
    memoryUsage: () => ({ rss: 340 * MB, heapUsed: 100 * MB }),
  });

  const result = gate.reserve(8 * MB);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'MEMORY_PRESSURE');
  assert.equal(gate.snapshot().activeBytes, 0);
  assert.equal(gate.snapshot().rejected, 1);
});

test('una ráfaga de cargas nunca supera el máximo de bytes en vuelo y libera capacidad al finalizar', () => {
  const gate = createUploadPressureGate({
    softLimitBytes: 512 * MB,
    reserveBytes: 32 * MB,
    maxInFlightBytes: 64 * MB,
    maxRequestBytes: 32 * MB,
    memoryUsage: () => ({ rss: 160 * MB, heapUsed: 80 * MB }),
  });

  const reservations = [];
  for (let index = 0; index < 20; index += 1) {
    const reservation = gate.reserve(8 * MB);
    if (reservation.accepted) reservations.push(reservation);
  }

  assert.equal(reservations.length, 8);
  assert.equal(gate.snapshot().activeBytes, 64 * MB);
  assert.ok(gate.snapshot().peakActiveBytes <= 64 * MB);
  assert.equal(gate.snapshot().rejected, 12);

  reservations.forEach((reservation) => reservation.release({ ok: true }));
  assert.equal(gate.snapshot().activeBytes, 0);
  assert.equal(gate.snapshot().completed, 8);
  assert.equal(gate.reserve(32 * MB).accepted, true);
});

test('la cola de segundo plano limita concurrencia, conserva deduplicación y termina sin rechazos ocultos', async () => {
  let active = 0;
  let peak = 0;
  const completed = [];
  const queue = createBackgroundTaskQueue({ name: 'test-agenda', maxConcurrent: 1, queueLimit: 10 });

  for (let index = 0; index < 5; index += 1) {
    const result = queue.enqueue(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(4);
      completed.push(index);
      active -= 1;
    }, { key: `agenda-${index}` });
    assert.equal(result.accepted, true);
  }

  const duplicate = queue.enqueue(async () => {}, { key: 'agenda-2' });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(await queue.waitForIdle(2_000), true);
  assert.equal(peak, 1);
  assert.deepEqual(completed, [0, 1, 2, 3, 4]);
  assert.equal(queue.snapshot().failed, 0);
  assert.equal(queue.snapshot().deduplicated, 1);
});

test('el endpoint binario aplica backpressure antes de materializar el cuerpo y Drive no duplica buffers', () => {
  const route = source('backend/src/routes/binary-upload.routes.js');
  const drive = source('backend/src/infra/drive.repository.js');
  const server = source('backend/src/server.js');
  const env = source('backend/src/config/env.js');

  const pressureIndex = route.indexOf('reserveUploadCapacity,');
  const rawIndex = route.indexOf("express.raw({ type: 'application/octet-stream'");
  assert.ok(pressureIndex >= 0 && rawIndex > pressureIndex, 'La presión de memoria debe evaluarse antes de express.raw');
  assert.match(route, /reserveBinaryUpload/);
  assert.match(route, /UPLOAD_BACKPRESSURE/);
  assert.match(drive, /Readable\.from\(\[content\]\)/);
  assert.doesNotMatch(drive, /Readable\.from\(Buffer\.from\(content\)\)/);
  assert.match(drive, /Buffer\.from\(value\.buffer, value\.byteOffset, value\.byteLength\)/);
  assert.match(server, /body\.uploads = uploadPressureSnapshot\(\)/);
  assert.match(env, /UPLOAD_MEMORY_SOFT_LIMIT_MB/);
  assert.match(env, /UPLOAD_MAX_IN_FLIGHT_MB/);
});

test('Agenda persiste primero y encola correo y Chat sin mantener bloqueada la solicitud', () => {
  const agenda = source('backend/src/modules/agenda.module.js');
  const queue = source('backend/src/services/agenda-notification-queue.service.js');
  const server = source('backend/src/server.js');

  assert.match(agenda, /enqueueAgendaNotification/);
  assert.match(agenda, /const notification = queueAgendaNotification\(views, users, 'CREATED'\)/);
  assert.doesNotMatch(agenda, /const notification = await notifyAgenda\(views, users, 'CREATED'\)/);
  assert.match(agenda, /queueAgendaNotification\(\[view\], users, 'UPDATED', removedMap\)/);
  assert.match(agenda, /notificaciones se están enviando en segundo plano/i);
  assert.match(queue, /maxConcurrent: env\.agendaNotificationMaxConcurrent/);
  assert.match(queue, /queueLimit: env\.agendaNotificationQueueLimit/);
  assert.match(server, /drainAgendaNotificationQueue/);
  assert.match(server, /body\.agendaNotifications = agendaNotificationQueueSnapshot\(\)/);
});

test('Agenda cierra el editor sin esperar una recarga completa y confirma silenciosamente después', () => {
  const page = source('src/pages/agenda/AgendaPage.jsx');

  assert.match(page, /onSaved\(response\);\s*onClose\(\);/);
  assert.doesNotMatch(page, /await onSaved\(response\)/);
  assert.match(page, /responseItems/);
  assert.match(page, /setItems\(\(current\) =>/);
  assert.match(page, /void load\(\{ silent: true \}\)/);
  assert.doesNotMatch(page, /async function saved\(response\)[\s\S]*?await load\(\)/);
  assert.match(page, /Las notificaciones se enviarán automáticamente después del guardado\./);
});
