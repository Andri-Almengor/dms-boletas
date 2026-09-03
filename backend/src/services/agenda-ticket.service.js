import { badRequest, forbidden } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { env } from '../config/env.js';
import { findById, readTables, updateRow } from '../infra/sheets.repository.js';
import { audit } from './audit.service.js';
import { agendaRequiresTicket, normalizeAgendaText } from './agenda-domain.service.js';
import { getAgendaTicketExceptions } from './agenda-ticket-exceptions.service.js';
import { sendAppsScriptAction } from './apps-script-action.service.js';

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

function validTicket(ticket = {}) {
  return Boolean(clean(ticket.BoletaUID))
    && !['true', '1', 'si', 'sí'].includes(normalizeAgendaText(ticket.Anulada))
    && normalizeAgendaText(ticket.Estado) !== 'anulada';
}

function userName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Técnico');
}

function ticketNumber(ticket = {}) {
  return clean(ticket.BoletaNumero || ticket.BoletaID || ticket.BoletaUID);
}

function agendaIdFromPayload(payload = {}) {
  return clean(payload.agendaId || payload.AgendaID || payload.agendaID);
}

/**
 * Prepara una creación de boleta originada desde Agenda sin cambiar el endpoint
 * ni el permiso histórico BOLETAS_CREAR. Las creaciones normales pasan sin
 * modificación. Para una agenda se exige además el mismo nivel administrativo
 * que ya protege crear/modificar agendas y se fuerzan únicamente sus técnicos.
 */
export async function prepareAgendaTicketCreation(ctx, payload = {}) {
  const agendaId = agendaIdFromPayload(payload);
  if (!agendaId) return { payload, agenda: null, assignedIds: [], users: [] };
  if (!isAdmin(ctx)) throw forbidden('Solo un administrador puede crear una boleta desde la agenda.');
  if (clean(payload.parentTicketId || payload.boletaRelacionadaUid || payload.BoletaRelacionadaUID)) {
    throw badRequest('Una boleta creada desde la agenda debe ser una visita principal, no una visita relacionada.');
  }

  const [agenda, tables, ticketExceptions] = await Promise.all([
    findById('Agendas', agendaId),
    readTables(['AgendaAsignados', 'Usuarios', 'Boletas']),
    getAgendaTicketExceptions(),
  ]);

  if (normalizeAgendaText(agenda.Estado) === 'cancelada') {
    throw badRequest('No se puede crear una boleta para una agenda cancelada.');
  }
  if (!agendaRequiresTicket(agenda.Detalle, ticketExceptions)) {
    throw badRequest('Esta agenda está configurada para no requerir boleta.');
  }

  const assignedIds = [...new Set((tables.AgendaAsignados || [])
    .filter((row) => activeAssignment(row) && clean(row.AgendaID) === agendaId)
    .map((row) => clean(row.UsuarioID))
    .filter(Boolean))];
  if (!assignedIds.length) throw badRequest('La agenda no tiene técnicos activos asignados.');

  const requestedTicketId = clean(payload.boletaUid || payload.BoletaUID);
  const linkedTicketId = clean(agenda.BoletaUID);
  const linkedTicket = linkedTicketId
    ? (tables.Boletas || []).find((ticket) => clean(ticket.BoletaUID) === linkedTicketId && validTicket(ticket))
    : null;

  if (linkedTicket && linkedTicketId !== requestedTicketId) {
    throw badRequest(`La agenda ya tiene vinculada la boleta #${ticketNumber(linkedTicket)}.`);
  }

  const usersById = new Map((tables.Usuarios || []).map((user) => [clean(user.UsuarioID), user]));
  const users = assignedIds.map((id) => usersById.get(id)).filter(Boolean);

  return {
    agenda,
    assignedIds,
    users,
    payload: {
      ...payload,
      agendaId,
      AgendaID: agendaId,
      AsignadoA: assignedIds,
      asignados: assignedIds,
      Fecha: clean(payload.Fecha || payload.fecha) || clean(agenda.Fecha),
      fecha: clean(payload.fecha || payload.Fecha) || clean(agenda.Fecha),
      HoraInicio: clean(payload.HoraInicio || payload.horaInicio) || clean(agenda.HoraInicio),
      horaInicio: clean(payload.horaInicio || payload.HoraInicio) || clean(agenda.HoraInicio),
      HoraFinal: clean(payload.HoraFinal || payload.horaFinal) || clean(agenda.HoraFin),
      horaFinal: clean(payload.horaFinal || payload.HoraFinal) || clean(agenda.HoraFin),
    },
  };
}

