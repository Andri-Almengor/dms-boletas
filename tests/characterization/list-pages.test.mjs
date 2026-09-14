import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ticket = await readFile(new URL('../../src/pages/tickets/TicketListPage.jsx', import.meta.url), 'utf8');
const maintenance = await readFile(new URL('../../src/pages/maintenance/MaintenanceListPage.jsx', import.meta.url), 'utf8');
const maintenanceDomain = await readFile(new URL('../../src/features/maintenance/maintenanceListDomain.js', import.meta.url), 'utf8');
const maintenanceBackend = await readFile(new URL('../../backend/src/modules/maintenance.module.js', import.meta.url), 'utf8');

for (const [name, source] of [['boletas', ticket], ['mantenimientos', maintenance]]) {
  assert.match(source, /usePaginatedResource/);
  assert.doesNotMatch(source, /requestSequence/);
  assert.doesNotMatch(source, /mergePaginatedItems/);
  assert.doesNotMatch(source, /paginationMeta/);
  assert.match(source, /signal/);
  assert.match(source, /loadMore/);
  console.log(`✓ ${name}: paginación y cancelación compartidas`);
}

assert.match(ticket, /TICKET_PAGE_SIZE = 50/);
assert.match(ticket, /normalizeTicketStatus/);
assert.match(ticket, /asignadoUsuarioId/);
assert.match(maintenanceDomain, /MAINTENANCE_LIST_PAGE_SIZE = 40/);
assert.match(maintenance, /PAGE_SIZE = MAINTENANCE_LIST_PAGE_SIZE/);
assert.match(maintenance, /matchesMaintenanceListFilters/);
assert.match(maintenance, /normalizeMaintenanceStatus/);
assert.match(maintenance, /maintenanceListPayload/);

const listStart = maintenanceBackend.indexOf('list: async ({ payload }) => {');
const listEnd = maintenanceBackend.indexOf('\n\n  get: async', listStart);
assert.ok(listStart >= 0 && listEnd > listStart, 'debe existir el handler maintenance.list');
const maintenanceListHandler = maintenanceBackend.slice(listStart, listEnd);
const paginationAt = maintenanceListHandler.indexOf('const result = filterRows(');
const deviceReadAt = maintenanceListHandler.indexOf("readTable('Evidencia_Mantenimientos')");
assert.match(maintenanceListHandler, /readTable\('Mantenimiento'\)/);
assert.doesNotMatch(maintenanceListHandler, /readTables\(\['Mantenimiento', 'Evidencia_Mantenimientos'\]\)/);
assert.ok(paginationAt >= 0, 'maintenance.list debe filtrar y paginar con filterRows');
assert.ok(deviceReadAt > paginationAt, 'maintenance.list debe paginar antes de leer/enriquecer dispositivos');
assert.match(maintenanceListHandler, /if \(!result\.items\.length\) return result/);
assert.match(maintenanceListHandler, /const pageIds = new Set\(result\.items\.map/);
assert.match(maintenanceListHandler, /pageIds\.has\(String\(device\.MantenimientoRef\)\)/);
assert.match(maintenanceListHandler, /result\.items = result\.items\.map/);
console.log('✓ mantenimientos backend: filtra y pagina antes de enriquecer la página');
