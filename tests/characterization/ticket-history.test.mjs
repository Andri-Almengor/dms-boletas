import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('ticket edits and autosaves share transactionally persisted snapshots under row lock', () => {
  const ticket = read('backend/src/modules/tickets.module.js');
  const audit = read('backend/src/services/audit.service.js');
  assert.match(ticket, /function persistTicketEdit\(ctx, autosave = false\)/);
  assert.match(ticket, /FOR UPDATE/);
  assert.match(ticket, /AUTOGUARDAR_BOLETA/);
  assert.match(ticket, /assignedTicketSnapshot/);
  assert.match(ticket, /immediate: true/);
  assert.match(ticket, /update: async \(ctx\) => enrichTicket\(await persistTicketEdit\(ctx\)\)/);
  assert.match(ticket, /await persistTicketEdit\(ctx, true\)/);
  assert.match(audit, /if \(immediate\) \{[\s\S]*await appendRow\('Auditoria', row\)/);
  assert.match(ticket, /ORDER BY "Fecha" DESC, "__db_id" DESC LIMIT \$2 OFFSET \$3/);
  assert.match(read('backend/migrations/027_ticket_edit_audit_history_index.sql'), /CREATE INDEX IF NOT EXISTS/);
});

test('only management permission can request or view ticket history; previous versions stay read-only', () => {
  const router = read('backend/src/core/action-router.js');
  const detail = read('src/pages/tickets/TicketDetailPage.jsx');
  const client = read('src/components/tickets/TicketHistoryPanel.jsx');
  assert.match(router, /ticketHandlers\.history, 'USUARIOS_GESTIONAR'/);
  assert.match(detail, /hasPermission\('USUARIOS_GESTIONAR'\) && <TicketHistoryPanel/);
  assert.match(client, /Ver cómo estaba toda la boleta antes de la edición/);
  assert.match(client, /Consultar quién cambió la boleta/);
  assert.match(client, /pageSize: 20/);
  assert.doesNotMatch(client, /boletas\.update|tickets\.update|history\.restore/);
  assert.match(read('src/styles/ticket-history.css'), /max-width: 600px/);
});
