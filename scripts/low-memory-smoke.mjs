// PostgreSQL runtime smoke. Operational persistence must not touch Google Sheets.
// Uses only TEST_DATABASE_URL because this script creates and deletes synthetic rows.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!testDatabaseUrl) {
  throw new Error('low-memory-smoke.mjs requires TEST_DATABASE_URL; DATABASE_URL is never accepted for destructive smoke data.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
Object.assign(process.env, {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'fixture@example.invalid',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'fixture-not-a-key',
  MAINTENANCE_PROGRESS_CHAT_ENABLED: 'false',
});

const initial = process.memoryUsage();
const peaks = { ...initial };
function sample(m = process.memoryUsage()) {
  for (const key of Object.keys(peaks)) peaks[key] = Math.max(peaks[key], m[key]);
}
const timer = setInterval(sample, 5);
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const { sheetsApi } = await import('../backend/src/infra/google.js');
const { hashPassword } = await import('../backend/src/core/utils.js');
const repo = await import('../backend/src/infra/postgres.repository.js');
const { query, postgresSnapshot, closePostgres } = await import('../backend/src/infra/postgres.js');
const { audit, flushAuditQueue } = await import('../backend/src/services/audit.service.js');

const sheetCalls = [];
function forbidSheets(method) {
  return async (args = {}) => {
    sheetCalls.push({ method, spreadsheetId: args.spreadsheetId ? 'present' : '', range: args.range || '' });
    throw new Error(`Operational Google Sheets call forbidden during PostgreSQL smoke: ${method}`);
  };
}
sheetsApi.spreadsheets.values.get = forbidSheets('values.get');
sheetsApi.spreadsheets.values.batchGet = forbidSheets('values.batchGet');
sheetsApi.spreadsheets.values.append = forbidSheets('values.append');
sheetsApi.spreadsheets.values.update = forbidSheets('values.update');
sheetsApi.spreadsheets.values.batchUpdate = forbidSheets('values.batchUpdate');
sheetsApi.spreadsheets.get = forbidSheets('spreadsheets.get');
sheetsApi.spreadsheets.batchUpdate = forbidSheets('spreadsheets.batchUpdate');
sheetsApi.spreadsheets.create = forbidSheets('spreadsheets.create');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  role: `smoke-role-${suffix}`,
  user: `smoke-user-${suffix}`,
  client: `smoke-client-${suffix}`,
  ticket: `smoke-ticket-${suffix}`,
};
const username = `smoke-${suffix}`;
const password = hashPassword('Fixture-Password-2026');
const permissionCodes = [
  'USUARIOS_GESTIONAR',
  'USUARIOS_VER',
  'BOLETAS_VER',
  'BOLETAS_CREAR',
  'BOLETAS_EDITAR',
  'MANTENIMIENTOS_VER',
  'MANTENIMIENTOS_GESTIONAR',
  'CLIENTES_VER',
  'AGENDA_VER',
];

async function cleanup() {
  await query('DELETE FROM "Sesiones" WHERE "UsuarioID"=$1', [ids.user], { label: 'smoke.cleanup.sessions', write: true }).catch(() => {});
  await query('DELETE FROM "Auditoria" WHERE "UsuarioID"=$1', [ids.user], { label: 'smoke.cleanup.audit', write: true }).catch(() => {});
  await query('DELETE FROM "Boletas" WHERE "BoletaUID"=$1', [ids.ticket], { label: 'smoke.cleanup.ticket', write: true }).catch(() => {});
  await query('DELETE FROM "Clientes" WHERE "ClienteID"=$1', [ids.client], { label: 'smoke.cleanup.client', write: true }).catch(() => {});
  await query('DELETE FROM "Usuarios" WHERE "UsuarioID"=$1', [ids.user], { label: 'smoke.cleanup.user', write: true }).catch(() => {});
  await query('DELETE FROM "Roles" WHERE "RolID"=$1', [ids.role], { label: 'smoke.cleanup.role', write: true }).catch(() => {});
  await query('DELETE FROM "Permisos" WHERE "PermisoID" LIKE $1', [`smoke-perm-${suffix}-%`], { label: 'smoke.cleanup.permissions', write: true }).catch(() => {});
}

