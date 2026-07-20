import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import { getHeaders, invalidateTableCache } from '../infra/sheets.repository.js';

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

const sheetTails = new Map();

async function ensureColumnCapacity(sheetName, requiredColumnCount) {
  const metadata = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
  });
  const sheet = (metadata.data.sheets || []).find(
    (item) => String(item.properties?.title) === String(sheetName),
  );
  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    throw new Error(`No se encontró la hoja ${sheetName} para ampliar sus columnas.`);
  }

  const currentColumnCount = Number(sheet.properties.gridProperties?.columnCount || 0);
  if (currentColumnCount >= requiredColumnCount) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: {
      requests: [{
        appendDimension: {
          sheetId: sheet.properties.sheetId,
          dimension: 'COLUMNS',
          length: Math.max(requiredColumnCount - currentColumnCount, 10),
        },
      }],
    },
  });
}

/**
 * Agrega encabezados faltantes al final de una hoja registrada.
 * Antes de escribir amplía físicamente la cuadrícula cuando no existen
 * suficientes columnas. Las operaciones de una misma hoja se serializan para
 * evitar que dos solicitudes intenten agregar encabezados en la misma posición.
 */
export async function ensureSheetColumns(sheetName, columns = []) {
  const requested = [...new Set((columns || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requested.length) return [];

  const previous = sheetTails.get(sheetName) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const headers = await getHeaders(sheetName, true);
    const missing = requested.filter((column) => !headers.includes(column));
    if (!missing.length) return headers;

    const start = headers.length;
    const end = start + missing.length - 1;
    await ensureColumnCapacity(sheetName, end + 1);
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!${columnLetter(start)}1:${columnLetter(end)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [missing] },
    });

    invalidateTableCache(sheetName);
    return getHeaders(sheetName, true);
  });

  const tracked = operation.finally(() => {
    if (sheetTails.get(sheetName) === tracked) sheetTails.delete(sheetName);
  });
  sheetTails.set(sheetName, tracked);
  return tracked;
}
