import { badRequest, forbidden } from '../core/errors.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.service.js';
import { sendAgendaChatNotification } from '../services/agenda-chat.service.js';
import { sendAppsScriptAction } from '../services/apps-script-action.service.js';
import { agendaHandlers } from './agenda.module.js';

const PENDING_TICKET_TEST_TYPE = 'PENDING_TICKET_TEST';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function truthy(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === '') return false;
  return !['false', '0', 'no', 'inactivo'].includes(clean(value).toLowerCase());
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
}

function wantsPendingTicketTest(ctx = {}) {
  return clean(
    ctx.payload?.notificationType
      || ctx.payload?.tipoNotificacion
      || ctx.payload?.mode,
  ).toUpperCase() === PENDING_TICKET_TEST_TYPE
    || ctx.payload?.pendingTicketTest === true;
}

async function loadAgenda(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo un administrador puede reenviar una agenda.');
  const agendaId = clean(ctx.payload?.agendaId || ctx.payload?.AgendaID || ctx.payload?.id);
  if (!agendaId) throw badRequest('Debe indicar la agenda que desea reenviar.');

  const response = await agendaHandlers.get({
    ...ctx,
    payload: { ...ctx.payload, agendaId },
  });
  if (!response?.item) throw badRequest('No fue posible cargar la agenda para reenviarla.');
  return response.item;
}

function emailDeliveries(item = {}) {
  const recipients = new Map();
  for (const user of Array.isArray(item.asignados) ? item.asignados : []) {
    const email = clean(user?.Correo).toLowerCase();
    if (!email) continue;
    recipients.set(email, {
      correo: email,
      nombre: personName(user),
      agendas: [{
        agendaId: item.AgendaID,
        fecha: item.Fecha,
        horaInicio: item.HoraInicio,
        horaFin: item.HoraFin,
        detalle: item.Detalle,
        assigned: true,
      }],
    });
  }
  return [...recipients.values()];
}

function pendingTestAssignees(item = {}) {
  return (Array.isArray(item.asignados) ? item.asignados : []).map((user) => ({
    UsuarioID: clean(user.UsuarioID),
    NombreCompleto: personName(user),
    NombreUsuario: clean(user.NombreUsuario),
    Correo: clean(user.Correo).toLowerCase(),
  }));
}

function pendingTestAgenda(item = {}) {
  return {
    AgendaID: clean(item.AgendaID),
    Fecha: clean(item.Fecha),
    HoraInicio: clean(item.HoraInicio, '07:00'),
    HoraFin: clean(item.HoraFin, '17:00'),
    Detalle: clean(item.Detalle),
    Estado: clean(item.Estado, 'ACTIVA'),
    RequiereBoleta: truthy(item.RequiereBoleta),
    BoletaUID: clean(item.BoletaUID || item.boleta?.BoletaUID),
    RecordatorioEnviado: truthy(item.RecordatorioEnviado),
    RecordatorioEnviadoEn: clean(item.RecordatorioEnviadoEn),
    RecordatorioDia: clean(item.RecordatorioDia),
  };
}

