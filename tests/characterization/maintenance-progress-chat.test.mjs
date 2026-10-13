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
  const delayedMorning = maintenanceProgressScheduleSlot(
    new Date('2026-08-07T13:27:00.000Z'),
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
  assert.equal(delayedMorning?.slot, '07:00');
  assert.equal(
    delayedMorning?.key,
    morning?.key,
    '07:00 y 07:27 pertenecen al mismo slot idempotente del día.',
  );
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

test('un inventario completo cuenta pendientes DESPUÉS solo en equipos con ANTES sin DESPUÉS', () => {
  const maintenance = { MantenimientoID: 'mnt-1', Cliente: 'Cliente XYZ', Estado: 'PENDIENTE', CantCámaras: 3, CantPuertas: 2 };
  const progress = buildMaintenanceProgress({
    maintenance,
    devices: [...devices('Cámara', 3), ...devices('Puertas', 2)],
    images: [
      // Varias fotos ANTES de un mismo equipo equivalen a un solo pendiente.
      { FotoDispositivoID: 'foto-1', DispositivoMantenimientoRef: 'Cámara-1', Tipo: 'Antes', Activo: true },
      { FotoDispositivoID: 'foto-2', DispositivoMantenimientoRef: 'Cámara-1', Tipo: 'ANTES', Activo: true },
      // La agregación real de PostgreSQL indica que este equipo tiene ambos tipos.
      { DispositivoMantenimientoRef: 'Cámara-2', TotalEvidencias: 3, EvidenciasAntes: 1, EvidenciasDespues: 2 },
      { DispositivoMantenimientoRef: 'Cámara-3', TotalEvidencias: 5, EvidenciasAntes: 5, Activo: false },
      { DispositivoMantenimientoRef: 'Puertas-1', TotalEvidencias: 1, EvidenciasAntes: 1, EvidenciasDespues: 0 },
      { DispositivoMantenimientoRef: 'otro-mantenimiento', TotalEvidencias: 100, EvidenciasAntes: 100 },
    ],
  });
  const cameras = progress.items.find((item) => item.label === 'Cámaras');
  assert.equal(cameras.withEvidence, 2);
  assert.equal(cameras.missingEvidence, 1);
  assert.equal(cameras.evidenceTotal, 5);
  assert.equal(cameras.pendingAfter, 1);
  assert.equal(cameras.completeEvidencePairs, 1);
  assert.equal(progress.withEvidence, 3);
  assert.equal(progress.missingEvidence, 2);
  assert.equal(progress.pendingAfter, 2);
  assert.equal(progress.completeEvidencePairs, 1);
  assert.equal(progress.evidenceTotal, 6);

  const message = formatMaintenanceProgressMessage({ maintenance, progress });
  assert.match(message, /Evidencias por tipo de dispositivo:/);
  assert.match(message, /Cámaras: 3 dispositivos · 1 con ANTES y DESPUÉS · 1 pendiente DESPUÉS · 1 sin fotos/);
  assert.match(message, /Puertas: 2 dispositivos · 0 con ANTES y DESPUÉS · 1 pendiente DESPUÉS · 1 sin fotos/);
  assert.match(message, /Total: 5 de 5 \(100%\)/);
  assert.match(message, /Con ANTES y DESPUÉS: 1/);
  assert.match(message, /Pendientes DESPUÉS \(tienen ANTES\): 2/);
  assert.match(message, /Sin fotos: 2/);
  assert.match(message, /Archivos cargados: 6/);
  assert.doesNotMatch(message, /Pendientes: /);
});

test('solo DESPUÉS y fotos sin clasificar no se confunden con pendientes DESPUÉS', () => {
  const maintenance = { MantenimientoID: 'mnt-1', TipoMantenimiento: 'MANTENIMIENTO', CantCámaras: 5 };
  const progress = buildMaintenanceProgress({
    maintenance,
    devices: devices('Cámara', 5),
    images: [
      { DispositivoMantenimientoRef: 'Cámara-1', TotalEvidencias: 3, EvidenciasAntes: 3, EvidenciasDespues: 0 },
      { DispositivoMantenimientoRef: 'Cámara-2', Tipo: 'ANTES' },
      { DispositivoMantenimientoRef: 'Cámara-2', Tipo: 'Después' },
      { DispositivoMantenimientoRef: 'Cámara-3', Tipo: 'AFTER' },
      { DispositivoMantenimientoRef: 'Cámara-5', Tipo: 'OTRA' },
    ],
  });
  assert.equal(progress.pendingAfter, 1);
  assert.equal(progress.completeEvidencePairs, 1);
  assert.equal(progress.onlyAfter, 1);
  assert.equal(progress.unclassifiedOnly, 1);
  assert.equal(progress.missingEvidence, 1);
  const message = formatMaintenanceProgressMessage({ maintenance, progress });
  assert.match(message, /Pendientes DESPUÉS \(tienen ANTES\): 1/);
  assert.match(message, /Solo DESPUÉS \(sin ANTES\): 1/);
  assert.match(message, /Sin fotos: 1/);
  assert.match(message, /Solo evidencias sin clasificar: 1/);
});

test('si se elimina la única foto DESPUÉS, el equipo vuelve a estar pendiente', () => {
  const maintenance = { MantenimientoID: 'mnt-1', CantPuertas: 1 };
  const before = devices('Puertas', 1);
  const complete = buildMaintenanceProgress({
    maintenance, devices: before,
    images: [{ DispositivoMantenimientoRef: 'Puertas-1', TotalEvidencias: 2, EvidenciasAntes: 1, EvidenciasDespues: 1 }],
  });
  const afterDelete = buildMaintenanceProgress({
    maintenance, devices: before,
    images: [{ DispositivoMantenimientoRef: 'Puertas-1', TotalEvidencias: 1, EvidenciasAntes: 1, EvidenciasDespues: 0 }],
  });
  assert.equal(complete.pendingAfter, 0);
  assert.equal(complete.completeEvidencePairs, 1);
  assert.equal(afterDelete.pendingAfter, 1);
  assert.equal(afterDelete.completeEvidencePairs, 0);
});

test('los proyectos mantienen el reporte histórico de evidencias sin exigir ANTES/DESPUÉS', () => {
  const maintenance = { MantenimientoID: 'mnt-1', TipoMantenimiento: 'PROYECTO', CantPuertas: 2 };
  const progress = buildMaintenanceProgress({
    maintenance,
    devices: devices('Puertas', 2),
    images: [{ DispositivoMantenimientoRef: 'Puertas-1', Tipo: 'Proyecto' }],
  });
  const message = formatMaintenanceProgressMessage({ maintenance, progress });
  assert.match(message, /Puertas: 2 dispositivos · 1 con evidencia · 1 sin evidencia · 1 archivo/);
  assert.match(message, /Con evidencias: 1/);
  assert.match(message, /Sin evidencias: 1/);
  assert.doesNotMatch(message, /Pendientes DESPUÉS/);
});

test('mantiene el mensaje anterior mientras falten dispositivos, aun cuando ya existan fotografías', () => {
  const maintenance = { MantenimientoID: 'mnt-1', Estado: 'PENDIENTE', CantCámaras: 4, CantPuertas: 2 };
  const progress = buildMaintenanceProgress({
    maintenance,
    devices: [...devices('Cámara', 3), ...devices('Puertas', 2)],
    images: [{ DispositivoMantenimientoRef: 'Cámara-1', TotalEvidencias: 2 }],
  });
  const message = formatMaintenanceProgressMessage({ maintenance, progress });
  assert.match(message, /Avance por tipo:/);
  assert.match(message, /Cámaras: 3 de 4/);
  assert.match(message, /Puertas: 2 de 2/);
  assert.match(message, /Total: 5 de 6/);
  assert.match(message, /Pendientes: 1/);
  assert.doesNotMatch(message, /Sin evidencias: /);
});

test('no declara inventario completo si falta un tipo aunque otro supere su cuota', () => {
  const maintenance = { MantenimientoID: 'mnt-1', CantCámaras: 3, CantPuertas: 2 };
  const progress = buildMaintenanceProgress({
    maintenance,
    devices: [...devices('Cámara', 4), ...devices('Puertas', 1)],
    images: [],
  });
  assert.equal(progress.registered, progress.expected);
  assert.equal(progress.items.find((item) => item.label === 'Puertas').remaining, 1);
  const message = formatMaintenanceProgressMessage({ maintenance, progress });
  assert.match(message, /Avance por tipo:/);
  assert.match(message, /Puertas: 1 de 2/);
  assert.doesNotMatch(message, /Evidencias por tipo de dispositivo:/);
});

test('el resumen SQL contabiliza fotografías activas ANTES/DESPUÉS sin consulta por equipo', () => {
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  assert.match(service, /COUNT\(\*\) FILTER \(WHERE image\."Tipo" ILIKE '%antes%'/);
  assert.match(service, /COUNT\(\*\) FILTER \(WHERE image\."Tipo" ILIKE '%desp%'/);
  assert.match(service, /AS "EvidenciasAntes"/);
  assert.match(service, /AS "EvidenciasDespues"/);
  assert.match(service, /GROUP BY image\."DispositivoMantenimientoRef"/);
  assert.match(service, /image\."__valid" = TRUE/);
  assert.match(service, /device\."MantenimientoRef" = ANY\(\$1::text\[\]\)/);
  assert.match(service, /UPPER\(COALESCE\(image\."Activo"/);
  assert.match(service, /pendingAfter: progress\.pendingAfter/);
});

test('el Chat usa el estado vigente y deja fuera cierres completos y evidencias borradas', () => {
  const service = source('backend/src/services/maintenance-progress-chat.service.js');
  assert.match(service, /normalized\(row\.EstadoFinalizacion\) !== 'COMPLETADO'/);
  assert.match(service, /const currentRows = await findRows\(\s*'Mantenimiento'/);
  assert.match(service, /const currentMaintenance = currentRows\[0\]/);
  assert.match(service, /if \(!currentMaintenance \|\| !pendingMaintenance\(currentMaintenance\)\)/);
  assert.ok(service.indexOf('const currentRows = await findRows') < service.indexOf('const reservation = await claimNotification'));
  assert.match(service, /maintenance: currentMaintenance/);
  assert.match(service, /loadEvidenceSummary\(pending\.map/);
  assert.match(service, /GROUP BY image\."DispositivoMantenimientoRef"/);
  assert.match(service, /image\."__valid" = TRUE/);
  assert.match(service, /UPPER\(COALESCE\(image\."Activo"/);
  assert.match(service, /images: local\.images/);
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

  assert.match(reportScript, /2026-10-09-V7\.15-VIDEO-DRIVE-LINK/);
  assert.match(reportScript, /dmsDiagnoseMaintenanceProgressTriggers/);
  assert.match(reportScript, /runDmsMaintenanceProgressSlot_\(\s*'17:00'/);
});
