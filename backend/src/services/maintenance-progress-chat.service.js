import { env } from '../config/env.js';
import { nowIso, uuid } from '../core/utils.js';
import {
  buildMaintenanceProgress,
  formatMaintenanceProgressMessage,
  isMaintenanceProgressWeekday,
  maintenanceProgressScheduleSlot,
} from '../core/maintenance-progress.js';
import { query } from '../infra/postgres.js';
import {
  appendRow,
  findRows,
  readTables,
  updateRow,
  withTransaction,
} from '../infra/sheets.repository.js';
import { redactWebhook, sendChatMessage } from './chat.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

const NOTIFICATION_COLUMNS = Object.freeze([
  'ClaveIdempotencia',
  'Entidad',
  'EntidadID',
  'Canal',
  'Destino',
  'Tipo',
  'Estado',
  'Intentos',
  'Respuesta',
  'Error',
  'FechaCreacion',
  'FechaEnvio',
  'UltimoIntento',
  'CreadoPor',
  'ResumenJSON',
]);

const MAX_NOTIFICATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000;
const IN_FLIGHT_LEASE_MS = 10 * 60_000;
const keyLocks = new Map();
let schemaPromise = null;
let immediateTail = Promise.resolve();
let schedulerTimer = null;
let schedulerStartupTimer = null;
let schedulerRunning = false;
let schedulerState = { key: '', lastAttemptAt: 0, completed: false };

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value).toUpperCase();
}

function active(row = {}) {
  if (row.Activo === false) return false;
  return !['FALSE', '0', 'NO', 'INACTIVO', 'INACTIVE'].includes(normalized(row.Activo));
}

function pendingMaintenance(row = {}) {
  return active(row) && normalized(row.Estado || 'PENDIENTE') === 'PENDIENTE';
}

function configuredHours() {
  const values = clean(env.maintenanceProgressChatHours || '7,17')
    .split(/[;,\s]+/)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);
  return values.length ? [...new Set(values)] : [7, 17];
}

function zonedDateParts(date = new Date(), timeZone = env.maintenanceProgressChatTimezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function normalizeScheduledSlot(value) {
  const match = clean(value).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isInteger(hour) || minute !== 0 || !configuredHours().includes(hour)) return '';
  return `${String(hour).padStart(2, '0')}:00`;
}

function notificationType(reason) {
  if (reason === 'CREATED') return 'MANTENIMIENTO_CREADO';
  if (reason === 'COUNTS_UPDATED') return 'MANTENIMIENTO_CANTIDADES_ACTUALIZADAS';
  return 'MANTENIMIENTO_PROGRESO_PROGRAMADO';
}

function notificationKey({ maintenance, reason, slotKey }) {
  const id = clean(maintenance.MantenimientoID);
  if (reason === 'CREATED') return `MANTENIMIENTO_PROGRESO|CREATED|${id}`;
  if (reason === 'COUNTS_UPDATED') {
    const revision = clean(maintenance.FechaActualizacion || maintenance.ActualizadoEn || nowIso());
    return `MANTENIMIENTO_PROGRESO|COUNTS|${id}|${revision}`;
  }
  return `MANTENIMIENTO_PROGRESO|SCHEDULED|${id}|${clean(slotKey)}`;
}

function clientForMaintenance(maintenance, clients = []) {
  const clientId = clean(maintenance.ClienteID || maintenance.ClienteRef);
  if (clientId) {
    const byId = clients.find((row) => clean(row.ClienteID) === clientId);
    if (byId) return byId;
  }
  const name = clean(maintenance.Cliente);
  if (!name) return null;
  return clients.find((row) => clean(row.Clientes || row.Cliente || row.Nombre).toLowerCase() === name.toLowerCase()) || null;
}

function clientWebhook(client = {}) {
  return clean(client.ChatWebhook || client.ChatWebhookURL || client.chatWebhook);
}

function errorText(error) {
  return clean(error?.message || error || 'Error desconocido').slice(0, 1200);
}

