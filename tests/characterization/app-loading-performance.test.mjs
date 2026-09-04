import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las rutas lazy reutilizan un manifiesto precargable', () => {
  const app = source('src/app/App.jsx');
  const loaders = source('src/app/routeLoaders.js');
  assert.match(app, /from '\.\/routeLoaders'/);
  assert.match(app, /lazy\(loadTicketListPage\)/);
  assert.match(app, /lazy\(loadMaintenanceListPage\)/);
  assert.match(loaders, /export function preloadRouteModule/);
  assert.match(loaders, /export function preloadRouteModules/);
  assert.match(loaders, /loaderForPath/);
  assert.match(loaders, /warmedLoads/);
});

test('la navegación precarga módulos, listas y flujos de creación en tiempo ocioso', () => {
  const shell = source('src/components/layout/AppShell.jsx');
  assert.match(shell, /preloadRouteModule/);
  assert.match(shell, /preloadRouteModules/);
  assert.match(shell, /preloadNavigationData/);
  assert.match(shell, /preloadNavigationDataBatch/);
  assert.match(shell, /onPointerEnter/);
  assert.match(shell, /onFocus/);
  assert.match(shell, /onTouchStart/);
  assert.match(shell, /requestIdleCallback/);
  assert.match(shell, /navigator\.connection\?\.saveData/);
  assert.match(shell, /likelyRoutes\.push\('\/clientes'\)/);
  assert.match(shell, /likelyRoutes\.push\('\/boletas\/nueva'\)/);
  assert.match(shell, /likelyRoutes\.push\('\/mantenimientos\/nuevo'\)/);
});

