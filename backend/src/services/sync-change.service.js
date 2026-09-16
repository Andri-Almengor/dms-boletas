import { performance } from 'node:perf_hooks';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { sheetsApi } from '../infra/google.js';
import { appendRow, readTable, updateRow } from '../infra/sheets.repository.js';
import { mutationIdFrom, SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

export const SYNC_SHEET = 'SyncChanges';
export const SYNC_SCHEMA_VERSION = Math.max(1, Number(env.syncSchemaVersion || 1));
export const SYNC_CHANGE_HEADERS = Object.freeze([
  'ChangeID',
  'Resource',
  'EntityID',
  'Operation',
  'ParentID',
  'ChangedAt',
  'ActorUserID',
  'SourceRoute',
  'MutationID',
  'SchemaVersion',
  'Metadata',
]);

const GENERATION_KEY = 'INCREMENTAL_SYNC_GENERATION';
const UNSAFE_KEY = 'INCREMENTAL_SYNC_UNSAFE';
const CONFIG_DESCRIPTION = 'Estado interno del motor de sincronización incremental. No editar manualmente.';
const MAX_METADATA_CHARS = 1200;
const CURSOR_LABEL_CELL = 'L1';
const CURSOR_VALUE_CELL = 'L2';
let infrastructurePromise = null;
let descriptorPromise = null;
let cachedDescriptor = null;
let currentCursor = null;
let unsafeReason = '';
let eventWriteTail = Promise.resolve();

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function clean(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function rowValuesToChange(values = [], rowNumber = 0) {
  if (!Array.isArray(values) || !values.some((value) => value !== '' && value !== null && value !== undefined)) return null;
  const record = { __rowNumber: Number(rowNumber || 0) };
  SYNC_CHANGE_HEADERS.forEach((header, index) => { record[header] = values[index] ?? ''; });
  record.SchemaVersion = Number(record.SchemaVersion || 0);
  if (record.Metadata) {
    try { record.Metadata = JSON.parse(String(record.Metadata)); } catch { record.Metadata = {}; }
  } else {
    record.Metadata = {};
  }
  return record;
}

export function sanitizeSyncMetadata(metadata = null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const blocked = /(password|token|secret|base64|blob|file|image|video|firma|signature|webhook|private)/i;
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.test(String(key))) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      sanitized[clean(key, 80)] = typeof value === 'string' ? clean(value, 240) : value;
    }
  }
  const serialized = JSON.stringify(sanitized);
  return serialized.length <= MAX_METADATA_CHARS ? serialized : JSON.stringify({ truncated: true });
}

async function sheetProperties(title) {
  const response = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
  });
  return (response.data.sheets || []).find((sheet) => sheet.properties?.title === title)?.properties || null;
}

async function ensureSyncInfrastructureInternal() {
  let properties = await sheetProperties(SYNC_SHEET);
  if (!properties) {
    const response = await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: SYNC_SHEET,
              gridProperties: { rowCount: 1000, columnCount: 12 },
            },
          },
        }],
      },
    });
    properties = response.data.replies?.[0]?.addSheet?.properties || await sheetProperties(SYNC_SHEET);
  } else if (Number(properties.gridProperties?.columnCount || 0) < 12) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: properties.sheetId,
            dimension: 'COLUMNS',
            length: 12 - Number(properties.gridProperties?.columnCount || 0),
          },
        }],
      },
    });
  }

  const [headerResponse, cursorResponse] = await Promise.all([
    sheetsApi.spreadsheets.values.get({
      spreadsheetId: env.sheetId,
      range: `${quote(SYNC_SHEET)}!1:1`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheetsApi.spreadsheets.values.get({
      spreadsheetId: env.sheetId,
      range: `${quote(SYNC_SHEET)}!${CURSOR_LABEL_CELL}:${CURSOR_VALUE_CELL}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ]);
  const currentHeaders = (headerResponse.data.values?.[0] || []).slice(0, SYNC_CHANGE_HEADERS.length).map(String);
  const compatible = SYNC_CHANGE_HEADERS.every((header, index) => currentHeaders[index] === header);
  if (!compatible) {
    if (currentHeaders.some(Boolean)) {
      throw new AppError(
        'SYNC_SCHEMA_INCOMPATIBLE',
        'La hoja SyncChanges existe con un esquema incompatible. Se requiere reconciliación completa.',
        503,
      );
    }
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(SYNC_SHEET)}!A1:K1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SYNC_CHANGE_HEADERS] },
    });
  }

  const cursorValues = cursorResponse.data.values || [];
  const label = clean(cursorValues?.[0]?.[0]);
  const storedCursor = Number(cursorValues?.[1]?.[0]);
  if (label !== 'Cursor' || !Number.isInteger(storedCursor) || storedCursor < 1) {
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${quote(SYNC_SHEET)}!${CURSOR_LABEL_CELL}`, values: [['Cursor']] },
          { range: `${quote(SYNC_SHEET)}!${CURSOR_VALUE_CELL}`, values: [[1]] },
        ],
      },
    });
    currentCursor = 1;
  } else {
    currentCursor = storedCursor;
  }

  return { sheetId: properties?.sheetId ?? null };
}

