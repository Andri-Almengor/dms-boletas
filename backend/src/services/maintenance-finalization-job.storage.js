import { AsyncLocalStorage } from 'node:async_hooks';
import {
  appendRows,
  findById,
  readTable,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { nowIso, sha256, uuid } from '../core/utils.js';
import { ensureSheetTables } from './sheet-schema.service.js';

export const FINALIZATION_JOB_SHEET = 'MaintenanceFinalizationJobs';
export const FINALIZATION_ITEM_SHEET = 'MaintenanceFinalizationItems';

export const FINALIZATION_JOB_HEADERS = Object.freeze([
  'JobID',
  'MantenimientoID',
  'Estado',
  'Fase',
  'TotalBoletas',
  'BoletasCompletadas',
  'TotalDispositivos',
  'DispositivosCompletados',
  'TotalEvidencias',
  'EvidenciasProcesadas',
  'Porcentaje',
  'UltimoError',
  'Reintentos',
  'FechaInicio',
  'FechaActualizacion',
  'FechaFinalizacion',
  'CreadoPor',
  'ActualizadoPor',
]);

export const FINALIZATION_ITEM_HEADERS = Object.freeze([
  'ItemID',
  'JobID',
  'MantenimientoID',
  'Tipo',
  'ReferenciaID',
  'Orden',
  'Parte',
  'TotalPartes',
  'Evidencias',
  'Estado',
  'Intentos',
  'ResultadoID',
  'ResultadoURL',
  'Copiadas',
  'Existentes',
  'UltimoError',
  'FechaInicio',
  'FechaActualizacion',
  'FechaFinalizacion',
  'CreadoPor',
  'ActualizadoPor',
]);

const WRITE_BATCH = 100;
let storageReady = null;
const finalizationItemStepStorage = new AsyncLocalStorage();

function clean(value) {
  return String(value ?? '').trim();
}

function sortFinalizationItems(items = []) {
  return items.sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
}

function activeItemSnapshot(jobId) {
  const snapshot = finalizationItemStepStorage.getStore();
  return snapshot && clean(snapshot.jobId) === clean(jobId) ? snapshot : null;
}

export function mergeFinalizationItemSnapshot(items = [], updates = []) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(updates) || !updates.length) return items;
  const indexes = new Map(items.map((item, index) => [clean(item.ItemID), index]));
  for (const update of updates) {
    const itemId = clean(update?.ItemID);
    const index = indexes.get(itemId);
    if (index === undefined) continue;
    items[index] = { ...items[index], ...update };
  }
  return sortFinalizationItems(items);
}

export function runWithFinalizationItemStepSnapshot(jobId, operation) {
  return finalizationItemStepStorage.run({ jobId: clean(jobId), items: null }, operation);
}

export function ensureMaintenanceFinalizationStorage() {
  if (storageReady) return storageReady;
  storageReady = ensureSheetTables({
    [FINALIZATION_JOB_SHEET]: FINALIZATION_JOB_HEADERS,
    [FINALIZATION_ITEM_SHEET]: FINALIZATION_ITEM_HEADERS,
  }).catch((error) => {
    storageReady = null;
    throw error;
  });
  return storageReady;
}

export function createFinalizationJobId(maintenanceId) {
  return `mfj-${sha256(`${clean(maintenanceId)}|${uuid()}`).slice(0, 28)}`;
}

export function createFinalizationItemId(jobId, type, referenceId, part = 1) {
  return `mfi-${sha256(`${jobId}|${type}|${referenceId}|${part}`).slice(0, 30)}`;
}

export async function createFinalizationJob({ maintenanceId, actor = 'SISTEMA' }) {
  await ensureMaintenanceFinalizationStorage();
  const timestamp = nowIso();
  const record = {
    JobID: createFinalizationJobId(maintenanceId),
    MantenimientoID: clean(maintenanceId),
    Estado: 'EN_PROCESO',
    Fase: 'PREPARANDO',
    TotalBoletas: 0,
    BoletasCompletadas: 0,
    TotalDispositivos: 0,
    DispositivosCompletados: 0,
    TotalEvidencias: 0,
    EvidenciasProcesadas: 0,
    Porcentaje: 2,
    UltimoError: '',
    Reintentos: 0,
    FechaInicio: timestamp,
    FechaActualizacion: timestamp,
    FechaFinalizacion: '',
    CreadoPor: actor,
    ActualizadoPor: actor,
  };
  await appendRows(FINALIZATION_JOB_SHEET, [record], { chunkSize: 1 });
  return record;
}

