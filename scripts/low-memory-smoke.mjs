// Real Express/action/auth/repository code; only Google APIs use synthetic data.
// No production credentials, network, Drive, SMTP or Apps Script writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

Object.assign(process.env, {
  GOOGLE_SHEET_ID: 'synthetic-only',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'fixture@example.invalid',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'fixture-not-a-key',
  SHEETS_WRITE_MIN_INTERVAL_MS: '0',
  SHEETS_BATCH_WINDOW_MS: '1',
  MAINTENANCE_PROGRESS_CHAT_ENABLED: 'false',
});
const initial = process.memoryUsage();
const peaks = { ...initial };
function sample(m = process.memoryUsage()) { for (const k of Object.keys(peaks)) peaks[k] = Math.max(peaks[k], m[k]); }
const timer = setInterval(sample, 5);
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const { sheetsApi } = await import('../backend/src/infra/google.js');
const { TABLES } = await import('../backend/src/config/tables.js');
const { hashPassword } = await import('../backend/src/core/utils.js');
const password = hashPassword('fixture-password');
const datasets = new Map(Object.entries(TABLES).map(([name, def]) => [name, { headers: [def.id], rows: [] }]));
const calls = [];
function seed(name, records, headers = Object.keys(records[0] || {})) {
  datasets.set(name, { headers, rows: records.map(record => headers.map(h => record[h] ?? '')) });
}
const permissions = ['USUARIOS_GESTIONAR','USUARIOS_VER','BOLETAS_VER','BOLETAS_CREAR','BOLETAS_EDITAR','MANTENIMIENTOS_VER','MANTENIMIENTOS_GESTIONAR','CLIENTES_VER'];
seed('Roles', [{ RolID: 'admin', EsAdministrador: true }]);
seed('Permisos', permissions.map((Codigo, i) => ({ PermisoID: String(i), Codigo, Estado: 'ACTIVO' })));
seed('Usuarios', [{ UsuarioID: 'u1', RolID: 'admin', NombreUsuario: 'fixture', NombreCompleto: 'Synthetic user', Correo: 'fixture@example.invalid', Estado: 'ACTIVO', PasswordSalt: password.salt, PasswordHash: password.hash, IntentosFallidos: 0, BloqueadoHasta: '', UltimoAcceso: '', ActualizadoPor: '', FechaActualizacion: '' }]);
seed('Sesiones', [], ['SesionID','UsuarioID','TokenHash','FechaInicio','FechaExpiracion','Revocada','IP','UserAgent','FechaRevocacion']);
seed('Auditoria', [], ['AuditoriaID','UsuarioID','UsuarioNombre','Accion','Entidad','EntidadID','DatosAntesJSON','DatosDespuesJSON','IP','UserAgent','Fecha']);
const rowCount = Number(process.env.SYNTHETIC_ROWS || 10000);
seed('Boletas', Array.from({ length: rowCount }, (_, i) => ({ BoletaUID: `b${i}`, BoletaID: String(i), ClienteID: 'c1', Estado: i % 2 ? 'PENDIENTE' : 'FINALIZADA', Activo: true, Fecha: '2026-09-14', Descripcion: 'Synthetic ticket '.repeat(12) })));
seed('Mantenimiento', Array.from({ length: rowCount }, (_, i) => ({ MantenimientoID: `m${i}`, ClienteRef: 'c1', Estado: 'PENDIENTE', TituloMantenimiento: `Synthetic maintenance ${i}`, Fecha: '2026-09-14', DescripcionGeneral: 'Synthetic maintenance '.repeat(12) })));
seed('Clientes', [{ ClienteID: 'c1', Nombre: 'Synthetic client', Activo: true, Estado: 'ACTIVO' }]);
// Virtual huge sheets: any full read throws BEFORE allocation. Their historical
// row count cannot influence initialization or the first audit append.
const historicalRows = 5_000_000;
function sheetName(range) { return String(range).split('!')[0].replace(/^'|'$/g, '').replace(/''/g, "'"); }
function table(range) {
  const name = sheetName(range);
  assert.notEqual(name, 'ActividadApp', 'retired sheet must never be accessed');
  assert.ok(datasets.has(name), `unexpected sheet ${name}`);
  return datasets.get(name);
}
function readRange(range) {
  calls.push({ method: 'get', range });
  const data = table(range);
  if (range.endsWith('!1:1')) return [data.headers.slice()];
  assert.notEqual(sheetName(range), 'Auditoria', `must not read ${historicalRows} historical audit rows`);
  sample();
  const lastColumn = range.match(/!A:([A-Z]+)$/)?.[1];
  const width = lastColumn ? [...lastColumn].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : data.headers.length;
  return [data.headers.slice(0, width), ...data.rows.map(row => row.slice(0, width))];
}
sheetsApi.spreadsheets.values.get = async ({ range }) => ({ data: { values: readRange(range) } });
sheetsApi.spreadsheets.values.batchGet = async ({ ranges }) => ({ data: { valueRanges: ranges.map(range => ({ range, values: readRange(range) })) } });
sheetsApi.spreadsheets.get = async () => {
  calls.push({ method: 'metadata' });
  return { data: { sheets: [...datasets].map(([title], sheetId) => ({ properties: { title, sheetId, gridProperties: { columnCount: 26 } } })) } };
};
sheetsApi.spreadsheets.batchUpdate = async ({ requestBody }) => {
  calls.push({ method: 'metadataWrite' });
  for (const r of requestBody.requests) if (r.addSheet) datasets.set(r.addSheet.properties.title, { headers: [], rows: [] });
  return { data: {} };
};
sheetsApi.spreadsheets.values.append = async ({ range, requestBody }) => {
  const d = table(range); calls.push({ method: 'append', range });
  const start = d.rows.length + 2;
  d.rows.push(...requestBody.values);
  return { data: { updates: { updatedRange: `${range.split('!')[0]}!A${start}:Z${d.rows.length + 1}` } } };
};
function update({ range, values }) {
  const d = table(range); const match = range.match(/!([A-Z]+)(\d+)/);
  const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]);
  const target = row === 1 ? d.headers : d.rows[row - 2];
  for (let i = 0; i < values[0].length; i++) target[col + i] = values[0][i];
}
sheetsApi.spreadsheets.values.update = async ({ range, requestBody }) => { calls.push({ method: 'update', range }); update({ range, values: requestBody.values }); return { data: {} }; };
sheetsApi.spreadsheets.values.batchUpdate = async ({ requestBody }) => { for (const d of requestBody.data) { calls.push({ method: 'update', range: d.range }); update(d); } return { data: {} }; };

