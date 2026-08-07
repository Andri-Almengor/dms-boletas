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