export async function getFinalizationJob(jobId) {
  await ensureMaintenanceFinalizationStorage();
  return findById(FINALIZATION_JOB_SHEET, clean(jobId), 'JobID');
}

export async function findFinalizationJobForMaintenance(maintenanceId, jobId = '') {
  await ensureMaintenanceFinalizationStorage();
  if (clean(jobId)) {
    try {
      const job = await getFinalizationJob(jobId);
      if (clean(job.MantenimientoID) === clean(maintenanceId)) return job;
    } catch {
      // Se buscará el último job del mantenimiento.
    }
  }

  let latest = null;
  let latestRowNumber = -1;
  for (const row of await readTable(FINALIZATION_JOB_SHEET)) {
    if (clean(row.MantenimientoID) !== clean(maintenanceId)) continue;
    const rowNumber = Number(row.__rowNumber || 0);
    if (rowNumber > latestRowNumber) {
      latest = row;
      latestRowNumber = rowNumber;
    }
  }
  return latest;
}

export async function updateFinalizationJob(jobId, patch = {}) {
  await ensureMaintenanceFinalizationStorage();
  return updateRow(FINALIZATION_JOB_SHEET, clean(jobId), {
    ...patch,
    FechaActualizacion: patch.FechaActualizacion || nowIso(),
  }, 'JobID');
}

export async function listFinalizationItems(jobId) {
  await ensureMaintenanceFinalizationStorage();
  const snapshot = activeItemSnapshot(jobId);
  if (snapshot?.items) return snapshot.items;
  const rows = await readTable(FINALIZATION_ITEM_SHEET);
  const items = sortFinalizationItems(rows.filter((row) => clean(row.JobID) === clean(jobId)));
  if (snapshot) snapshot.items = items;
  return items;
}

export async function ensureFinalizationItems(job, definitions = [], actor = 'SISTEMA') {
  await ensureMaintenanceFinalizationStorage();
  const current = await listFinalizationItems(job.JobID);
  const existing = new Set(current.map((row) => clean(row.ItemID)));
  const timestamp = nowIso();
  const creates = definitions.map((definition, index) => {
    const part = Number(definition.part || 1);
    const itemId = createFinalizationItemId(job.JobID, definition.type, definition.referenceId, part);
    if (existing.has(itemId)) return null;
    return {
      ItemID: itemId,
      JobID: job.JobID,
      MantenimientoID: job.MantenimientoID,
      Tipo: clean(definition.type).toUpperCase(),
      ReferenciaID: clean(definition.referenceId),
      Orden: Number(definition.order ?? index + 1),
      Parte: part,
      TotalPartes: Number(definition.totalParts || 1),
      Evidencias: Number(definition.evidences || 0),
      Estado: 'PENDIENTE',
      Intentos: 0,
      ResultadoID: '',
      ResultadoURL: '',
      Copiadas: 0,
      Existentes: 0,
      UltimoError: '',
      FechaInicio: '',
      FechaActualizacion: timestamp,
      FechaFinalizacion: '',
      CreadoPor: actor,
      ActualizadoPor: actor,
    };
  }).filter(Boolean);

  if (!creates.length) return current;
  await appendRows(FINALIZATION_ITEM_SHEET, creates, { chunkSize: WRITE_BATCH });
  current.push(...creates);
  return sortFinalizationItems(current);
}

