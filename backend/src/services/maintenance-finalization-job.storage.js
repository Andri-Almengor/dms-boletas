import { env } from '../config/env.js';
import {
  appendRows,
  findById,
  getHeaders,
  invalidateTableCache,
  readTable,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { sheetsApi } from '../infra/google.js';
import { nowIso, sha256, uuid } from '../core/utils.js';

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

const ENSURE = new Map();
const WRITE_BATCH = 100;

function clean(value) {
  return String(value ?? '').trim();
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function ensureSheet(sheetName, headers) {
  if (ENSURE.has(sheetName)) return ENSURE.get(sheetName);
  const promise = (async () => {
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId: env.sheetId,
      fields: 'sheets.properties.title',
    });
    const exists = (data.sheets || []).some((sheet) => sheet.properties?.title === sheetName);
    if (!exists) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });
    }

    const { data: values } = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!1:1`,
    });
    const current = (values.values?.[0] || []).map((value) => clean(value)).filter(Boolean);
    const missing = headers.filter((header) => !current.includes(header));
    const finalHeaders = current.length ? [...current, ...missing] : [...headers];
    if (!current.length || missing.length) {
      await sheetsApi.spreadsheets.values.update({
        spreadsheetId: env.sheetId,
        range: `${quote(sheetName)}!A1:${columnLetter(finalHeaders.length - 1)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [finalHeaders] },
      });
    }
    invalidateTableCache(sheetName);
    await getHeaders(sheetName, true);
  })().catch((error) => {
    ENSURE.delete(sheetName);
    throw error;
  });
  ENSURE.set(sheetName, promise);
  return promise;
}

export async function ensureMaintenanceFinalizationStorage() {
  await Promise.all([
    ensureSheet(FINALIZATION_JOB_SHEET, FINALIZATION_JOB_HEADERS),
    ensureSheet(FINALIZATION_ITEM_SHEET, FINALIZATION_ITEM_HEADERS),
  ]);
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
  const rows = await readTable(FINALIZATION_JOB_SHEET);
  return rows
    .filter((row) => clean(row.MantenimientoID) === clean(maintenanceId))
    .sort((a, b) => Number(b.__rowNumber || 0) - Number(a.__rowNumber || 0))[0] || null;
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
  const rows = await readTable(FINALIZATION_ITEM_SHEET);
  return rows
    .filter((row) => clean(row.JobID) === clean(jobId))
    .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
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

  if (creates.length) await appendRows(FINALIZATION_ITEM_SHEET, creates, { chunkSize: WRITE_BATCH });
  return listFinalizationItems(job.JobID);
}

export async function updateFinalizationItem(itemId, patch = {}) {
  await ensureMaintenanceFinalizationStorage();
  return updateRow(FINALIZATION_ITEM_SHEET, clean(itemId), {
    ...patch,
    FechaActualizacion: patch.FechaActualizacion || nowIso(),
  }, 'ItemID');
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
  return updateRows(FINALIZATION_ITEM_SHEET, normalized, 'ItemID');
}

function state(row) {
  return clean(row.Estado).toUpperCase();
}

export function summarizeFinalizationItems(items = []) {
  const tickets = items.filter((row) => clean(row.Tipo).toUpperCase() === 'TICKET');
  const drive = items.filter((row) => clean(row.Tipo).toUpperCase() === 'DRIVE');
  const ticketCompleted = tickets.filter((row) => state(row) === 'COMPLETADO');
  const driveCompleted = drive.filter((row) => state(row) === 'COMPLETADO');
  const deviceParts = new Map();
  drive.forEach((row) => {
    const id = clean(row.ReferenciaID);
    if (!deviceParts.has(id)) deviceParts.set(id, []);
    deviceParts.get(id).push(row);
  });
  const completedDevices = [...deviceParts.values()].filter(
    (parts) => parts.length && parts.every((row) => state(row) === 'COMPLETADO'),
  ).length;
  const totalEvidences = drive.reduce((sum, row) => sum + Number(row.Evidencias || 0), 0);
  const processedEvidences = driveCompleted.reduce((sum, row) => sum + Number(row.Evidencias || 0), 0);
  const copied = driveCompleted.reduce((sum, row) => sum + Number(row.Copiadas || 0), 0);
  const existing = driveCompleted.reduce((sum, row) => sum + Number(row.Existentes || 0), 0);

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
    pendingTickets: tickets.filter((row) => !['COMPLETADO'].includes(state(row))),
    pendingDrive: drive.filter((row) => !['COMPLETADO'].includes(state(row))),
    failed: items.filter((row) => state(row) === 'ERROR'),
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
