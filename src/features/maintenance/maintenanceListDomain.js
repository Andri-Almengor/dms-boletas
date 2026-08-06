export const MAINTENANCE_LIST_PAGE_SIZE = 40;

function pickValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function normalizeMaintenanceStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['FINALIZADO', 'FINALIZADA'].includes(normalized)) return 'FINALIZADO';
  if (['PENDIENTE', 'PENDIENTES'].includes(normalized)) return 'PENDIENTE';
  return normalized || 'PENDIENTE';
}

export function maintenanceRecordId(row = {}, fallback = '') {
  return String(pickValue(row, ['MantenimientoID', 'id', 'RowID'], fallback));
}

export function maintenanceDateKey(value) {
  if (!value) return '';
  const text = String(value);
  const isoMatch = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function maintenanceListPayload({
  page = 1,
  pageSize = MAINTENANCE_LIST_PAGE_SIZE,
  status = 'PENDIENTE',
  search = '',
  filters = {},
} = {}) {
  const normalizedStatus = normalizeMaintenanceStatus(status);
  const client = String(filters.client || '').trim();
  return {
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.max(1, Number(pageSize) || MAINTENANCE_LIST_PAGE_SIZE),
    activo: true,
    status: normalizedStatus,
    estado: normalizedStatus,
    search: String(search || '').trim(),
    cliente: client,
    client,
    dateFrom: String(filters.dateFrom || '').trim(),
    dateTo: String(filters.dateTo || '').trim(),
    sortBy: 'Fecha',
    sortDir: 'desc',
  };
}

export function matchesMaintenanceListFilters(row = {}, status = 'PENDIENTE', query = '', filters = {}) {
  const rowStatus = normalizeMaintenanceStatus(pickValue(row, ['Estado'], 'PENDIENTE'));
  if (rowStatus !== normalizeMaintenanceStatus(status)) return false;

  const rowClient = String(pickValue(row, ['Cliente', 'ClienteRef'], '')).trim();
  if (filters.client && rowClient !== String(filters.client).trim()) return false;

  const rowDate = maintenanceDateKey(pickValue(row, ['Fecha']));
  if (filters.dateFrom && (!rowDate || rowDate < filters.dateFrom)) return false;
  if (filters.dateTo && (!rowDate || rowDate > filters.dateTo)) return false;

  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    pickValue(row, ['TituloMantenimiento']),
    rowClient,
    pickValue(row, ['Responsables', 'Responsable']),
    pickValue(row, ['DescripcionGeneral']),
    pickValue(row, ['Ubicacion']),
  ].join(' ').toLowerCase().includes(normalizedQuery);
}
