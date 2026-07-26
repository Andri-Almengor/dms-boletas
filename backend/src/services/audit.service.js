import { env } from '../config/env.js';
import { appendRows } from '../infra/sheets.repository.js';
import { uuid, nowIso } from '../core/utils.js';

const queue = [];
let flushPromise = null;
let droppedRows = 0;
let flushedRows = 0;
let failedFlushes = 0;

function scheduleFlush() {
  if (queue.length >= env.auditBatchSize) void flushAuditQueue();
}

const flushTimer = setInterval(() => {
  if (queue.length) void flushAuditQueue();
}, env.auditFlushMs);
flushTimer.unref?.();

export async function flushAuditQueue() {
  if (flushPromise) return flushPromise;
  if (!queue.length) return { flushed: 0 };

  const batch = queue.splice(0, Math.min(queue.length, env.auditBatchSize));
  flushPromise = appendRows('Auditoria', batch, { chunkSize: env.auditBatchSize })
    .then(() => {
      flushedRows += batch.length;
      return { flushed: batch.length };
    })
    .catch((error) => {
      failedFlushes += 1;
      // Se reinsertan al inicio para conservar el orden. Auditoría no bloquea
      // la operación principal, pero tampoco se descarta por un 429 temporal.
      queue.unshift(...batch);
      while (queue.length > env.auditMaxBufferedRows) {
        queue.shift();
        droppedRows += 1;
      }
      console.error('No se pudo vaciar la cola de auditoría:', error.message);
      return { flushed: 0, error: error.message };
    })
    .finally(() => {
      flushPromise = null;
      if (queue.length >= env.auditBatchSize) scheduleFlush();
    });

  return flushPromise;
}

export function auditQueueSnapshot() {
  return {
    queued: queue.length,
    flushing: Boolean(flushPromise),
    flushedRows,
    failedFlushes,
    droppedRows,
    flushEveryMs: env.auditFlushMs,
    batchSize: env.auditBatchSize,
  };
}

export async function audit(ctx, action, entity, entityId, before = null, after = null) {
  const row = {
    AuditoriaID: uuid(),
    UsuarioID: ctx?.user?.UsuarioID || 'SYSTEM',
    UsuarioNombre: ctx?.user?.NombreCompleto || 'SYSTEM',
    Accion: action,
    Entidad: entity,
    EntidadID: entityId || '',
    DatosAntesJSON: before ? JSON.stringify(before) : '',
    DatosDespuesJSON: after ? JSON.stringify(after) : '',
    IP: ctx?.ip || '',
    UserAgent: ctx?.userAgent || '',
    Fecha: nowIso(),
  };

  queue.push(row);
  while (queue.length > env.auditMaxBufferedRows) {
    queue.shift();
    droppedRows += 1;
  }
  scheduleFlush();

  // Los módulos existentes esperan esta función. Se mantiene async, pero ya no
  // obliga al usuario a esperar una escritura independiente en Google Sheets.
  return { queued: true, auditoriaId: row.AuditoriaID };
}
