import { readTable } from '../infra/sheets.repository.js';
export async function getConfig() {
  const rows = await readTable('Configuracion'); const result = {};
  rows.forEach((row) => { if (row.Clave) result[row.Clave] = row.Valor; });
  return result;
}
