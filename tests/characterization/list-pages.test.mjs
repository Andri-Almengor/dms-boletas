import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ticket = await readFile(new URL('../../src/pages/tickets/TicketListPage.jsx', import.meta.url), 'utf8');
const maintenance = await readFile(new URL('../../src/pages/maintenance/MaintenanceListPage.jsx', import.meta.url), 'utf8');
const maintenanceDomain = await readFile(new URL('../../src/features/maintenance/maintenanceListDomain.js', import.meta.url), 'utf8');

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
