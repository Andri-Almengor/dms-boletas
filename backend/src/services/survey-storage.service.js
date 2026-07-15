import { env } from '../config/env.js';
import { getHeaders, invalidateTableCache } from '../infra/sheets.repository.js';
import { sheetsApi } from '../infra/google.js';

export const SURVEY_SHEETS = Object.freeze({
  EncuestaPreguntas: [
    'PreguntaID',
    'Texto',
    'Orden',
    'Activo',
    'Estado',
    'CreadoPor',
    'FechaCreacion',
    'ActualizadoPor',
    'FechaActualizacion',
  ],
  Encuestas: [
    'EncuestaID',
    'Token',
    'BoletaUID',
    'BoletaID',
    'ClienteID',
    'ClienteNombre',
    'TituloBoleta',
    'FinalizacionClave',
    'PreguntasSnapshot',
    'Estado',
    'Promedio',
    'EncuestaURL',
    'FechaCreacion',
    'FechaExpiracion',
    'FechaRespuesta',
    'CreadoPor',
    'ActualizadoPor',
    'FechaActualizacion',
  ],
  EncuestaRespuestas: [
    'RespuestaEncuestaID',
    'EncuestaID',
    'PreguntaID',
    'PreguntaTexto',
    'Orden',
    'Calificacion',
    'FechaRespuesta',
  ],
});

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

async function ensureHeaders(sheetName, requiredHeaders) {
  const range = `${quote(sheetName)}!1:1`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range,
  });
  const current = (data.values?.[0] || []).map((value) => String(value || '').trim()).filter(Boolean);
  const missing = requiredHeaders.filter((header) => !current.includes(header));
  const headers = current.length ? [...current, ...missing] : [...requiredHeaders];

  if (!current.length || missing.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(sheetName)}!A1:${columnLetter(headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  invalidateTableCache(sheetName);
  await getHeaders(sheetName, true);
}

export async function ensureSurveyStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId: env.sheetId,
      fields: 'sheets.properties.title',
    });
    const existing = new Set((data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
    const missingNames = Object.keys(SURVEY_SHEETS).filter((name) => !existing.has(name));

    if (missingNames.length) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: {
          requests: missingNames.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
    }

    for (const [sheetName, headers] of Object.entries(SURVEY_SHEETS)) {
      await ensureHeaders(sheetName, headers);
    }

    ensured = true;
  })().catch((error) => {
    ensured = false;
    throw error;
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}
