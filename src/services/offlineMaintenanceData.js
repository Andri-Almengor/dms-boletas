import {
  MAINTENANCE_LIST_PAGE_SIZE,
  maintenanceListPayload,
  maintenanceRecordId,
  matchesMaintenanceListFilters,
  normalizeMaintenanceStatus,
} from '../features/maintenance/maintenanceListDomain';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from './moduleApi';
import {
  getOfflineMeta,
  readCachedResponse,
  responseCacheKey,
  setOfflineMeta,
} from './offlineStore';

const MAX_PENDING_PAGES = 25;
const MAX_FINALIZED_PAGES = 2;
const PENDING_DETAIL_LIMIT = 200;
const FINALIZED_DETAIL_LIMIT = 20;
const DETAIL_WORKERS = 2;
const META_PREFIX = 'offline-maintenance-list-v1';

export const OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE = 'No hay mantenimientos descargados en este dispositivo. Conéctese, abra Más → Contenido descargado y pulse “Actualizar contenido”.';

function maxPagesForStatus(status) {
  return normalizeMaintenanceStatus(status) === 'FINALIZADO'
    ? MAX_FINALIZED_PAGES
    : MAX_PENDING_PAGES;
}

function detailLimitForStatus(status) {
  return normalizeMaintenanceStatus(status) === 'FINALIZADO'
    ? FINALIZED_DETAIL_LIMIT
    : PENDING_DETAIL_LIMIT;
}

function metadataKey(status) {
  return `${META_PREFIX}:${normalizeMaintenanceStatus(status)}`;
}

function responseHasMore(response, loadedCount, incomingCount, pageSize) {
  if (typeof response?.hasMore === 'boolean') return response.hasMore;
  if (typeof response?.pagination?.hasMore === 'boolean') return response.pagination.hasMore;
  const serverTotal = Number(response?.total ?? response?.pagination?.total);
  if (Number.isFinite(serverTotal) && serverTotal >= 0) return loadedCount < serverTotal;
  return incomingCount >= pageSize;
}

function dedupeRows(rows = []) {
  const map = new Map();
  rows.forEach((row, index) => {
    const id = maintenanceRecordId(row, `maintenance-${index}`);
    if (!map.has(id)) map.set(id, row);
    else map.set(id, { ...map.get(id), ...row });
  });
  return [...map.values()];
}

async function preloadList(status, sessionToken) {
  const normalizedStatus = normalizeMaintenanceStatus(status);
  const maxPages = maxPagesForStatus(normalizedStatus);
  const rows = [];
  let downloadedPages = 0;
  let serverTotal = 0;
  let complete = true;

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = maintenanceListPayload({
      page,
      pageSize: MAINTENANCE_LIST_PAGE_SIZE,
      status: normalizedStatus,
    });
    const response = await requestAvailable(MODULE_ROUTES.maintenance.list, payload, sessionToken);
    const incoming = normalizeItems(response);
    rows.push(...incoming);
    downloadedPages = page;

    const uniqueCount = dedupeRows(rows).length;
    const reportedTotal = Number(response?.total ?? response?.pagination?.total);
    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) serverTotal = reportedTotal;
    const hasMore = responseHasMore(response, uniqueCount, incoming.length, MAINTENANCE_LIST_PAGE_SIZE);
    if (!hasMore) break;
    if (page === maxPages) complete = false;
  }

  const records = dedupeRows(rows);
  await setOfflineMeta(metadataKey(normalizedStatus), {
    status: normalizedStatus,
    pages: downloadedPages,
    downloadedTotal: records.length,
    serverTotal: serverTotal || records.length,
    complete,
    downloadedAt: Date.now(),
  });
  return records;
}

async function preloadDetails(records, sessionToken, limit) {
  const selected = dedupeRows(records)
    .filter((row) => maintenanceRecordId(row))
    .slice(0, limit);
  if (!selected.length) return { requested: 0, completed: 0, failed: 0 };

  let cursor = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const maintenanceId = maintenanceRecordId(selected[index]);
      try {
        await requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken);
        completed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_WORKERS, selected.length) },
    () => worker(),
  ));
  return { requested: selected.length, completed, failed };
}

async function preloadStatus(status, sessionToken) {
  const normalizedStatus = normalizeMaintenanceStatus(status);
  const records = await preloadList(normalizedStatus, sessionToken);
  const details = await preloadDetails(
    records,
    sessionToken,
    detailLimitForStatus(normalizedStatus),
  );
  return {
    status: normalizedStatus,
    records: records.length,
    detailRequested: details.requested,
    detailCompleted: details.completed,
    detailFailures: details.failed,
  };
}

export async function preloadOfflineMaintenanceData(sessionToken = '') {
  if (!sessionToken || (typeof navigator !== 'undefined' && navigator.onLine === false)) return [];
  const results = [];
  for (const status of ['PENDIENTE', 'FINALIZADO']) {
    try {
      results.push({ status: 'fulfilled', value: await preloadStatus(status, sessionToken) });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }
  return results;
}

async function readDownloadedRows(status, sessionToken) {
  const normalizedStatus = normalizeMaintenanceStatus(status);
  const metadata = await getOfflineMeta(metadataKey(normalizedStatus));
  const storedPages = Number(metadata?.value?.pages || 0);
  const pagesToProbe = storedPages || maxPagesForStatus(normalizedStatus);
  const rows = [];
  let foundCache = false;

  for (let page = 1; page <= pagesToProbe; page += 1) {
    const payload = maintenanceListPayload({
      page,
      pageSize: MAINTENANCE_LIST_PAGE_SIZE,
      status: normalizedStatus,
    });
    const key = responseCacheKey(MODULE_ROUTES.maintenance.list, payload, sessionToken);
    const response = await readCachedResponse(key);
    if (response === null) {
      if (!storedPages || page === 1) break;
      continue;
    }
    foundCache = true;
    rows.push(...normalizeItems(response));
  }

  if (!foundCache) {
    const error = new Error(OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE);
    error.code = 'OFFLINE_MAINTENANCE_NOT_DOWNLOADED';
    throw error;
  }

  return {
    rows: dedupeRows(rows),
    metadata: metadata?.value || null,
  };
}

export async function readOfflineMaintenancePage({
  page = 1,
  pageSize = MAINTENANCE_LIST_PAGE_SIZE,
  status = 'PENDIENTE',
  search = '',
  filters = {},
  sessionToken = '',
} = {}) {
  const downloaded = await readDownloadedRows(status, sessionToken);
  const filtered = downloaded.rows.filter((row) => (
    matchesMaintenanceListFilters(row, status, search, filters)
  ));
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.max(1, Number(pageSize) || MAINTENANCE_LIST_PAGE_SIZE);
  const start = (normalizedPage - 1) * normalizedPageSize;
  const items = filtered.slice(start, start + normalizedPageSize);

  return {
    items,
    total: filtered.length,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    hasMore: start + items.length < filtered.length,
    offline: true,
    downloadedAt: downloaded.metadata?.downloadedAt || 0,
    complete: downloaded.metadata?.complete !== false,
  };
}