function responseText(response) {
  try {
    return JSON.stringify({ sent: Boolean(response?.sent), status: response?.status || 0 }).slice(0, 800);
  } catch {
    return '';
  }
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

async function ensureNotificationSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSheetColumns('Notificaciones', NOTIFICATION_COLUMNS)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

function withKeyLock(key, operation) {
  const previous = keyLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const settled = current.catch(() => {});
  keyLocks.set(key, settled);
  settled.finally(() => {
    if (keyLocks.get(key) === settled) keyLocks.delete(key);
  });
  return current;
}

function existingNotification(rows, key) {
  const matches = (rows || []).filter((row) => clean(row.ClaveIdempotencia) === key);
  return matches.find((row) => normalized(row.Estado) === 'ENVIADO') || matches[0] || null;
}

function shouldRetry(existing, now = new Date()) {
  if (!existing) return true;
  const state = normalized(existing.Estado);
  if (state === 'ENVIADO') return false;
  const attempts = Number(existing.Intentos || 0);
  if (attempts >= MAX_NOTIFICATION_ATTEMPTS) return false;
  const lastAttempt = parseDate(existing.UltimoIntento || existing.FechaCreacion);
  const delay = state === 'ENVIANDO' ? IN_FLIGHT_LEASE_MS : RETRY_DELAY_MS;
  return !lastAttempt || now.getTime() - lastAttempt.getTime() >= delay;
}

function skipReason(existing) {
  const state = normalized(existing?.Estado);
  if (state === 'ENVIADO') return 'ALREADY_SENT';
  if (state === 'ENVIANDO') return 'ALREADY_RUNNING';
  return 'RETRY_LIMIT';
}


async function claimNotification({
  key,
  maintenance,
  reason,
  webhook,
  actor,
  progress,
  now,
}) {
  await ensureNotificationSchema();
  return withTransaction(async () => {
    // keyLocks evita duplicados dentro del mismo proceso. Este advisory lock
    // hace la reserva atómica también entre varias instancias de Render.
    await query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [key],
      { label: 'maintenance_progress_chat.claim_lock' },
    );

    // No usamos el snapshot precargado de Notificaciones: otra instancia pudo
    // haber enviado el mismo slot desde que comenzó este ciclo.
    const rows = await findRows(
      'Notificaciones',
      { ClaveIdempotencia: key },
      { limit: 20, order: 'DESC' },
    );
    const existing = existingNotification(rows, key);
    if (!shouldRetry(existing, now)) {
      return { claimed: false, existing, skipped: skipReason(existing) };
    }

    const timestamp = now.toISOString();
    const claim = {
      ClaveIdempotencia: key,
      Entidad: 'Mantenimiento',
      EntidadID: clean(maintenance.MantenimientoID),
      Canal: 'GOOGLE_CHAT',
      Destino: redactWebhook(webhook),
      Tipo: notificationType(reason),
      Estado: 'ENVIANDO',
      Intentos: Number(existing?.Intentos || 0),
      Respuesta: existing?.Respuesta || '',
      Error: '',
      FechaCreacion: existing?.FechaCreacion || timestamp,
      FechaEnvio: existing?.FechaEnvio || '',
      UltimoIntento: timestamp,
      CreadoPor: clean(actor) || 'SYSTEM',
      ResumenJSON: JSON.stringify({
        registered: progress.registered,
        expected: progress.expected,
        remaining: progress.remaining,
        percentage: progress.percentage,
        items: progress.items,
      }),
    };

    if (existing?.NotificacionID) {
      const reserved = await updateRow('Notificaciones', existing.NotificacionID, claim);
      return { claimed: true, existing: reserved };
    }

    const reserved = { NotificacionID: uuid(), ...claim };
    await appendRow('Notificaciones', reserved);
    return { claimed: true, existing: reserved };
  });
}

async function persistAttempt({ existing, key, maintenance, reason, webhook, actor, progress, result, error, now }) {
  const timestamp = now.toISOString();
  const sent = Boolean(result?.sent) && !error;
  const attempts = Number(existing?.Intentos || 0) + 1;
  const row = {
    ClaveIdempotencia: key,
    Entidad: 'Mantenimiento',
    EntidadID: clean(maintenance.MantenimientoID),
    Canal: 'GOOGLE_CHAT',
    Destino: redactWebhook(webhook),
    Tipo: notificationType(reason),
    Estado: sent ? 'ENVIADO' : 'ERROR',
    Intentos: attempts,
    Respuesta: sent ? responseText(result) : '',
    Error: sent ? '' : errorText(error),
    FechaCreacion: existing?.FechaCreacion || timestamp,
    FechaEnvio: sent ? timestamp : existing?.FechaEnvio || '',
    UltimoIntento: timestamp,
    CreadoPor: clean(actor) || 'SYSTEM',
    ResumenJSON: JSON.stringify({
      registered: progress.registered,
      expected: progress.expected,
      remaining: progress.remaining,
      percentage: progress.percentage,
      items: progress.items,
    }),
  };

  if (existing?.NotificacionID) {
    return updateRow('Notificaciones', existing.NotificacionID, row);
  }

  const created = { NotificacionID: uuid(), ...row };
  await appendRow('Notificaciones', created);
  return created;
}

