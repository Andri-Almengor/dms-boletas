import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Pendientes y Finalizadas usan la misma tarjeta con nombres de asignados', () => {
  const list = source('src/pages/tickets/TicketListPage.jsx');
  const card = source('src/components/tickets/TicketCard.jsx');
  const styles = source('src/styles/modules.css');

  assert.match(list, /<TicketCard/);
  assert.match(list, /status === 'PENDIENTE'/);
  assert.match(list, /status === 'FINALIZADA'/);
  assert.match(card, /AsignadosNombres/);
  assert.match(card, /<dt>Asignados<\/dt>/);
  assert.match(card, /ticket-card__data-wide/);
  assert.match(styles, /\.ticket-card__data \.ticket-card__data-wide \{ grid-column: 1 \/ -1; \}/);
});

test('el listado PostgreSQL agrega asignados sin consultas N+1 por tarjeta', () => {
  const queries = source('backend/src/infra/postgres.repository.queries.js');

  assert.match(queries, /STRING_AGG\(assigned_names\.name, ', ' ORDER BY assigned_names\.name\)/);
  assert.match(queries, /FROM "BoletaAsignados" ba/);
  assert.match(queries, /LEFT JOIN "Usuarios" u/);
  assert.match(queries, /AS "AsignadosNombres"/);
  assert.match(queries, /AsignadosNombres: String\(row\.AsignadosNombres \|\| ''\)/);
});

test('el delta incremental conserva los nombres de todos los técnicos asignados', () => {
  const sync = source('backend/src/services/sync-ticket.service.js');

  assert.match(sync, /assignmentNamesByTicket/);
  assert.match(sync, /NombreAsignado/);
  assert.match(sync, /AsignadosNombres:/);
  assert.match(sync, /assignedUserIds:/);
});