await cleanup();
await repo.appendRow('Roles', { RolID: ids.role, Nombre: 'Smoke admin', EsAdministrador: true, Estado: 'ACTIVO' });
for (let index = 0; index < permissionCodes.length; index += 1) {
  await repo.appendRow('Permisos', {
    PermisoID: `smoke-perm-${suffix}-${index}`,
    Codigo: permissionCodes[index],
    Nombre: permissionCodes[index],
    Estado: 'ACTIVO',
  });
}
await repo.appendRow('Usuarios', {
  UsuarioID: ids.user,
  RolID: ids.role,
  NombreUsuario: username,
  NombreCompleto: 'Synthetic PostgreSQL user',
  Correo: `${username}@example.invalid`,
  Estado: 'ACTIVO',
  PasswordSalt: password.salt,
  PasswordHash: password.hash,
  IntentosFallidos: 0,
  BloqueadoHasta: '',
});
await repo.appendRow('Clientes', {
  ClienteID: ids.client,
  Nombre: 'Synthetic PostgreSQL client',
  Estado: 'ACTIVO',
  Activo: true,
});
await repo.appendRow('Boletas', {
  BoletaUID: ids.ticket,
  BoletaID: `PRUEBA-SMOKE-${suffix}`,
  EsPrueba: true,
  ClienteID: ids.client,
  Estado: 'PENDIENTE',
  Titulo: 'Synthetic PostgreSQL ticket',
  Fecha: '2026-09-17',
  Activo: true,
});

await audit({ user: { UsuarioID: ids.user, NombreCompleto: 'Synthetic PostgreSQL user' } }, 'SMOKE', 'Boletas', ids.ticket);
assert.equal((await flushAuditQueue()).flushed, 1);
const auditRows = await query(
  'SELECT COUNT(*)::int AS count FROM "Auditoria" WHERE "UsuarioID"=$1 AND "EntidadID"=$2 AND "Accion"=$3',
  [ids.user, ids.ticket, 'SMOKE'],
  { label: 'smoke.audit.verify' },
);
assert.equal(Number(auditRows.rows[0]?.count || 0), 1);
assert.deepEqual(sheetCalls, []);

const { app } = await import('../backend/src/app.js');
const { concurrencyMiddleware } = await import('../backend/src/middleware/concurrency.middleware.js');
const server = http.createServer((req, res) => concurrencyMiddleware(req, res, (error) => {
  if (error) res.writeHead(error.status || 503).end();
  else app(req, res);
}));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}`;
const ready = process.memoryUsage();
sample(ready);
let requestCount = 0;

async function action(route, payload = {}, token = '') {
  requestCount += 1;
  const response = await fetch(`${endpoint}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route, payload, sessionToken: token }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, route);
  sample();
  return body.data;
}

try {
  const login = await action('auth.login', { username, password: 'Fixture-Password-2026' });
  const token = login.sessionToken;
  assert.ok(token);
  await action('auth.me', {}, token);
  await action('boletas.list', { pageSize: 20 }, token);
  await action('maintenance.list', { pageSize: 20 }, token);
  await action('clients.list', { pageSize: 20 }, token);

  await audit({ user: { UsuarioID: ids.user, NombreCompleto: 'Synthetic PostgreSQL user' } }, 'SMOKE_END', 'Clientes', ids.client);
  assert.equal((await flushAuditQueue()).flushed, 1);
  assert.deepEqual(sheetCalls, []);

  sample();
  peaks.rss = Math.max(peaks.rss, process.resourceUsage().maxRSS * 1024);
  console.log(JSON.stringify({
    node: process.version,
    persistence: 'postgresql',
    requestCount,
    initial,
    ready,
    peaks,
    eventLoopMaxMs: loop.max / 1e6,
    operationalGoogleSheetsCalls: sheetCalls.length,
    postgres: postgresSnapshot(),
    limitations: 'Synthetic PostgreSQL fixture in TEST_DATABASE_URL; Drive/PDF/video/SMTP/Apps Script/report-generation paths are not exercised.',
  }, null, 2));
} finally {
  clearInterval(timer);
  loop.disable();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await cleanup();
  await closePostgres();
}