function progressContextForMaintenance(maintenance, context = {}) {
  const maintenanceId = clean(maintenance.MantenimientoID);
  return {
    clients: context.clients || [],
    deviceTypes: context.deviceTypes || [],
    devices: (context.devices || []).filter((device) => (
      clean(device.MantenimientoRef) === maintenanceId && active(device)
    )),
  };
}

async function loadContextForMaintenance(maintenance) {
  const tables = await readTables([
    'Clientes',
    'TiposDispositivo',
    'Evidencia_Mantenimientos',
  ]);
  return {
    clients: tables.Clientes || [],
    deviceTypes: tables.TiposDispositivo || [],
    devices: tables.Evidencia_Mantenimientos || [],
  };
}

export async function notifyMaintenanceProgress({
  maintenance,
  reason = 'SCHEDULED',
  slot = '',
  slotKey = '',
  actor = 'SYSTEM',
  now = new Date(),
  context = null,
} = {}) {
  if (!maintenance?.MantenimientoID) return { sent: false, skipped: 'NO_MAINTENANCE' };
  if (!pendingMaintenance(maintenance)) return { sent: false, skipped: 'NOT_PENDING' };
  if (!isMaintenanceProgressWeekday(now, env.maintenanceProgressChatTimezone)) {
    return { sent: false, skipped: 'WEEKEND' };
  }

  const loadedContext = context || await loadContextForMaintenance(maintenance);
  const local = progressContextForMaintenance(maintenance, loadedContext);
  const client = clientForMaintenance(maintenance, local.clients);
  const webhook = clientWebhook(client);
  if (!webhook) return { sent: false, skipped: 'NO_CLIENT_CHAT' };

  const progress = buildMaintenanceProgress({
    maintenance,
    devices: local.devices,
    deviceTypes: local.deviceTypes,
  });
  const key = notificationKey({ maintenance, reason, slotKey });

  return withKeyLock(key, async () => {
    const reservation = await claimNotification({
      key,
      maintenance,
      reason,
      webhook,
      actor,
      progress,
      now,
    });
    if (!reservation.claimed) {
      return {
        sent: false,
        skipped: reservation.skipped,
        progress,
      };
    }
    const existing = reservation.existing;

    const message = formatMaintenanceProgressMessage({
      maintenance,
      progress,
      reason,
      slot,
      now,
      timeZone: env.maintenanceProgressChatTimezone,
    });

    let result = null;
    let sendError = null;
    try {
      result = await sendChatMessage(webhook, message);
    } catch (error) {
      sendError = error;
    }

    await persistAttempt({
      existing,
      key,
      maintenance,
      reason,
      webhook,
      actor,
      progress,
      result,
      error: sendError,
      now,
    });

    if (sendError) {
      console.warn(`[maintenance-progress-chat] ${clean(maintenance.MantenimientoID)}: ${errorText(sendError)}`);
      return { sent: false, error: errorText(sendError), progress };
    }
    return { sent: true, progress };
  });
}

export function queueMaintenanceProgressNotification(options = {}) {
  immediateTail = immediateTail
    .catch(() => {})
    .then(() => notifyMaintenanceProgress(options))
    .catch((error) => {
      console.warn(`[maintenance-progress-chat] No se pudo procesar una notificación inmediata: ${errorText(error)}`);
      return { sent: false, error: errorText(error) };
    });
  return { queued: true };
}

async function dispatchScheduledMaintenanceProgress({ slot, slotKey, now = new Date() }) {
  await ensureNotificationSchema();
  const tables = await readTables([
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'TiposDispositivo',
    'Clientes',
  ], { force: true });

  const context = {
    devices: tables.Evidencia_Mantenimientos || [],
    deviceTypes: tables.TiposDispositivo || [],
    clients: tables.Clientes || [],
  };
  const pending = (tables.Mantenimiento || []).filter(pendingMaintenance);
  const summary = { due: true, slot, key: slotKey, pending: pending.length, sent: 0, skipped: 0, failed: 0 };

  for (const maintenance of pending) {
    const result = await notifyMaintenanceProgress({
      maintenance,
      reason: 'SCHEDULED',
      slot,
      slotKey,
      actor: 'SYSTEM',
      now,
      context,
    });
    if (result.sent) summary.sent += 1;
    else if (result.error) summary.failed += 1;
    else summary.skipped += 1;
  }

  return summary;
}

