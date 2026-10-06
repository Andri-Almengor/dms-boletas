import { AppError } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { env } from '../config/env.js';
import { query } from '../infra/postgres.js';
import {
  appendRow,
  findById,
  findRows,
  updateRow,
  withTransaction,
} from '../infra/sheets.repository.js';
import { audit } from './audit.service.js';
import { sendAppsScriptAction } from './apps-script-action.service.js';
import {
  MAINTENANCE_DEVICE_FAULT_QUESTION_KEY,
  parseMaintenanceAnswers,
} from './maintenance-question-catalog.service.js';
import { getNotificationEmailSettings } from './notification-email-settings.service.js';

const NOTIFICATION_TYPE = 'MANTENIMIENTO_AVERIA_DISPOSITIVO';
export const MAINTENANCE_DEVICE_FAULT_ACTION = 'maintenance.device.fault.send';

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function reportsFault(device = {}) {
  const answers = parseMaintenanceAnswers(device.RespuestasJSON || device.respuestas || {});
  return ['si', 'true', '1', 'yes'].includes(normalized(answers[MAINTENANCE_DEVICE_FAULT_QUESTION_KEY]));
}

function notificationKey(deviceId) {
  return `MANTENIMIENTO_AVERIA|${clean(deviceId, 300)}|${uuid()}`;
}

function existingNotification(rows = []) {
  return rows.find((row) => normalized(row.Estado) === 'enviado')
    || rows.find((row) => normalized(row.Estado) === 'enviando')
    || rows[0]
    || null;
}

function errorText(error) {
  return clean(error?.message || error || 'Error desconocido', 1200);
}

export async function sendMaintenanceDeviceFaultEmailViaAppsScript({
  maintenance = {},
  device = {},
  to = [],
  idempotencyKey = '',
  testMode = false,
} = {}) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to])
    .map((value) => clean(value, 320).toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];

  if (!recipients.length) {
    throw new AppError(
      'MAINTENANCE_FAULT_EMAIL_MISSING',
      'El dispositivo se guardó, pero no hay un destinatario configurado para los avisos de avería.',
      400,
    );
  }

  const maintenanceId = clean(maintenance.MantenimientoID, 300);
  const publicBase = clean(env.appPublicUrl, 1200).replace(/\/+$/, '');
  const detailUrl = publicBase && maintenanceId
    ? `${publicBase}/mantenimientos/${encodeURIComponent(maintenanceId)}`
    : '';

  return sendAppsScriptAction(
    MAINTENANCE_DEVICE_FAULT_ACTION,
    {
      testMode: Boolean(testMode),
      maintenance,
      device,
      recipients: { to: recipients, cc: [] },
      appUrl: publicBase,
      detailUrl,
    },
    {
      idempotencyKey: clean(idempotencyKey, 500),
      attempts: 3,
    },
  );
}

async function claimFaultNotification({ ctx, deviceId, recipients }) {
  return withTransaction(async () => {
    const lockKey = `MANTENIMIENTO_AVERIA|DEVICE|${clean(deviceId, 300)}`;
    await query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [lockKey],
      { label: 'maintenance_device_fault.claim_lock' },
    );

    let device = await findById('Evidencia_Mantenimientos', deviceId);
    const reported = reportsFault(device);
    const currentKey = clean(device.AveriaNotificacionClave, 500);

    if (!reported) {
      if (currentKey) {
        device = await updateRow('Evidencia_Mantenimientos', deviceId, {
          AveriaNotificacionClave: '',
        });
      }
      return { claimed: false, skipped: 'NOT_REPORTED', device };
    }

    const key = currentKey || notificationKey(deviceId);
    if (!currentKey) {
      device = await updateRow('Evidencia_Mantenimientos', deviceId, {
        AveriaNotificacionClave: key,
      });
    }

    const rows = await findRows(
      'Notificaciones',
      { ClaveIdempotencia: key },
      { limit: 10, order: 'DESC' },
    );
    const existing = existingNotification(rows);
    const state = normalized(existing?.Estado);
    if (state === 'enviado') {
      return { claimed: false, skipped: 'ALREADY_SENT', existing, device, key };
    }
    if (state === 'enviando') {
      return { claimed: false, skipped: 'ALREADY_RUNNING', existing, device, key };
    }

    const timestamp = nowIso();
    const claim = {
      ClaveIdempotencia: key,
      Entidad: 'Evidencia_Mantenimientos',
      EntidadID: clean(deviceId, 300),
      Canal: 'EMAIL',
      Destino: recipients.join('; '),
      Tipo: NOTIFICATION_TYPE,
      Estado: 'ENVIANDO',
      Intentos: Number(existing?.Intentos || 0) + 1,
      Respuesta: existing?.Respuesta || '',
      Error: '',
      FechaCreacion: existing?.FechaCreacion || timestamp,
      FechaEnvio: existing?.FechaEnvio || '',
      UltimoIntento: timestamp,
      CreadoPor: clean(ctx.user?.UsuarioID, 300) || 'SYSTEM',
      ResumenJSON: JSON.stringify({
        mantenimientoId: clean(device.MantenimientoRef, 300),
        dispositivoId: clean(deviceId, 300),
        dispositivo: clean(device.NombreDispositivo, 500),
        tipoDispositivo: clean(device.TipoDispositivo || device.Categoria, 500),
      }),
    };

    const reserved = existing?.NotificacionID
      ? await updateRow('Notificaciones', existing.NotificacionID, claim)
      : await appendRow('Notificaciones', { NotificacionID: uuid(), ...claim });

    return { claimed: true, existing: reserved, device, key };
  });
}