await import('../backend/src/services/sheets-memory-guard.service.js');
const repo = await import('../backend/src/infra/sheets.repository.js');
const { audit, flushAuditQueue } = await import('../backend/src/services/audit.service.js');
const { ensureSheetTable, ensureSheetTables } = await import('../backend/src/services/sheet-schema.service.js');
await audit({ user: { UsuarioID: 'u1' } }, 'SMOKE', 'Boletas', 'b1');
assert.equal((await flushAuditQueue()).flushed, 1);
assert.deepEqual(calls, [{ method: 'get', range: "'Auditoria'!1:1" }, { method: 'append', range: "'Auditoria'!A1" }]);
const auditFirstWriteCalls = calls.slice();
await repo.getHeaders('Auditoria');
assert.equal(calls.length, 2, 'headers cached');
await repo.getHeaders('Auditoria', true);
assert.equal(calls.at(-1).range, "'Auditoria'!1:1");
repo.invalidateTableCache('Auditoria');
const before = calls.length;
await repo.appendRow('Auditoria', { AuditoriaID: 'second' });
assert.equal(calls.length, before + 1, 'table invalidation preserves headers');
let schemaStart = calls.length;
await repo.ensureColumns('Auditoria', ['AuditoriaID', 'NuevaColumna']);
await ensureSheetTable('Auditoria', ['AuditoriaID', 'NuevaColumna']);
await ensureSheetTables({ SyntheticEmpty: ['ID', 'Name'] });
const schemaCalls = calls.slice(schemaStart);
assert.ok(schemaCalls.filter(c => c.method === 'get').every(c => c.range.endsWith('!1:1')));
assert.deepEqual(await repo.getHeaders('SyntheticEmpty'), ['ID','Name']);
// Blank columns must not shift fields on append or overwrite real headers.
seed('SyntheticGaps', [], ['ID', '', 'Name']);
await repo.ensureColumns('SyntheticGaps', ['Added']);
await repo.appendRow('SyntheticGaps', { ID: '1', Name: 'kept', Added: 'new' });
assert.deepEqual(datasets.get('SyntheticGaps').rows[0], ['1','','kept','new']);

