import { asArray, nowIso, pick, sha256 } from '../core/utils.js';
import { calculateMinimumOneHourTotalHours } from '../core/ticket-hours.js';
import { readTables, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceTicketWorkTimePolicy');
const DEFAULT_TIME_ZONE = 'America/Costa_Rica';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

function dateOnly(value, fallback = '') {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

function technicianIdsFor(device = {}, maintenance = {}) {
  const direct = asArray(device.TecnicoIDsJSON || device.TecnicoIDs || device.tecnicoIds)
    .map((value) => clean(value))
    .filter(Boolean);
  if (direct.length) return [...new Set(direct)].sort();

  const maintenanceIds = asArray(maintenance.ResponsableIDsJSON || maintenance.ResponsableIDs)
    .map((value) => clean(value))
    .filter(Boolean);
  if (maintenanceIds.length) return [...new Set(maintenanceIds)].sort();

  const fallback = clean(device.CreadoPor || maintenance.CreadoPor);
  return fallback ? [fallback] : [];
}

function workDateFor(device = {}, maintenance = {}) {
  return dateOnly(
    device.FechaTrabajo || device.FechaRegistroTrabajo || device.FechaCreacion,
    dateOnly(maintenance.Fecha, dateOnly(maintenance.FechaCreacion)),
  );
}

function parseTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const text = clean(value);
  if (!text) return null;

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function timeFormatter() {
  const requested = clean(process.env.APP_TIME_ZONE, DEFAULT_TIME_ZONE);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: requested,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: DEFAULT_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}

const formatTime = timeFormatter();

function localTime(timestamp) {
  const parts = Object.fromEntries(formatTime.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.hour || '00'}:${parts.minute || '00'}`;
}

function ticketIdFor(maintenanceId, groupKey) {
  return `mnt-${sha256(maintenanceId).slice(0, 12)}-${sha256(groupKey).slice(0, 20)}`;
}

function groupWindow(devices = []) {
  const timestamps = devices
    .map((device) => parseTimestamp(device.FechaCreacion) ?? parseTimestamp(device.FechaActualizacion))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!timestamps.length) return null;

  const start = localTime(timestamps[0]);
  const end = localTime(timestamps[timestamps.length - 1]);
  return {
    HoraInicio: start,
    HoraFinal: end,
    HorasTotales: Math.max(1, calculateMinimumOneHourTotalHours(start, end)),
    firstDeviceCreatedAt: new Date(timestamps[0]).toISOString(),
    lastDeviceCreatedAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

function buildGroups(maintenance, devices) {
  const groups = new Map();
  for (const device of devices) {
    const date = workDateFor(device, maintenance);
    const technicianIds = technicianIdsFor(device, maintenance);
    if (!date || !technicianIds.length) continue;
    const key = `${date}|${technicianIds.join(',')}`;
    if (!groups.has(key)) groups.set(key, { key, date, technicianIds, devices: [] });
    groups.get(key).devices.push(device);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    ticketId: ticketIdFor(clean(maintenance.MantenimientoID), group.key),
    window: groupWindow(group.devices),
  }));
}

async function maintenanceGroups(maintenanceId = '') {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos']);
  const maintenances = (tables.Mantenimiento || []).filter(active);
  const selected = maintenanceId
    ? maintenances.filter((row) => clean(row.MantenimientoID) === clean(maintenanceId))
    : maintenances;
  const devices = (tables.Evidencia_Mantenimientos || []).filter(active);
  return selected.flatMap((maintenance) => buildGroups(
    maintenance,
    devices.filter((device) => clean(device.MantenimientoRef) === clean(maintenance.MantenimientoID)),
  ));
}

async function windowForTicket(ticketId) {
  if (!clean(ticketId).startsWith('mnt-')) return null;
  const groups = await maintenanceGroups();
  return groups.find((group) => group.ticketId === clean(ticketId))?.window || null;
}

async function contextWithWorkTimes(ctx) {
  const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
  const window = await windowForTicket(ticketId);
  if (!window) return ctx;
  return {
    ...ctx,
    payload: {
      ...ctx.payload,
      HoraInicio: window.HoraInicio,
      horaInicio: window.HoraInicio,
      HoraFinal: window.HoraFinal,
      horaFinal: window.HoraFinal,
      HorasTotales: window.HorasTotales,
      horasTotales: window.HorasTotales,
    },
  };
}

async function synchronizeExistingTickets(ctx) {
  const maintenanceId = clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
  if (!maintenanceId || ctx.payload?.testMode || ctx.payload?.prueba) return;

  const [groups, ticketTable] = await Promise.all([
    maintenanceGroups(maintenanceId),
    readTables(['Boletas']),
  ]);
  const tickets = ticketTable.Boletas || [];
  const actor = clean(ctx.user?.UsuarioID, 'SISTEMA');

  for (const group of groups) {
    if (!group.window) continue;
    const existing = tickets.find((ticket) => clean(ticket.BoletaUID) === group.ticketId);
    if (!existing) continue;
    const patch = {};
    if (clean(existing.HoraInicio) !== group.window.HoraInicio) patch.HoraInicio = group.window.HoraInicio;
    if (clean(existing.HoraFinal) !== group.window.HoraFinal) patch.HoraFinal = group.window.HoraFinal;
    if (Number(existing.HorasTotales || 0) !== Number(group.window.HorasTotales)) patch.HorasTotales = group.window.HorasTotales;
    if (!Object.keys(patch).length) continue;
    await updateRow('Boletas', group.ticketId, {
      ...patch,
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    });
  }
}

if (!ticketMultiHandlers[INSTALL_FLAG]) {
  const createTicket = ticketMultiHandlers.create;
  const updateTicket = ticketMultiHandlers.update;
  ticketMultiHandlers.create = async (ctx) => createTicket(await contextWithWorkTimes(ctx));
  ticketMultiHandlers.update = async (ctx) => updateTicket(await contextWithWorkTimes(ctx));
  ticketMultiHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceAutomationHandlers[INSTALL_FLAG]) {
  const finalizeMaintenance = maintenanceAutomationHandlers.finalize;
  maintenanceAutomationHandlers.finalize = async (ctx) => {
    await synchronizeExistingTickets(ctx);
    return finalizeMaintenance(ctx);
  };
  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}
