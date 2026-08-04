import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import { ensureColumns, invalidateTableCache } from '../infra/sheets.repository.js';

export const PASSWORD_VAULT_CATEGORY_HEADERS = Object.freeze([
  'CategoriaCredencialID',
  'Nombre',
  'Descripcion',
  'Estado',
  'FechaCreacion',
  'FechaActualizacion',
  'CreadoPor',
  'ActualizadoPor',
  'Activo',
]);

export const PASSWORD_VAULT_CREDENTIAL_HEADERS = Object.freeze([
  'CredencialID',
  'ClienteID',
  'CategoriaCredencialID',
  'Nombre',
  'Usuario',
  'PasswordCiphertext',
  'PasswordIV',
  'PasswordTag',
  'PasswordVersion',
  'URL',
  'Notas',
  'Version',
  'FechaCreacion',
  'FechaActualizacion',
  'CreadoPor',
  'ActualizadoPor',
  'Activo',
]);

const TABLE_DEFINITIONS = Object.freeze({
  CategoriasCredenciales: PASSWORD_VAULT_CATEGORY_HEADERS,
  CredencialesClientes: PASSWORD_VAULT_CREDENTIAL_HEADERS,
});

let schemaPromise = null;

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function spreadsheetSheets() {
  const { data } = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
  });
  return data.sheets || [];
}

async function createMissingSheets(existingTitles) {
  const missing = Object.keys(TABLE_DEFINITIONS).filter((title) => !existingTitles.has(title));
  if (!missing.length) return [];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: {
      requests: missing.map((title) => ({
        addSheet: {
          properties: {
            title,
            gridProperties: {
              rowCount: 1000,
              columnCount: Math.max(26, TABLE_DEFINITIONS[title].length),
              frozenRowCount: 1,
            },
          },
        },
      })),
    },
  });

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: missing.map((title) => ({
        range: `${quote(title)}!A1`,
        values: [TABLE_DEFINITIONS[title]],
      })),
    },
  });

  missing.forEach((title) => invalidateTableCache(title));
  return missing;
}

async function ensureSchemaInternal() {
  const sheets = await spreadsheetSheets();
  const titles = new Set(sheets.map((sheet) => String(sheet.properties?.title || '')));
  const created = await createMissingSheets(titles);

  for (const [title, headers] of Object.entries(TABLE_DEFINITIONS)) {
    if (!created.includes(title)) await ensureColumns(title, headers);
  }

  return { created, tables: Object.keys(TABLE_DEFINITIONS) };
}

export async function ensurePasswordVaultSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSchemaInternal().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
