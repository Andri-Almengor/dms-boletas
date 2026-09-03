import { env } from '../config/env.js';
import { createBackgroundTaskQueue } from './background-task-queue.service.js';

const queue = createBackgroundTaskQueue({
  name: 'agenda-notifications',
  maxConcurrent: env.agendaNotificationMaxConcurrent,
  queueLimit: env.agendaNotificationQueueLimit,
  onError(error, meta) {
    const ids = Array.isArray(meta?.agendaIds) ? meta.agendaIds.join(',') : '';
    console.warn(`[agenda-notifications] Falló una entrega${ids ? ` (${ids})` : ''}: ${error?.message || error}`);
  },
});

export function enqueueAgendaNotification({ key, agendaIds = [], task, onResult, onFailure } = {}) {
  return queue.enqueue(task, {
    key,
    meta: { agendaIds: [...agendaIds] },
    onResult,
    onFailure,
  });
}

export function agendaNotificationQueueSnapshot() {
  return queue.snapshot();
}

export function drainAgendaNotificationQueue(timeoutMs = 10_000) {
  return queue.waitForIdle(timeoutMs);
}