export async function updateFinalizationItem(itemId, patch = {}) {
  await ensureMaintenanceFinalizationStorage();
  const updated = await updateRow(FINALIZATION_ITEM_SHEET, clean(itemId), {
    ...patch,
    FechaActualizacion: patch.FechaActualizacion || nowIso(),
  }, 'ItemID');
  const snapshot = activeItemSnapshot(updated?.JobID);
  if (snapshot?.items) mergeFinalizationItemSnapshot(snapshot.items, [updated]);
  return updated;
}

export async function updateFinalizationItems(updates = []) {
  if (!updates.length) return [];
  await ensureMaintenanceFinalizationStorage();
  const normalized = updates.map((update) => ({
    idValue: update.itemId,
    patch: {
      ...update.patch,
      FechaActualizacion: update.patch?.FechaActualizacion || nowIso(),
    },
  }));
  const updated = await updateRows(FINALIZATION_ITEM_SHEET, normalized, 'ItemID');
  const snapshots = new Map();
  for (const item of updated) {
    const snapshot = activeItemSnapshot(item?.JobID);
    if (snapshot?.items) snapshots.set(snapshot, snapshot.items);
  }
  for (const [snapshot, items] of snapshots) {
    const jobUpdates = updated.filter((item) => clean(item.JobID) === clean(snapshot.jobId));
    mergeFinalizationItemSnapshot(items, jobUpdates);
  }
  return updated;
}

function state(row) {
  return clean(row.Estado).toUpperCase();
}

export function summarizeFinalizationItems(items = []) {
  const tickets = [];
  const drive = [];
  const ticketCompleted = [];
  const driveCompleted = [];
  const pendingTickets = [];
  const pendingDrive = [];
  const failed = [];
  const deviceParts = new Map();
  let totalEvidences = 0;
  let processedEvidences = 0;
  let copied = 0;
  let existing = 0;

  for (const row of items) {
    const rowState = state(row);
    const type = clean(row.Tipo).toUpperCase();
    if (rowState === 'ERROR') failed.push(row);

    if (type === 'TICKET') {
      tickets.push(row);
      if (rowState === 'COMPLETADO') ticketCompleted.push(row);
      else pendingTickets.push(row);
      continue;
    }

    if (type !== 'DRIVE') continue;
    drive.push(row);
    const referenceId = clean(row.ReferenciaID);
    if (!deviceParts.has(referenceId)) deviceParts.set(referenceId, []);
    deviceParts.get(referenceId).push(row);
    totalEvidences += Number(row.Evidencias || 0);

    if (rowState === 'COMPLETADO') {
      driveCompleted.push(row);
      processedEvidences += Number(row.Evidencias || 0);
      copied += Number(row.Copiadas || 0);
      existing += Number(row.Existentes || 0);
    } else {
      pendingDrive.push(row);
    }
  }

  let completedDevices = 0;
  for (const parts of deviceParts.values()) {
    if (parts.length && parts.every((row) => state(row) === 'COMPLETADO')) completedDevices += 1;
  }

  return {
    tickets,
    drive,
    totalTickets: tickets.length,
    completedTickets: ticketCompleted.length,
    totalDevices: deviceParts.size,
    completedDevices,
    totalEvidences,
    processedEvidences,
    copied,
    existing,
    pendingTickets,
    pendingDrive,
    failed,
  };
}

export function progressForSummary(summary, phase = '') {
  const normalized = clean(phase).toUpperCase();
  if (normalized === 'COMPLETADO') return 100;
  if (!summary.totalTickets && !summary.totalDevices) return normalized === 'PREPARANDO' ? 2 : 5;
  const ticketsRatio = summary.totalTickets ? summary.completedTickets / summary.totalTickets : 1;
  const driveRatio = summary.totalDevices ? summary.completedDevices / summary.totalDevices : 1;
  if (normalized === 'PREPARANDO') return 5;
  if (normalized === 'BOLETAS') return Math.min(45, Math.max(5, Math.round(5 + ticketsRatio * 40)));
  if (normalized === 'DRIVE') return Math.min(95, Math.max(45, Math.round(45 + driveRatio * 50)));
  if (normalized === 'CIERRE') return 97;
  return Math.min(95, Math.max(5, Math.round(5 + ticketsRatio * 40 + driveRatio * 50)));
}
