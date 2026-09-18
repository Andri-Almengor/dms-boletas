import { ensureColumns } from '../infra/sheets.repository.js';

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

async function ensureSchemaInternal() {
  for (const [table, headers] of Object.entries(TABLE_DEFINITIONS)) {
    await ensureColumns(table, headers);
  }
  return { created: [], tables: Object.keys(TABLE_DEFINITIONS) };
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
