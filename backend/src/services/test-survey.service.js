import crypto from 'node:crypto';
import { AppError, notFound } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { appendRow, readTable, readTables } from '../infra/sheets.repository.js';
import { ensureSurveyStorage } from './survey-storage.service.js';

const DEFAULT_QUESTIONS = [
  '¿Cómo califica la calidad del trabajo realizado?',
  '¿El servicio resolvió la necesidad por la que solicitó la visita?',
  '¿Cómo califica la comunicación y el trato del personal técnico?',
  '¿Cómo califica el cumplimiento del horario y el tiempo de atención?',
  '¿Qué tan satisfecho está con el servicio recibido en general?',
];

function clean(value) { return String(value ?? '').trim(); }
function isInactive(row) { return row?.Activo === false || String(row?.Activo).toLowerCase() === 'false' || String(row?.Estado || '').toUpperCase() === 'INACTIVO'; }
function publicBaseUrl(origin = '') {
  const selected = [origin, process.env.PUBLIC_APP_URL, process.env.APP_PUBLIC_URL, process.env.RENDER_EXTERNAL_URL, process.env.FRONTEND_ORIGIN]
    .map(clean).find((value) => /^https?:\/\//i.test(value) && value !== '*');
  if (!selected) throw new AppError('SURVEY_PUBLIC_URL_MISSING', 'No fue posible determinar la URL pública para generar la encuesta de prueba.', 503);
  return selected.replace(/\/+$/, '');
}

async function activeQuestions(actor) {
  let rows = await readTable('EncuestaPreguntas', { force: true });
  if (!rows.length) {
    const timestamp = nowIso();
    for (let index = 0; index < DEFAULT_QUESTIONS.length; index += 1) {
      await appendRow('EncuestaPreguntas', {
        PreguntaID: uuid(), Texto: DEFAULT_QUESTIONS[index], Orden: index + 1,
        Activo: true, Estado: 'ACTIVO', CreadoPor: actor, FechaCreacion: timestamp,
        ActualizadoPor: actor, FechaActualizacion: timestamp,
      });
    }
    rows = await readTable('EncuestaPreguntas', { force: true });
  }
  const questions = rows.filter((row) => !isInactive(row)).map((row, index) => ({
    id: clean(row.PreguntaID), text: clean(row.Texto || row.Pregunta), order: Number(row.Orden || index + 1),
  })).filter((item) => item.id && item.text).sort((a, b) => a.order - b.order);
  if (!questions.length) throw new AppError('SURVEY_QUESTIONS_MISSING', 'Debe existir al menos una pregunta activa para generar la prueba.', 503);
  return questions;
}

function surveyView(row, questions) {
  return {
    id: clean(row.EncuestaID), ticketUid: clean(row.BoletaUID), ticketNumber: clean(row.BoletaID || row.BoletaUID),
    clientId: clean(row.ClienteID), clientName: clean(row.ClienteNombre) || 'Cliente',
    ticketTitle: clean(row.TituloBoleta) || 'Boleta de servicio', status: clean(row.Estado || 'PENDIENTE').toUpperCase(),
    average: null, url: clean(row.EncuestaURL), createdAt: row.FechaCreacion || '', expiresAt: row.FechaExpiracion || '',
    answeredAt: row.FechaRespuesta || '', type: 'PRUEBA', token: row.Token, questions,
  };
}

export async function ensureTestSurveyForTicket({ ticketId, origin = '', actor = 'SISTEMA' }) {
  await ensureSurveyStorage();
  const tables = await readTables(['Boletas', 'Clientes', 'Encuestas']);
  const ticket = tables.Boletas.find((row) => String(row.BoletaUID) === String(ticketId));
  if (!ticket) throw notFound('No se encontró la boleta para generar la encuesta de prueba.');
  const version = clean(ticket.Version || ticket.FechaActualizacion || ticket.BoletaUID);
  const key = `${ticket.BoletaUID}:${version}:TEST`;
  const existing = [...tables.Encuestas].reverse().find((row) => String(row.FinalizacionClave) === key);
  if (existing) {
    let snapshot = [];
    try { snapshot = JSON.parse(existing.PreguntasSnapshot || '[]'); } catch { snapshot = []; }
    return surveyView(existing, snapshot);
  }
  const questions = await activeQuestions(actor);
  const client = tables.Clientes.find((row) => String(row.ClienteID) === String(ticket.ClienteID));
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const row = {
    EncuestaID: uuid(), Token: token, BoletaUID: ticket.BoletaUID, BoletaID: ticket.BoletaID || ticket.BoletaUID,
    ClienteID: ticket.ClienteID || client?.ClienteID || '', ClienteNombre: ticket.Cliente || client?.Nombre || client?.RazonSocial || 'Cliente',
    TituloBoleta: `[PRUEBA] ${ticket.Titulo || 'Boleta de servicio'}`, Tipo: 'PRUEBA', FinalizacionClave: key,
    PreguntasSnapshot: JSON.stringify(questions), Estado: 'PENDIENTE', Promedio: '',
    EncuestaURL: `${publicBaseUrl(origin)}/encuesta/${encodeURIComponent(token)}`,
    FechaCreacion: createdAt, FechaExpiracion: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    FechaRespuesta: '', CreadoPor: actor, ActualizadoPor: actor, FechaActualizacion: createdAt,
  };
  await appendRow('Encuestas', row);
  return surveyView(row, questions);
}
