import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';
import {
  getAgendaChatSettings,
  testAgendaChatNotification,
  updateAgendaChatSettings,
} from '../services/agenda-chat.service.js';
import {
  getAgendaTicketExceptionSettings,
  updateAgendaTicketExceptionSettings,
} from '../services/agenda-ticket-exceptions.service.js';
import {
  getNotificationEmailSettings,
  normalizeNotificationEmails,
  notificationEmailSettingsForClient,
  updateNotificationEmailSettings,
} from '../services/notification-email-settings.service.js';
import { sendMaintenanceDeviceFaultEmailViaAppsScript } from '../services/maintenance-device-fault-notification.service.js';
import {
  createWeeklyBackup,
  getWeeklyBackupStatus,
  updateWeeklyBackupSettings,
} from '../services/weekly-backup.service.js';
import { audit } from '../services/audit.service.js';

const DEFAULT_TICKET_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';
const SENSITIVE_KEY = /(WEBHOOK|SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY)/i;
const ADMIN_ONLY_KEY = /^BACKUP_/i;
const SENSITIVE_VALUE = /chat\.googleapis\.com|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const NOTIFICATION_SECTION = 'NOTIFICATION_EMAILS';
const AGENDA_CHAT_SECTION = 'AGENDA_CHAT';
const AGENDA_TICKET_EXCEPTIONS_SECTION = 'AGENDA_TICKET_EXCEPTIONS';
const BACKUP_SECTION = 'BACKUPS';

