import { badRequest, forbidden, notFound } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import {
  appendRows,
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

const MAX_GROUPS = 50;
const MAX_DETAIL = 3000;

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function activeAssignment(row = {}) {
  const enabled = normalizeAgendaText(row.Activo ?? 'true');
  return !['false', '0', 'no', 'inactivo'].includes(enabled) && !clean(row.FechaDesasignacion);
}

function activeUser(user = {}) {
  return normalizeAgendaText(user.Estado || 'ACTIVO') === 'activo' && Boolean(clean(user.UsuarioID));
}

function normalizeTime(value, fallback) {
  const text = clean(value, fallback);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw badRequest('El horario de la agenda no es válido.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw badRequest('El horario de la agenda no es válido.');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeGroup(group = {}, original = {}) {
  const detail = clean(group.detalle ?? group.Detalle, original.Detalle).slice(0, MAX_DETAIL);
  if (!detail) throw badRequest('Cada nueva agenda debe indicar el lugar o detalle de la visita.');

  const fecha = agendaDate(group.fecha ?? group.Fecha ?? original.Fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw badRequest('La fecha de la agenda no es válida.');

  const horaInicio = normalizeTime(group.horaInicio ?? group.HoraInicio, clean(original.HoraInicio, '07:00'));
  const horaFin = normalizeTime(group.horaFin ?? group.HoraFin, clean(original.HoraFin, '17:00'));
  if (horaInicio >= horaFin) throw badRequest('La hora de finalización debe ser posterior a la hora de inicio.');

  const userIds = [...new Set((Array.isArray(group.usuarioIds) ? group.usuarioIds : [])
    .map((value) => clean(value?.UsuarioID || value))
    .filter(Boolean))];
  if (!userIds.length) throw badRequest('Cada nueva agenda debe tener al menos una persona.');

  return {
    Fecha: fecha,
    HoraInicio: horaInicio,
    HoraFin: horaFin,
    Detalle: detail,
    Estado: 'ACTIVA',
    RequiereBoleta: agendaRequiresTicket(detail),
    userIds,
  };
}

function userDisplay(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
}

function buildDeliveries(views, users) {
  const byUser = new Map(users.map((user) => [clean(user.UsuarioID), user]));
  const deliveries = new Map();

  views.forEach((agenda) => {
    agenda.asignados.forEach((assigned) => {
      const user = byUser.get(clean(assigned.UsuarioID));
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
        assigned: true,
      });
    });
  });

  return [...deliveries.values()];
}

async function notifySplit(views, users, originalAgendaId) {
  const deliveries = buildDeliveries(views, users);
  try {
    const data = await sendAppsScriptAction('agenda.notification.send', {
      dataSpreadsheetId: env.sheetId,
      appUrl: env.appPublicUrl,
      mode: 'UPDATED',
      reason: 'SPLIT',
      originalAgendaId,
      deliveries,
    }, {
      idempotencyKey: `agenda:split:${originalAgendaId}:${views.map((item) => item.AgendaID).join(',')}`,
      attempts: 3,
    });
    return { sent: Boolean(data?.sent), deliveries: deliveries.length, ...data };
  } catch (error) {
    return { sent: false, deliveries: deliveries.length, error: error.message, code: error.code || '' };
  }
}

async function split(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo un administrador puede separar una agenda.');
  await ensureAgendaSchema();

  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda que desea separar.');

  const groupsRaw = Array.isArray(ctx.payload?.grupos)
    ? ctx.payload.grupos
    : Array.isArray(ctx.payload?.groups)
      ? ctx.payload.groups
      : [];
  if (groupsRaw.length < 2) throw badRequest('La separación debe crear al menos dos agendas.');
  if (groupsRaw.length > MAX_GROUPS) throw badRequest(`Puede crear un máximo de ${MAX_GROUPS} agendas en una separación.`);

  const tables = await readTables(['Agendas', 'AgendaAsignados', 'Usuarios', 'Boletas', 'BoletaAsignados']);
  const original = (tables.Agendas || []).find((row) => clean(row.AgendaID) === agendaId);
  if (!original) throw notFound('No se encontró la agenda solicitada.');
  if (clean(original.Estado, 'ACTIVA').toUpperCase() === 'CANCELADA') {
    throw badRequest('La agenda ya está cancelada y no puede separarse nuevamente.');
  }

  const currentAssignments = (tables.AgendaAsignados || [])
    .filter((row) => activeAssignment(row) && clean(row.AgendaID) === agendaId);
  const originalUserIds = [...new Set(currentAssignments.map((row) => clean(row.UsuarioID)).filter(Boolean))];
  if (originalUserIds.length < 2) throw badRequest('Esta agenda no tiene varias personas para separar.');

  const users = (tables.Usuarios || []).filter(activeUser);
  const validUserIds = new Set(users.map((user) => clean(user.UsuarioID)));
  const groups = groupsRaw.map((group) => normalizeGroup(group, original));
  const assignedAcrossGroups = groups.flatMap((group) => group.userIds);

  const duplicateIds = assignedAcrossGroups.filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw badRequest('Una misma persona no puede quedar en dos agendas nuevas durante la separación.');
  if (assignedAcrossGroups.some((id) => !validUserIds.has(id))) {
    throw badRequest('La separación contiene usuarios inactivos o inexistentes.');
  }

  const originalSet = new Set(originalUserIds);
  const newSet = new Set(assignedAcrossGroups);
  const missing = originalUserIds.filter((id) => !newSet.has(id));
  const extra = assignedAcrossGroups.filter((id) => !originalSet.has(id));
  if (missing.length || extra.length) {
    throw badRequest('Para separar rápidamente la agenda, cada persona de la agenda original debe quedar exactamente en una de las agendas nuevas.');
  }

  const timestamp = nowIso();
  const agendaRows = [];
  const assignmentRows = [];

  groups.forEach((group) => {
    const newAgendaId = uuid();
    agendaRows.push({
      AgendaID: newAgendaId,
      AgendaOrigenID: agendaId,
      Fecha: group.Fecha,
      HoraInicio: group.HoraInicio,
      HoraFin: group.HoraFin,
      Detalle: group.Detalle,
      Estado: 'ACTIVA',
      RequiereBoleta: group.RequiereBoleta,
      BoletaUID: '',
      RecordatorioEnviado: false,
      RecordatorioEnviadoEn: '',
      RecordatorioDia: '',
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    });
    group.userIds.forEach((userId) => assignmentRows.push({
      AgendaAsignadoID: uuid(),
      AgendaID: newAgendaId,
      UsuarioID: userId,
      Activo: true,
      FechaAsignacion: timestamp,
      FechaDesasignacion: '',
    }));
  });

  await appendRows('Agendas', agendaRows, { chunkSize: 100 });
  await appendRows('AgendaAsignados', assignmentRows, { chunkSize: 200 });

  await updateRow('Agendas', agendaId, {
    Estado: 'CANCELADA',
    RequiereBoleta: false,
    BoletaUID: '',
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });

  if (currentAssignments.length) {
    await updateRows('AgendaAsignados', currentAssignments.map((row) => ({
      idValue: row.AgendaAsignadoID,
      patch: { Activo: false, FechaDesasignacion: timestamp },
    })));
  }

  const views = buildAgendaViews({
    agendas: agendaRows,
    agendaAssignments: assignmentRows,
    users,
    tickets: tables.Boletas || [],
    ticketAssignments: tables.BoletaAsignados || [],
  });
  const notification = await notifySplit(views, users, agendaId);

  await audit(ctx, 'SEPARAR_AGENDA', 'Agendas', agendaId, original, {
    nuevasAgendas: views,
    notification,
  });

  return {
    originalAgendaId: agendaId,
    items: views,
    total: views.length,
    notification,
    message: notification.sent
      ? `La agenda se separó en ${views.length} agendas y las personas fueron notificadas.`
      : `La agenda se separó en ${views.length} agendas. Revise la advertencia del correo.`,
  };
}

export const agendaSplitHandlers = { split };
