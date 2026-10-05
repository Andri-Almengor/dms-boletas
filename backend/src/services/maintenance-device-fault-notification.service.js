import { env } from '../config/env.js';
import { nowIso, uuid } from '../core/utils.js';
import {
  appendRow,
  findRows,
  updateRow,
} from '../infra/sheets.repository.js';
import { sendAppsScriptAction } from './apps-script-action.service.js';
import { getNotificationEmailSettings } from './notification-email-settings.service.js';

const NOTIFICATION_ENTITY = 'MANTENIMIENTO_DISPOSITIVO';
const NOTIFICATION_TYPE = 'AVERIA_DISPOSITIVO';
const APPS_SCRIPT_ACTION = 'maintenance.device.failure.send';
const RETRY_STALE_MS = 2 * 60 * 1000;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalized(value) {
  return clean(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function maintenanceDeviceReportsFault(value) {
  return ['si', 'yes', 'true', '1'].includes(normalized(value));
}

function splitEmails(value) {
  const source = Array.isArray(value) ? value : clean(value, 20000).split(/[;,\n\r]+/);
  return [...new Set(source
    .map((item) => clean(item, 320).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function notificationAgeMs(row = {}) {
  const value = clean(row.UltimoIntento || row.FechaCreacion, 100);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

function retryableNotification(row = {}) {
  const state = clean(row.Estado, 40).toUpperCase();
  if (state === 'PENDIENTE' || state === 'ERROR') return true;
  return state === 'ENVIANDO' && notificationAgeMs(row) >= RETRY_STALE_MS;
}

function publicMaintenanceUrl(maintenanceId) {
  const base = clean(
    env.appPublicUrl
      || process.env.PUBLIC_APP_URL
      || process.env.RENDER_EXTERNAL_URL
      || process.env.FRONTEND_ORIGIN,
    2000,
  ).replace(/\/+$/, '');
  const id = clean(maintenanceId, 500);
  return base && id ? `${base}/mantenimientos/${encodeURIComponent(id)}` : '';
}

function parseAnswers(device = {}) {
  let raw = device.RespuestasJSON || device.respuestas || {};
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw || '{}');
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

  const snapshot = Array.isArray(raw.__preguntas) ? raw.__preguntas : [];
  const labels = new Map(snapshot.map((item) => [
    clean(item?.key || item?.Clave, 200),
    clean(item?.label || item?.Pregunta || item?.key || item?.Clave, 500),
  ]));

  return Object.entries(raw)
    .filter(([key]) => key !== '__preguntas')
    .map(([key, value]) => {
      let formatted = value;
      if (Array.isArray(value)) formatted = value.join(', ');
      else if (value && typeof value === 'object') {
        try {
          formatted = JSON.stringify(value);
        } catch {
          formatted = String(value);
        }
      }
      return {
        key: clean(key, 200),
        label: labels.get(clean(key, 200)) || clean(key, 500),
        value: clean(formatted, 5000),
      };
    })
    .filter((item) => item.key && item.value);
}

function maintenanceMailPayload(maintenance = {}) {
  return {
    MantenimientoID: clean(maintenance.MantenimientoID, 200),
    TituloMantenimiento: clean(maintenance.TituloMantenimiento, 500),
    TipoMantenimiento: clean(maintenance.TipoMantenimiento || 'MANTENIMIENTO', 80).toUpperCase(),
    Cliente: clean(maintenance.Cliente, 500),
    Ubicacion: clean(maintenance.Ubicacion, 500),
    Fecha: clean(maintenance.Fecha, 100),
    FechaFinalizacion: clean(maintenance.FechaFinalizacion, 100),
    Estado: clean(maintenance.Estado, 80),
    Responsables: clean(maintenance.Responsables, 2000),
    DescripcionGeneral: clean(maintenance.DescripcionGeneral, 5000),
  };
}

function deviceMailPayload(device = {}) {
  return {
    EvidenciaMantenimientoID: clean(device.EvidenciaMantenimientoID, 200),
    UbicacionEquipoID: clean(device.UbicacionEquipoID, 200),
    Zona: clean(device.Zona, 500),
    TipoDispositivoID: clean(device.TipoDispositivoID, 200),
    TipoDispositivo: clean(device.TipoDispositivo || device.Categoria, 500),
    NombreDispositivo: clean(device.NombreDispositivo, 500),
    Fabricante: clean(device.Fabricante, 500),
    Modelo: clean(device.Modelo, 500),
    Serie: clean(device.Serie, 500),
    DireccionMAC: clean(device.DireccionMAC, 120),
    Funcionamiento: clean(device.Funcionamiento, 500),
    EnUso: clean(device.EnUso, 500),
    Estado: clean(device.Estado, 500),
    Observacion: clean(device.Observacion, 5000),
    FechaTrabajo: clean(device.FechaTrabajo, 100),
    Tecnicos: clean(device.Tecnicos, 2000),
    ReportaAveria: 'Sí',
    Respuestas: parseAnswers(device),
  };
}

function summaryJson(maintenance = {}, device = {}) {
  return JSON.stringify({
    MantenimientoID: clean(maintenance.MantenimientoID, 200),
    TipoMantenimiento: clean(maintenance.TipoMantenimiento || 'MANTENIMIENTO', 80),
    Cliente: clean(maintenance.Cliente, 300),
    DispositivoID: clean(device.EvidenciaMantenimientoID, 200),
    Dispositivo: clean(device.NombreDispositivo, 300),
    ReportaAveria: 'Sí',
  });
}

async function configuredRecipients() {
  const settings = await getNotificationEmailSettings();
  return splitEmails(settings.maintenanceFaultTo || []);
}

export async function claimMaintenanceDeviceFaultNotification({
  maintenance,
  device,
  actorUserId = 'SYSTEM',
  forceNew = false,
} = {}) {
  if (!maintenanceDeviceReportsFault(device?.ReportaAveria)) return null;

  const deviceId = clean(device?.EvidenciaMantenimientoID, 200);
  if (!deviceId) return null;

  const recipients = await configuredRecipients();
  const destination = recipients.join(', ');
  const timestamp = nowIso();

  if (forceNew) {
    const notificationId = uuid();
    const row = {
      NotificacionID: notificationId,
      Entidad: NOTIFICATION_ENTITY,
      EntidadID: deviceId,
      Canal: 'CORREO_APPS_SCRIPT',
      Destino: destination,
      Tipo: NOTIFICATION_TYPE,
      Estado: 'ENVIANDO',
      Intentos: 0,
      Respuesta: '',
      Error: '',
      FechaCreacion: timestamp,
      FechaEnvio: '',
      CreadoPor: clean(actorUserId, 200) || 'SYSTEM',
      ClaveIdempotencia: `maintenance-device-fault:${deviceId}:${notificationId}`,
      UltimoIntento: timestamp,
      ResumenJSON: summaryJson(maintenance, device),
    };
    await appendRow('Notificaciones', row);
    return row;
  }

  const rows = await findRows(
    'Notificaciones',
    {
      Entidad: NOTIFICATION_ENTITY,
      EntidadID: deviceId,
      Tipo: NOTIFICATION_TYPE,
    },
    { limit: 20, orderBy: 'FechaCreacion', order: 'DESC' },
  );
  const latest = rows[0] || null;
  if (!latest || !retryableNotification(latest)) return null;

  return updateRow('Notificaciones', latest.NotificacionID, {
    Estado: 'ENVIANDO',
    Destino: destination,
    UltimoIntento: timestamp,
    ResumenJSON: summaryJson(maintenance, device),
  });
}

export async function deliverMaintenanceDeviceFaultNotification({
  notification,
  maintenance,
  device,
} = {}) {
  if (!notification?.NotificacionID) {
    return {
      sent: false,
      skipped: true,
      status: 'OMITIDO',
      message: '',
    };
  }

  const recipients = splitEmails(notification.Destino);
  const attempts = Math.max(0, Number(notification.Intentos || 0)) + 1;
  const attemptAt = nowIso();

  if (!recipients.length) {
    const message = 'La avería se guardó, pero no se envió el correo porque no hay destinatarios configurados en Administración → Notificaciones → Averías de mantenimiento.';
    await updateRow('Notificaciones', notification.NotificacionID, {
      Estado: 'ERROR',
      Intentos: attempts,
      Error: message,
      UltimoIntento: attemptAt,
    }).catch(() => {});
    return {
      sent: false,
      skipped: false,
      status: 'ERROR',
      notificationId: notification.NotificacionID,
      message,
    };
  }

  try {
    const result = await sendAppsScriptAction(
      APPS_SCRIPT_ACTION,
      {
        recipients,
        maintenance: maintenanceMailPayload(maintenance),
        device: deviceMailPayload(device),
        targetUrl: publicMaintenanceUrl(maintenance?.MantenimientoID),
      },
      {
        idempotencyKey: clean(notification.ClaveIdempotencia, 500),
        attempts: 2,
        timeoutMs: 45_000,
      },
    );

    if (result?.sent !== true || result?.skipped === true) {
      throw new Error(clean(result?.reason, 1200) || 'Apps Script no confirmó el envío del aviso de avería.');
    }

    const sentAt = nowIso();
    await updateRow('Notificaciones', notification.NotificacionID, {
      Estado: 'ENVIADO',
      Intentos: attempts,
      Respuesta: JSON.stringify(result).slice(0, 1500),
      Error: '',
      FechaEnvio: sentAt,
      UltimoIntento: sentAt,
    });

    return {
      sent: true,
      skipped: false,
      status: 'ENVIADO',
      notificationId: notification.NotificacionID,
      recipientCount: Number(result.recipientCount || recipients.length),
      destination: recipients.join(', '),
      message: 'La avería fue registrada y el correo de notificación se envió correctamente.',
    };
  } catch (error) {
    const detail = clean(error?.message || error, 1200) || 'Error desconocido al enviar el correo.';
    const message = `La avería se guardó, pero el correo no pudo enviarse: ${detail}`;
    await updateRow('Notificaciones', notification.NotificacionID, {
      Estado: 'ERROR',
      Intentos: attempts,
      Error: detail,
      UltimoIntento: attemptAt,
    }).catch(() => {});

    return {
      sent: false,
      skipped: false,
      status: 'ERROR',
      notificationId: notification.NotificacionID,
      destination: recipients.join(', '),
      message,
    };
  }
}

export const MAINTENANCE_DEVICE_FAULT_NOTIFICATION = Object.freeze({
  entity: NOTIFICATION_ENTITY,
  type: NOTIFICATION_TYPE,
  appsScriptAction: APPS_SCRIPT_ACTION,
});
