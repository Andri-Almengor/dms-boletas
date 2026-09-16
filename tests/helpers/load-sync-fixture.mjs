import { readFile } from 'node:fs/promises';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const root = new URL('../../src/services/', import.meta.url);
const moduleFrom = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let seq = 0;
export async function loadSyncFixture() {
  globalThis.window = { indexedDB, dispatchEvent() {}, addEventListener() {}, setInterval() {} };
  globalThis.IDBKeyRange = IDBKeyRange;
  const coreSource = (await readFile(new URL('offlineStoreCore.js', root), 'utf8'))
    .replace("'./offlineCatalogDomain'", JSON.stringify(new URL('offlineCatalogDomain.js', root).href));
  const core = await moduleFrom(coreSource);
  await core.getOfflineMeta("initialize");
  const db = await new Promise((resolve) => { const req = indexedDB.open('dms-boletas-offline'); req.onsuccess = () => resolve(req.result); });
  await new Promise((resolve) => {
    const tx = db.transaction(['responses', 'meta'], 'readwrite');
    tx.objectStore('responses').clear(); tx.objectStore('meta').clear(); tx.oncomplete = resolve;
  });
  db.close();
  return core;
}

export async function loadSyncManager(core, apiRequest) {
  const fixture = `__sync_fixture_${++seq}`;
  globalThis[fixture] = { core, apiRequest };
  let source = await readFile(new URL('syncManager.js', root), 'utf8');
  source = source.replace(/^import .*;\n/gm, '')
    .replace('import.meta.env.VITE_INCREMENTAL_SYNC_INTERVAL_MS', 'undefined')
    .replace("import('./offlineStoreCore')", `Promise.resolve(globalThis.${fixture}.core)`);
  return moduleFrom(`
    const apiRequest = (...args) => globalThis.${fixture}.apiRequest(...args);
    const requestAvailable = (routes, payload, token, options) => apiRequest(routes[0], payload, token, options);
    const requestFirstAvailable = (routes, fn) => fn(routes[0]);
    const normalizeItems = (data) => Array.isArray(data) ? data : data?.items || data?.rows || data?.data || [];
    const crudSyncListRoutes = () => [];
    const patchCrudCollection = (resource, data) => data;
    const patchMaintenanceCollection = (data) => data;
    const isMediaUploadActive = () => true;
    ${source}
  `);
}
