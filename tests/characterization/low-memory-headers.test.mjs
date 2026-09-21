import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }

test('activity product, endpoints, schema, exports and telemetry are absent from active runtime source', () => {
  const forbidden = /ActivityTelemetry|activityReport|activityQueue|PAGE_TIME|PAGE_VIEW|UI_TAB|\/api\/activity|recordUiActivity|recordApiActivityFromToken|flushActivityQueue|activityQueueSnapshot|activity-reports/;
  const runtimeFiles = [...files(root + 'src'), ...files(root + 'backend/src')]
    .filter((file) => !file.includes('/backend/src/scripts/'));
  for (const file of runtimeFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), forbidden, file);
});

test('headers come from the PostgreSQL migration registry without operational Sheets I/O', () => {
  const repository = read('backend/src/infra/postgres.repository.core.js');
  assert.match(repository, /export async function getHeaders\(table\)/);
  assert.match(repository, /return \[\.\.\._definition\(table\)\.columns\]/);
  assert.doesNotMatch(repository, /sheetsApi|google\.sheets|spreadsheets\./);
  const schema = read('backend/src/services/sheet-schema.service.js');
  assert.match(schema, /ensureColumns/);
  assert.doesNotMatch(schema, /sheetsApi|google\.sheets|spreadsheets\./);
});

test('the legacy Sheets memory guard is disabled after PostgreSQL cutover', () => {
  const code = read('backend/src/services/sheets-memory-guard.service.js');
  assert.match(code, /postgres-persistence/);
  assert.match(code, /enabled:\s*false/);
  assert.doesNotMatch(code, /HEAVY_SHEETS|splitRepositoryRanges|serializeRepositoryRead/);
});

