import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildMaintenanceProgress,
  formatMaintenanceProgressMessage,
  maintenancePlannedCountsChanged,
  maintenanceProgressScheduleSlot,
} from '../../backend/src/core/maintenance-progress.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function devices(category, count, extra = {}) {
  return Array.from({ length: count }, (_, index) => ({
    EvidenciaMantenimientoID: `${category}-${index + 1}`,
    MantenimientoRef: 'mnt-1',
    TipoDispositivo: category,
    Categoria: category,
    Activo: true,
    ...extra,
  }));
}

test('calcula avance fijo por categoría y total del mantenimiento', () => {
  const progress = buildMaintenanceProgress({
    maintenance: {
      MantenimientoID: 'mnt-1',
      CantCámaras: 100,
      CantPuertas: 20,
      CantidadesJSON: JSON.stringify({ CantCámaras: 100, CantPuertas: 20 }),
    },
    devices: [
      ...devices('Cámara', 10),
      ...devices('Puertas', 3),
      { ...devices('Cámara', 1)[0], EvidenciaMantenimientoID: 'inactive', Activo: false },
    ],
  });

  const cameras = progress.items.find((item) => item.label === 'Cámaras');
  const doors = progress.items.find((item) => item.label === 'Puertas');
  assert.deepEqual(
    { registered: cameras.registered, expected: cameras.expected },
    { registered: 10, expected: 100 },
  );
  assert.deepEqual(
    { registered: doors.registered, expected: doors.expected },
    { registered: 3, expected: 20 },
  );
  assert.equal(progress.registered, 13);
  assert.equal(progress.expected, 120);
  assert.equal(progress.remaining, 107);
  assert.equal(progress.percentage, 10.8);
});

test('incluye tipos de dispositivo dinámicos definidos en CantidadesJSON', () => {
  const progress = buildMaintenanceProgress({
    maintenance: {
      MantenimientoID: 'mnt-1',
      CantidadesJSON: JSON.stringify({ 'TipoDispositivo:type-1': 5 }),
    },
    deviceTypes: [{ TipoDispositivoID: 'type-1', Nombre: 'Lector biométrico' }],
    devices: [
      ...devices('', 2, { TipoDispositivoID: 'type-1', TipoDispositivo: '', Categoria: '' }),
    ],
  });

  const item = progress.items.find((entry) => entry.label === 'Lector biométrico');
  assert.ok(item);
  assert.equal(item.registered, 2);
  assert.equal(item.expected, 5);
  assert.equal(progress.registered, 2);
  assert.equal(progress.expected, 5);
});

test('solo cambios de cantidades disparan el aviso inmediato de edición', () => {
  const before = {
    TituloMantenimiento: 'Preventivo CCTV',
    CantCámaras: 100,
    CantidadesJSON: JSON.stringify({ CantCámaras: 100, 'TipoDispositivo:type-1': 5 }),
  };
  assert.equal(
    maintenancePlannedCountsChanged(before, { ...before, TituloMantenimiento: 'Preventivo CCTV agosto' }),
    false,
  );
  assert.equal(
    maintenancePlannedCountsChanged(before, { ...before, CantCámaras: 120 }),
    true,
  );
  assert.equal(
    maintenancePlannedCountsChanged(before, {
      ...before,
      CantidadesJSON: JSON.stringify({ CantCámaras: 100, 'TipoDispositivo:type-1': 8 }),
    }),
    true,
  );
});

test('programa 7 a. m. y 5 p. m. de Costa Rica y omite fines de semana', () => {
  const morning = maintenanceProgressScheduleSlot(
    new Date('2026-08-07T13:00:15.000Z'),
    'America/Costa_Rica',
    [7, 17],
  );
  const afternoon = maintenanceProgressScheduleSlot(
    new Date('2026-08-07T23:00:15.000Z'),
    'America/Costa_Rica',
    [7, 17],
  );
  const saturday = maintenanceProgressScheduleSlot(
    new Date('2026-08-08T13:00:00.000Z'),
    'America/Costa_Rica',
    [7, 17],
  );

  assert.equal(morning?.slot, '07:00');
  assert.equal(morning?.dateKey, '2026-08-07');
  assert.equal(afternoon?.slot, '17:00');
  assert.equal(saturday, null);
});

test('mensaje muestra avance por dispositivo y total', () => {
  const progress = buildMaintenanceProgress({
    maintenance: { MantenimientoID: 'mnt-1', CantCámaras: 100, CantPuertas: 20 },
    devices: [...devices('Cámara', 10), ...devices('Puertas', 3)],
  });
  const message = formatMaintenanceProgressMessage({
    maintenance: {
      MantenimientoID: 'mnt-1',
      Cliente: 'Cliente XYZ',
      TituloMantenimiento: 'Mantenimiento preventivo CCTV',
      Estado: 'PENDIENTE',
    },
    progress,
    reason: 'SCHEDULED',
    slot: '07:00',
    now: new Date('2026-08-07T13:00:15.000Z'),
    timeZone: 'America/Costa_Rica',
  });

  assert.match(message, /ESTADO DE MANTENIMIENTO · 7:00 a\. m\./);
  assert.match(message, /Cliente: Cliente XYZ/);
  assert.match(message, /Cámaras: 10 de 100/);
  assert.match(message, /Puertas: 3 de 20/);
  assert.match(message, /Total: 13 de 120 \(10\.8%\)/);
  assert.match(message, /Pendientes: 107/);
});