// Same auth-only warmup as server.js; module imports must not scan activity.
const warmupStart = calls.length;
await repo.readTables(['Sesiones','Usuarios','Roles','Permisos','RolPermisos','UsuarioPermisos']);
assert.ok(calls.slice(warmupStart).filter(c => c.method === 'get').every(c => ['Sesiones','Usuarios','Roles','Permisos','RolPermisos','UsuarioPermisos'].includes(sheetName(c.range))));
const { app } = await import('../backend/src/app.js');
const { concurrencyMiddleware } = await import('../backend/src/middleware/concurrency.middleware.js');
const server = http.createServer((req, res) => concurrencyMiddleware(req, res, error => error ? res.writeHead(error.status || 503).end() : app(req, res)));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}`;
const ready = process.memoryUsage(); sample(ready);
let requestCount = 0;
async function action(route, payload = {}, token = '') {
  requestCount++;
  const response = await fetch(`${endpoint}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route, payload, sessionToken: token }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, route); sample(); return body.data;
}
try {
  for (const path of ['/api/activity/track','/api/activity/report']) {
    const response = await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 404); await response.text();
  }
  const login = await action('auth.login', { username: 'fixture', password: 'fixture-password' });
  const token = login.sessionToken; assert.ok(token);
  await action('auth.me', {}, token);
  for (const payload of [{ pageSize: 1, estado: 'PENDIENTE' }, { pageSize: 3 }, { pageSize: 1, estado: 'FINALIZADA' }]) await action('boletas.list', payload, token);
  for (let i = 0; i < 3; i++) {
    await action('boletas.list', { pageSize: 20 }, token);
    await action('maintenance.list', { pageSize: 80 }, token);
    await action('agenda.list', { pageSize: 100 }, token);
    await action('clients.list', { pageSize: 20 }, token);
  }
  // Independent invalidation: re-reading headers must not evict parsed rows.
  await repo.readTable('Clientes');
  repo.invalidateHeaderCache('Clientes');
  const headerRefreshStart = calls.length;
  await repo.getHeaders('Clientes');
  await repo.readTable('Clientes');
  assert.deepEqual(calls.slice(headerRefreshStart), [{ method: 'get', range: "'Clientes'!1:1" }]);
  // Normal table refreshes must not extend header TTL and hide new columns.
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    seed('Configuracion', [{ Clave: 'fixture', Valor: 'value' }]);
    await repo.readTable('Configuracion', { force: true });
    const config = datasets.get('Configuracion');
    config.headers.push('ExternalColumn'); config.rows[0].push('visible');
    clock += 121000;
    await repo.readTable('Configuracion', { force: true });
    clock += 181000;
    assert.equal((await repo.readTable('Configuracion', { force: true }))[0].ExternalColumn, 'visible');
  } finally { Date.now = realNow; }
  await audit({ user: { UsuarioID: 'u1' } }, 'SMOKE_END', 'Clientes', 'c1');
  assert.equal((await flushAuditQueue()).flushed, 1);
  assert.ok(calls.every(c => !String(c.range).includes('ActividadApp')));
  assert.ok(calls.every(c => !String(c.range).endsWith('A:ZZ')));
  sample();
  peaks.rss = Math.max(peaks.rss, process.resourceUsage().maxRSS * 1024);
  console.log(JSON.stringify({ node: process.version, syntheticRowsPerMainTable: rowCount, virtualHistoricalRows: historicalRows, requestCount, initial, ready, peaks, eventLoopMaxMs: loop.max / 1e6, auditFirstWriteCalls, schemaReads: schemaCalls.filter(c => c.method === 'get'), googleReads: calls.filter(c => c.method === 'get').length, googleWrites: calls.filter(c => ['append','update','metadataWrite'].includes(c.method)).length, activityCalls: 0, cache: repo.sheetsRepositorySnapshot(), limitations: 'Synthetic Google values: no Gaxios/TLS/gzip buffers, no Render cgroup, no real Drive/PDF/video/SMTP/Apps Script; memory includes fixture datasets. HTTP uses real Express, authentication, authorization and action handlers. Warmup calls same auth tables as server.' }, null, 2));
} finally {
  clearInterval(timer); loop.disable(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
