import { env } from '../config/env.js';
import { TABLES, DATE_FIELDS, TIME_FIELDS } from '../config/tables.js';
import { sheetsApi } from './google.js';
import { AppError, notFound } from '../core/errors.js';

const headerCache = new Map();
const cacheMs = 60_000;

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

export async function getHeaders(sheetName, force = false) {
  const cached = headerCache.get(sheetName);
  if (!force && cached && Date.now() - cached.at < cacheMs) return cached.headers;
  const { data } = await sheetsApi.spreadsheets.values.get({ spreadsheetId: env.sheetId, range: `${quote(sheetName)}!1:1` });
  const headers = (data.values?.[0] || []).map(String).filter(Boolean);
  headerCache.set(sheetName, { at: Date.now(), headers });
  return headers;
}

export async function readTable(sheetName) {
  if (!TABLES[sheetName]) throw new Error(`Tabla no registrada: ${sheetName}`);
  const { data } = await sheetsApi.spreadsheets.values.get({ spreadsheetId: env.sheetId, range: `${quote(sheetName)}!A:ZZ`, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  const rows = data.values || [];
  const headers = (rows.shift() || []).map(String);
  return rows.map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => { if (header) record[header] = normalizeValue(header, row[index]); });
    return { record, hasData: row.some((value) => value !== '' && value !== null && value !== undefined) };
  }).filter((item) => item.hasData).map((item) => item.record);
}

export async function findById(sheetName, idValue, idColumn = TABLES[sheetName]?.id) {
  const rows = await readTable(sheetName);
  const row = rows.find((item) => String(item[idColumn] ?? '') === String(idValue ?? ''));
  if (!row) throw notFound(`No se encontró el registro en ${sheetName}.`);
  return row;
}

export async function appendRow(sheetName, record) {
  const headers = await getHeaders(sheetName);
  if (!headers.length) throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  await sheetsApi.spreadsheets.values.append({ spreadsheetId: env.sheetId, range: `${quote(sheetName)}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [headers.map((header) => writable(record[header]))] } });
  return record;
}

export async function updateRow(sheetName, idValue, patch, idColumn = TABLES[sheetName]?.id) {
  const headers = await getHeaders(sheetName);
  if (!headers.length) throw new Error(`La hoja ${sheetName} no tiene encabezados.`);

  const current = await findById(sheetName, idValue, idColumn);
  const merged = { ...current, ...patch };
  const writableFields = Object.entries(patch || {})
    .filter(([header]) => headers.includes(header));

  if (writableFields.length) {
    const data = writableFields.map(([header, value]) => {
      const column = columnLetter(headers.indexOf(header));
      return {
        range: `${quote(sheetName)}!${column}${current.__rowNumber}`,
        values: [[writable(value)]],
      };
    });

    try {
      await sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data,
        },
      });
    } catch (error) {
      if (isProtectedRangeError(error)) {
        throw new AppError(
          'SHEET_PROTECTED_RANGE',
          `La cuenta de servicio no puede editar una o más columnas protegidas de la hoja ${sheetName}.`,
          403,
          {
            sheetName,
            rowNumber: current.__rowNumber,
            columns: writableFields.map(([header]) => header),
          },
        );
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
