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

test('la navegación precarga módulos y datos por intención y en tiempo ocioso', () => {
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

test('el backend calienta tablas operativas después de autenticación en un arranque frío', () => {
  const server = source('backend/src/server.js');
  assert.match(server, /STARTUP_CRITICAL_TABLES/);
  assert.match(server, /STARTUP_OPERATIONAL_TABLES/);
  for (const table of [
    'Configuracion',
    'Boletas',
    'BoletaAsignados',
    'Agendas',
    'AgendaAsignados',
    'Mantenimiento',
    'Evidencia_Mantenimientos',
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
