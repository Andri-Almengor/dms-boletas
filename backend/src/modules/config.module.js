import { readTable } from '../infra/sheets.repository.js';

const SENSITIVE_KEY = /(WEBHOOK|SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY)/i;
const SENSITIVE_VALUE = /chat\.googleapis\.com|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

export async function getConfig() {
  const rows = await readTable('Configuracion');
  const result = {};
  rows.forEach((row) => {
    if (row.Clave) result[row.Clave] = row.Valor;
  });
  return result;
}

export async function getClientConfig() {
  const config = await getConfig();
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => (
    !SENSITIVE_KEY.test(String(key)) && !SENSITIVE_VALUE.test(String(value || ''))
  )));
}