async function sendPendingTicketReminderTest(ctx) {
  const item = await loadAgenda(ctx);
  const agenda = pendingTestAgenda(item);
  const assignedUsers = pendingTestAssignees(item);
  const hasTicket = Boolean(agenda.BoletaUID || item.boleta?.BoletaUID);

  if (!agenda.RequiereBoleta) {
    return {
      channel: 'pending-ticket-test',
      sent: false,
      testMode: true,
      stateChanged: false,
      code: 'AGENDA_PENDING_TEST_NOT_REQUIRED',
      message: 'Esta agenda está excluida del control de boleta. Use una agenda cuyo detalle sí requiera boleta.',
      diagnostics: {
        agendaId: agenda.AgendaID,
        requiresTicket: false,
        hasTicket,
        assignedCount: assignedUsers.length,
      },
    };
  }

  if (hasTicket) {
    return {
      channel: 'pending-ticket-test',
      sent: false,
      testMode: true,
      stateChanged: false,
      code: 'AGENDA_PENDING_TEST_ALREADY_HAS_TICKET',
      message: 'Esta agenda ya tiene una boleta relacionada. Para probar el faltante use una agenda sin boleta.',
      diagnostics: {
        agendaId: agenda.AgendaID,
        requiresTicket: true,
        hasTicket: true,
        assignedCount: assignedUsers.length,
      },
    };
  }

  let result;
  try {
    const data = await sendAppsScriptAction('agenda.notification.send', {
      dataSpreadsheetId: env.sheetId,
      appUrl: env.appPublicUrl,
      mode: 'PENDING_TEST',
      reason: 'MANUAL_PENDING_TICKET_TEST',
      pendingReminderTest: {
        agenda,
        assignedUsers,
      },
    }, {
      idempotencyKey: `agenda:pending-ticket-test:${agenda.AgendaID}:${Date.now()}`,
      attempts: 3,
    });

    if (data?.testMode !== true || data?.stateChanged !== false) {
      throw badRequest(
        'La implementación actual de Apps Script todavía no soporta la prueba de boleta pendiente. Publique la V7.6 y vuelva a intentarlo.',
      );
    }

    result = {
      channel: 'pending-ticket-test',
      sent: Boolean(data?.sent),
      testMode: true,
      stateChanged: false,
      diagnostics: {
        agendaId: agenda.AgendaID,
        date: agenda.Fecha,
        detail: agenda.Detalle,
        requiresTicket: true,
        hasTicket: false,
        reminderAlreadySent: agenda.RecordatorioEnviado,
        assignedCount: assignedUsers.length,
        assignedUsers: assignedUsers.map((user) => ({
          UsuarioID: user.UsuarioID,
          nombre: user.NombreCompleto,
          correo: user.Correo,
        })),
        to: Array.isArray(data?.to) ? data.to : [],
        cc: Array.isArray(data?.cc) ? data.cc : [],
        configuredTo: Array.isArray(data?.configuredTo) ? data.configuredTo : [],
        configuredCc: Array.isArray(data?.configuredCc) ? data.configuredCc : [],
        assignedEmails: Array.isArray(data?.assignedEmails) ? data.assignedEmails : [],
        subject: clean(data?.subject),
        sender: clean(data?.sender),
        remainingDailyQuota: Number(data?.remainingDailyQuota ?? 0),
        scriptVersion: clean(data?.scriptVersion),
      },
    };
  } catch (error) {
    result = {
      channel: 'pending-ticket-test',
      sent: false,
      testMode: true,
      stateChanged: false,
      code: error?.code || 'AGENDA_PENDING_TEST_FAILED',
      error: error?.message || 'No se pudo enviar la prueba del recordatorio de boleta pendiente.',
      diagnostics: {
        agendaId: agenda.AgendaID,
        date: agenda.Fecha,
        detail: agenda.Detalle,
        requiresTicket: true,
        hasTicket: false,
        reminderAlreadySent: agenda.RecordatorioEnviado,
        assignedCount: assignedUsers.length,
        assignedUsers: assignedUsers.map((user) => ({
          UsuarioID: user.UsuarioID,
          nombre: user.NombreCompleto,
          correo: user.Correo,
        })),
      },
    };
  }

  await audit(ctx, 'PROBAR_RECORDATORIO_BOLETA_PENDIENTE', 'Agendas', agenda.AgendaID, null, {
    testMode: true,
    stateChanged: false,
    result,
  }).catch(() => {});

  return {
    ...result,
    item: { AgendaID: agenda.AgendaID, Fecha: agenda.Fecha, Detalle: agenda.Detalle },
    message: result.sent
      ? 'Prueba enviada. La agenda no fue modificada ni se marcó el recordatorio como enviado.'
      : result.error || 'No se pudo enviar la prueba del recordatorio de boleta pendiente.',
  };
}

async function resendEmail(ctx) {
  if (wantsPendingTicketTest(ctx)) {
    return sendPendingTicketReminderTest(ctx);
  }

  const item = await loadAgenda(ctx);
  const deliveries = emailDeliveries(item);
  if (!deliveries.length) {
    return {
      channel: 'email',
      sent: false,
      code: 'AGENDA_EMAIL_NO_RECIPIENTS',
      recipients: 0,
      message: 'La agenda no tiene personas asignadas con correo electrónico.',
    };
  }

  let result;
  try {
    const data = await sendAppsScriptAction('agenda.notification.send', {
      dataSpreadsheetId: env.sheetId,
      appUrl: env.appPublicUrl,
      mode: 'CREATED',
      reason: 'MANUAL_RESEND',
      deliveries,
    }, {
      idempotencyKey: `agenda:manual-email:${item.AgendaID}:${Date.now()}`,
      attempts: 3,
    });
    result = {
      channel: 'email',
      sent: Boolean(data?.sent),
      recipients: deliveries.length,
      ...data,
    };
  } catch (error) {
    result = {
      channel: 'email',
      sent: false,
      recipients: deliveries.length,
      code: error?.code || 'AGENDA_EMAIL_RESEND_FAILED',
      error: error?.message || 'No se pudo reenviar la agenda por correo.',
    };
  }

  await audit(ctx, 'REENVIAR_AGENDA_CORREO', 'Agendas', item.AgendaID, null, {
    recipients: deliveries.map((delivery) => delivery.correo),
    result,
  }).catch(() => {});

  return {
    ...result,
    item: { AgendaID: item.AgendaID, Fecha: item.Fecha, Detalle: item.Detalle },
    message: result.sent
      ? `Agenda reenviada por correo a ${deliveries.length} persona${deliveries.length === 1 ? '' : 's'}.`
      : result.error || 'No se pudo reenviar la agenda por correo.',
  };
}

async function resendChat(ctx) {
  const item = await loadAgenda(ctx);
  const result = await sendAgendaChatNotification({
    views: [item],
    mode: 'RESENT',
    appUrl: env.appPublicUrl,
  });

  await audit(ctx, 'REENVIAR_AGENDA_CHAT', 'Agendas', item.AgendaID, null, {
    result,
  }).catch(() => {});

  let message = 'Agenda reenviada correctamente a Google Chat.';
  if (!result?.sent) {
    if (!result?.configured) message = 'El Google Chat de Agenda no está configurado.';
    else if (result?.status) message = `Google Chat rechazó el reenvío (HTTP ${result.status}).`;
    else message = result?.error || 'No se pudo reenviar la agenda a Google Chat.';
  }

  return {
    channel: 'chat',
    ...result,
    item: { AgendaID: item.AgendaID, Fecha: item.Fecha, Detalle: item.Detalle },
    message,
  };
}

export const agendaResendHandlers = {
  email: resendEmail,
  chat: resendChat,
};
