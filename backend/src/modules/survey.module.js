import crypto from 'node:crypto';
import { AppError, badRequest, notFound } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { appendRow, filterRows, readTable, readTables, updateRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { ensureSurveyStorage } from '../services/survey-storage.service.js';

const DEFAULT_QUESTIONS = [
  '¿Cómo califica la calidad del trabajo realizado?',
  '¿El servicio resolvió la necesidad por la que solicitó la visita?',
  '¿Cómo califica la comunicación y el trato del personal técnico?',
  '¿Cómo califica el cumplimiento del horario y el tiempo de atención?',
  '¿Qué tan satisfecho está con el servicio recibido en general?',
];

const submissionLocks = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function isInactive(row) {
  return row?.Activo === false || String(row?.Activo).toLowerCase() === 'false' || String(row?.Estado || '').toUpperCase() === 'INACTIVO';
}

function questionView(row) {
  return {
    id: clean(pick(row, ['PreguntaID', 'id'])),
    text: clean(pick(row, ['Texto', 'Pregunta', 'text'])),
    order: Number(pick(row, ['Orden', 'order'], 0)) || 0,
    status: isInactive(row) ? 'INACTIVO' : 'ACTIVO',
  };
}

function surveyView(row) {
  return {
    id: clean(row.EncuestaID),
    ticketUid: clean(row.BoletaUID),
    ticketNumber: clean(row.BoletaID || row.BoletaUID),
    clientId: clean(row.ClienteID),
    clientName: clean(row.ClienteNombre) || 'Cliente',
    ticketTitle: clean(row.TituloBoleta) || 'Boleta de servicio',
    status: clean(row.Estado || 'PENDIENTE').toUpperCase(),
    type: clean(row.Tipo || 'REAL').toUpperCase(),
    average: row.Promedio === '' || row.Promedio === undefined ? null : Number(row.Promedio),
    url: clean(row.EncuestaURL),
    createdAt: row.FechaCreacion || '',
    expiresAt: row.FechaExpiracion || '',
    answeredAt: row.FechaRespuesta || '',
  };
}

function visitNumber(ticket = {}) {
  const number = Number(ticket.NumeroVisita || 0);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function ticketGroupId(ticket = {}) {
  return clean(ticket.GrupoVisitaID || ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

function ticketRootId(ticket = {}) {
  return clean(ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

function sortRelatedTickets(tickets = []) {
  return [...tickets].sort((left, right) => {
    const byVisit = visitNumber(left) - visitNumber(right);
    if (byVisit) return byVisit;
    const byDate = clean(left.Fecha).localeCompare(clean(right.Fecha));
    if (byDate) return byDate;
    return Number(left.BoletaID || 0) - Number(right.BoletaID || 0);
  });
}

function relatedTicketsForSurvey(ticket, allTickets = []) {
  if (!ticket?.BoletaUID) return [];
  const groupId = ticketGroupId(ticket);
  const rootId = ticketRootId(ticket);
  const related = allTickets.filter((row) => (
    ticketGroupId(row) === groupId
    || clean(row.BoletaUID) === rootId
    || clean(row.BoletaPrincipalUID) === rootId
  ));
  return sortRelatedTickets(related.length ? related : [ticket]);
}

function ticketSurveyView(ticket, rootId) {
  return {
    uid: clean(ticket.BoletaUID),
    number: clean(ticket.BoletaID || ticket.BoletaUID),
    visitNumber: visitNumber(ticket),
    isPrimary: clean(ticket.BoletaUID) === clean(rootId),
    title: clean(ticket.Titulo || ticket.TituloBoleta || 'Boleta de servicio'),
    date: ticket.Fecha || '',
    startTime: ticket.HoraInicio || '',
    endTime: ticket.HoraFinal || '',
    totalHours: ticket.HorasTotales ?? '',
    status: clean(ticket.Estado || 'PENDIENTE').toUpperCase(),
    result: clean(ticket.Resultado) || 'Sin información adicional',
    location: clean(ticket.Ubicacion),
    equipmentLocation: clean(ticket.UbicacionEquipo || ticket.Ubicacion_equipo),
    deviceName: clean(ticket.Descripcion || ticket.Descripción || ticket.DescripcionEquipo || ticket.NombreEquipo),
    deviceType: clean(ticket.TipoDispositivo),
    manufacturer: clean(ticket.Fabricante),
    model: clean(ticket.Modelo),
  };
}

function parseQuestions(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((item, index) => ({
      id: clean(item.id || item.PreguntaID),
      text: clean(item.text || item.Texto || item.Pregunta),
      order: Number(item.order ?? item.Orden ?? index + 1),
    })).filter((item) => item.id && item.text).sort((a, b) => a.order - b.order) : [];
  } catch {
    return [];
  }
}

async function seedDefaultQuestions(actor = 'SISTEMA') {
  const current = await readTable('EncuestaPreguntas', { force: true });
  if (current.length) return;
  const timestamp = nowIso();
  for (let index = 0; index < DEFAULT_QUESTIONS.length; index += 1) {
    await appendRow('EncuestaPreguntas', {
      PreguntaID: uuid(),
      Texto: DEFAULT_QUESTIONS[index],
      Orden: index + 1,
      Activo: true,
      Estado: 'ACTIVO',
      CreadoPor: actor,
      FechaCreacion: timestamp,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  }
}

async function activeQuestions(actor = 'SISTEMA') {
  await ensureSurveyStorage();
  await seedDefaultQuestions(actor);
  const questions = (await readTable('EncuestaPreguntas', { force: true }))
    .filter((row) => !isInactive(row))
    .map(questionView)
    .filter((item) => item.id && item.text)
    .sort((a, b) => a.order - b.order);
  if (!questions.length) {
    throw new AppError('SURVEY_QUESTIONS_MISSING', 'Debe existir al menos una pregunta activa antes de finalizar una boleta.', 503);
  }
  return questions;
}

function publicBaseUrl(origin = '') {
  const candidates = [
    origin,
    process.env.PUBLIC_APP_URL,
    process.env.APP_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.FRONTEND_ORIGIN,
  ];
  const selected = candidates.map(clean).find((value) => /^https?:\/\//i.test(value) && value !== '*');
  if (!selected) {
    throw new AppError('SURVEY_PUBLIC_URL_MISSING', 'No fue posible determinar la URL pública para generar la encuesta.', 503);
  }
  return selected.replace(/\/+$/, '');
}

function finalizationKey(ticket) {
  return clean(ticket.Version || ticket.FechaActualizacion || ticket.FinalizadaEn || ticket.BoletaUID);
}

export async function ensureSurveyForTicket({ ticketId, origin = '', actor = 'SISTEMA' }) {
  await ensureSurveyStorage();
  const tables = await readTables(['Boletas', 'Clientes', 'Encuestas']);
  const ticket = tables.Boletas.find((row) => String(row.BoletaUID) === String(ticketId));
  if (!ticket) throw notFound('No se encontró la boleta para generar la encuesta.');

  const key = `${ticket.BoletaUID}:${finalizationKey(ticket)}`;
  const existing = [...tables.Encuestas]
    .reverse()
    .find((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && String(row.FinalizacionClave) === key);
  if (existing) return { ...surveyView(existing), token: existing.Token, questions: parseQuestions(existing.PreguntasSnapshot) };

  const questions = await activeQuestions(actor);
  const client = tables.Clientes.find((row) => String(row.ClienteID) === String(ticket.ClienteID));
  const token = crypto.randomBytes(32).toString('base64url');
  const surveyId = uuid();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const url = `${publicBaseUrl(origin)}/encuesta/${encodeURIComponent(token)}`;
  const snapshot = questions.map((question) => ({ id: question.id, text: question.text, order: question.order }));
  const row = {
    EncuestaID: surveyId,
    Token: token,
    BoletaUID: ticket.BoletaUID,
    BoletaID: ticket.BoletaID || ticket.BoletaUID,
    ClienteID: ticket.ClienteID || client?.ClienteID || '',
    ClienteNombre: ticket.Cliente || client?.Nombre || client?.RazonSocial || 'Cliente',
    TituloBoleta: ticket.Titulo || ticket.TituloBoleta || 'Boleta de servicio',
    FinalizacionClave: key,
    PreguntasSnapshot: JSON.stringify(snapshot),
    Estado: 'PENDIENTE',
    Promedio: '',
    EncuestaURL: url,
    FechaCreacion: createdAt,
    FechaExpiracion: expiresAt,
    FechaRespuesta: '',
    CreadoPor: actor,
    ActualizadoPor: actor,
    FechaActualizacion: createdAt,
  };
  await appendRow('Encuestas', row);
  return { ...surveyView(row), token, questions: snapshot };
}

async function findSurveyByToken(token) {
  await ensureSurveyStorage();
  const survey = (await readTable('Encuestas', { force: true })).find((row) => clean(row.Token) === clean(token));
  if (!survey) throw notFound('La encuesta no existe o el enlace no es válido.');
  return survey;
}

async function expireIfNeeded(survey) {
  if (String(survey.Estado || '').toUpperCase() !== 'PENDIENTE') return survey;
  const expiration = new Date(survey.FechaExpiracion || 0).getTime();
  if (expiration && expiration < Date.now()) {
    return updateRow('Encuestas', survey.EncuestaID, {
      Estado: 'EXPIRADA',
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: nowIso(),
    });
  }
  return survey;
}

async function submitSurvey(ctx) {
  const token = clean(ctx.payload.token);
  if (!token) throw badRequest('El enlace de la encuesta no es válido.');
  if (submissionLocks.has(token)) return submissionLocks.get(token);

  const operation = (async () => {
    let survey = await findSurveyByToken(token);
    survey = await expireIfNeeded(survey);
    const status = String(survey.Estado || '').toUpperCase();
    if (status === 'RESPONDIDA') {
      throw new AppError('SURVEY_ALREADY_ANSWERED', 'Esta encuesta ya fue respondida. Gracias por su participación.', 409);
    }
    if (status === 'EXPIRADA') throw new AppError('SURVEY_EXPIRED', 'Este enlace de encuesta ha expirado.', 410);

    const questions = parseQuestions(survey.PreguntasSnapshot);
    const incoming = Array.isArray(ctx.payload.answers) ? ctx.payload.answers : [];
    const answerById = new Map(incoming.map((answer) => [clean(answer.questionId || answer.preguntaId), Number(answer.rating ?? answer.calificacion)]));
    if (questions.some((question) => !answerById.has(question.id))) {
      throw badRequest('Debe responder todas las preguntas antes de enviar la encuesta.');
    }

    const timestamp = nowIso();
    const values = [];
    for (const question of questions) {
      const rating = answerById.get(question.id);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw badRequest('Cada calificación debe ser un número entero entre 1 y 5.');
      }
      values.push(rating);
      await appendRow('EncuestaRespuestas', {
        RespuestaEncuestaID: uuid(),
        EncuestaID: survey.EncuestaID,
        PreguntaID: question.id,
        PreguntaTexto: question.text,
        Orden: question.order,
        Calificacion: rating,
        FechaRespuesta: timestamp,
      });
    }

    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
    const updated = await updateRow('Encuestas', survey.EncuestaID, {
      Estado: 'RESPONDIDA',
      Promedio: average,
      FechaRespuesta: timestamp,
      ActualizadoPor: 'CLIENTE',
      FechaActualizacion: timestamp,
    });
    return { submitted: true, average, survey: surveyView(updated) };
  })().finally(() => submissionLocks.delete(token));

  submissionLocks.set(token, operation);
  return operation;
}

export const surveyHandlers = {
  publicGet: async (ctx) => {
    let survey = await findSurveyByToken(ctx.payload.token);
    survey = await expireIfNeeded(survey);
    const view = surveyView(survey);
    return {
      survey: view,
      questions: parseQuestions(survey.PreguntasSnapshot),
      alreadySubmitted: view.status === 'RESPONDIDA',
      expired: view.status === 'EXPIRADA',
    };
  },
  publicSubmit: submitSurvey,

  questionsList: async (ctx) => {
    await ensureSurveyStorage();
    await seedDefaultQuestions(ctx.user.UsuarioID);
    let rows = await readTable('EncuestaPreguntas', { force: true });
    if (!ctx.payload.includeInactive) rows = rows.filter((row) => !isInactive(row));
    const items = rows.map(questionView).sort((a, b) => a.order - b.order);
    return { items, total: items.length, page: 1, pageSize: items.length || 1 };
  },
  questionsCreate: async (ctx) => {
    await ensureSurveyStorage();
    const text = clean(ctx.payload.text || ctx.payload.Texto);
    if (!text) throw badRequest('El texto de la pregunta es obligatorio.');
    const rows = await readTable('EncuestaPreguntas', { force: true });
    const maxOrder = rows.reduce((max, row) => Math.max(max, Number(row.Orden || 0)), 0);
    const timestamp = nowIso();
    const row = {
      PreguntaID: uuid(),
      Texto: text,
      Orden: Math.max(1, Number(ctx.payload.order || ctx.payload.Orden || maxOrder + 1)),
      Activo: true,
      Estado: 'ACTIVO',
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    await appendRow('EncuestaPreguntas', row);
    await audit(ctx, 'CREAR_PREGUNTA_ENCUESTA', 'EncuestaPreguntas', row.PreguntaID, null, row);
    return questionView(row);
  },
  questionsUpdate: async (ctx) => {
    await ensureSurveyStorage();
    const id = clean(ctx.payload.questionId || ctx.payload.PreguntaID || ctx.payload.id);
    if (!id) throw badRequest('Falta el identificador de la pregunta.');
    const before = (await readTable('EncuestaPreguntas', { force: true })).find((row) => String(row.PreguntaID) === id);
    if (!before) throw notFound('No se encontró la pregunta.');
    const text = clean(ctx.payload.text ?? ctx.payload.Texto ?? before.Texto);
    if (!text) throw badRequest('El texto de la pregunta es obligatorio.');
    const status = clean(ctx.payload.status || ctx.payload.Estado || before.Estado || 'ACTIVO').toUpperCase();
    const patch = {
      Texto: text,
      Orden: Math.max(1, Number(ctx.payload.order ?? ctx.payload.Orden ?? before.Orden ?? 1)),
      Estado: status,
      Activo: status !== 'INACTIVO',
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    const after = await updateRow('EncuestaPreguntas', id, patch);
    await audit(ctx, 'EDITAR_PREGUNTA_ENCUESTA', 'EncuestaPreguntas', id, before, after);
    return questionView(after);
  },
  questionsDelete: async (ctx) => {
    ctx.payload = { ...ctx.payload, status: 'INACTIVO' };
    return surveyHandlers.questionsUpdate(ctx);
  },

  responsesList: async (ctx) => {
    await ensureSurveyStorage();
    const rows = await readTable('Encuestas', { force: true });
    const result = filterRows(rows, ctx.payload, ['BoletaID', 'ClienteNombre', 'TituloBoleta']);
    result.items = result.items.map(surveyView).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return result;
  },
  responsesGet: async (ctx) => {
    await ensureSurveyStorage();
    const id = clean(ctx.payload.surveyId || ctx.payload.EncuestaID || ctx.payload.id);
    if (!id) throw badRequest('Falta el identificador de la encuesta.');
    const tables = await readTables(['Encuestas', 'EncuestaRespuestas', 'Boletas']);
    const survey = tables.Encuestas.find((row) => String(row.EncuestaID) === id);
    if (!survey) throw notFound('No se encontró la encuesta.');
    const answers = tables.EncuestaRespuestas
      .filter((row) => String(row.EncuestaID) === id)
      .map((row) => ({
        id: row.RespuestaEncuestaID,
        questionId: row.PreguntaID,
        question: row.PreguntaTexto,
        order: Number(row.Orden || 0),
        rating: Number(row.Calificacion || 0),
        answeredAt: row.FechaRespuesta || '',
      }))
      .sort((a, b) => a.order - b.order);
    const ticket = tables.Boletas.find((row) => String(row.BoletaUID) === String(survey.BoletaUID)) || null;
    const related = ticket ? relatedTicketsForSurvey(ticket, tables.Boletas) : [];
    const rootId = ticket ? ticketRootId(ticket) : clean(survey.BoletaUID);
    const tickets = related.map((item) => ticketSurveyView(item, rootId));
    const view = surveyView(survey);
    const isMultipleTickets = tickets.length > 1;
    const ticketNumbers = tickets.map((item) => item.number).filter(Boolean);
    return {
      survey: {
        ...view,
        ticketNumber: ticketNumbers.length ? ticketNumbers.join(', ') : view.ticketNumber,
        visitCount: tickets.length || (ticket ? 1 : 0),
        isMultipleTickets,
      },
      answers,
      ticket,
      tickets,
      visitGroup: {
        id: ticket ? ticketGroupId(ticket) : clean(survey.BoletaUID),
        rootId,
        count: tickets.length || (ticket ? 1 : 0),
        isMultiple: isMultipleTickets,
        ticketNumbers,
      },
    };
  },
};