test('la precarga de datos reutiliza los mismos payloads de las vistas frecuentes', () => {
  const preload = source('src/services/navigationPreload.js');
  assert.match(preload, /MODULE_ROUTES\.tickets\.list/);
  assert.match(preload, /MODULE_ROUTES\.maintenance\.list/);
  assert.match(preload, /MODULE_ROUTES\.clients\.list/);
  assert.match(preload, /MODULE_ROUTES\.knowledge\.list/);
  assert.match(preload, /agenda\.list/);
  assert.match(preload, /calendarMonthRange\(monthKey\(\)\)/);
  assert.match(preload, /maintenanceListPayload/);
  assert.match(preload, /pageSize:\s*TICKET_PAGE_SIZE/);
  assert.match(preload, /pageSize:\s*KNOWLEDGE_PAGE_SIZE/);
  assert.match(preload, /export async function preloadNavigationDataBatch/);
  assert.match(preload, /IDLE_DATA_CONCURRENCY = 2/);
  assert.match(preload, /ticketListAdmin/);
  assert.match(preload, /navigator\.connection\?\.saveData/);
  assert.doesNotMatch(preload, /fetch\(/);
});

test('Inicio obtiene actividad y conteos con una sola lista por dominio', () => {
  const home = source('src/pages/HomePage.jsx');
  const ticketVisibility = source('backend/src/services/ticket-visibility.patch.js');
  const maintenanceProgress = source('backend/src/modules/maintenance-progress-chat.module.js');
  const statusCounts = source('backend/src/core/status-counts.js');

  assert.equal((home.match(/MODULE_ROUTES\.tickets\.list/g) || []).length, 1);
  assert.equal((home.match(/MODULE_ROUTES\.maintenance\.list/g) || []).length, 1);
  assert.equal((home.match(/includeStatusCounts:\s*true/g) || []).length, 2);
  assert.match(home, /responseStatusCount/);
  assert.match(ticketVisibility, /countStatuses\(rows\)/);
  assert.match(maintenanceProgress, /countStatuses\(activeRows\)/);
  assert.match(maintenanceProgress, /Promise\.all/);
  assert.match(statusCounts, /export function countStatuses/);
});

test('los formularios precargan catálogos compartidos sin habilitar el modo offline', () => {
  const preload = source('src/services/navigationPreload.js');
  assert.match(preload, /loadCatalogResource/);
  assert.match(preload, /function ticketFormPreload/);
  assert.match(preload, /function maintenanceFormPreload/);
  assert.match(preload, /FORM_CLIENT_PAGE_SIZE = 80/);
  assert.match(preload, /MODULE_ROUTES\.failureTypes\.list/);
  assert.match(preload, /MODULE_ROUTES\.deviceManufacturers\.list/);
  assert.match(preload, /MODULE_ROUTES\.models\.list/);
  assert.match(preload, /maintenance\.config/);
  assert.match(preload, /path === '\/boletas\/nueva'/);
  assert.match(preload, /path === '\/mantenimientos\/nuevo'/);
});

test('los catálogos completos pueden resolver filtros y páginas menores sin otra lectura', () => {
  const resource = source('src/services/catalogResource.js');
  assert.match(resource, /function isCompleteMasterEntry/);
  assert.match(resource, /function deriveFromCachedMaster/);
  assert.match(resource, /filterOfflineCatalog\(candidate\.value, payload\)/);
  assert.match(resource, /sessionToken/);
  assert.match(resource, /derived: true/);
  assert.match(resource, /catalogInflight/);
  assert.match(resource, /waitForSharedCatalog/);
});

test('mantenimiento no descarga todos los clientes antes de mostrar el formulario', () => {
  const resources = source('src/features/maintenance/useMaintenanceResources.js');
  assert.match(resources, /CLIENT_PAGE_SIZE = 80/);
  assert.match(resources, /function loadClientPage/);
  assert.match(resources, /q: normalizedQuery/);
  assert.doesNotMatch(resources, /totalPages/);
  assert.doesNotMatch(resources, /for \(let page = 2/);
  assert.doesNotMatch(resources, /force:\s*true/);
});

test('editores y filtros reutilizan la caché de catálogos compartida', () => {
  const deviceFields = source('src/components/maintenance/MaintenanceDeviceCatalogFields.jsx');
  const ticketList = source('src/pages/tickets/TicketListPage.jsx');
  assert.match(deviceFields, /loadCatalogResource/);
  assert.match(deviceFields, /loadCatalogs\(\{ force: true \}\)/);
  assert.match(ticketList, /loadCatalogResource/);
});

test('la caché persistente de rendimiento reutiliza IndexedDB y se invalida tras escrituras', () => {
  const cache = source('src/services/performanceReadCache.js');
  const api = source('src/api.js');
  assert.match(cache, /import\('\.\/offlineStoreCore'\)/);
  assert.match(cache, /PERFORMANCE_CACHE_MAX_AGE_MS = 2 \* 60_000/);
  assert.match(cache, /PERFORMANCE_CACHE_GRACE_MS = 280/);
  assert.match(cache, /cachedAt <= readLastWriteAt/);
  assert.match(api, /cachePerformanceResponse/);
  assert.match(api, /readPerformanceResponse/);
  assert.match(api, /waitForPerformanceGrace/);
  assert.match(api, /invalidatePerformanceResponses\(sessionToken\)/);
  assert.match(api, /pendingReads\.set\(key, sharedNetworkRequest\)/);
  assert.match(api, /dms-performance-cache-used/);
  assert.match(api, /dms-performance-cache-updated/);
});

test('la caché persistente solo admite listas operativas y excluye superficies sensibles', () => {
  const api = source('src/api.js');
  assert.match(api, /PERFORMANCE_CACHE_ROUTE_PATTERNS/);
  assert.match(api, /\^\(boletas\|tickets\).*list/);
  assert.match(api, /\^\(maintenance\|mantenimientos\).*list/);
  assert.match(api, /\^\(agenda\|agendas\).*list/);
  assert.doesNotMatch(api, /passwordVault/);
  assert.doesNotMatch(api, /credentials\.reveal/);
  assert.doesNotMatch(api, /auth\.me.*PERFORMANCE_CACHE_ROUTE_PATTERNS/);
  assert.doesNotMatch(api, /assistant\.chat.*PERFORMANCE_CACHE_ROUTE_PATTERNS/);
});

test('el backend calienta tablas operativas y metadatos de detalle después de autenticación', () => {
  const server = source('backend/src/server.js');
  assert.match(server, /STARTUP_CRITICAL_TABLES/);
  assert.match(server, /STARTUP_OPERATIONAL_TABLES/);
  for (const table of [
    'Configuracion',
    'Boletas',
    'BoletaAsignados',
    'EvidenciasBoleta',
    'Agendas',
    'AgendaAsignados',
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'Mantenimiento imagenes',
    'KnowledgeArticles',
    'KnowledgeCategories',
  ]) {
    assert.match(server, new RegExp(`'${table}'`), `Debe precargar ${table}.`);
  }
  assert.match(server, /await readTables\(STARTUP_CRITICAL_TABLES\)/);
  assert.match(server, /await readTables\(STARTUP_OPERATIONAL_TABLES\)/);
  assert.match(server, /}, 25\)\.unref/);
  assert.doesNotMatch(server, /}, 750\)\.unref/);
});

test('las optimizaciones no agregan endpoints ni cambian la matriz de permisos', () => {
  const preload = source('src/services/navigationPreload.js');
  const cache = source('src/services/performanceReadCache.js');
  const router = source('backend/src/core/action-router.js');
  assert.doesNotMatch(preload, /home\.summary|dashboard\.summary|performance\.summary/);
  assert.doesNotMatch(cache, /home\.summary|dashboard\.summary|performance\.summary/);
  assert.match(router, /PermissionRoute|permission|USUARIOS_GESTIONAR/i);
});
