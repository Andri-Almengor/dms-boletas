import { badRequest } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from './maintenance-automation.module.js';

const FIXED_COUNT_FIELDS = new Map([
  ['camara', 'CantCámaras'],
  ['camaras', 'CantCámaras'],
  ['puerta', 'CantPuertas'],
  ['puertas', 'CantPuertas'],
  ['control de acceso', 'CantPuertas'],
  ['control acceso', 'CantPuertas'],
  ['controles de acceso', 'CantPuertas'],
  ['control de accesos', 'CantPuertas'],
  ['servidor', 'CantServidores'],
  ['servidores', 'CantServidores'],
  ['grabador', 'CantGrabadores'],
  ['grabadores', 'CantGrabadores'],
  ['nvr', 'CantGrabadores'],
  ['dvr', 'CantGrabadores'],
  ['bocina', 'CantBocinas'],
  ['bocinas', 'CantBocinas'],
  ['altavoz', 'CantBocinas'],
  ['altavoces', 'CantBocinas'],
  ['sensor perimetral', 'CantSensoresPerimetrales'],
  ['sensores perimetrales', 'CantSensoresPerimetrales'],
  ['sensor movimiento', 'CantSensoresMovimiento'],
  ['sensor de movimiento', 'CantSensoresMovimiento'],
  ['sensores de movimiento', 'CantSensoresMovimiento'],
  ['sensor ruptura', 'CantSensorRuptura'],
  ['sensor de ruptura', 'CantSensorRuptura'],
  ['sensores de ruptura', 'CantSensorRuptura'],
  ['impresora', 'CantImpresora'],
  ['impresoras', 'CantImpresora'],
  ['gabinete', 'CantGabinetes'],
  ['gabinetes', 'CantGabinetes'],
  ['videowall', 'CantVideoWall'],
  ['video wall', 'CantVideoWall'],
]);

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCounts(maintenance = {}) {
  let counts = {};
  try {
    counts = typeof maintenance.CantidadesJSON === 'string'
      ? JSON.parse(maintenance.CantidadesJSON || '{}')
      : maintenance.CantidadesJSON || {};
  } catch {
    counts = {};
  }

  for (const field of new Set(FIXED_COUNT_FIELDS.values())) {
    if (maintenance[field] !== undefined && maintenance[field] !== '') {
      counts[field] = Number(maintenance[field] || 0);
    }
  }
  return counts;
}

function sameTarget(before = {}, target = {}) {
  const beforeTypeId = clean(pick(before, ['TipoDispositivoID', 'tipoDispositivoId']));
  const beforeCategory = normalized(pick(before, ['TipoDispositivo', 'Categoria', 'categoria']));
  return beforeTypeId === target.typeId && beforeCategory === normalized(target.category);
}

async function resolveTarget(payload = {}, before = null) {
  const typeId = clean(pick(payload, ['TipoDispositivoID', 'tipoDispositivoId'], before?.TipoDispositivoID));
  let category = clean(pick(payload, ['TipoDispositivo', 'Categoria', 'categoria'], before?.TipoDispositivo || before?.Categoria));
  let typeRow = null;

  if (typeId || category) {
    const types = await readTable('TiposDispositivo');
    typeRow = typeId
      ? types.find((row) => clean(row.TipoDispositivoID) === typeId)
      : types.find((row) => normalized(row.Nombre) === normalized(category));
    if (!category && typeRow) category = clean(typeRow.Nombre);
  }

  return {
    typeId: typeId || clean(typeRow?.TipoDispositivoID),
    category: category || clean(typeRow?.Nombre),
    typeRow,
  };
}

function expectedQuantity(maintenance, target) {
  const counts = parseCounts(maintenance);
  const fixedField = FIXED_COUNT_FIELDS.get(normalized(target.category || target.typeRow?.Nombre));
  if (fixedField) return Number(counts[fixedField] || 0);
  if (target.typeId) return Number(counts[`TipoDispositivo:${target.typeId}`] || 0);
  if (target.category) return Number(counts[`TipoDispositivoNombre:${normalized(target.category)}`] || 0);
  return 0;
}

async function validateSelectedType(ctx, before = null) {
  const maintenanceId = clean(pick(
    ctx.payload,
    ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'],
    before?.MantenimientoRef,
  ));
  if (!maintenanceId) throw badRequest('No se indicó el mantenimiento del dispositivo.');

  const maintenance = await findById('Mantenimiento', maintenanceId);
  const target = await resolveTarget(ctx.payload, before);
  if (!target.category && !target.typeId) throw badRequest('Seleccione un tipo de dispositivo.');
  if (before && sameTarget(before, target)) return;

  if (expectedQuantity(maintenance, target) <= 0) {
    const label = target.category || target.typeRow?.Nombre || 'este tipo de dispositivo';
    throw badRequest(`No se pueden agregar dispositivos de tipo “${label}” porque su cantidad esperada es 0. Edite el mantenimiento y asigne una cantidad mayor que cero primero.`);
  }
}

async function deviceCreate(ctx) {
  const requestedId = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  if (requestedId) {
    const existing = (await readTable('Evidencia_Mantenimientos', { force: true }))
      .find((row) => clean(row.EvidenciaMantenimientoID) === requestedId);
    if (existing) return maintenanceAutomationHandlers.deviceCreate(ctx);
  }
  await validateSelectedType(ctx);
  return maintenanceAutomationHandlers.deviceCreate(ctx);
}

async function deviceUpdate(ctx) {
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  await validateSelectedType(ctx, before);
  return maintenanceAutomationHandlers.deviceUpdate(ctx);
}

async function deviceAutosave(ctx) {
  const id = clean(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  await validateSelectedType(ctx, before);
  return maintenanceAutomationHandlers.deviceAutosave(ctx);
}

export const maintenanceDeviceCountPolicyHandlers = {
  ...maintenanceAutomationHandlers,
  deviceCreate,
  deviceUpdate,
  deviceAutosave,
};
