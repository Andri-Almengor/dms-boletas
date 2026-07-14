import { readTable } from '../infra/sheets.repository.js';

const DEFAULT_TICKET_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';
const SENSITIVE_KEY = /(WEBHOOK|SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY)/i;
const SENSITIVE_VALUE = /chat\.googleapis\.com|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

export async function getConfig() {
  const rows = await readTable('Configuracion');
  const result = {};
  rows.forEach((row) => {
    if (row.Clave) result[row.Clave] = row.Valor;
  });
  if (!String(result.TEMPLATE_BOLETA_ID || '').trim()) {
    result.TEMPLATE_BOLETA_ID = DEFAULT_TICKET_TEMPLATE_ID;
  }
  return result;
}

export async function getClientConfig() {
  const config = await getConfig();
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => (
    !SENSITIVE_KEY.test(String(key)) && !SENSITIVE_VALUE.test(String(value || ''))
  )));
}
