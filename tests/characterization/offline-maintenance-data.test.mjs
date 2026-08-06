import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  maintenanceListPayload,
  matchesMaintenanceListFilters,
  normalizeMaintenanceStatus,
} from '../../src/features/maintenance/maintenanceListDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el payload de lista es idéntico para conexión y caché offline', () => {
  assert.deepEqual(maintenanceListPayload({
    page: 2,
    pageSize: 40,
    status: 'FINALIZADA',
    search: ' Asamblea ',
    filters: { client: 'Asamblea Legislativa', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  }), {
    page: 2,
    pageSize: 40,
    activo: true,
    status: 'FINALIZADO',
    estado: 'FINALIZADO',
    search: 'Asamblea',
    cliente: 'Asamblea Legislativa',
    client: 'Asamblea Legislativa',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    sortBy: 'Fecha',
    sortDir: 'desc',
  });
  assert.equal(normalizeMaintenanceStatus('finalizada'), 'FINALIZADO');
  assert.equal(normalizeMaintenanceStatus(''), 'PENDIENTE');
});

test('la búsqueda offline aplica estado, cliente, fecha y texto sobre los datos descargados', () => {
  const row = {
    MantenimientoID: 'M-1',
    Estado: 'PENDIENTE',
    Fecha: '2026-08-06',
    Cliente: 'Asamblea Legislativa',
    TituloMantenimiento: 'Revisión de cámaras',
    Responsable: 'Técnico Uno',
    Ubicacion: 'Edificio principal',
  };

  assert.equal(matchesMaintenanceListFilters(row, 'PENDIENTE', 'cámaras', {
    client: 'Asamblea Legislativa',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
  }), true);
  assert.equal(matchesMaintenanceListFilters(row, 'FINALIZADO', '', {}), false);
  assert.equal(matchesMaintenanceListFilters(row, 'PENDIENTE', '', { client: 'BCR' }), false);
  assert.equal(matchesMaintenanceListFilters(row, 'PENDIENTE', '', { dateFrom: '2026-08-07' }), false);
});

test('la base operativa descarga listas paginadas y detalles con concurrencia limitada', () => {
  const service = source('src/services/offlineMaintenanceData.js');

  assert.match(service, /MAX_PENDING_PAGES = 25/);
  assert.match(service, /MAX_FINALIZED_PAGES = 2/);
  assert.match(service, /PENDING_DETAIL_LIMIT = 80/);
  assert.match(service, /FINALIZED_DETAIL_LIMIT = 10/);
  assert.match(service, /DETAIL_WORKERS = 2/);
  assert.match(service, /requestAvailable\(MODULE_ROUTES\.maintenance\.list/);
  assert.match(service, /requestAvailable\(MODULE_ROUTES\.maintenance\.get, \{ maintenanceId \}/);
  assert.match(service, /setOfflineMeta\(metadataKey\(normalizedStatus\)/);
  assert.match(service, /readCachedResponse\(key\)/);
  assert.match(service, /dedupeRows\(rows\)/);
  assert.match(service, /OFFLINE_MAINTENANCE_NOT_DOWNLOADED/);
});

test('la lista usa la caché operativa y evita mostrar un vacío falso cuando falta la descarga', () => {
  const list = source('src/pages/maintenance/MaintenanceListPage.jsx');
  const offlinePage = source('src/pages/offline/OfflineContentPage.jsx');

  assert.match(list, /readOfflineMaintenancePage\(query\)/);
  assert.match(list, /if \(isNetworkError\(loadError\)\)/);
  assert.match(list, /error === OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE/);
  assert.match(list, /Mantenimientos no descargados/);
  assert.match(list, /Preparar contenido sin conexión/);
  assert.match(offlinePage, /preloadOfflineMaintenanceData\(sessionToken\)/);
  assert.match(offlinePage, /Descargando catálogos, mantenimientos y detalles/);
});
