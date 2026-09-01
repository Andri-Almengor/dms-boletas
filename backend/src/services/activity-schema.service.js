import { ensureSheetTables } from './sheet-schema.service.js';

export const ACTIVITY_HEADERS = Object.freeze([
  'ActividadID',
  'UsuarioID',
  'UsuarioNombre',
  'SesionID',
  'TipoEvento',
  'Seccion',
  'Vista',
  'RutaUI',
  'RutaAccion',
  'Accion',
  'Entidad',
  'EntidadID',
  'Resultado',
  'Prioridad',
  'DetalleJSON',
  'FechaInicio',
  'FechaFin',
  'DuracionSegundos',
  'IP',
  'UserAgent',
  'Fuente',
]);

export const ACTIVITY_TABLE_DEFINITIONS = Object.freeze({
  ActividadApp: ACTIVITY_HEADERS,
});

let schemaPromise = null;

export function ensureActivitySchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSheetTables(ACTIVITY_TABLE_DEFINITIONS).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
