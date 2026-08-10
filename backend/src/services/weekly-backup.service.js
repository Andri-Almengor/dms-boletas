import { env } from '../config/env.js';
import { appendRow, readTable, updateRow } from '../infra/sheets.repository.js';
import { copyDriveFile, createFolder, getDriveFile } from '../infra/drive.repository.js';
import { getConfig } from '../modules/config.module.js';

const BACKUP_KEYS = Object.freeze({
  enabled: 'BACKUP_WEEKLY_ENABLED',
  day: 'BACKUP_WEEKLY_DAY',
  hour: 'BACKUP_WEEKLY_HOUR',
  timezone: 'BACKUP_TIMEZONE',
  folderId: 'BACKUP_FOLDER_ID',
  folderUrl: 'BACKUP_FOLDER_URL',
  lastAt: 'BACKUP_LAST_AT',
  lastSlot: 'BACKUP_LAST_SLOT',
  lastFileId: 'BACKUP_LAST_FILE_ID',
  lastFileName: 'BACKUP_LAST_FILE_NAME',
  lastUrl: 'BACKUP_LAST_URL',
  lastStatus: 'BACKUP_LAST_STATUS',
  lastError: 'BACKUP_LAST_ERROR',
  lastActor: 'BACKUP_LAST_ACTOR',
});

const DEFAULT_TIMEZONE = 'America/Costa_Rica';
const DEFAULT_DAY = 0; // Domingo.
const DEFAULT_HOUR = 2;
const SCHEDULER_TICK_MS = 15 * 60_000;
const WEEKDAYS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

let schedulerTimer = null;
let schedulerStartupTimer = null;
let schedulerRunning = false;
let backupTail = Promise.resolve();

function clean(value, maxLength = 1200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function asBoolean(value, fallback = false) {
  const normalized = clean(value, 40).toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'on', 'activo'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'inactivo'].includes(normalized)) return false;
  return fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function configMap(rows = []) {
  return Object.fromEntries(rows.filter((row) => row?.Clave).map((row) => [String(row.Clave), row.Valor]));
}

function backupSettingsFromConfig(config = {}) {
  return {
    enabled: asBoolean(config[BACKUP_KEYS.enabled], false),
    day: boundedInteger(config[BACKUP_KEYS.day], DEFAULT_DAY, 0, 6),
    hour: boundedInteger(config[BACKUP_KEYS.hour], DEFAULT_HOUR, 0, 23),
    timezone: clean(config[BACKUP_KEYS.timezone], 100) || DEFAULT_TIMEZONE,
    folderId: clean(config[BACKUP_KEYS.folderId], 300),
    folderUrl: clean(config[BACKUP_KEYS.folderUrl], 1000),
    lastAt: clean(config[BACKUP_KEYS.lastAt], 100),
    lastSlot: clean(config[BACKUP_KEYS.lastSlot], 20),
    lastFileId: clean(config[BACKUP_KEYS.lastFileId], 300),
    lastFileName: clean(config[BACKUP_KEYS.lastFileName], 300),
    lastUrl: clean(config[BACKUP_KEYS.lastUrl], 1000),
    lastStatus: clean(config[BACKUP_KEYS.lastStatus], 80) || 'SIN_RESPALDO',
    lastError: clean(config[BACKUP_KEYS.lastError], 1200),
    lastActor: clean(config[BACKUP_KEYS.lastActor], 250),
  };
}

async function upsertConfigEntries(entries = {}) {
  const rows = await readTable('Configuracion', { force: true });
  const existingKeys = new Set(rows.map((row) => String(row.Clave || '')).filter(Boolean));
  for (const [key, rawValue] of Object.entries(entries)) {
    const value = rawValue === undefined || rawValue === null ? '' : String(rawValue);
    if (existingKeys.has(key)) {
      await updateRow('Configuracion', key, { Valor: value });
    } else {
      await appendRow('Configuracion', { Clave: key, Valor: value });
      existingKeys.add(key);
    }
  }
}

