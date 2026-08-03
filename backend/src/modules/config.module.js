import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';
import {
  getNotificationEmailSettings,
  notificationEmailSettingsForClient,
  updateNotificationEmailSettings,
} from '../services/notification-email-settings.service.js';
import { audit } from '../services/audit.service.js';

const DEFAULT_TICKET_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';
const SENSITIVE_KEY = /(WEBHOOK|SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY)/i;
const SENSITIVE_VALUE = /chat\.googleapis\.com|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const NOTIFICATION_SECTION = 'NOTIFICATION_EMAILS';

function clean(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function canManageNotificationSettings(ctx = {}) {
  return Array.isArray(ctx.permissions) && ctx.permissions.includes('USUARIOS_GESTIONAR');
}

function requestedNotificationSection(payload = {}) {
  return clean(payload.section || payload.seccion || payload.configSection, 80).toUpperCase() === NOTIFICATION_SECTION;
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
  if (requestedNotificationSection(payload)) {
    if (!canManageNotificationSettings(ctx)) {
      throw forbidden('Solo un administrador puede consultar o modificar los destinatarios de correo.');
    }
    const operation = clean(payload.operation || payload.operacion || 'GET', 20).toUpperCase();
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
    !SENSITIVE_KEY.test(String(key)) && !SENSITIVE_VALUE.test(String(value || ''))
  )));
}
