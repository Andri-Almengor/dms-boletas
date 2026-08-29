import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isMaintenanceFinalizationDue,
  maintenanceFinalizationSchedule,
} from '../../backend/src/core/maintenance-finalization-schedule.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('antes de las 17:00 Costa Rica la finalización queda programada para las 23:00 UTC', () => {
  const schedule = maintenanceFinalizationSchedule(new Date('2026-08-28T22:59:00.000Z'));
  assert.equal(schedule.dueNow, false);
  assert.equal(schedule.scheduledAt, '2026-08-28T23:00:00.000Z');
  assert.equal(schedule.localDate, '2026-08-28');
});

test('a partir de las 17:00 Costa Rica la finalización puede iniciar inmediatamente', () => {
  const schedule = maintenanceFinalizationSchedule(new Date('2026-08-28T23:00:00.000Z'));
  assert.equal(schedule.dueNow, true);
  assert.equal(isMaintenanceFinalizationDue(schedule.scheduledAt, new Date('2026-08-28T23:00:00.000Z')), true);
});

test('el backend persiste PROGRAMADO y no entra al worker antes de las 17:00', () => {
  const scheduler = source('backend/src/services/maintenance-finalization-schedule.patch.js');
  assert.match(scheduler, /EstadoFinalizacion: 'PROGRAMADO'/);
  assert.match(scheduler, /PasoFinalizacion: 'ESPERANDO_1700'/);
  assert.match(scheduler, /FinalizacionProgramadaPara: schedule\.scheduledAt/);
  assert.match(scheduler, /if \(schedule\.dueNow\) return baseFinalize\(ctx\)/);
  assert.match(scheduler, /Puede cerrar la aplicación/);
});

test('la capa de las 17:00 se instala antes de que action-router capture los handlers', () => {
  const app = source('backend/src/app.js');
  const scheduleImport = app.indexOf("import './services/maintenance-finalization-schedule.patch.js'");
  const routerImport = app.indexOf("import { dispatchAction } from './core/action-router.js'");
  assert.ok(scheduleImport >= 0);
  assert.ok(routerImport > scheduleImport);
});

test('mientras está PROGRAMADO el servidor bloquea cambios de datos dispositivos y evidencias', () => {
  const scheduler = source('backend/src/services/maintenance-finalization-schedule.patch.js');
  const guard = source('backend/src/services/maintenance-finalization-edit-guard.service.js');
  assert.match(scheduler, /installEditGuard\(maintenanceProgressChatHandlers/);
  assert.match(scheduler, /installEditGuard\(maintenanceScalableImageHandlers/);
  assert.match(guard, /MAINTENANCE_FINALIZATION_SCHEDULED_LOCKED/);
  assert.match(guard, /EstadoFinalizacion/);
  assert.match(guard, /PROGRAMADO/);
});

test('el wake-up usa un contexto interno y retoma PROGRAMADO o EN_PROCESO sin sesión del navegador', () => {
  const scheduler = source('backend/src/services/maintenance-finalization-schedule.patch.js');
  assert.match(scheduler, /UsuarioID: 'SISTEMA_1700'/);
  assert.match(scheduler, /dueScheduledRows/);
  assert.match(scheduler, /isProcessing\(row\)/);
  assert.match(scheduler, /baseProgressFinalize\(systemContext/);
  assert.match(scheduler, /export async function wakeScheduledMaintenanceFinalizations/);
});

test('el endpoint externo exige un secreto y nunca reutiliza una sesión de usuario', () => {
  const route = source('backend/src/routes/maintenance-finalization-worker.routes.js');
  const app = source('backend/src/app.js');
  const render = source('render.yaml');
  assert.match(route, /MAINTENANCE_FINALIZATION_WAKE_SECRET/);
  assert.match(route, /x-dms-worker-secret/);
  assert.match(route, /timingSafeEqual/);
  assert.match(app, /\/api\/maintenance-finalization/);
  assert.match(render, /MAINTENANCE_FINALIZATION_WAKE_SECRET/);
});

test('Apps Script despierta Render a las 17:00 y programa reintentos si todavía queda trabajo', () => {
  const script = source('scripts/google-apps-script/maintenance-finalization-5pm-worker.gs');
  assert.match(script, /atHour\(17\)/);
  assert.match(script, /inTimezone\('America\/Costa_Rica'\)/);
  assert.match(script, /nextDueAt/);
  assert.match(script, /scheduleDmsRetry_/);
  assert.match(script, /\/api\/maintenance-finalization\/wake/);
});

test('Apps Script libera DELIVERY heredadas y limita la idempotencia antes de despertar Render', () => {
  const script = source('scripts/google-apps-script/maintenance-finalization-5pm-worker.gs');
  assert.match(script, /DMS_IDEMPOTENCY_MAX_PROPERTIES = 80/);
  assert.match(script, /'DELIVERY_'/);
  assert.match(script, /dmsPruneIdempotencyProperties_/);
  assert.match(script, /dmsCleanupQuotaBeforeWake_\(\)/);
  assert.match(script, /dmsCleanupPropertyQuotaNow/);
  assert.match(script, /everyHours\(1\)/);
  assert.match(script, /properties\.deleteProperty\(key\)/);
  assert.match(script, /REPORT_WEBHOOK_SECRET/);
  assert.match(script, /TEMPLATE_BOLETA_ID/);
  assert.match(script, /BOLETAS_FOLDER_ID/);
});

test('la interfaz distingue finalización programada y permite cancelarla antes de iniciar', () => {
  const domain = source('src/services/maintenanceFinalizationDomain.js');
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  const service = source('src/services/maintenanceFinalization.js');
  assert.match(domain, /ESPERANDO_1700/);
  assert.match(domain, /scheduled = state === 'PROGRAMADO'/);
  assert.match(center, /Cancelar finalización programada/);
  assert.match(center, /Puede cerrar el navegador o apagar este equipo/);
  assert.match(center, /window\.setInterval\(refreshStatus, 5_000\)/);
  assert.match(service, /cancelScheduledMaintenanceFinalization/);
});
