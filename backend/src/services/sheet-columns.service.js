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

const pending = new Map();

/**
 * Agrega encabezados faltantes al final de una hoja registrada.
 * La operación es idempotente y comparte la misma promesa cuando varias
 * solicitudes intentan preparar la misma hoja al mismo tiempo.
 */
export async function ensureSheetColumns(sheetName, columns = []) {
  const requested = [...new Set((columns || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requested.length) return [];

  const key = `${sheetName}:${requested.sort().join('|')}`;
  if (pending.has(key)) return pending.get(key);

  const operation = (async () => {
    const headers = await getHeaders(sheetName, true);
    const missing = requested.filter((column) => !headers.includes(column));
    if (!missing.length) return headers;

    const start = headers.length;
    const end = start + missing.length - 1;
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!${columnLetter(start)}1:${columnLetter(end)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [missing] },
    });

    invalidateTableCache(sheetName);
    return getHeaders(sheetName, true);
  })().finally(() => pending.delete(key));

  pending.set(key, operation);
  return operation;
}
