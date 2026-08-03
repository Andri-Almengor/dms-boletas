import { badRequest } from '../core/errors.js';
import {
  appendRows,
  readTable,
  updateRows,
} from '../infra/sheets.repository.js';

const CONFIG_KEYS = Object.freeze({
  caseCreatedTo: 'CORREOS_CASOS_PRINCIPALES',
  caseCreatedCc: 'CORREOS_CASOS_CC',
  caseAssignedCc: 'CORREOS_CASOS_ASIGNACION_CC',
  ticketDefaultCc: 'CORREOS_BOLETAS_CC',
  testRecipients: 'CORREOS_PRUEBAS',
  testCc: 'CORREOS_PRUEBAS_CC',
});

const DEFAULT_CASE_RECIPIENTS = Object.freeze([
  'yehuda.karmona@solutionsdms.com',
  'raul.mayorga@solutionsdms.com',
  'alejandra.umana@solutionsdms.com',
]);
const DEFAULT_TEST_RECIPIENTS = Object.freeze([
  'andrick.almengor@solutionsdms.com',
]);
const MAX_EMAILS_PER_FIELD = 40;
let seedPromise = null;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function splitRawEmails(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitRawEmails(item));
  return clean(value, 20000)
    .split(/[;,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeNotificationEmails(value, fieldLabel = 'correos') {
  const raw = splitRawEmails(value);
  const invalid = raw.filter((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  if (invalid.length) {
    throw badRequest(`Revise ${fieldLabel}. Correos inválidos: ${invalid.slice(0, 5).join(', ')}.`);
  }
  const emails = [...new Set(raw.map((item) => item.toLowerCase()))];
  if (emails.length > MAX_EMAILS_PER_FIELD) {
    throw badRequest(`${fieldLabel} permite un máximo de ${MAX_EMAILS_PER_FIELD} correos.`);
  }
  return emails;
}

function serialized(emails = []) {
  return normalizeNotificationEmails(emails).join('; ');
}

function rowsMap(rows = []) {
  return new Map(rows
    .filter((row) => clean(row.Clave))
    .map((row) => [clean(row.Clave), clean(row.Valor, 20000)]));
}

function legacyValue(map, key, envValue = '') {
  return clean(envValue, 20000) || clean(map.get(key), 20000);
}

function initialValues(map) {
  const legacyCaseTo = legacyValue(map, 'CUSTOMER_CASE_ADMIN_EMAILS', process.env.CUSTOMER_CASE_ADMIN_EMAILS);
  const legacyTicketCc = legacyValue(map, 'DEFAULT_CC_EMAILS');
  const legacyTest = legacyValue(map, 'TEST_EMAIL', process.env.TEST_NOTIFICATION_EMAIL);
  return {
    [CONFIG_KEYS.caseCreatedTo]: serialized(legacyCaseTo || DEFAULT_CASE_RECIPIENTS),
    [CONFIG_KEYS.caseCreatedCc]: '',
    [CONFIG_KEYS.caseAssignedCc]: '',
    [CONFIG_KEYS.ticketDefaultCc]: serialized(legacyTicketCc || []),
    [CONFIG_KEYS.testRecipients]: serialized(legacyTest || DEFAULT_TEST_RECIPIENTS),
    [CONFIG_KEYS.testCc]: '',
  };
}

async function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const rows = await readTable('Configuracion');
      const map = rowsMap(rows);
      const defaults = initialValues(map);
      const missing = Object.entries(defaults)
        .filter(([key]) => !map.has(key))
        .map(([Clave, Valor]) => ({ Clave, Valor }));
      if (missing.length) await appendRows('Configuracion', missing);
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

function settingsFromMap(map) {
  return {
    caseCreatedTo: normalizeNotificationEmails(map.get(CONFIG_KEYS.caseCreatedTo) || []),
    caseCreatedCc: normalizeNotificationEmails(map.get(CONFIG_KEYS.caseCreatedCc) || []),
    caseAssignedCc: normalizeNotificationEmails(map.get(CONFIG_KEYS.caseAssignedCc) || []),
    ticketDefaultCc: normalizeNotificationEmails(map.get(CONFIG_KEYS.ticketDefaultCc) || []),
    testRecipients: normalizeNotificationEmails(map.get(CONFIG_KEYS.testRecipients) || []),
    testCc: normalizeNotificationEmails(map.get(CONFIG_KEYS.testCc) || []),
  };
}

export async function getNotificationEmailSettings() {
  await ensureSeeded();
  const rows = await readTable('Configuracion');
  const settings = settingsFromMap(rowsMap(rows));
  if (!settings.caseCreatedTo.length) {
    settings.caseCreatedTo = [...DEFAULT_CASE_RECIPIENTS];
  }
  if (!settings.testRecipients.length) {
    settings.testRecipients = [...DEFAULT_TEST_RECIPIENTS];
  }
  return settings;
}

export async function updateNotificationEmailSettings(payload = {}) {
  await ensureSeeded();
  const next = {
    caseCreatedTo: normalizeNotificationEmails(payload.caseCreatedTo, 'los destinatarios principales de casos'),
    caseCreatedCc: normalizeNotificationEmails(payload.caseCreatedCc, 'las copias de casos nuevos'),
    caseAssignedCc: normalizeNotificationEmails(payload.caseAssignedCc, 'las copias de asignación de casos'),
    ticketDefaultCc: normalizeNotificationEmails(payload.ticketDefaultCc, 'las copias de boletas'),
    testRecipients: normalizeNotificationEmails(payload.testRecipients, 'los destinatarios de prueba'),
    testCc: normalizeNotificationEmails(payload.testCc, 'las copias de prueba'),
  };
  if (!next.caseCreatedTo.length) {
    throw badRequest('Debe configurar al menos un destinatario principal para los casos nuevos.');
  }
  if (!next.testRecipients.length) {
    throw badRequest('Debe configurar al menos un correo para las pruebas.');
  }

  const rows = await readTable('Configuracion', { force: true });
  const existing = rowsMap(rows);
  const updates = [];
  const inserts = [];
  Object.entries(CONFIG_KEYS).forEach(([field, key]) => {
    const record = { Clave: key, Valor: serialized(next[field]) };
    if (existing.has(key)) updates.push({ idValue: key, patch: record });
    else inserts.push(record);
  });
  if (updates.length) await updateRows('Configuracion', updates, 'Clave');
  if (inserts.length) await appendRows('Configuracion', inserts);
  return getNotificationEmailSettings();
}

export function notificationEmailSettingsForClient(settings = {}) {
  return {
    caseCreatedTo: settings.caseCreatedTo || [],
    caseCreatedCc: settings.caseCreatedCc || [],
    caseAssignedCc: settings.caseAssignedCc || [],
    ticketDefaultCc: settings.ticketDefaultCc || [],
    testRecipients: settings.testRecipients || [],
    testCc: settings.testCc || [],
  };
}

export const NOTIFICATION_EMAIL_CONFIG_KEYS = CONFIG_KEYS;
