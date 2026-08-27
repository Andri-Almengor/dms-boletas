import { badRequest, forbidden } from '../core/errors.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.service.js';
import { sendAgendaChatNotification } from '../services/agenda-chat.service.js';
import { sendAppsScriptAction } from '../services/apps-script-action.service.js';
import { agendaHandlers } from './agenda.module.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function isAdmin(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
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

async function resendEmail(ctx) {
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
