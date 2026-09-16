import { normalizeItems } from './moduleApi';

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeMaintenanceSyncStatus(value) {
  const text = clean(value).toUpperCase();
  if (['FINALIZADA', 'FINALIZADO'].includes(text)) return 'FINALIZADO';
  if (['PENDIENTES', 'PENDIENTE'].includes(text)) return 'PENDIENTE';
  return text;
}

export function maintenanceSyncId(row = {}) {
  return clean(row.MantenimientoID || row.maintenanceId || row.id || row.RowID);
}

function active(row = {}) {
  return row.Activo !== false && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

function dateKey(row = {}) {
  return String(row.Fecha || row.FechaCreacion || '').slice(0, 10);
}

function createdAt(row = {}) {
  const value = Date.parse(row.FechaCreacion || row.FechaActualizacion || '');
  return Number.isNaN(value) ? 0 : value;
}

function compareMaintenance(left, right) {
  return dateKey(right).localeCompare(dateKey(left))
    || createdAt(right) - createdAt(left)
    || maintenanceSyncId(right).localeCompare(maintenanceSyncId(left));
}

export function maintenanceMatchesSyncQuery(row = {}, request = {}) {
  if (!active(row)) return false;
  const requestedStatus = normalizeMaintenanceSyncStatus(request.status || request.estado);
  if (requestedStatus && normalizeMaintenanceSyncStatus(row.Estado) !== requestedStatus) return false;
  const activeFilter = request.activo;
  if (activeFilter !== undefined && String(row.Activo ?? true).toLowerCase() !== String(activeFilter).toLowerCase()) return false;

  const rowDate = dateKey(row);
  if (request.dateFrom && (!rowDate || rowDate < String(request.dateFrom))) return false;
  if (request.dateTo && (!rowDate || rowDate > String(request.dateTo))) return false;

  const expectedClient = clean(request.client || request.cliente);
  if (expectedClient && clean(row.Cliente || row.ClienteRef) !== expectedClient) return false;

  const query = clean(request.search || request.q).toLowerCase();
  if (query) {
    const searchable = [
      row.TituloMantenimiento,
      row.Cliente,
      row.ClienteRef,
      row.Ubicacion,
      row.Responsables,
      row.Responsable,
      row.DescripcionGeneral,
    ].join(' ').toLowerCase();
    if (!searchable.includes(query)) return false;
  }
  return true;
}

export function patchMaintenanceItemsForQuery(items = [], request = {}, delta = {}, limit = 0) {
  const removed = new Set((delta.removed || []).map(String));
  const next = (items || []).filter((item) => !removed.has(maintenanceSyncId(item)));
  const byId = new Map(next.map((item, index) => [maintenanceSyncId(item), index]));

  for (const incoming of delta.upserts || []) {
    const id = maintenanceSyncId(incoming);
    if (!id) continue;
    const index = byId.has(id) ? byId.get(id) : -1;
    if (!maintenanceMatchesSyncQuery(incoming, request)) {
      if (index >= 0) {
        next.splice(index, 1);
        byId.clear();
        next.forEach((item, currentIndex) => byId.set(maintenanceSyncId(item), currentIndex));
      }
      continue;
    }
    if (index >= 0) next[index] = { ...next[index], ...incoming };
    else next.push(incoming);
    byId.clear();
    next.forEach((item, currentIndex) => byId.set(maintenanceSyncId(item), currentIndex));
  }

  next.sort(compareMaintenance);
  return limit > 0 ? next.slice(0, limit) : next;
}

function authoritativeTotal(request = {}, delta = {}) {
  const status = normalizeMaintenanceSyncStatus(request.status || request.estado);
  if (request.search || request.q || request.dateFrom || request.dateTo || request.client || request.cliente) return null;
  if (status === 'PENDIENTE') return Number.isFinite(Number(delta.counts?.pending)) ? Number(delta.counts.pending) : null;
  if (status === 'FINALIZADO') return Number.isFinite(Number(delta.counts?.finished)) ? Number(delta.counts.finished) : null;
  return null;
}

function rebuild(original, items, total, request, delta, integrityPending) {
  if (Array.isArray(original)) return items;
  const shared = {
    ...original,
    total: Number.isFinite(Number(total)) ? Number(total) : items.length,
    syncIntegrityPending: Boolean(integrityPending),
  };
  if (delta.counts && original?.homeSummary) {
    shared.homeSummary = {
      pending: Number(delta.counts.pending || 0),
      finished: Number(delta.counts.finished || 0),
    };
  }
  if (Array.isArray(original?.items)) return { ...shared, items };
  if (Array.isArray(original?.rows)) return { ...shared, rows: items };
  if (Array.isArray(original?.data)) return { ...shared, data: items };
  return {
    ...shared,
    items,
    page: Number(request.page || 1),
    pageSize: Number(request.pageSize || items.length || 1),
  };
}

export function patchMaintenanceCollection(data, request = {}, delta = {}) {
  const beforeItems = normalizeItems(data);
  const beforeIds = new Set(beforeItems.map(maintenanceSyncId).filter(Boolean));
  const page = Math.max(1, Number(request.page || data?.page || 1));
  const pageSize = Math.max(1, Number(request.pageSize || data?.pageSize || beforeItems.length || 40));
  const workingLimit = Math.max(beforeItems.length, page === 1 ? pageSize : beforeItems.length);
  const items = patchMaintenanceItemsForQuery(beforeItems, request, delta, workingLimit);
  const serverTotal = authoritativeTotal(request, delta);
  let total = Number(data?.total);
  if (!Number.isFinite(total)) total = beforeItems.length;
  let integrityPending = false;

  if (serverTotal !== null) {
    total = serverTotal;
  } else {
    const afterIds = new Set(items.map(maintenanceSyncId).filter(Boolean));
    for (const id of beforeIds) if (!afterIds.has(id)) total = Math.max(0, total - 1);
    for (const incoming of delta.upserts || []) {
      const id = maintenanceSyncId(incoming);
      if (!id || beforeIds.has(id) || !maintenanceMatchesSyncQuery(incoming, request)) continue;
      if (total <= beforeItems.length && page === 1) total += 1;
      else integrityPending = true;
    }
  }

  return rebuild(data, items, total, request, delta, integrityPending);
}
