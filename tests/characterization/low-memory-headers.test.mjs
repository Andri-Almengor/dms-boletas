import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }

test('activity product, endpoints, schema, exports and telemetry are absent from active source', () => {
  const forbidden = /ActividadApp|ActivityTelemetry|activityReport|activityQueue|PAGE_TIME|PAGE_VIEW|UI_TAB|\/api\/activity|recordUiActivity|recordApiActivityFromToken|flushActivityQueue|activityQueueSnapshot|activity-reports/;
  for (const file of [...files(root + 'src'), ...files(root + 'backend/src')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), forbidden, file);
  }
});
test('headers use a dedicated row-one read and never call the table read path', () => {
  const code = read('backend/src/infra/sheets.repository.js');
  const headers = code.slice(code.indexOf('export async function getHeaders'), code.indexOf('export async function readTable'));
  assert.match(headers, /values\.get/);
  assert.match(headers, /!1:1/);
  assert.doesNotMatch(headers, /readTable|queueTableRead|batchGet/);
  const schema = read('backend/src/services/sheet-schema.service.js');
  assert.doesNotMatch(schema, /readTable|invalidateTableCache|!A:ZZ/);
  assert.match(schema, /ensureColumns\(name, expected\)/);
});
test('the memory guard recognizes all bounded full-column table ranges', () => {
  const code = read('backend/src/services/sheets-memory-guard.service.js');
  const match = code.match(/function isRepositoryRange\(range\) \{([\s\S]*?)\n\}/);
  const isRange = new Function('range', match[1]);
  for (const range of ["'Auditoria'!A:K", "'Boletas'!A:ZZ", "'Mantenimiento'!A:AZ"]) assert.equal(isRange(range), true);
  for (const range of ["'Auditoria'!1:1", "'Boletas'!A3:C3"]) assert.equal(isRange(range), false);
});
test('cold start warmup remains auth only and runtime is exactly pinned', () => {
  const server = read('backend/src/server.js');
  const warmup = server.match(/readTables\(\[([^\]]+)\]\)/)[1];
  assert.deepEqual([...warmup.matchAll(/'([^']+)'/g)].map(m => m[1]), ['Sesiones','Usuarios','Roles','Permisos','RolPermisos','UsuarioPermisos']);
  const version = read('.node-version').trim();
  assert.equal(version, '24.21.0');
  for (const path of ['package.json','backend/package.json']) assert.equal(JSON.parse(read(path)).engines.node, version);
  assert.match(read('render.yaml'), /key: NODE_VERSION\s+value: "24\.21\.0"/);
});
test('huge historical sheets: audit is header+append, schema never scans, normal HTTP actions work', { timeout: 60000 }, () => {
  const result = spawnSync(process.execPath, ['scripts/low-memory-smoke.mjs'], { cwd: root, encoding: 'utf8', timeout: 55000, env: { ...process.env, SYNTHETIC_ROWS: '1000' } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.activityCalls, 0);
  assert.equal(report.auditFirstWriteCalls.length, 2);
  assert.equal(report.requestCount, 17);
  assert.equal(report.cache.inflight, 0);
});

test('ticket Home summary keeps the existing technician-assignment visibility gate', () => {
  const visibility = read('backend/src/services/ticket-visibility.patch.js');
  assert.match(visibility, /const viewAll = canViewAllTickets\(ctx\)/);
  assert.match(visibility, /const needsAssignments = !viewAll \|\| Boolean\(requestedAssignedUser\)/);
  assert.match(visibility, /ticketIdsAssignedTo\(assignments, ctx\.user\.UsuarioID\)/);
  assert.match(visibility, /allowedIds\.has\(String\(row\.BoletaUID\)\)/);
  assert.match(visibility, /summarizeTicketHomeRows\(rows\)/);

  const access = read('backend/src/services/ticket-access.service.js');
  assert.match(access, /USUARIOS_GESTIONAR/);
  assert.match(access, /BOLETAS_ELIMINAR/);
  assert.match(access, /assignedTicketIdsForUser\(ctx\.user\.UsuarioID\)/);
  assert.match(access, /Solo puede consultar o modificar las boletas en las que está asignado/);
});

test('finalization storage reuses shared schema and preserves bounded recoverable writes', () => {
  const storage = read('backend/src/services/maintenance-finalization-job.storage.js');
  assert.match(storage, /ensureSheetTables/);
  assert.doesNotMatch(storage, /sheetsApi|invalidateTableCache|getHeaders|spreadsheets\.values\.get/);
  assert.match(storage, /const WRITE_BATCH = 100/);
  assert.match(storage, /if \(!creates\.length\) return current/);
  assert.match(storage, /appendRows\(FINALIZATION_ITEM_SHEET, creates, \{ chunkSize: WRITE_BATCH \}\)/);
  assert.match(storage, /updateRows\(FINALIZATION_ITEM_SHEET, normalized, 'ItemID'\)/);
  assert.match(storage, /JobID/);
  assert.match(storage, /ItemID/);
  assert.match(storage, /FechaActualizacion/);
});

// Baseline main 65c86e2: explicit invariants requested for the activity-removal work.
// Ticket visibility, finalization storage and the maintenance list are intentionally covered
// by behavior/source guards because this PR changes their internals while preserving
// authorization, persisted headers, checkpoints, pagination results and write batching.
const businessBaseline = {
  "backend/src/core/action-router.js": "92f33f8d565c70a77e6ef8b6196a696237a5b7b9880b0858842f6aa23aa37033",
  "backend/src/services/auth.service.js": "2af2682ef2b898bc71fe7aafa9c030fb3e2410559c28aea1d198520a0d7d7098",
  "backend/src/services/permissions.service.js": "4447b2b92c8438456e2bd6e5bea9dcd72a3cb4892e26aa9f3d5335c22090feba",
  "backend/src/services/maintenance-evidence-permissions.patch.js": "c39ed14272d49ad648ddd4e40ecedeaf0bad22555d88df17baa53b2ae715032b",
  "backend/src/services/maintenance-device-delete-permissions.patch.js": "40cf84fbc2552b8e00b16d840d11c0f9825c71819c6bf4bcb86e630d7e359903",
  "backend/src/modules/tickets.module.js": "6f40142d4a0691e99e83cbdc869cc8871559010871c017084f4a393887b60059",
  "backend/src/modules/agenda.module.js": "d19ad3bcbbd7b3c360855db9e5bb0e8f22cd18a5644690065c692c6f1e6fe5ca",
  "backend/src/modules/crud.module.js": "9f6c25cfbeaadd8126426012ba2fd6e4d0199687b1493d291b889032f292ca21",
  "backend/src/modules/ticket-signature.module.js": "c1df58a8a8a5303d10ba236335eef7a3d7d12c643057be6f6063a60f72271ba0",
  "backend/src/modules/maintenance-signature.module.js": "607439631bfdb7b8e17cff815ca8e55fd5f716223ee764fd983fec79fa4416b6",
  "backend/src/services/protected-media-stream.service.js": "7c84b03e743ac5c80b7957e3fdba0ae89128114869368d8ab3ade93acf5dac11",
  "backend/src/services/maintenance-finalization-resume.patch.js": "0f9dca7d2a8110451d52dbe152bb6b8df654579e190dfb44046eef2f775478e6",
  "backend/src/services/maintenance-finalization-schedule.patch.js": "726eba328256a4a1cac542dc2489e1fe1a25eca6efd14cc2d61a5aa8220a9bbd",
  "apps-script/KnowledgeBase.gs": "5ccb3dc0115e44445c0c0fd7a7944c19c11cbe65298e4cc7a60d6d4fa6783ab3",
  "apps-script/KnowledgeSpreadsheetCompat.gs": "d8b99dd4c7bdbbc8ed15056e221503d06def77e2cf6c18d44ab966cf29f868f8",
  "apps-script/MaintenanceCore.gs": "6dcc9ee18469e89207f4b7405787c43973d0fa921a2bd366e386dca3aeca815a",
  "apps-script/MaintenanceDevices.gs": "08b2f1f7b4f57bef5801103bc98faafcbc815017d324c844b327c480cd4e65a5",
  "apps-script/MaintenanceHelpers.gs": "4e3b5ab317e2c3275a52ad8c72748f78ffe59dd2e801c32e61114065b0d24d64",
  "apps-script/MaintenanceReports.gs": "7e333bbbc79a1434ee3271d620a3c3ff0d770b18b653833f7f7e93370252e9d6",
  "apps-script/MigrateImportedClientRelations.gs": "b43907afd2c60e7d37cb80054a92bfac815017d324c844b327c480cd4e65a5",
  "apps-script/OperationalAccessAndInvites.gs": "d79376d14a89063ef72b0986c168c29417179fc2bf7de3d4f339b5a27a77c5c8",
  "apps-script/RepairImportedClientIds.gs": "3976d85dd4936f185ce2634c9d816e94f123919cf7fea95706f096051b68d18f",
  "apps-script/boletas-report/Code.gs": "5aeb4d1c13bf8adcd160acc2da98d199e26005dfbf6cbb68fa5bea2c01df42b6",
  "apps-script/boletas-report/appsscript.json": "16d91a41109e4e876741d4b437f40b2e4d1619555432f03c873cc176772f5db8",
  "apps-script/patches/agenda-ticket-finalization-reminders-v7.9.patch": "530353f2daa2cead4e84e52aed8b24a9792bf045b8858c2ea6df29e542543147",
  "apps-script/patches/pdf-annex-blank-page.patch": "f5237174bdcf74e4d005802aaf572847af15e59ca9388c98bb5ec5c1ad9bc864",
  "apps-script/report-service/Code.gs": "9c7e56b51a6d4585161fa267c50e8ec94475532a4b735136c448bea7186314b0",
  "apps-script/report-service/README.md": "972bad00e5fc9f8593c2b2b95a4009d61bb8eade84c975425a7f74c1169b60ea"
};
test('roles, permissions, unchanged business handlers, original media and Apps Script remain byte-identical', () => {
  for (const [file, digest] of Object.entries(businessBaseline)) assert.equal(createHash('sha256').update(read(file)).digest('hex'), digest, file);
});
