import { ensureColumns } from '../infra/sheets.repository.js';
import { tableDefinition } from '../config/database-tables.js';

export async function ensureSheetTable(name, headers = []) {
  if (!tableDefinition(name)) throw new Error(`Tabla PostgreSQL no registrada: ${name}.`);
  await ensureColumns(name, headers);
  return headers;
}
export async function ensureSheetTables(definitions = {}) {
  for (const [name, headers] of Object.entries(definitions)) await ensureSheetTable(name, headers);
  return Object.keys(definitions);
}
