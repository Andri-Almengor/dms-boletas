function pickValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['FINALIZADO', 'FINALIZADA'].includes(normalized)) return 'FINALIZADO';
  if (['PENDIENTE', 'PENDIENTES'].includes(normalized)) return 'PENDIENTE';
  return normalized || 'PENDIENTE';
}

function maintenanceDateKey(value) {
  if (!value) return '';
  const text = String(value);
  const isoMatch = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function matchesActiveFilter(row, payload) {
  if (row?.Activo === false) return false;
  if (payload?.activo === undefined) return true;
  return String(row?.Activo).toLowerCase() === String(payload.activo).toLowerCase();
}

function matchesMaintenanceFilters(row, payload) {
  if (!matchesActiveFilter(row, payload)) return false;

  const requestedStatus = String(payload?.estado || payload?.status || '').trim();
  if (requestedStatus && normalizeStatus(row?.Estado) !== normalizeStatus(requestedStatus)) return false;

  if (payload?.clienteId) {
    const rowClientId = String(row?.ClienteID || row?.ClienteRef || '');
    if (rowClientId !== String(payload.clienteId)) return false;
  }

  const requestedClient = String(payload?.cliente || payload?.client || '').trim();
  if (requestedClient) {
    const rowClient = String(pickValue(row, ['Cliente', 'ClienteRef'], '')).trim();
    if (rowClient !== requestedClient) return false;
  }

  const rowDate = maintenanceDateKey(row?.Fecha);
  const dateFrom = String(payload?.dateFrom || '').trim();
  const dateTo = String(payload?.dateTo || '').trim();
  if (dateFrom && (!rowDate || rowDate < dateFrom)) return false;
  if (dateTo && (!rowDate || rowDate > dateTo)) return false;

  const search = String(payload?.search || payload?.q || '').trim().toLowerCase();
  if (!search) return true;

  return [
    pickValue(row, ['TituloMantenimiento']),
    pickValue(row, ['Cliente', 'ClienteRef']),
    pickValue(row, ['Responsables', 'Responsable']),
    pickValue(row, ['DescripcionGeneral']),
    pickValue(row, ['Ubicacion']),
  ].join(' ').toLowerCase().includes(search);
}

function stripInternalRowNumber(row) {
  const { __rowNumber, ...clean } = row || {};
  return clean;
}

export function selectMaintenancePage(rows = [], payload = {}) {
  const filtered = [];
  for (const row of rows || []) {
    if (matchesMaintenanceFilters(row, payload)) filtered.push(row);
  }

  const sortBy = String(payload.sortBy || '').trim();
  if (sortBy) {
    const direction = String(payload.sortDir || '').toLowerCase() === 'desc' ? -1 : 1;
    filtered.sort((left, right) => (
      String(left?.[sortBy] || '').localeCompare(String(right?.[sortBy] || ''), 'es') * direction
    ));
  }

  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map(stripInternalRowNumber);

  return { items, total, page, pageSize };
}

export function addVisibleMaintenanceDeviceCounts(pageItems = [], devices = []) {
  const visibleMaintenanceIds = new Set(
    (pageItems || [])
      .map((row) => String(row?.MantenimientoID ?? ''))
      .filter(Boolean),
  );
  const deviceCounts = new Map();

  if (visibleMaintenanceIds.size) {
    for (const device of devices || []) {
      if (device?.Activo === false) continue;
      const maintenanceId = String(device?.MantenimientoRef ?? '');
      if (!visibleMaintenanceIds.has(maintenanceId)) continue;
      deviceCounts.set(maintenanceId, (deviceCounts.get(maintenanceId) || 0) + 1);
    }
  }

  return (pageItems || []).map((row) => ({
    ...row,
    DispositivosRegistrados: deviceCounts.get(String(row?.MantenimientoID ?? '')) || 0,
  }));
}
