import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createBackgroundTaskQueue } from '../../backend/src/services/background-task-queue.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

test('el canal binario y el guardián de presión de memoria permanecen retirados', () => {
  const app = source('backend/src/app.js');
  const env = source('backend/src/config/env.js');
  const ticketPersistence = source('src/features/tickets/ticketPersistenceService.js');
  const maintenanceBatch = source('src/services/maintenanceImageBatch.js');

  assert.doesNotMatch(app, /binary-upload\.routes|\/api\/upload\/binary/);
  assert.doesNotMatch(env, /UPLOAD_MEMORY_SOFT_LIMIT_MB|UPLOAD_MAX_IN_FLIGHT_MB|UPLOAD_BINARY_MAX_REQUEST_MB/);
  assert.doesNotMatch(ticketPersistence, /binaryUploadRequest|EVIDENCE_UPLOAD_CONCURRENCY|mapWithConcurrency/);
  assert.doesNotMatch(maintenanceBatch, /binaryUploadRequest|uploadBinaryImages|EVIDENCE_UPLOAD_CONCURRENCY/);
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