async function persistAttempt({ reservation, recipients, result = null, error = null }) {
  const existing = reservation.existing;
  const timestamp = nowIso();
  const sent = Boolean(result?.sent) && !error;
  return updateRow('Notificaciones', existing.NotificacionID, {
    Destino: recipients.join('; '),
    Estado: sent ? 'ENVIADO' : 'ERROR',
    Respuesta: sent
      ? JSON.stringify({
        sent: true,
        provider: 'APPS_SCRIPT',
        scriptVersion: clean(result?.scriptVersion, 160),
        senderMode: clean(result?.senderMode, 120),
        senderAddress: clean(result?.senderAddress, 320),
        aliasFallback: Boolean(result?.aliasFallback),
        accepted: Array.isArray(result?.accepted)
          ? result.accepted.length
          : Number(result?.recipientCount || 0),
        rejected: Array.isArray(result?.rejected) ? result.rejected.length : 0,
      })
      : '',
    Error: sent ? '' : errorText(error),
    FechaEnvio: sent ? timestamp : existing.FechaEnvio || '',
    UltimoIntento: timestamp,
  });
}

export async function notifyMaintenanceDeviceFaultOnSave({ ctx, device } = {}) {
  const deviceId = clean(device?.EvidenciaMantenimientoID || device?.deviceId || device?.id, 300);
  if (!deviceId) return { sent: false, skipped: 'NO_DEVICE' };

  const initiallyReported = reportsFault(device);
  const currentKey = clean(device?.AveriaNotificacionClave, 500);
  if (!initiallyReported && !currentKey) {
    return { sent: false, skipped: 'NOT_REPORTED', device };
  }

  let recipients = [];
  if (initiallyReported) {
    const settings = await getNotificationEmailSettings();
    recipients = Array.isArray(settings.maintenanceFaultTo)
      ? settings.maintenanceFaultTo
      : [];
  }

  const reservation = await claimFaultNotification({
    ctx,
    deviceId,
    recipients,
  });
  if (!reservation.claimed) {
    return {
      sent: reservation.skipped === 'ALREADY_SENT',
      skipped: reservation.skipped,
      notificationId: reservation.existing?.NotificacionID || '',
      device: reservation.device || device,
    };
  }

  const maintenance = await findById(
    'Mantenimiento',
    reservation.device.MantenimientoRef,
  );

  let result = null;
  let sendError = null;
  try {
    result = await sendMaintenanceDeviceFaultEmailViaAppsScript({
      maintenance,
      device: reservation.device,
      to: recipients,
      idempotencyKey: reservation.key,
    });
  } catch (error) {
    sendError = error;
  }

  const notification = await persistAttempt({
    reservation,
    recipients,
    result,
    error: sendError,
  });

  if (sendError) {
    await audit(
      ctx,
      'ERROR_NOTIFICACION_AVERIA_DISPOSITIVO',
      'Evidencia_Mantenimientos',
      deviceId,
      null,
      {
        mantenimientoId: clean(maintenance.MantenimientoID, 300),
        notificacionId: notification.NotificacionID,
        etapa: 'APPS_SCRIPT_CORREO',
        codigo: clean(sendError.code, 120),
        error: errorText(sendError),
      },
    ).catch(() => {});

    return {
      sent: false,
      error: errorText(sendError),
      code: clean(sendError.code, 120),
      notificationId: notification.NotificacionID,
      device: reservation.device,
    };
  }

  await audit(
    ctx,
    'REPORTAR_AVERIA_DISPOSITIVO',
    'Evidencia_Mantenimientos',
    deviceId,
    null,
    {
      mantenimientoId: clean(maintenance.MantenimientoID, 300),
      notificacionId: notification.NotificacionID,
      destinatarios: recipients.length,
      canal: 'EMAIL',
      proveedor: 'APPS_SCRIPT',
    },
  ).catch(() => {});

  return {
    sent: true,
    notificationId: notification.NotificacionID,
    recipientCount: recipients.length,
    device: reservation.device,
  };
}