export async function sendScheduledMaintenanceProgressForSlot({ slot, now = new Date() } = {}) {
  if (!env.maintenanceProgressChatEnabled) {
    return { due: false, reason: 'DISABLED', sent: 0, skipped: 0, failed: 0 };
  }

  const normalizedSlot = normalizeScheduledSlot(slot);
  if (!normalizedSlot) {
    return { due: false, reason: 'INVALID_SLOT', sent: 0, skipped: 0, failed: 0 };
  }
  if (!isMaintenanceProgressWeekday(now, env.maintenanceProgressChatTimezone)) {
    return { due: false, reason: 'WEEKEND', slot: normalizedSlot, sent: 0, skipped: 0, failed: 0 };
  }

  const parts = zonedDateParts(now, env.maintenanceProgressChatTimezone);
  const currentMinutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  const targetHour = Number(normalizedSlot.slice(0, 2));
  const targetMinutes = targetHour * 60;
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;

  // Apps Script puede disparar nearMinute(0) unos minutos antes. Nunca enviamos
  // el recordatorio antes de la hora nominal; el script reintentará al llegar.
  if (currentMinutes < targetMinutes) {
    return {
      due: false,
      reason: 'TOO_EARLY',
      slot: normalizedSlot,
      dateKey,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  return dispatchScheduledMaintenanceProgress({
    slot: normalizedSlot,
    slotKey: `${dateKey}|${normalizedSlot}`,
    now,
  });
}

export async function sendScheduledMaintenanceProgress(now = new Date()) {
  const slot = maintenanceProgressScheduleSlot(
    now,
    env.maintenanceProgressChatTimezone,
    configuredHours(),
  );
  if (!slot) return { due: false, sent: 0, skipped: 0, failed: 0 };

  return dispatchScheduledMaintenanceProgress({
    slot: slot.slot,
    slotKey: slot.key,
    now,
  });
}

async function schedulerTick() {
  if (!env.maintenanceProgressChatEnabled || schedulerRunning) return;
  const now = new Date();
  const slot = maintenanceProgressScheduleSlot(
    now,
    env.maintenanceProgressChatTimezone,
    configuredHours(),
  );
  if (!slot) {
    schedulerState = { key: '', lastAttemptAt: 0, completed: false };
    return;
  }

  if (schedulerState.key !== slot.key) {
    schedulerState = { key: slot.key, lastAttemptAt: 0, completed: false };
  }
  if (schedulerState.completed) return;
  if (schedulerState.lastAttemptAt && now.getTime() - schedulerState.lastAttemptAt < RETRY_DELAY_MS) return;

  schedulerRunning = true;
  schedulerState.lastAttemptAt = now.getTime();
  try {
    const result = await sendScheduledMaintenanceProgress(now);
    schedulerState.completed = result.failed === 0;
    console.log(
      `[maintenance-progress-chat] ${slot.key}: ${result.sent} enviado(s), ${result.skipped} omitido(s), ${result.failed} fallo(s).`,
    );
  } catch (error) {
    console.warn(`[maintenance-progress-chat] Falló el ciclo programado ${slot.key}: ${errorText(error)}`);
  } finally {
    schedulerRunning = false;
  }
}

export function startMaintenanceProgressScheduler() {
  if (!env.maintenanceProgressChatEnabled) {
    console.log('[maintenance-progress-chat] Notificaciones desactivadas por configuración.');
    return { enabled: false };
  }
  if (schedulerTimer) return { enabled: true, alreadyStarted: true };

  schedulerStartupTimer = setTimeout(() => void schedulerTick(), 2_000);
  schedulerStartupTimer.unref?.();
  schedulerTimer = setInterval(
    () => void schedulerTick(),
    Math.max(10_000, Number(env.maintenanceProgressChatTickMs || 30_000)),
  );
  schedulerTimer.unref?.();
  console.log(
    `[maintenance-progress-chat] Programado de lunes a viernes a las ${configuredHours().map((hour) => `${String(hour).padStart(2, '0')}:00`).join(' y ')} (${env.maintenanceProgressChatTimezone}).`,
  );
  return { enabled: true };
}

export function stopMaintenanceProgressScheduler() {
  clearTimeout(schedulerStartupTimer);
  clearInterval(schedulerTimer);
  schedulerStartupTimer = null;
  schedulerTimer = null;
  schedulerRunning = false;
  schedulerState = { key: '', lastAttemptAt: 0, completed: false };
}