test('cold start validates PostgreSQL without warming operational tables and runtime is exactly pinned', () => {
  const server = read('backend/src/server.js');
  assert.match(server, /SELECT schema_version FROM sync_state WHERE singleton=TRUE/);
  assert.doesNotMatch(server, /readTables\(/);
  const version = read('.node-version').trim();
  assert.equal(version, '24.21.0');
  for (const path of ['package.json','backend/package.json']) assert.equal(JSON.parse(read(path)).engines.node, version);
  assert.match(read('render.yaml'), /key: NODE_VERSION\s+value: "24\.21\.0"/);
});

test('PostgreSQL runtime avoids Sheets-wide warmups and exposes bounded query paths', () => {
  const repository = read('backend/src/infra/postgres.repository.core.js');
  const queries = read('backend/src/infra/postgres.repository.queries.js');
  const server = read('backend/src/server.js');
  assert.match(repository, /WHERE "__valid" = TRUE/);
  assert.match(queries, /export async function queryTicketPage/);
  assert.match(queries, /export async function queryCustomerCasePage/);
  assert.doesNotMatch(server, /readTables\(/);
  assert.doesNotMatch(server, /spreadsheets\./);
});

test('ticket Home summary keeps the existing technician-assignment visibility gate', () => {
  const visibility = read('backend/src/services/ticket-visibility.patch.js');
  assert.match(visibility, /const viewAll = canViewAllTickets\(ctx\)/);
  assert.match(visibility, /let allowedIds = viewAll \? null : await assignedTicketIdsForUser\(ctx\.user\.UsuarioID\)/);
  assert.match(visibility, /queryTicketPage\(payload, \{ allowedIds \}\)/);

  const access = read('backend/src/services/ticket-access.service.js');
  assert.match(access, /USUARIOS_GESTIONAR/);
  assert.match(access, /BOLETAS_ELIMINAR/);
  assert.doesNotMatch(access.match(/export function canViewAllTickets[\s\S]*?\n\}/)?.[0] || '', /BOLETAS_GESTIONAR/);
  assert.match(access, /assignedTicketIdsForUser\(ctx\.user\.UsuarioID/);
  assert.match(access, /Solo puede consultar o modificar las boletas en las que está asignado/);

  const queries = read('backend/src/infra/postgres.repository.queries.js');
  assert.match(queries, /allowedIds instanceof Set/);
  assert.match(queries, /"BoletaUID"=ANY/);
  assert.match(queries, /String\.fromCharCode\(36\) \+ params\.length/);
  assert.match(queries, /COUNT\(\*\) FILTER \(WHERE \$\{statusSql\}='PENDIENTE'\)/);
  assert.match(queries, /COUNT\(\*\) FILTER \(WHERE \$\{statusSql\}='FINALIZADA'\)/);
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
// Protected media is intentionally excluded here because PR #305 changes its transport;
// dedicated security/performance characterization covers that path instead.
// Maintenance signature handling and the boleta report script are also covered by
// dedicated signature characterization because the signature reset/fit work changes them intentionally.
const businessBaseline = {
  "backend/src/services/maintenance-evidence-permissions.patch.js": "c39ed14272d49ad648ddd4e40ecedeaf0bad22555d88df17baa53b2ae715032b",
  "backend/src/services/maintenance-device-delete-permissions.patch.js": "40cf84fbc2552b8e00b16d840d11c0f9825c71819c6bf4bcb86e630d7e359903",
  "backend/src/modules/agenda.module.js": "9b2b364f7a825cefa4c39849b9b54da5356c6882282be10450baeaddc52bd8d0",
  "backend/src/modules/crud.module.js": "d34442574321a7f1596bffacd1d7fecead757ad73557251449f8322590b6f27b",
  "backend/src/modules/ticket-signature.module.js": "c1df58a8a8a5303d10ba236335eef7a3d7d12c643057be6f6063a60f72271ba0",
  "backend/src/services/maintenance-finalization-resume.patch.js": "0f9dca7d2a8110451d52dbe152bb6b8df654579e190dfb44046eef2f775478e6",
  "backend/src/services/maintenance-finalization-schedule.patch.js": "726eba328256a4a1cac542dc2489e1fe1a25eca6efd14cc2d61a5aa8220a9bbd",
  "apps-script/KnowledgeBase.gs": "5ccb3dc0115e44445c0c0fd7a7944c19c11cbe65298e4cc7a60d6d4fa6783ab3",
  "apps-script/KnowledgeSpreadsheetCompat.gs": "d8b99dd4c7bdbbc8ed15056e221503d06def77e2cf6c18d44ab966cf29f868f8",
  "apps-script/MaintenanceCore.gs": "6dcc9ee18469e89207f4b7405787c43973d0fa921a2bd366e386dca3aeca815a",
  "apps-script/MaintenanceDevices.gs": "08b2f1f7b4f57bef5801103bc98faafcbc815017d324c844b327c480cd4e65a5",
  "apps-script/MaintenanceHelpers.gs": "4e3b5ab317e2c3275a52ad8c72748f78ffe59dd2e801c32e61114065b0d24d64",
  "apps-script/MaintenanceReports.gs": "7e333bbbc79a1434ee3271d620a3c3ff0d770b18b653833f7f7e93370252e9d6",
  "apps-script/MigrateImportedClientRelations.gs": "b43907afd2c60e7d37cb80054a92bfac57df39f49a3952d63bed74c4264e311a",
  "apps-script/OperationalAccessAndInvites.gs": "d79376d14a89063ef72b0986c168c29417179fc2bf7de3d4f339b5a27a77c5c8",
  "apps-script/RepairImportedClientIds.gs": "3976d85dd4936f185ce2634c9d816e94f123919cf7fea95706f096051b68d18f",
  "apps-script/boletas-report/appsscript.json": "16d91a41109e4e876741d4b437f40b2e4d1619555432f03c873cc176772f5db8",
  "apps-script/patches/agenda-ticket-finalization-reminders-v7.9.patch": "530353f2daa2cead4e84e52aed8b24a9792bf045b8858c2ea6df29e542543147",
  "apps-script/patches/pdf-annex-blank-page.patch": "f5237174bdcf74e4d005802aaf572847af15e59ca9388c98bb5ec5c1ad9bc864",
  "apps-script/report-service/Code.gs": "9c7e56b51a6d4585161fa267c50e8ec94475532a4b735136c448bea7186314b0",
  "apps-script/report-service/README.md": "972bad00e5fc9f8593c2b2b95a4009d61bb8eade84c975425a7f74c1169b60ea"
};
test('unchanged business handlers and Apps Script remain byte-identical while auth permissions preserve policy', () => {
  for (const [file, digest] of Object.entries(businessBaseline)) assert.equal(createHash('sha256').update(read(file)).digest('hex'), digest, file);

  const router = read('backend/src/core/action-router.js');
  assert.match(router, /boletas\.evidence\.uploadBatch/);
  assert.match(router, /ticketScalableEvidenceHandlers\.uploadBatch, \['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR'\]/);
  assert.match(router, /maintenance\.images\.uploadBatch/);
  assert.match(router, /maintenanceScalableImageHandlers\.uploadBatch/);

  const tickets = read('backend/src/modules/tickets.module.js');
  assert.match(tickets, /findRows\('EvidenciasBoleta'/);
  assert.match(tickets, /TipoMedio:/);
  assert.match(tickets, /DuracionSegundos:/);

  const auth = read('backend/src/services/auth.service.js');
  assert.match(auth, /findUserByLogin/);
  assert.match(auth, /findActiveSessionByTokenHash/);
  assert.match(auth, /CambioPasswordObligatorio/);
  assert.match(auth, /IntentosFallidos/);

  const permissions = read('backend/src/services/permissions.service.js');
  assert.match(permissions, /EsAdministrador/);
  assert.match(permissions, /RolPermisos/);
  assert.match(permissions, /UsuarioPermisos/);

  const access = read('backend/src/services/ticket-access.service.js');
  const viewAll = access.match(/export function canViewAllTickets[\s\S]*?\n\}/)?.[0] || '';
  assert.match(viewAll, /USUARIOS_GESTIONAR/);
  assert.match(viewAll, /BOLETAS_ELIMINAR/);
  assert.doesNotMatch(viewAll, /BOLETAS_GESTIONAR/);
});