export function ensureSyncInfrastructure() {
  if (!env.incrementalSyncEnabled) return Promise.resolve({ enabled: false });
  if (!infrastructurePromise) {
    infrastructurePromise = ensureSyncInfrastructureInternal().catch((error) => {
      infrastructurePromise = null;
      throw error;
    });
  }
  return infrastructurePromise;
}

async function writeConfigValue(key, value) {
  const rows = await readTable('Configuracion');
  const existing = rows.find((row) => String(row.Clave || '') === key);
  if (existing) {
    return updateRow('Configuracion', key, { Valor: String(value), Descripcion: existing.Descripcion || CONFIG_DESCRIPTION });
  }
  return appendRow('Configuracion', { Clave: key, Valor: String(value), Descripcion: CONFIG_DESCRIPTION });
}

async function rotateGeneration(reason = '') {
  const nextGeneration = uuid();
  await writeConfigValue(GENERATION_KEY, nextGeneration);
  try { await writeConfigValue(UNSAFE_KEY, ''); } catch { /* generation mismatch is already safe */ }
  unsafeReason = '';
  cachedDescriptor = {
    enabled: Boolean(env.incrementalSyncEnabled),
    generation: nextGeneration,
    schemaVersion: SYNC_SCHEMA_VERSION,
    unsafe: false,
    unsafeReason: '',
    lastReconcileReason: clean(reason, 240),
  };
  return cachedDescriptor;
}

async function readDescriptorInternal() {
  await ensureSyncInfrastructure();
  const rows = await readTable('Configuracion');
  let generation = clean(rows.find((row) => String(row.Clave || '') === GENERATION_KEY)?.Valor, 160);
  const persistedUnsafe = clean(rows.find((row) => String(row.Clave || '') === UNSAFE_KEY)?.Valor, 600);
  if (!generation) {
    generation = uuid();
    await writeConfigValue(GENERATION_KEY, generation);
  }
  if (persistedUnsafe) {
    unsafeReason = persistedUnsafe;
    try { return await rotateGeneration(persistedUnsafe); } catch { /* keep unsafe below */ }
  }
  cachedDescriptor = {
    enabled: Boolean(env.incrementalSyncEnabled),
    generation,
    schemaVersion: SYNC_SCHEMA_VERSION,
    unsafe: Boolean(unsafeReason),
    unsafeReason,
  };
  return cachedDescriptor;
}

export async function getSyncDescriptor({ force = false } = {}) {
  if (!env.incrementalSyncEnabled) {
    return { enabled: false, generation: '', schemaVersion: SYNC_SCHEMA_VERSION, unsafe: false, unsafeReason: '' };
  }
  if (!force && cachedDescriptor) return { ...cachedDescriptor, unsafe: Boolean(unsafeReason), unsafeReason };
  if (!descriptorPromise || force) {
    descriptorPromise = readDescriptorInternal().finally(() => { descriptorPromise = null; });
  }
  return descriptorPromise;
}

async function initializeCursor() {
  if (Number.isInteger(currentCursor)) return currentCursor;
  await ensureSyncInfrastructure();
  return Number.isInteger(currentCursor) ? currentCursor : 1;
}

export async function getSyncCursor() {
  return initializeCursor();
}