function clean(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function canManageAdminSettings(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function requestedSection(payload = {}) {
  return clean(payload.section || payload.seccion || payload.configSection, 80).toUpperCase();
}

function requestedNotificationSection(payload = {}) {
  return requestedSection(payload) === NOTIFICATION_SECTION;
}

function requestedAgendaChatSection(payload = {}) {
  return requestedSection(payload) === AGENDA_CHAT_SECTION;
}

function requestedAgendaTicketExceptionsSection(payload = {}) {
  return requestedSection(payload) === AGENDA_TICKET_EXCEPTIONS_SECTION;
}

function requestedBackupSection(payload = {}) {
  return requestedSection(payload) === BACKUP_SECTION;
}

async function handleAgendaChatSection(ctx, payload) {
  if (!canManageAdminSettings(ctx)) {
    throw forbidden('Solo un administrador puede consultar o modificar el chat de Agenda.');
  }

  const operation = clean(payload.operation || payload.operacion || 'GET', 20).toUpperCase();
  if (['UPDATE', 'SAVE', 'GUARDAR'].includes(operation)) {
    const before = await getAgendaChatSettings();
    const after = await updateAgendaChatSettings(payload.settings || payload.config || {});
    await audit(
      ctx,
      'ACTUALIZAR_CHAT_AGENDA',
      'Configuracion',
      AGENDA_CHAT_SECTION,
      before,
      after,
    ).catch(() => {});
    return { section: AGENDA_CHAT_SECTION, settings: after, updated: true };
  }

  if (['TEST', 'PROBAR', 'PRUEBA'].includes(operation)) {
    const candidate = payload.settings || payload.config || {};
    const test = await testAgendaChatNotification(candidate);
    await audit(
      ctx,
      'PROBAR_CHAT_AGENDA',
      'Configuracion',
      AGENDA_CHAT_SECTION,
      null,
      {
        configured: test.configured,
        sent: test.sent,
        status: test.status || 0,
        code: test.code || '',
      },
    ).catch(() => {});
    return {
      section: AGENDA_CHAT_SECTION,
      settings: await getAgendaChatSettings(),
      test,
      tested: true,
    };
  }

  return {
    section: AGENDA_CHAT_SECTION,
    settings: await getAgendaChatSettings(),
    updated: false,
  };
}

async function handleAgendaTicketExceptionsSection(ctx, payload) {
  if (!canManageAdminSettings(ctx)) {
    throw forbidden('Solo un administrador puede consultar o modificar las excepciones de boleta de Agenda.');
  }

  const operation = clean(payload.operation || payload.operacion || 'GET', 20).toUpperCase();
  if (['UPDATE', 'SAVE', 'GUARDAR'].includes(operation)) {
    const before = await getAgendaTicketExceptionSettings();
    const after = await updateAgendaTicketExceptionSettings(payload.settings || payload.config || {});
    await audit(
      ctx,
      'ACTUALIZAR_EXCEPCIONES_BOLETA_AGENDA',
      'Configuracion',
      AGENDA_TICKET_EXCEPTIONS_SECTION,
      before,
      after,
    ).catch(() => {});
    return { section: AGENDA_TICKET_EXCEPTIONS_SECTION, settings: after, updated: true };
  }

  return {
    section: AGENDA_TICKET_EXCEPTIONS_SECTION,
    settings: await getAgendaTicketExceptionSettings(),
    updated: false,
  };
}

async function handleBackupSection(ctx, payload) {
  if (!canManageAdminSettings(ctx)) {
    throw forbidden('Solo un administrador puede consultar o modificar las copias de respaldo.');
  }

  const operation = clean(payload.operation || payload.operacion || 'GET', 20).toUpperCase();
  if (['UPDATE', 'SAVE', 'GUARDAR'].includes(operation)) {
    const before = await getWeeklyBackupStatus();
    const after = await updateWeeklyBackupSettings({
      enabled: payload.enabled ?? payload.activo,
      day: payload.day ?? payload.dia,
      hour: payload.hour ?? payload.hora,
    });
    await audit(
      ctx,
      'ACTUALIZAR_RESPALDO_SEMANAL',
      'Configuracion',
      BACKUP_SECTION,
      before,
      after,
    ).catch(() => {});
    return { section: BACKUP_SECTION, settings: after, updated: true };
  }

  if (['CREATE', 'BACKUP', 'RESPALDAR', 'CREAR'].includes(operation)) {
    const backup = await createWeeklyBackup({
      actor: ctx.user?.UsuarioID || ctx.user?.Correo || 'SYSTEM',
    });
    await audit(
      ctx,
      'CREAR_RESPALDO_MANUAL',
      'Configuracion',
      BACKUP_SECTION,
      null,
      {
        fileId: backup.fileId,
        fileName: backup.fileName,
        createdAt: backup.createdAt,
        slot: backup.slot,
      },
    ).catch(() => {});
    return {
      section: BACKUP_SECTION,
      settings: await getWeeklyBackupStatus(),
      backup,
      created: true,
    };
  }

  return {
    section: BACKUP_SECTION,
    settings: await getWeeklyBackupStatus(),
    updated: false,
  };
}

export async function getConfig() {
  const rows = await readTable('Configuracion');
  const result = {};
  rows.forEach((row) => {
    if (row.Clave) result[row.Clave] = row.Valor;
  });
  if (!String(result.TEMPLATE_BOLETA_ID || '').trim()) {
    result.TEMPLATE_BOLETA_ID = DEFAULT_TICKET_TEMPLATE_ID;
  }
  return result;
}

export async function getClientConfig(ctx = {}) {
  const payload = ctx?.payload || {};
  if (requestedBackupSection(payload)) return handleBackupSection(ctx, payload);
  if (requestedAgendaChatSection(payload)) return handleAgendaChatSection(ctx, payload);
  if (requestedAgendaTicketExceptionsSection(payload)) return handleAgendaTicketExceptionsSection(ctx, payload);

  if (requestedNotificationSection(payload)) {
    if (!canManageAdminSettings(ctx)) {
      throw forbidden('Solo un administrador puede consultar o modificar los destinatarios de correo.');
    }
    const operation = clean(payload.operation || payload.operacion || 'GET', 40).toUpperCase();
    if (['TEST_MAINTENANCE_FAULT', 'TEST_FAULT', 'PROBAR_AVERIA'].includes(operation)) {
      const settings = await getNotificationEmailSettings();
      const candidate = payload.settings?.maintenanceFaultTo
        ?? payload.config?.maintenanceFaultTo
        ?? settings.maintenanceFaultTo;
      const recipients = normalizeNotificationEmails(candidate, 'el destinatario de averías de mantenimiento');
      const test = await sendMaintenanceDeviceFaultEmailViaAppsScript({
        maintenance: {
          MantenimientoID: 'PRUEBA-CANAL-CORREO',
          TipoMantenimiento: 'MANTENIMIENTO',
          TituloMantenimiento: 'Prueba de correo de avería',
          Cliente: 'DMS',
          Ubicacion: 'Configuración de notificaciones',
          Fecha: new Date().toISOString().slice(0, 10),
          Estado: 'PRUEBA',
          Responsables: clean(ctx.user?.NombreCompleto || ctx.user?.NombreUsuario || ctx.user?.Correo || 'Administrador', 200),
          DescripcionGeneral: 'Prueba manual del canal de correo para avisos de avería.',
        },
        device: {
          EvidenciaMantenimientoID: 'PRUEBA-CANAL-CORREO',
          TipoDispositivo: 'Prueba',
          NombreDispositivo: 'PRUEBA DE CANAL - NO ES UNA AVERÍA REAL',
          UbicacionEquipoNombre: 'Configuración',
          Estado: 'PRUEBA',
          Observacion: 'Este mensaje valida el destinatario configurado y la conexión SMTP del backend.',
          RespuestasJSON: JSON.stringify({
            reportaAveria: 'Sí',
            __preguntas: [{
              key: 'reportaAveria',
              label: '¿Se reporta avería en este equipo?',
              value: 'Sí',
            }],
          }),
        },
        to: recipients,
        idempotencyKey: `MANTENIMIENTO_AVERIA_TEST|${clean(ctx.user?.UsuarioID || ctx.user?.Correo || 'ADMIN', 300)}|${Date.now()}`,
        testMode: true,
      });
      await audit(
        ctx,
        'PROBAR_CORREO_AVERIA_MANTENIMIENTO',
        'Configuracion',
        NOTIFICATION_SECTION,
        null,
        {
          enviado: Boolean(test.sent),
          destinatarios: recipients.length,
          aceptados: Array.isArray(test.accepted) ? test.accepted.length : 0,
          rechazados: Array.isArray(test.rejected) ? test.rejected.length : 0,
        },
      ).catch(() => {});
      return {
        section: NOTIFICATION_SECTION,
        settings: notificationEmailSettingsForClient(settings),
        test: {
          sent: Boolean(test.sent),
          accepted: Array.isArray(test.accepted) ? test.accepted.length : 0,
          rejected: Array.isArray(test.rejected) ? test.rejected.length : 0,
        },
        tested: true,
      };
    }
    if (operation === 'UPDATE' || operation === 'SAVE' || operation === 'GUARDAR') {
      const before = await getNotificationEmailSettings();
      const after = await updateNotificationEmailSettings(payload.settings || payload.config || {});
      await audit(
        ctx,
        'ACTUALIZAR_DESTINATARIOS_CORREO',
        'Configuracion',
        NOTIFICATION_SECTION,
        notificationEmailSettingsForClient(before),
        notificationEmailSettingsForClient(after),
      ).catch(() => {});
      return {
        section: NOTIFICATION_SECTION,
        settings: notificationEmailSettingsForClient(after),
        updated: true,
      };
    }
    const settings = await getNotificationEmailSettings();
    return {
      section: NOTIFICATION_SECTION,
      settings: notificationEmailSettingsForClient(settings),
      updated: false,
    };
  }

  const config = await getConfig();
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => (
    !SENSITIVE_KEY.test(String(key))
    && !ADMIN_ONLY_KEY.test(String(key))
    && !SENSITIVE_VALUE.test(String(value || ''))
  )));
}
