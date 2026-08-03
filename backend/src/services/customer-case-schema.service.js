import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import { ensureColumns, invalidateTableCache } from '../infra/sheets.repository.js';

export const CUSTOMER_CASE_HEADERS = Object.freeze([
  'CasoID',
  'CasoNumero',
  'SolicitudClienteID',
  'ClienteID',
  'Cliente',
  'RazonVisita',
  'Problema',
  'CorreoSolicitante',
  'NombreSolicitante',
  'Estado',
  'EvidenciaCount',
  'TecnicoIDsJSON',
  'TecnicoNombres',
  'FechaVisita',
  'HoraVisita',
  'MensajeAdministrador',
  'BoletaUID',
  'BoletaID',
  'AsuntoCorreoInicial',
  'CuerpoCorreoInicial',
  'AsuntoCorreoTecnicos',
  'CuerpoCorreoTecnicos',
  'EstadoNotificacionInicial',
  'EstadoNotificacionTecnicos',
  'UltimoErrorNotificacion',
  'FechaProceso',
  'FechaFinalizacion',
  'FechaCreacion',
  'FechaActualizacion',
  'CreadoPor',
  'ActualizadoPor',
  'Activo',
]);

export const CUSTOMER_CASE_EVIDENCE_HEADERS = Object.freeze([
  'CasoEvidenciaID',
  'CasoID',
  'ClienteID',
  'NombreArchivo',
  'MimeType',
  'TamanoBytes',
  'DriveFileID',
  'DriveURL',
  'Nota',
  'FechaCreacion',
  'CreadoPor',
  'Activo',
]);

const TABLE_DEFINITIONS = Object.freeze({
  CasosClientes: CUSTOMER_CASE_HEADERS,
  CasoEvidencias: CUSTOMER_CASE_EVIDENCE_HEADERS,
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

  await ensureColumns('Clientes', [
    'PortalCasosToken',
    'PortalCasosActivo',
    'PortalCasosCreadoEn',
    'PortalCasosActualizadoEn',
  ]);
  await ensureColumns('Boletas', ['OrigenCasoID']);

  return { created, tables: Object.keys(TABLE_DEFINITIONS) };
}

export async function ensureCustomerCaseSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSchemaInternal().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