export async function readSyncChangesAfter(fromCursor, { limit = env.syncDeltaMaxEvents } = {}) {
  await ensureSyncInfrastructure();
  const tail = await initializeCursor();
  const cursor = Number(fromCursor || 1);
  const maxEvents = Math.max(1, Math.min(Number(limit || env.syncDeltaMaxEvents), env.syncDeltaMaxEvents));
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > tail) {
    return { invalidCursor: true, fromCursor: cursor, cursor: tail, hasMore: false, events: [], eventsScanned: 0 };
  }
  if (cursor === tail) {
    return { invalidCursor: false, fromCursor: cursor, cursor, hasMore: false, events: [], eventsScanned: 0 };
  }

  const endRow = Math.min(tail, cursor + maxEvents);
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range: `${quote(SYNC_SHEET)}!A${cursor + 1}:K${endRow}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = response.data.values || [];
  const events = [];
  for (let index = 0; index < rows.length; index += 1) {
    const change = rowValuesToChange(rows[index], cursor + 1 + index);
    if (change) events.push(change);
  }
  return {
    invalidCursor: false,
    fromCursor: cursor,
    cursor: endRow,
    hasMore: endRow < tail,
    events,
    eventsScanned: Math.max(0, endRow - cursor),
  };
}

function buildEvent({
  resource,
  entityId,
  operation = 'UPSERT',
  parentId = '',
  actorUserId = '',
  sourceRoute = '',
  mutationId = '',
  metadata = null,
} = {}) {
  const normalizedResource = clean(resource, 80);
  const normalizedEntity = clean(entityId, 180);
  if (!normalizedResource || !normalizedEntity) {
    throw new AppError('SYNC_EVENT_INVALID', 'No se pudo identificar el recurso modificado para sincronización.', 500);
  }
  return {
    ChangeID: uuid(),
    Resource: normalizedResource,
    EntityID: normalizedEntity,
    Operation: ['UPSERT', 'DELETE', 'INVALIDATE'].includes(operation) ? operation : 'UPSERT',
    ParentID: clean(parentId, 180),
    ChangedAt: nowIso(),
    ActorUserID: clean(actorUserId, 180),
    SourceRoute: clean(sourceRoute, 160),
    MutationID: clean(mutationId, 160),
    SchemaVersion: SYNC_SCHEMA_VERSION,
    Metadata: sanitizeSyncMetadata(metadata),
  };
}

export async function appendSyncChange(change = {}) {
  if (!env.incrementalSyncEnabled) return null;
  const operation = async () => {
    await ensureSyncInfrastructure();
    const event = buildEvent(change);
    const cursor = (await initializeCursor()) + 1;
    const values = SYNC_CHANGE_HEADERS.map((header) => event[header] ?? '');
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${quote(SYNC_SHEET)}!A${cursor}:K${cursor}`, values: [values] },
          { range: `${quote(SYNC_SHEET)}!${CURSOR_VALUE_CELL}`, values: [[cursor]] },
        ],
      },
    });
    currentCursor = cursor;
    return { ...event, cursor };
  };
  const current = eventWriteTail.then(operation, operation);
  eventWriteTail = current.catch(() => {});
  return current;
}

export async function markSyncUnsafe(reason = 'changelog_write_failed') {
  unsafeReason = clean(reason, 600) || 'changelog_write_failed';
  cachedDescriptor = cachedDescriptor ? { ...cachedDescriptor, unsafe: true, unsafeReason } : null;
  try {
    await writeConfigValue(UNSAFE_KEY, unsafeReason);
    return await rotateGeneration(unsafeReason);
  } catch {
    // Keep the process unsafe if the generation cannot be rotated. On the
    // next descriptor read the persisted unsafe marker retries the rotation.
    return cachedDescriptor;
  }
}

export async function clearSyncUnsafeAfterReconciliation() {
  unsafeReason = '';
  try { await writeConfigValue(UNSAFE_KEY, ''); } catch { return false; }
  if (cachedDescriptor) cachedDescriptor = { ...cachedDescriptor, unsafe: false, unsafeReason: '' };
  return true;
}

export async function recordClassifiedSyncChange(classification, ctx = {}) {
  if (!env.incrementalSyncEnabled || !classification || classification.classification === SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED) return null;
  const startedAt = performance.now();
  try {
    return await appendSyncChange({
      resource: classification.resource,
      entityId: classification.entityId,
      operation: classification.operation,
      parentId: classification.parentId,
      actorUserId: ctx.user?.UsuarioID || '',
      sourceRoute: ctx.route || '',
      mutationId: mutationIdFrom(ctx.payload),
      metadata: classification.metadata,
    });
  } catch (error) {
    await markSyncUnsafe(`${ctx.route || 'unknown'}:${error?.code || error?.message || 'sync_change_failed'}`);
    throw new AppError(
      'SYNC_CHANGELOG_UNSAFE',
      'La operación de negocio se completó, pero no fue posible confirmar su evento de sincronización. Se forzará una reconciliación completa.',
      503,
      { syncReconcileRequired: true, handlerMs: Math.round(performance.now() - startedAt) },
    );
  }
}

export function syncChangeServiceSnapshot() {
  return {
    enabled: Boolean(env.incrementalSyncEnabled),
    schemaVersion: SYNC_SCHEMA_VERSION,
    cursor: currentCursor,
    unsafe: Boolean(unsafeReason),
    unsafeReason,
  };
}
