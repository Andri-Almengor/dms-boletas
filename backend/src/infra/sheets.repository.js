import { env } from '../config/env.js';
import { TABLES, DATE_FIELDS, TIME_FIELDS } from '../config/tables.js';
import { sheetsApi } from './google.js';
import { AppError, notFound } from '../core/errors.js';

const headerCache = new Map();
const tableCache = new Map();
const inflightReads = new Map();
const pendingReads = new Map();
const headerCacheMs = 60_000;
let readFlushTimer = null;

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
async function withQuotaRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt <= env.sheetsQuotaRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error) || attempt >= env.sheetsQuotaRetries) break;
      const jitter = Math.floor(Math.random() * 300);
      const delay = Math.min(env.sheetsQuotaBackoffMs * (2 ** attempt) + jitter, 8000);
      await sleep(delay);
    }
  }
  if (isQuotaError(lastError)) {
    throw new AppError(
      'SHEETS_QUOTA_EXCEEDED',
      'Google Sheets está recibiendo demasiadas lecturas o escrituras. Espere unos segundos y vuelva a intentarlo.',
      429,
      { retryAfterSeconds: 60 },
    );
  }
  throw lastError;
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
function getCachedTable(sheetName) {
  const cached = tableCache.get(sheetName);
  if (!cached || env.sheetsCacheTtlMs <= 0 || Date.now() - cached.at >= env.sheetsCacheTtlMs) return null;
  return cached.records;
}
export function invalidateTableCache(sheetName) {
  tableCache.delete(sheetName);
}
function invalidateSheetCaches(sheetName) {
  tableCache.delete(sheetName);
  headerCache.delete(sheetName);
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
      tableCache.set(sheetName, { at: Date.now(), records: parsed.records });
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
  if (!options.force) {
    const cached = getCachedTable(sheetName);
    if (cached) return cached;
  } else {
    invalidateTableCache(sheetName);
  }
  return queueTableRead(sheetName);
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
  const headers = await getHeaders(sheetName, true);
  const missing = columns.filter((column) => !headers.includes(column));
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
    await withQuotaRetry(() => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: metadata.sheetId,
            dimension: 'COLUMNS',
            length: requiredColumns - currentColumns,
          },
        }],
      },
    }));
  }

  const start = columnLetter(headers.length);
  const end = columnLetter(requiredColumns - 1);
  await withQuotaRetry(() => sheetsApi.spreadsheets.values.update({
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
    await withQuotaRetry(() => sheetsApi.spreadsheets.values.append({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: chunk.map((record) => headers.map((header) => writable(record[header]))) },
    }));
  }
  invalidateTableCache(sheetName);
  return records;
}

export async function appendRow(sheetName, record) {
  await appendRows(sheetName, [record], { chunkSize: 1 });
  return record;
}

export async function updateRow(sheetName, idValue, patch, idColumn = TABLES[sheetName]?.id) {
  const headers = await getHeaders(sheetName);
  if (!headers.length) throw new Error(`La hoja ${sheetName} no tiene encabezados.`);

  const current = await findById(sheetName, idValue, idColumn);
  const merged = { ...current, ...patch };
  const writableFields = Object.entries(patch || {}).filter(([header]) => headers.includes(header));

  if (writableFields.length) {
    const data = writableFields.map(([header, value]) => {
      const column = columnLetter(headers.indexOf(header));
      return { range: `${quote(sheetName)}!${column}${current.__rowNumber}`, values: [[writable(value)]] };
    });

    try {
      await withQuotaRetry(() => sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId: env.sheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } }));
      invalidateTableCache(sheetName);
    } catch (error) {
      if (isProtectedRangeError(error)) {
        throw new AppError('SHEET_PROTECTED_RANGE', `La cuenta de servicio no puede editar una o más columnas protegidas de la hoja ${sheetName}.`, 403, { sheetName, rowNumber: current.__rowNumber, columns: writableFields.map(([header]) => header) });
      }
      throw error;
    }
  }

  delete merged.__rowNumber;
  return merged;
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
