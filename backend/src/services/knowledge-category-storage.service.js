import { env } from '../config/env.js';
import { getHeaders, invalidateTableCache } from '../infra/sheets.repository.js';
import { sheetsApi } from '../infra/google.js';

export const KNOWLEDGE_CATEGORY_RELATION_SHEET = 'KnowledgeArticleCategories';
export const KNOWLEDGE_CATEGORY_RELATION_HEADERS = [
  'RelacionArticuloCategoriaID',
  'TutorialID',
  'CategoriaConocimientoID',
  'Orden',
  'Activo',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
];

let ensurePromise = null;
let ensured = false;

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

async function ensureHeaders() {
  const range = `${quote(KNOWLEDGE_CATEGORY_RELATION_SHEET)}!1:1`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range,
  });
  const current = (data.values?.[0] || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const missing = KNOWLEDGE_CATEGORY_RELATION_HEADERS.filter((header) => !current.includes(header));
  const headers = current.length ? [...current, ...missing] : [...KNOWLEDGE_CATEGORY_RELATION_HEADERS];

  if (!current.length || missing.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(KNOWLEDGE_CATEGORY_RELATION_SHEET)}!A1:${columnLetter(headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  invalidateTableCache(KNOWLEDGE_CATEGORY_RELATION_SHEET);
  await getHeaders(KNOWLEDGE_CATEGORY_RELATION_SHEET, true);
}

export async function ensureKnowledgeCategoryStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId: env.sheetId,
      fields: 'sheets.properties.title',
    });
    const exists = (data.sheets || []).some(
      (sheet) => sheet.properties?.title === KNOWLEDGE_CATEGORY_RELATION_SHEET,
    );

    if (!exists) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: KNOWLEDGE_CATEGORY_RELATION_SHEET } } }],
        },
      });
    }

    await ensureHeaders();
    ensured = true;
  })().catch((error) => {
    ensured = false;
    throw error;
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}
