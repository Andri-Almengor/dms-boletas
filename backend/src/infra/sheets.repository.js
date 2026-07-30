import { env } from '../config/env.js';
import { TABLES, DATE_FIELDS, TIME_FIELDS } from '../config/tables.js';
import { sheetsApi } from './google.js';
import { AppError, notFound } from '../core/errors.js';

const headerCache = new Map();
const tableCache = new Map();
const staleTableCache = new Map();
const inflightReads = new Map();
const pendingReads = new Map();
const headerCacheMs = 5 * 60_000;
let readFlushTimer = null;
let activeWrites = 0;
let lastWriteStartedAt = 0;
const writeWaiters = [];

function quote(name) { return `'${String(name).replace(/'/g, "''")}'`; }
function columnLetter(index) {
  let result = ''; let n = index + 1;
  while (n > 0) { const r = (n - 1) % 26; result = String.fromCharCode(65 + r) + result; n = Math.floor((n - 1) / 26); }
  return result;
}
function serialToDate(value) {
  const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
function serialToTime(value) {
  const seconds = Math.round((Number(value) % 1) * 86400);
  const h = String(Math.floor(seconds / 3600) % 24).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}`;
}
function normalizeValue(header, value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && DATE_FIELDS.has(header)) return serialToDate(value);
  if (typeof value === 'number' && TIME_FIELDS.has(header)) return serialToTime(value);
  return value;
}
function writable(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
function isProtectedRangeError(error) {
  const text = `${error?.message || ''} ${error?.response?.data?.error?.message || ''}`.toLowerCase();
  return text.includes('protected cell') || text.includes('protected range') || text.includes('protected object');
}
function isQuotaError(error) {
  const status = Number(error?.response?.status || error?.status || error?.code || 0);
  const text = `${error?.message || ''} ${error?.response?.data?.error?.message || ''}`.toLowerCase();
  return status === 429 || text.includes('quota exceeded') || text.includes('resource_exhausted') || text.includes('rate limit');
}
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function retryAfterMs(error) {
  const value = Number(error?.response?.headers?.['retry-after'] || error?.response?.headers?.get?.('retry-after') || 0);
  return Number.isFinite(value) && value > 0 ? value * 1000 : 0;
}
async function withQuotaRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt <= env.sheetsQuotaRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error) || attempt >= env.sheetsQuotaRetries) break;
      const jitter = Math.floor(Math.random() * 500);
      const exponential = env.sheetsQuotaBackoffMs * (2 ** attempt) + jitter;
      const delay = Math.max(retryAfterMs(error), Math.min(exponential, env.sheetsQuotaMaxBackoffMs));
      await sleep(delay);
    }
  }
  if (isQuotaError(lastError)) {
    throw new AppError(
      'SHEETS_QUOTA_EXCEEDED',
      'Google Sheets está recibiendo demasiadas lecturas o escrituras. Espere unos segundos y vuelva a intentarlo.',
      429,
      { retryAfterSeconds: Math.max(5, Math.ceil(env.sheetsQuotaMaxBackoffMs / 1000)) },
    );
  }
  throw lastError;
}

async function acquireWriteSlot() {
  if (activeWrites < env.sheetsMaxConcurrentWrites) {
    activeWrites += 1;
    return;
  }
  await new Promise((resolve) => writeWaiters.push(resolve));
  activeWrites += 1;
}
function releaseWriteSlot() {
  activeWrites = Math.max(0, activeWrites - 1);
  writeWaiters.shift()?.();
}
async function withWriteSlot(operation) {
  await acquireWriteSlot();
  try {
    const remaining = env.sheetsWriteMinIntervalMs - (Date.now() - lastWriteStartedAt);
    if (remaining > 0) await sleep(remaining);
    lastWriteStartedAt = Date.now();
    return await withQuotaRetry(operation);
  } finally {
    releaseWriteSlot();
  }
}

function parseTable(values = []) {
  const rows = values.map((row) => [...row]);
  const headers = (rows.shift() || []).map(String);
  const records = rows.map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => { if (header) record[header] = normalizeValue(header, row[index]); });
    return { record, hasData: row.some((value) => value !== '' && value !== null && value !== undefined) };
  }).filter((item) => item.hasData).map((item) => item.record);
  return { headers: headers.filter(Boolean), records };
}
function getCachedEntry(sheetName) {
  const cached = tableCache.get(sheetName);
  if (!cached || env.sheetsCacheTtlMs <= 0 || Date.now() - cached.at >= env.sheetsCacheTtlMs) return null;
  return cached;
}
function getCachedTable(sheetName) { return getCachedEntry(sheetName)?.records || null; }
function setTableCache(sheetName, records, at = Date.now()) {
  const entry = { at, records };
  tableCache.set(sheetName, entry);
  staleTableCache.set(sheetName, entry);
}
export function invalidateTableCache(sheetName) { tableCache.delete(sheetName); }
function invalidateSheetCaches(sheetName) {
  tableCache.delete(sheetName);
  headerCache.delete(sheetName);
}
function parseUpdatedStartRow(updatedRange = '') {
  const match = String(updatedRange).match(/![A-Z]+(\d+):[A-Z]+\d+$/i);
  return match ? Number(match[1]) : 0;
}
function appendToCachedTable(sheetName, headers, records, updatedRange) {
  const cached = tableCache.get(sheetName);
  if (!cached) {
    invalidateTableCache(sheetName);
    return;
  }
  const fallbackStart = cached.records.reduce((max, row) => Math.max(max, Number(row.__rowNumber || 0)), 1) + 1;
  const startRow = parseUpdatedStartRow(updatedRange) || fallbackStart;
  const appended = records.map((record, index) => {
    const normalized = { __rowNumber: startRow + index };
    headers.forEach((header) => { normalized[header] = normalizeValue(header, writable(record[header])); });
    return normalized;
  });
  setTableCache(sheetName, [...cached.records, ...appended]);
}
function patchCachedRows(sheetName, patchesByRowNumber = new Map()) {
  const cached = tableCache.get(sheetName);
  if (!cached) {
    invalidateTableCache(sheetName);
    return;
  }
  const records = cached.records.map((row) => {
    const patch = patchesByRowNumber.get(Number(row.__rowNumber));
    return patch ? { ...row, ...patch, __rowNumber: row.__rowNumber } : row;
  });
  setTableCache(sheetName, records);
}

async function flushPendingReads() {
  readFlushTimer = null;
  const batch = new Map(pendingReads);
  pendingReads.clear();
  const namesToLoad = [];

  for (const [sheetName, deferred] of batch.entries()) {
    const cached = getCachedTable(sheetName);
    if (cached) {
      inflightReads.delete(sheetName);
      deferred.resolve(cached);
    } else {
      namesToLoad.push(sheetName);
    }
  }
  if (!namesToLoad.length) return;

  try {
    const { data } = await withQuotaRetry(() => sheetsApi.spreadsheets.values.batchGet({
      spreadsheetId: env.sheetId,
      ranges: namesToLoad.map((sheetName) => `${quote(sheetName)}!A:ZZ`),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }));

    namesToLoad.forEach((sheetName, index) => {
      const parsed = parseTable(data.valueRanges?.[index]?.values || []);
      setTableCache(sheetName, parsed.records);
      headerCache.set(sheetName, { at: Date.now(), headers: parsed.headers });
      inflightReads.delete(sheetName);
      batch.get(sheetName)?.resolve(parsed.records);
    });
  } catch (error) {
    namesToLoad.forEach((sheetName) => {
      inflightReads.delete(sheetName);
      batch.get(sheetName)?.reject(error);
    });
  }
}
function queueTableRead(sheetName) {
  const existing = inflightReads.get(sheetName);
  if (existing) return existing;
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  inflightReads.set(sheetName, promise);
  pendingReads.set(sheetName, { resolve, reject });
  if (!readFlushTimer) readFlushTimer = setTimeout(flushPendingReads, env.sheetsBatchWindowMs);
  return promise;
}

export async function getHeaders(sheetName, force = false) {
  const cached = headerCache.get(sheetName);
  if (!force && cached && Date.now() - cached.at < headerCacheMs) return cached.headers;
  await readTable(sheetName, { force });
  return headerCache.get(sheetName)?.headers || [];
}
export async function readTable(sheetName, options = {}) {
  if (!TABLES[sheetName]) throw new Error(`Tabla no registrada: ${sheetName}`);
  const cachedEntry = tableCache.get(sheetName);
  if (!options.force) {
    const cached = getCachedTable(sheetName);
    if (cached) return cached;
  } else if (cachedEntry && Date.now() - cachedEntry.at < env.sheetsForceCoalesceMs) {
    return cachedEntry.records;
  } else {
    invalidateTableCache(sheetName);
  }

  try {
    return await queueTableRead(sheetName);
  } catch (error) {
    const stale = staleTableCache.get(sheetName)?.records;
    if (!options.force && isQuotaError(error) && stale) return stale;
    throw error;
  }
}
export async function readTables(sheetNames, options = {}) {
  const names = [...new Set(sheetNames || [])];
  const values = await Promise.all(names.map((sheetName) => readTable(sheetName, options)));
  return Object.fromEntries(names.map((sheetName, index) => [sheetName, values[index]]));
}
export async function findById(sheetName, idValue, idColumn = TABLES[sheetName]?.id) {
  const rows = await readTable(sheetName);
  const row = rows.find((item) => String(item[idColumn] ?? '') === String(idValue ?? ''));
  if (!row) throw notFound(`No se encontró el registro en ${sheetName}.`);
  return row;
}

export async function ensureColumns(sheetName, requestedColumns = []) {
  const columns = [...new Set((requestedColumns || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!columns.length) return getHeaders(sheetName);
  let headers = await getHeaders(sheetName);
  let missing = columns.filter((column) => !headers.includes(column));
  if (!missing.length) return headers;

  headers = await getHeaders(sheetName, true);
  missing = columns.filter((column) => !headers.includes(column));
  if (!missing.length) return headers;

  const { data } = await withQuotaRetry(() => sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
  }));
  const metadata = (data.sheets || []).find((sheet) => sheet.properties?.title === sheetName)?.properties;
  if (!metadata) throw new Error(`No se encontró la hoja ${sheetName}.`);
  const requiredColumns = headers.length + missing.length;
  const currentColumns = Number(metadata.gridProperties?.columnCount || 0);
  if (currentColumns < requiredColumns) {
    await withWriteSlot(() => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: { requests: [{ appendDimension: { sheetId: metadata.sheetId, dimension: 'COLUMNS', length: requiredColumns - currentColumns } }] },
    }));
  }

  const start = columnLetter(headers.length);
  const end = columnLetter(requiredColumns - 1);
  await withWriteSlot(() => sheetsApi.spreadsheets.values.update({
    spreadsheetId: env.sheetId,
    range: `${quote(sheetName)}!${start}1:${end}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  }));
  invalidateSheetCaches(sheetName);
  return getHeaders(sheetName, true);
}

