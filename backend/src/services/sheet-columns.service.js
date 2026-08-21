import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import { ensureColumns, getHeaders } from '../infra/sheets.repository.js';

const sheetTails = new Map();
const confirmedColumns = new Map();

function confirmedSet(sheetName) {
  if (!confirmedColumns.has(sheetName)) confirmedColumns.set(sheetName, new Set());
  return confirmedColumns.get(sheetName);
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function isGridLimitError(error) {
  const text = `${error?.message || ''} ${error?.response?.data?.error?.message || ''}`.toLowerCase();
  return text.includes('exceeds grid limits')
    || (text.includes('max columns') && text.includes('range'));
}

async function repairGridAndHeaders(sheetName, requested) {
  const headerResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range: `${quote(sheetName)}!1:1`,
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rawHeaders = (headerResponse.data.values?.[0] || []).map((value) => String(value ?? '').trim());
  const existing = new Set(rawHeaders.filter(Boolean));
  const missing = requested.filter((column) => !existing.has(column));
  if (!missing.length) return;

  const metadataResponse = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
  });
  const metadata = (metadataResponse.data.sheets || [])
    .find((sheet) => sheet.properties?.title === sheetName)?.properties;
  if (!metadata) throw new Error(`No se encontró la hoja ${sheetName}.`);

  const startColumnIndex = rawHeaders.length;
  const requiredColumns = startColumnIndex + missing.length;
  const currentColumns = Number(metadata.gridProperties?.columnCount || 0);
  const requests = [];

  if (currentColumns < requiredColumns) {
    requests.push({
      appendDimension: {
        sheetId: metadata.sheetId,
        dimension: 'COLUMNS',
        length: requiredColumns - currentColumns,
      },
    });
  }

  requests.push({
    updateCells: {
      range: {
        sheetId: metadata.sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex,
        endColumnIndex: requiredColumns,
      },
      rows: [{
        values: missing.map((column) => ({
          userEnteredValue: { stringValue: column },
        })),
      }],
      fields: 'userEnteredValue',
    },
  });

  // appendDimension y updateCells viajan en el mismo batch. Google Sheets
  // aplica las solicitudes en orden, evitando que el encabezado se escriba
  // antes de que la cuadrícula haya crecido físicamente.
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: { requests },
  });
}

async function ensureColumnsResilient(sheetName, requested) {
  try {
    return await ensureColumns(sheetName, requested);
  } catch (error) {
    if (!isGridLimitError(error)) throw error;
    await repairGridAndHeaders(sheetName, requested);
    // Reutiliza el camino normal para invalidar/refrescar las cachés del repositorio.
    return ensureColumns(sheetName, requested);
  }
}

/**
 * Verifica encabezados una sola vez por proceso y únicamente vuelve a consultar
 * Google Sheets cuando aparece una columna que todavía no ha sido confirmada.
 * Las operaciones de una misma hoja se serializan para evitar escrituras dobles.
 */
export async function ensureSheetColumns(sheetName, columns = []) {
  const requested = [...new Set((columns || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requested.length) return [];

  const known = confirmedSet(sheetName);
  if (requested.every((column) => known.has(column))) return [...known];

  const previous = sheetTails.get(sheetName) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const currentKnown = confirmedSet(sheetName);
    if (requested.every((column) => currentKnown.has(column))) return [...currentKnown];

    const headers = await getHeaders(sheetName);
    headers.forEach((header) => currentKnown.add(header));
    const missing = requested.filter((column) => !currentKnown.has(column));
    if (!missing.length) return headers;

    const ensured = await ensureColumnsResilient(sheetName, requested);
    ensured.forEach((header) => currentKnown.add(header));
    return ensured;
  });

  const tracked = operation.finally(() => {
    if (sheetTails.get(sheetName) === tracked) sheetTails.delete(sheetName);
  });
  sheetTails.set(sheetName, tracked);
  return tracked;
}
