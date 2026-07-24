import { ensureColumns, getHeaders } from '../infra/sheets.repository.js';

const sheetTails = new Map();
const confirmedColumns = new Map();

function confirmedSet(sheetName) {
  if (!confirmedColumns.has(sheetName)) confirmedColumns.set(sheetName, new Set());
  return confirmedColumns.get(sheetName);
}

/**
 * Verifica encabezados una sola vez por proceso y únicamente vuelve a consultar
 * Google Sheets cuando aparece una columna que todavía no ha sido confirmada.
 * Las operaciones de una misma hoja se serializan para evitar escrituras dobles.
 */
export async function ensureSheetColumns(sheetName, columns = []) {
  const requested = [...new Set((columns || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requested.length) return [];

  const known = confirmedSet(sheetName);
  if (requested.every((column) => known.has(column))) return [...known];

  const previous = sheetTails.get(sheetName) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const currentKnown = confirmedSet(sheetName);
    if (requested.every((column) => currentKnown.has(column))) return [...currentKnown];

    const headers = await getHeaders(sheetName);
    headers.forEach((header) => currentKnown.add(header));
    const missing = requested.filter((column) => !currentKnown.has(column));
    if (!missing.length) return headers;

    const ensured = await ensureColumns(sheetName, requested);
    ensured.forEach((header) => currentKnown.add(header));
    return ensured;
  });

  const tracked = operation.finally(() => {
    if (sheetTails.get(sheetName) === tracked) sheetTails.delete(sheetName);
  });
  sheetTails.set(sheetName, tracked);
  return tracked;
}