test('la integración usa el Chat del cliente, idempotencia persistente y no bloquea el guardado', () => {
  const router = source('backend/src/core/action-router.js');
  const wrapper = source('backend/src/modules/maintenance-progress-chat.module.js');
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  const server = source('backend/src/server.js');
  const envExample = source('backend/.env.example');

  assert.match(router, /maintenance-progress-chat\.module\.js/);
  assert.match(wrapper, /queueMaintenanceProgressNotification/);
  assert.match(wrapper, /maintenancePlannedCountsChanged/);
  assert.match(service, /ChatWebhook/);
  assert.match(service, /redactWebhook\(webhook\)/);
  assert.match(service, /ClaveIdempotencia/);
  assert.match(service, /isMaintenanceProgressWeekday/);
  assert.match(service, /Estado.*PENDIENTE/s);
  assert.match(server, /startMaintenanceProgressScheduler\(\)/);
  assert.match(server, /stopMaintenanceProgressScheduler\(\)/);
  assert.match(envExample, /MAINTENANCE_PROGRESS_CHAT_HOURS=7,17/);
  assert.doesNotMatch(service, /Destino:\s*webhook\b/);
});


test('reserva cada recordatorio en PostgreSQL antes de llamar al webhook y evita carreras entre instancias', () => {
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  const migration = source('backend/migrations/015_maintenance_notification_idempotency.sql');

  assert.match(service, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(service, /findRows\(\s*'Notificaciones',[\s\S]*?ClaveIdempotencia: key/);
  assert.match(service, /Estado: 'ENVIANDO'/);
  assert.match(service, /ALREADY_RUNNING/);
  assert.match(service, /state === 'ENVIADO' \|\| state === 'ENVIANDO'/);
  assert.match(service, /Intentos: Number\(existing\?\.Intentos \|\| 0\) \+ 1/);
  assert.ok(
    service.indexOf('const reservation = await claimNotification') < service.indexOf('result = await sendChatMessage'),
    'La reserva persistente debe ocurrir antes del envío al Space.',
  );
  assert.doesNotMatch(
    service,
    /readTables\(\[[\s\S]*?'Notificaciones'[\s\S]*?\], \{ force: true \}\)/,
    'El scheduler no debe decidir idempotencia usando un snapshot viejo de Notificaciones.',
  );

  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /CASE WHEN UPPER\(COALESCE\("Estado", ''\)\) = 'ENVIADO'/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_notificaciones_clave_idempotencia/);
  assert.match(migration, /"ClaveIdempotencia"/);
});


test('el recordatorio programado tiene wake-up HTTP protegido para Render free', () => {
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  const route = source('backend/src/routes/maintenance-progress-worker.routes.js');
  const app = source('backend/src/app.js');
  const script = source('scripts/google-apps-script/maintenance-finalization-5pm-worker.gs');

  assert.match(service, /sendScheduledMaintenanceProgressForSlot/);
  assert.match(service, /reason: 'TOO_EARLY'/);
  assert.match(service, /currentMinutes < targetMinutes/);
  assert.match(service, /slotKey: `\$\{dateKey\}\|\$\{normalizedSlot\}`/);
  assert.match(route, /MAINTENANCE_FINALIZATION_WAKE_SECRET/);
  assert.match(route, /x-dms-worker-secret/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /sendScheduledMaintenanceProgressForSlot/);
  assert.match(app, /\/api\/maintenance-progress/);
  assert.match(script, /wakeDmsMaintenanceProgressAtSeven/);
  assert.match(script, /retryDmsMaintenanceProgressAtSeven/);
  assert.match(script, /retryDmsMaintenanceProgressAtFive/);
  assert.match(script, /\/api\/maintenance-progress\/wake/);
  assert.match(script, /atHour\(7\)/);
  assert.match(script, /atHour\(17\)/);
});


test('un trigger tardío no puede reenviar un slot ya reclamado y el Apps Script principal guarda el slot', () => {
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  const reportScript = source('apps-script/report-service/Code.gs');
  const standaloneScript = source('scripts/google-apps-script/maintenance-finalization-5pm-worker.gs');

  assert.match(
    service,
    /if \(scheduledProgressNotification\(existing\)\) return false/,
    'Un recordatorio 07:00\/17:00 ya reclamado nunca debe volver a llamar al webhook.',
  );
  assert.match(
    service,
    /if \(state === 'ENVIADO' \|\| state === 'ENVIANDO'\) return false/,
    'Las notificaciones inmediatas también deben bloquear ENVIADO\/ENVIANDO.',
  );
  assert.match(service, /SCHEDULED_ALREADY_ATTEMPTED/);

  [
    reportScript,
    standaloneScript,
  ].forEach((script) => {
    assert.match(script, /DMS_MAINTENANCE_PROGRESS_SLOT_/);
    assert.match(script, /SCRIPT_SLOT_ALREADY_COMPLETE/);
    assert.match(script, /SCRIPT_SLOT_ALREADY_RUNNING/);
    assert.match(script, /beginDmsMaintenanceProgressSlot_/);
    assert.match(script, /completeDmsMaintenanceProgressSlot_/);
    assert.match(script, /releaseDmsMaintenanceProgressSlot_/);
    assert.doesNotMatch(
      script.match(/function runDmsMaintenanceProgressSlot_[\s\S]*?\n\}/)?.[0] || '',
      /Number\(result && result\.failed \|\| 0\) > 0[\s\S]*?scheduleDmsProgressRetry_/,
      'Un ERROR devuelto después del intento del webhook no debe programar otro envío.',
    );
    assert.match(script, /atHour\(7\)/);
    assert.match(script, /atHour\(17\)/);
    assert.match(script, /\/api\/maintenance-progress\/wake/);
  });

  assert.match(reportScript, /dmsDiagnoseMaintenanceProgressTriggers/);
  assert.match(reportScript, /runDmsMaintenanceProgressSlot_\(\s*'17:00'/);
});
