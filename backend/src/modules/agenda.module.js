import { badRequest, forbidden, notFound } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import {
  appendRows,
  findById,
  readTables,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.service.js';
import {
  agendaDate,
  agendaRequiresTicket,
  buildAgendaViews,
  normalizeAgendaText,
} from '../services/agenda-domain.service.js';
import { ensureAgendaSchema } from '../services/agenda-schema.service.js';
import { sendAppsScriptAction } from '../services/apps-script-action.service.js';

const MAX_BATCH = 50;
const MAX_DETAIL = 3000;

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function normalizeDate(value) {
  const date = agendaDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('La fecha de la agenda no es válida.');
  return date;
}

function normalizeTime(value, fallback) {
  const text = clean(value, fallback);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw badRequest('El horario de la agenda no es válido.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) throw badRequest('El horario de la agenda no es válido.');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeUserIds(value) {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(value?.usuarioIds)
      ? value.usuarioIds
      : [];
  return [...new Set(raw.map((item) => clean(item?.UsuarioID || item?.usuarioId || item)).filter(Boolean))];
}

function activeUser(user = {}) {
  const state = normalizeAgendaText(user.Estado || 'ACTIVO');
  return state === 'activo' && Boolean(clean(user.UsuarioID));
}

function userDisplay(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
}

function normalizeAgendaInput(input = {}, fallback = {}) {
  const detail = clean(input.detalle ?? input.Detalle ?? fallback.Detalle).slice(0, MAX_DETAIL);
  if (!detail) throw badRequest('El detalle de la agenda es obligatorio.');

  const fecha = normalizeDate(input.fecha ?? input.Fecha ?? fallback.Fecha);
  const horaInicio = normalizeTime(input.horaInicio ?? input.HoraInicio ?? fallback.HoraInicio, '07:00');
  const horaFin = normalizeTime(input.horaFin ?? input.HoraFin ?? fallback.HoraFin, '17:00');
  if (horaInicio >= horaFin) throw badRequest('La hora de finalización debe ser posterior a la hora de inicio.');

  const estado = clean(input.estado ?? input.Estado ?? fallback.Estado, 'ACTIVA').toUpperCase();
  if (!['ACTIVA', 'CANCELADA'].includes(estado)) throw badRequest('El estado de la agenda no es válido.');

  return {
    Fecha: fecha,
    HoraInicio: horaInicio,
    HoraFin: horaFin,
    Detalle: detail,
    Estado: estado,
    RequiereBoleta: agendaRequiresTicket(detail),
  };
}

async function agendaTables() {
  await ensureAgendaSchema();
  return readTables(['Agendas', 'AgendaAsignados', 'Usuarios', 'Boletas', 'BoletaAsignados']);
}

function activeAssignment(row = {}) {
  const enabled = normalizeAgendaText(row.Activo ?? 'true');
  return !['false', '0', 'no', 'inactivo'].includes(enabled) && !clean(row.FechaDesasignacion);
}

function assignmentIds(rows, agendaId) {
  return rows
    .filter((row) => activeAssignment(row) && clean(row.AgendaID) === clean(agendaId))
    .map((row) => clean(row.UsuarioID))
    .filter(Boolean);
}

function visibleAgendaIdsForUser(assignments, userId) {
  return new Set(assignments
    .filter((row) => activeAssignment(row) && clean(row.UsuarioID) === clean(userId))
    .map((row) => clean(row.AgendaID))
    .filter(Boolean));
}

function reminderSent(value) {
  return ['true', '1', 'si', 'sí', 'yes', 'enviado'].includes(String(value ?? '').trim().toLowerCase());
}

function reminderBelongsToAgendaDay(row = {}) {
  if (!reminderSent(row.RecordatorioEnviado)) return false;
  const agendaDay = agendaDate(row.Fecha);
  const explicitDay = agendaDate(row.RecordatorioDia);
  const sentAtDay = agendaDate(row.RecordatorioEnviadoEn);
  if (explicitDay) return explicitDay === agendaDay;
  if (sentAtDay) return sentAtDay === agendaDay;
  return true;
}

function filterViews(views, payload = {}, ctx = {}) {
  let result = [...views];
  const from = clean(payload.from || payload.desde || payload.fechaInicio);
  const to = clean(payload.to || payload.hasta || payload.fechaFin);
  const search = normalizeAgendaText(payload.search || payload.q);
  const requestedUserId = clean(payload.usuarioId || payload.userId || payload.UsuarioID);

  if (from) result = result.filter((item) => item.Fecha >= normalizeDate(from));
  if (to) result = result.filter((item) => item.Fecha <= normalizeDate(to));
  if (requestedUserId && isAdmin(ctx)) {
    result = result.filter((item) => item.asignados.some((user) => clean(user.UsuarioID) === requestedUserId));
  }
  if (search) {
    result = result.filter((item) => normalizeAgendaText([
      item.Detalle,
      item.Fecha,
      ...item.asignados.map((user) => `${user.NombreCompleto} ${user.NombreUsuario} ${user.Correo}`),
    ].join(' ')).includes(search));
  }

  result.sort((left, right) => (
    left.Fecha.localeCompare(right.Fecha)
    || left.HoraInicio.localeCompare(right.HoraInicio)
    || left.Detalle.localeCompare(right.Detalle, 'es')
  ));
  return result;
}

function buildDeliveries(views, users, mode = 'CREATED', removedByAgenda = new Map()) {
  const userById = new Map(users.map((user) => [clean(user.UsuarioID), user]));
  const deliveries = new Map();

  function add(userId, agenda, assigned) {
    const user = userById.get(clean(userId));
    const email = clean(user?.Correo).toLowerCase();
    if (!email) return;
    if (!deliveries.has(email)) {
      deliveries.set(email, { correo: email, nombre: userDisplay(user), agendas: [] });
    }
    deliveries.get(email).agendas.push({
      agendaId: agenda.AgendaID,
      fecha: agenda.Fecha,
      horaInicio: agenda.HoraInicio,
      horaFin: agenda.HoraFin,
      detalle: agenda.Detalle,
      assigned,
    });
  }

  views.forEach((agenda) => {
    agenda.asignados.forEach((user) => add(user.UsuarioID, agenda, true));
    if (mode === 'UPDATED') {
      (removedByAgenda.get(agenda.AgendaID) || []).forEach((userId) => add(userId, agenda, false));
    }
  });

  return [...deliveries.values()];
}

async function notifyAgenda(views, users, mode, removedByAgenda = new Map()) {
  const deliveries = buildDeliveries(views, users, mode, removedByAgenda);
  try {
    const data = await sendAppsScriptAction('agenda.notification.send', {
      dataSpreadsheetId: env.sheetId,
      appUrl: env.appPublicUrl,
      mode,
      deliveries,
    }, {
      idempotencyKey: `agenda:${mode.toLowerCase()}:${views.map((item) => item.AgendaID).join(',')}:${Date.now()}`,
      attempts: 3,
    });
    return { sent: Boolean(data?.sent), deliveries: deliveries.length, ...data };
  } catch (error) {
    return { sent: false, deliveries: deliveries.length, error: error.message, code: error.code || '' };
  }
}

async function list(ctx) {
  const tables = await agendaTables();
  let agendas = tables.Agendas || [];

  if (!isAdmin(ctx)) {
    const visibleIds = visibleAgendaIdsForUser(tables.AgendaAsignados || [], ctx.user?.UsuarioID);
    agendas = agendas.filter((agenda) => visibleIds.has(clean(agenda.AgendaID)));
  }

  const views = buildAgendaViews({
    agendas,
    agendaAssignments: tables.AgendaAsignados || [],
    users: tables.Usuarios || [],
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  });
  const items = filterViews(views, ctx.payload || {}, ctx);
  return { items, total: items.length };
}

async function get(ctx) {
  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda.');
  const tables = await agendaTables();
  const agenda = (tables.Agendas || []).find((row) => clean(row.AgendaID) === agendaId);
  if (!agenda) throw notFound('No se encontró la agenda solicitada.');

  if (!isAdmin(ctx)) {
    const assigned = assignmentIds(tables.AgendaAsignados || [], agendaId);
    if (!assigned.includes(clean(ctx.user?.UsuarioID))) throw forbidden();
  }

  const item = buildAgendaViews({
    agendas: [agenda],
    agendaAssignments: tables.AgendaAsignados || [],
    users: tables.Usuarios || [],
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  })[0];
  return { item };
}

async function create(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo un administrador puede crear agendas.');
  await ensureAgendaSchema();

  const requested = Array.isArray(ctx.payload?.agendas) ? ctx.payload.agendas : [ctx.payload || {}];
  if (!requested.length) throw badRequest('Debe agregar al menos una agenda.');
  if (requested.length > MAX_BATCH) throw badRequest(`Puede crear un máximo de ${MAX_BATCH} agendas por envío.`);

  const tables = await readTables(['Usuarios']);
  const users = (tables.Usuarios || []).filter(activeUser);
  const userById = new Map(users.map((user) => [clean(user.UsuarioID), user]));
  const timestamp = nowIso();
  const agendaRows = [];
  const assignmentRows = [];

  requested.forEach((input, index) => {
    const values = normalizeAgendaInput(input);
    const userIds = normalizeUserIds(input.usuarioIds || input.UsuarioIDs || input.asignados || []);
    if (!userIds.length) throw badRequest(`La agenda #${index + 1} debe tener al menos una persona asignada.`);
    const invalidUsers = userIds.filter((id) => !userById.has(id));
    if (invalidUsers.length) throw badRequest(`La agenda #${index + 1} contiene usuarios inactivos o inexistentes.`);

    const agendaId = uuid();
    agendaRows.push({
      AgendaID: agendaId,
      AgendaOrigenID: clean(input.agendaOrigenId || input.AgendaOrigenID),
      ...values,
      BoletaUID: '',
      RecordatorioEnviado: false,
      RecordatorioEnviadoEn: '',
      RecordatorioDia: '',
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    });
    userIds.forEach((userId) => assignmentRows.push({
      AgendaAsignadoID: uuid(),
      AgendaID: agendaId,
      UsuarioID: userId,
      Activo: true,
      FechaAsignacion: timestamp,
      FechaDesasignacion: '',
    }));
  });

  await appendRows('Agendas', agendaRows, { chunkSize: 100 });
  await appendRows('AgendaAsignados', assignmentRows, { chunkSize: 200 });

  const views = buildAgendaViews({
    agendas: agendaRows,
    agendaAssignments: assignmentRows,
    users,
    tickets: [],
    ticketAssignments: [],
  });
  const notification = await notifyAgenda(views, users, 'CREATED');

  await audit(ctx, 'CREAR_AGENDAS', 'Agendas', agendaRows.map((row) => row.AgendaID).join(','), null, {
    agendas: views,
    notification,
  });

  return {
    items: views,
    total: views.length,
    notification,
    message: notification.sent
      ? `${views.length} agenda${views.length === 1 ? '' : 's'} creada${views.length === 1 ? '' : 's'} y notificada${views.length === 1 ? '' : 's'} correctamente.`
      : `${views.length} agenda${views.length === 1 ? '' : 's'} creada${views.length === 1 ? '' : 's'} correctamente. Revise la advertencia del correo.`,
  };
}

async function update(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo un administrador puede modificar agendas.');
  await ensureAgendaSchema();

  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda.');

  const before = await findById('Agendas', agendaId);
  const tables = await readTables(['AgendaAsignados', 'Usuarios', 'Boletas', 'BoletaAsignados']);
  const users = (tables.Usuarios || []).filter(activeUser);
  const userById = new Map(users.map((user) => [clean(user.UsuarioID), user]));
  const activeRows = (tables.AgendaAsignados || []).filter((row) => activeAssignment(row) && clean(row.AgendaID) === agendaId);
  const oldUserIds = [...new Set(activeRows.map((row) => clean(row.UsuarioID)).filter(Boolean))];
  const hasAssignmentPayload = Array.isArray(ctx.payload?.usuarioIds)
    || Array.isArray(ctx.payload?.UsuarioIDs)
    || Array.isArray(ctx.payload?.asignados);
  const newUserIds = hasAssignmentPayload
    ? normalizeUserIds(ctx.payload.usuarioIds || ctx.payload.UsuarioIDs || ctx.payload.asignados)
    : oldUserIds;
  if (!newUserIds.length) throw badRequest('La agenda debe tener al menos una persona asignada.');
  if (newUserIds.some((id) => !userById.has(id))) throw badRequest('La agenda contiene usuarios inactivos o inexistentes.');

  const values = normalizeAgendaInput(ctx.payload, before);
  const oldDate = agendaDate(before.Fecha);
  const dateChanged = values.Fecha !== oldDate;
  const assignmentChanged = oldUserIds.length !== newUserIds.length
    || oldUserIds.some((id) => !newUserIds.includes(id));
  const contentChanged = dateChanged
    || values.Detalle !== clean(before.Detalle)
    || values.HoraInicio !== clean(before.HoraInicio, '07:00')
    || values.HoraFin !== clean(before.HoraFin, '17:00');
  const resetLink = assignmentChanged || dateChanged || values.Detalle !== clean(before.Detalle);
  const reminderAlreadyConsumedForThisDay = !dateChanged && reminderBelongsToAgendaDay(before);
  const timestamp = nowIso();

  const patch = {
    ...values,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  };

  if ((contentChanged || assignmentChanged) && !reminderAlreadyConsumedForThisDay) {
    patch.RecordatorioEnviado = false;
    patch.RecordatorioEnviadoEn = '';
    patch.RecordatorioDia = '';
  }
  if (dateChanged) {
    patch.RecordatorioEnviado = false;
    patch.RecordatorioEnviadoEn = '';
    patch.RecordatorioDia = '';
  }
  if (resetLink || !values.RequiereBoleta) patch.BoletaUID = '';

  const after = await updateRow('Agendas', agendaId, patch);
  const removed = oldUserIds.filter((id) => !newUserIds.includes(id));
  const added = newUserIds.filter((id) => !oldUserIds.includes(id));

  if (removed.length) {
    await updateRows('AgendaAsignados', activeRows
      .filter((row) => removed.includes(clean(row.UsuarioID)))
      .map((row) => ({
        idValue: row.AgendaAsignadoID,
        patch: { Activo: false, FechaDesasignacion: timestamp },
      })));
  }
  if (added.length) {
    await appendRows('AgendaAsignados', added.map((userId) => ({
      AgendaAsignadoID: uuid(),
      AgendaID: agendaId,
      UsuarioID: userId,
      Activo: true,
      FechaAsignacion: timestamp,
      FechaDesasignacion: '',
    })));
  }

  const currentAssignments = [
    ...activeRows.filter((row) => !removed.includes(clean(row.UsuarioID))),
    ...added.map((userId) => ({ AgendaID: agendaId, UsuarioID: userId, Activo: true })),
  ];
  const view = buildAgendaViews({
    agendas: [after],
    agendaAssignments: currentAssignments,
    users,
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  })[0];
  const removedMap = new Map([[agendaId, removed]]);
  const notification = await notifyAgenda([view], users, 'UPDATED', removedMap);

  await audit(ctx, 'EDITAR_AGENDA', 'Agendas', agendaId, before, {
    agenda: view,
    removedUserIds: removed,
    addedUserIds: added,
    reminderPreservedForSameDay: reminderAlreadyConsumedForThisDay,
    notification,
  });

  return {
    item: view,
    notification,
    reminderPreservedForSameDay: reminderAlreadyConsumedForThisDay,
    message: notification.sent
      ? 'Agenda actualizada y notificada correctamente.'
      : 'Agenda actualizada correctamente. Revise la advertencia del correo.',
  };
}

export const agendaHandlers = {
  list,
  get,
  create,
  update,
};
