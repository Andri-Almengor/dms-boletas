import { ensureColumns } from '../infra/sheets.repository.js';

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
  'CarpetaDriveID',
  'CarpetaDriveURL',
  'TecnicoIDsJSON',
  'TecnicoNombres',
  'FechaVisita',
  'HoraVisita',
  'MensajeAdministrador',
  'BoletaUID',
  'BoletaID',
  'AsuntoCorreoInicial',
  'CuerpoCorreoInicial',
  'GeminiModeloInicial',
  'GeminiUsadoInicial',
  'AsuntoCorreoTecnicos',
  'CuerpoCorreoTecnicos',
  'GeminiModeloTecnicos',
  'GeminiUsadoTecnicos',
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

async function ensureSchemaInternal() {
  for (const [table, headers] of Object.entries(TABLE_DEFINITIONS)) {
    await ensureColumns(table, headers);
  }

  await ensureColumns('Clientes', [
    'PortalCasosToken',
    'PortalCasosActivo',
    'PortalCasosCreadoEn',
    'PortalCasosActualizadoEn',
  ]);
  await ensureColumns('Boletas', ['OrigenCasoID']);
  await ensureColumns('Notificaciones', [
    'Entidad',
    'EntidadID',
    'Canal',
    'Destino',
    'Tipo',
    'Estado',
    'Intentos',
    'Respuesta',
    'Error',
    'FechaCreacion',
    'FechaEnvio',
    'CreadoPor',
  ]);

  return { created: [], tables: Object.keys(TABLE_DEFINITIONS) };
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
