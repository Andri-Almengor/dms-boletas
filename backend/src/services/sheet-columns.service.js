import { ensureColumns } from '../infra/sheets.repository.js';

// Historical name retained for low-blast-radius compatibility. PostgreSQL
// columns are migration-owned and are never created dynamically at runtime.
export async function ensureSheetColumns(tableName, columns = []) {
  return ensureColumns(tableName, columns);
}