function costaRicaParts(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

export function weeklyBackupSlot(settings, now = new Date()) {
  const local = costaRicaParts(now, settings.timezone || DEFAULT_TIMEZONE);
  let daysBack = (local.weekday - Number(settings.day) + 7) % 7;
  if (daysBack === 0 && local.hour < Number(settings.hour)) daysBack = 7;
  const scheduledDate = new Date(Date.UTC(local.year, local.month - 1, local.day) - (daysBack * 86_400_000));
  return scheduledDate.toISOString().slice(0, 10);
}

function backupFileTimestamp(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = costaRicaParts(now, timeZone);
  const minute = new Intl.DateTimeFormat('en-US', {
    timeZone,
    minute: '2-digit',
  }).format(now);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}-${String(minute).padStart(2, '0')}`;
}

export async function getWeeklyBackupStatus() {
  const rows = await readTable('Configuracion');
  return backupSettingsFromConfig(configMap(rows));
}

export async function updateWeeklyBackupSettings({ enabled, day, hour } = {}) {
  const current = await getWeeklyBackupStatus();
  const next = {
    enabled: enabled === undefined ? current.enabled : Boolean(enabled),
    day: boundedInteger(day, current.day, 0, 6),
    hour: boundedInteger(hour, current.hour, 0, 23),
    timezone: DEFAULT_TIMEZONE,
  };
  await upsertConfigEntries({
    [BACKUP_KEYS.enabled]: next.enabled,
    [BACKUP_KEYS.day]: next.day,
    [BACKUP_KEYS.hour]: next.hour,
    [BACKUP_KEYS.timezone]: next.timezone,
  });
  return getWeeklyBackupStatus();
}

async function ensureBackupFolder(settings) {
  if (settings.folderId) {
    try {
      const existing = await getDriveFile(settings.folderId);
      if (!existing.trashed) return existing;
    } catch {
      // Si la carpeta configurada ya no existe, se recrea bajo la raíz actual.
    }
  }
  const config = await getConfig();
  const folder = await createFolder('Respaldos DMS Boletas', clean(config.ROOT_FOLDER_ID, 300));
  const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`;
  await upsertConfigEntries({
    [BACKUP_KEYS.folderId]: folder.id,
    [BACKUP_KEYS.folderUrl]: folderUrl,
  });
  return { ...folder, webViewLink: folderUrl };
}

async function performBackup({ actor = 'SYSTEM', now = new Date(), scheduledSlot = '' } = {}) {
  const settings = await getWeeklyBackupStatus();
  const slot = scheduledSlot || (settings.enabled ? weeklyBackupSlot(settings, now) : '');
  const folder = await ensureBackupFolder(settings);
  const name = `DMS Boletas - Respaldo ${backupFileTimestamp(now, settings.timezone)}`;
  try {
    const copied = await copyDriveFile({
      fileId: env.sheetId,
      name,
      folderId: folder.id,
    });
    const url = copied.webViewLink || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(copied.id)}/edit`;
    await upsertConfigEntries({
      [BACKUP_KEYS.lastAt]: now.toISOString(),
      [BACKUP_KEYS.lastSlot]: slot,
      [BACKUP_KEYS.lastFileId]: copied.id,
      [BACKUP_KEYS.lastFileName]: copied.name || name,
      [BACKUP_KEYS.lastUrl]: url,
      [BACKUP_KEYS.lastStatus]: 'COMPLETADO',
      [BACKUP_KEYS.lastError]: '',
      [BACKUP_KEYS.lastActor]: clean(actor, 250) || 'SYSTEM',
    });
    return {
      created: true,
      fileId: copied.id,
      fileName: copied.name || name,
      url,
      folderId: folder.id,
      folderUrl: folder.webViewLink || settings.folderUrl,
      createdAt: now.toISOString(),
      slot,
    };
  } catch (error) {
    await upsertConfigEntries({
      [BACKUP_KEYS.lastAt]: now.toISOString(),
      [BACKUP_KEYS.lastStatus]: 'ERROR',
      [BACKUP_KEYS.lastError]: clean(error?.message || error, 1200),
      [BACKUP_KEYS.lastActor]: clean(actor, 250) || 'SYSTEM',
    }).catch(() => {});
    throw error;
  }
}

export function createWeeklyBackup(options = {}) {
  const operation = backupTail.catch(() => {}).then(() => performBackup(options));
  backupTail = operation.catch(() => {});
  return operation;
}

async function schedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const settings = await getWeeklyBackupStatus();
    if (!settings.enabled) return;
    const slot = weeklyBackupSlot(settings, new Date());
    if (settings.lastSlot === slot && settings.lastStatus === 'COMPLETADO') return;
    const result = await createWeeklyBackup({ actor: 'SYSTEM', scheduledSlot: slot });
    console.log(`[weekly-backup] Respaldo ${result.fileName} creado para la semana ${slot}.`);
  } catch (error) {
    console.warn(`[weekly-backup] No se pudo crear el respaldo semanal: ${clean(error?.message || error, 500)}`);
  } finally {
    schedulerRunning = false;
  }
}

export function startWeeklyBackupScheduler() {
  if (schedulerTimer) return { started: true, alreadyStarted: true };
  schedulerStartupTimer = setTimeout(() => void schedulerTick(), 5_000);
  schedulerStartupTimer.unref?.();
  schedulerTimer = setInterval(() => void schedulerTick(), SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
  console.log('[weekly-backup] Verificación semanal habilitada; la configuración se lee desde Configuracion.');
  return { started: true };
}

export function stopWeeklyBackupScheduler() {
  clearTimeout(schedulerStartupTimer);
  clearInterval(schedulerTimer);
  schedulerStartupTimer = null;
  schedulerTimer = null;
  schedulerRunning = false;
}
