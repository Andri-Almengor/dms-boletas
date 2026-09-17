import { ensureColumns } from '../infra/sheets.repository.js';

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
    'Tipo',
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

export async function ensureSurveyStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    for (const [table, headers] of Object.entries(SURVEY_SHEETS)) {
      await ensureColumns(table, headers);
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
