import { ensureSheetTables } from './sheet-schema.service.js';

export const AGENDA_HEADERS = Object.freeze([
  'AgendaID',
  'Fecha',
  'HoraInicio',
  'HoraFin',
  'Detalle',
  'Estado',
  'RequiereBoleta',
  'BoletaUID',
  'RecordatorioEnviado',
  'RecordatorioEnviadoEn',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
]);

export const AGENDA_ASSIGNEE_HEADERS = Object.freeze([
  'AgendaAsignadoID',
  'AgendaID',
  'UsuarioID',
  'Activo',
  'FechaAsignacion',
  'FechaDesasignacion',
]);

export const AGENDA_TABLE_DEFINITIONS = Object.freeze({
  Agendas: AGENDA_HEADERS,
  AgendaAsignados: AGENDA_ASSIGNEE_HEADERS,
});

let schemaPromise = null;

export function ensureAgendaSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSheetTables(AGENDA_TABLE_DEFINITIONS).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
