import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import { ensureColumns, invalidateTableCache } from '../infra/sheets.repository.js';

const pending = new Map();

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function sheetMetadata(name) {
  const { data } = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
  });
  return (data.sheets || []).find((sheet) => sheet.properties?.title === name)?.properties || null;
}

async function createSheet(name) {
  try {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: name } } }],
      },
    });
  } catch (error) {
    const message = `${error?.message || ''} ${error?.response?.data?.error?.message || ''}`.toLowerCase();
    if (!message.includes('already exists') && !message.includes('ya existe')) throw error;
  }
}

async function ensureSheetTableInternal(name, headers) {
  const expected = [...new Set((headers || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!name || !expected.length) throw new Error('La definición de la tabla es inválida.');

  let metadata = await sheetMetadata(name);
  if (!metadata) {
    await createSheet(name);
    metadata = await sheetMetadata(name);
  }
  if (!metadata) throw new Error(`No fue posible crear la hoja ${name}.`);

  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range: `${quote(name)}!1:1`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const current = (data.values?.[0] || []).map((value) => String(value || '').trim()).filter(Boolean);

  if (!current.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(name)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [expected] },
    });
    invalidateTableCache(name);
    return expected;
  }

  await ensureColumns(name, expected);
  invalidateTableCache(name);
  return expected;
}

export function ensureSheetTable(name, headers) {
  if (pending.has(name)) return pending.get(name);
  const promise = ensureSheetTableInternal(name, headers).finally(() => pending.delete(name));
  pending.set(name, promise);
  return promise;
}

export async function ensureSheetTables(definitions = {}) {
  for (const [name, headers] of Object.entries(definitions)) {
    await ensureSheetTable(name, headers);
  }
  return Object.keys(definitions);
}