export async function appendRows(sheetName, records = [], options = {}) {
  if (!records.length) return [];
  const headers = await getHeaders(sheetName);
  if (!headers.length) throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  const chunkSize = Math.max(1, Math.min(500, Number(options.chunkSize || 300)));
  for (let offset = 0; offset < records.length; offset += chunkSize) {
    const chunk = records.slice(offset, offset + chunkSize);
    const response = await withWriteSlot(() => sheetsApi.spreadsheets.values.append({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: chunk.map((record) => headers.map((header) => writable(record[header]))) },
    }));
    appendToCachedTable(sheetName, headers, chunk, response?.data?.updates?.updatedRange);
  }
  return records;
}
export async function appendRow(sheetName, record) {
  await appendRows(sheetName, [record], { chunkSize: 1 });
  return record;
}
export async function updateRows(sheetName, updates = [], idColumn = TABLES[sheetName]?.id) {
  if (!updates.length) return [];
  const headers = await getHeaders(sheetName);
  if (!headers.length) throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  const rows = await readTable(sheetName);
  const rowsById = new Map(rows.map((row) => [String(row[idColumn] ?? ''), row]));
  const data = [];
  const cachePatches = new Map();
  const results = [];
  const columns = new Set();
  const rowNumbers = new Set();

  for (const update of updates) {
    const idValue = update?.idValue;
    const patch = update?.patch || {};
    const key = String(idValue ?? '');
    const current = rowsById.get(key);
    if (!current) throw notFound(`No se encontró el registro en ${sheetName}.`);

    const writableFields = Object.entries(patch).filter(([header]) => headers.includes(header));
    const rowNumber = Number(current.__rowNumber);
    const currentCachePatch = cachePatches.get(rowNumber) || {};
    const persistedPatch = Object.fromEntries(writableFields);
    cachePatches.set(rowNumber, { ...currentCachePatch, ...persistedPatch });
    rowNumbers.add(rowNumber);

    writableFields.forEach(([header, value]) => {
      columns.add(header);
      data.push({
        range: `${quote(sheetName)}!${columnLetter(headers.indexOf(header))}${rowNumber}`,
        values: [[writable(value)]],
      });
    });

    const merged = { ...current, ...patch };
    rowsById.set(key, { ...merged, __rowNumber: rowNumber });
    delete merged.__rowNumber;
    results.push(merged);
  }

  if (data.length) {
    try {
      await withWriteSlot(() => sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      }));
      patchCachedRows(sheetName, cachePatches);
    } catch (error) {
      if (isProtectedRangeError(error)) {
        const affectedRows = [...rowNumbers];
        const details = {
          sheetName,
          rowNumbers: affectedRows,
          columns: [...columns],
        };
        if (affectedRows.length === 1) details.rowNumber = affectedRows[0];
        throw new AppError(
          'SHEET_PROTECTED_RANGE',
          `La cuenta de servicio no puede editar una o más columnas protegidas de la hoja ${sheetName}.`,
          403,
          details,
        );
      }
      throw error;
    }
  }

  return results;
}
export async function updateRow(sheetName, idValue, patch, idColumn = TABLES[sheetName]?.id) {
  return (await updateRows(sheetName, [{ idValue, patch }], idColumn))[0];
}
export async function softDelete(sheetName, idValue, actor = '') {
  return updateRow(sheetName, idValue, { Activo: false, Estado: 'INACTIVO', ActualizadoPor: actor, FechaActualizacion: new Date().toISOString() });
}
export function filterRows(rows, payload = {}, searchFields = []) {
  const search = String(payload.search || payload.q || '').trim().toLowerCase();
  let result = rows.filter((row) => {
    if (payload.activo !== undefined && String(row.Activo).toLowerCase() !== String(payload.activo).toLowerCase()) return false;
    if (payload.estado && String(row.Estado || '').toUpperCase() !== String(payload.estado).toUpperCase()) return false;
    if (payload.clienteId && String(row.ClienteID || row.ClienteRef || '') !== String(payload.clienteId)) return false;
    if (search && !searchFields.some((field) => String(row[field] || '').toLowerCase().includes(search))) return false;
    return true;
  });
  if (payload.sortBy) result.sort((a, b) => String(a[payload.sortBy] || '').localeCompare(String(b[payload.sortBy] || ''), 'es') * (String(payload.sortDir).toLowerCase() === 'desc' ? -1 : 1));
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const total = result.length;
  result = result.slice((page - 1) * pageSize, page * pageSize);
  return { items: result.map(({ __rowNumber, ...row }) => row), total, page, pageSize };
}