async function notifyPendingAgendaTicket({ agenda, ticket, users }) {
  const deliveries = users
    .map((user) => ({
      correo: clean(user.Correo).toLowerCase(),
      nombre: userName(user),
      agendas: [{
        agendaId: clean(agenda.AgendaID),
        fecha: clean(agenda.Fecha),
        horaInicio: clean(agenda.HoraInicio, '07:00'),
        horaFin: clean(agenda.HoraFin, '17:00'),
        detalle: clean(agenda.Detalle),
        clienteId: clean(ticket.ClienteID),
        clienteNombre: clean(ticket.Cliente),
        boletaUid: clean(ticket.BoletaUID),
        boletaNumero: ticketNumber(ticket),
        boletaTitulo: clean(ticket.Titulo),
        boletaEstado: clean(ticket.Estado, 'PENDIENTE'),
        assigned: true,
      }],
    }))
    .filter((delivery) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.correo));

  if (!deliveries.length) {
    return { sent: false, skipped: true, reason: 'NO_ASSIGNED_EMAILS' };
  }

  try {
    const result = await sendAppsScriptAction('agenda.notification.send', {
      dataSpreadsheetId: env.sheetId,
      appUrl: env.appPublicUrl,
      mode: 'TICKET_CREATED_PENDING',
      deliveries,
    }, {
      idempotencyKey: `agenda:ticket-created:${clean(agenda.AgendaID)}:${clean(ticket.BoletaUID)}`,
      attempts: 3,
    });
    return { sent: Boolean(result?.sent), ...result };
  } catch (error) {
    return {
      sent: false,
      error: error?.message || 'No se pudo enviar el aviso de boleta creada.',
      code: error?.code || '',
    };
  }
}

/**
 * Vincula de manera explícita la boleta recién creada a su agenda. El cliente
 * queda reflejado en Agenda para búsquedas/compatibilidad, pero su selección se
 * realiza únicamente dentro del formulario real de la boleta.
 */
export async function completeAgendaTicketCreation(ctx, context, bundle) {
  if (!context?.agenda?.AgendaID) return bundle;

  const ticket = bundle?.boleta || bundle || {};
  if (!clean(ticket.BoletaUID)) throw badRequest('La boleta creada no devolvió un identificador válido.');

  const before = context.agenda;
  const timestamp = nowIso();
  const agenda = await updateRow('Agendas', before.AgendaID, {
    BoletaUID: clean(ticket.BoletaUID),
    ClienteID: clean(ticket.ClienteID),
    ClienteNombre: clean(ticket.Cliente),
    RequiereBoleta: true,
    RecordatorioEnviado: false,
    RecordatorioEnviadoEn: '',
    RecordatorioDia: '',
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });

  const workflowAction = clean(ctx.payload?.workflowAction || ctx.payload?.accionFormulario).toLowerCase();
  const shouldNotifyPending = workflowAction !== 'finalize'
    && normalizeAgendaText(ticket.Estado || 'PENDIENTE') !== 'finalizada';
  const notification = shouldNotifyPending
    ? await notifyPendingAgendaTicket({ agenda, ticket, users: context.users })
    : { sent: false, skipped: true, reason: 'CREATED_FOR_IMMEDIATE_FINALIZATION' };

  await audit(ctx, 'VINCULAR_BOLETA_AGENDA', 'Agendas', agenda.AgendaID, before, {
    agenda,
    BoletaUID: ticket.BoletaUID,
    BoletaID: ticket.BoletaID,
    assignedUserIds: context.assignedIds,
    notification,
  });

  return {
    ...(bundle?.boleta ? bundle : { boleta: ticket }),
    agenda,
    agendaNotification: notification,
  };
}
