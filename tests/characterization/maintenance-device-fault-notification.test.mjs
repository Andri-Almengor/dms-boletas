import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la pregunta de avería es global, SI/NO, opcional y aplica a Mantenimiento y Proyecto', () => {
  const catalog = source('backend/src/services/maintenance-question-catalog.service.js');
  const hook = source('src/hooks/useMaintenanceQuestionCatalog.js');
  const relation = source('src/components/maintenance/MaintenanceProjectRelationField.jsx');

  assert.match(catalog, /MAINTENANCE_DEVICE_FAULT_QUESTION_KEY = 'reportaAveria'/);
  assert.match(catalog, /¿Se reporta avería en este equipo\?/);
  assert.match(catalog, /TipoRespuesta: 'SI_NO'/);
  assert.match(catalog, /AplicaModo: 'AMBOS'/);
  assert.match(catalog, /required: false/);
  assert.match(catalog, /systemScope: 'ALL_DEVICES'/);
  assert.match(hook, /globalQuestions/);
  assert.match(hook, /systemScope === 'ALL_DEVICES'/);
  assert.match(relation, /includeSystem: false/);
});

test('el correo se dispara solo al guardar explícitamente el dispositivo', () => {
  const module = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  const createBlock = module.slice(module.indexOf('async function deviceCreate'), module.indexOf('async function deviceUpdate'));
  const updateBlock = module.slice(module.indexOf('async function deviceUpdate'), module.indexOf('async function deviceAutosave'));
  const autosaveBlock = module.slice(module.indexOf('async function deviceAutosave'), module.indexOf('export const maintenanceQuestionHandlers'));

  assert.match(createBlock, /attachFaultNotification/);
  assert.match(updateBlock, /attachFaultNotification/);
  assert.doesNotMatch(autosaveBlock, /attachFaultNotification/);
});

test('la notificación de avería reutiliza Notificaciones y locking PostgreSQL para idempotencia multi-instancia', () => {
  const service = source('backend/src/services/maintenance-device-fault-notification.service.js');
  const migration = source('backend/migrations/020_maintenance_device_fault_notifications.sql');
  const dbTables = source('backend/src/config/database-tables.js');

  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /ClaveIdempotencia/);
  assert.match(service, /AveriaNotificacionClave/);
  assert.match(service, /'Notificaciones'/);
  assert.match(service, /Estado: 'ENVIANDO'/);
  assert.match(service, /'ENVIADO' : 'ERROR'/);
  assert.match(service, /REPORTAR_AVERIA_DISPOSITIVO/);
  assert.match(service, /ERROR_NOTIFICACION_AVERIA_DISPOSITIVO/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "AveriaNotificacionClave" TEXT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_maintenance_device_fault_key/);
  assert.match(dbTables, /'AveriaNotificacionClave'/);
});

test('el destinatario se configura en Notificaciones existentes y el aviso usa Apps Script, no SMTP paralelo', () => {
  const settings = source('backend/src/services/notification-email-settings.service.js');
  const page = source('src/pages/admin/NotificationSettingsPage.jsx');
  const email = source('backend/src/services/email.service.js');
  const faultService = source('backend/src/services/maintenance-device-fault-notification.service.js');
  const appsScript = source('apps-script/report-service/Code.gs');

  assert.match(settings, /maintenanceFaultTo: 'CORREOS_AVERIAS_MANTENIMIENTO'/);
  assert.match(page, /Avisos de avería de equipos/);
  assert.match(page, /maintenanceFaultTo/);
  assert.match(faultService, /sendAppsScriptAction/);
  assert.match(faultService, /maintenance\.device\.fault\.send/);
  assert.match(faultService, /idempotencyKey: reservation\.key/);
  assert.doesNotMatch(email, /sendMaintenanceDeviceFaultEmail/);
  assert.match(appsScript, /MAINTENANCE_DEVICE_FAULT_ACTION = 'maintenance\.device\.fault\.send'/);
  assert.match(appsScript, /function sendMaintenanceDeviceFaultEmail_\(payload\)/);
  assert.match(appsScript, /sendDmsEmail_/);
  assert.match(appsScript, /AVERÍA REPORTADA/);
  assert.match(appsScript, /Datos del mantenimiento/);
  assert.match(appsScript, /Detalle del dispositivo/);
  assert.match(appsScript, /Respuestas del dispositivo/);
  assert.match(appsScript, /action === MAINTENANCE_DEVICE_FAULT_ACTION/);
  assert.match(appsScript, /MAINTENANCE_DEVICE_FAULT_/);
  assert.doesNotMatch(faultService, /sendChatMessage|Google Chat|sendTicketReportEmail/);
});

test('un error de correo se devuelve como estado posterior sin perder el guardado del dispositivo', () => {
  const persistence = source('src/services/maintenanceDevicePersistence.js');
  const form = source('src/hooks/useMaintenanceForm.js');
  const module = source('backend/src/modules/maintenance-dynamic-questions.module.js');

  assert.match(module, /El dispositivo se guardó, pero no se pudo procesar la notificación de avería/);
  assert.match(persistence, /faultNotification: saved\?\.AveriaNotificacion \|\| null/);
  assert.match(form, /result\.faultNotification\?\.error/);
  assert.match(form, /setError\(result\.faultNotification\.error\)/);
  assert.match(form, /const faultNotificationErrors = deviceResults/);
  assert.match(form, /falló el aviso de avería/);
});

test('la configuración administrativa permite probar el mismo canal de correo de averías', () => {
  const config = source('backend/src/modules/config.module.js');
  const page = source('src/pages/admin/NotificationSettingsPage.jsx');

  assert.match(config, /TEST_MAINTENANCE_FAULT/);
  assert.match(config, /sendMaintenanceDeviceFaultEmailViaAppsScript/);
  assert.match(config, /normalizeNotificationEmails/);
  assert.match(config, /PROBAR_CORREO_AVERIA_MANTENIMIENTO/);
  assert.match(page, /testMaintenanceFaultEmail/);
  assert.match(page, /Probar correo de avería/);
  assert.match(page, /maintenanceFaultTo: emailForm\.maintenanceFaultTo/);
});


test('cambiar únicamente reportaAveria sigue siendo un cambio guardable del dispositivo', async () => {
  const state = await import('../../src/features/maintenance/maintenanceDeviceState.js');
  const original = {
    id: 'device-1',
    respuestas: { reportaAveria: 'No' },
    images: [],
    newImages: [],
  };
  const current = {
    ...original,
    respuestas: { reportaAveria: 'Sí' },
  };
  const signatureBuilder = (device) => state.maintenanceDeviceSignature(device, {
    RespuestasJSON: JSON.stringify(device.respuestas),
  });

  assert.equal(state.maintenanceDeviceChanged(current, original, signatureBuilder), true);

  const formData = source('src/pages/maintenance/maintenanceFormData.js');
  const module = source('backend/src/modules/maintenance.module.js');
  const form = source('src/hooks/useMaintenanceForm.js');
  const deviceState = source('src/features/maintenance/maintenanceDeviceState.js');

  assert.match(deviceState, /answers: cloneAnswers\(device\.respuestas\)/);
  assert.match(formData, /RespuestasJSON: JSON\.stringify\(device\.respuestas\)/);
  assert.match(module, /RespuestasJSON: JSON\.stringify\(answers\)/);
  assert.match(module, /changedDevicePatch/);
  assert.match(form, /persistMaintenanceDevice\(/);
});
