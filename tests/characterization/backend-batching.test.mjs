import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  countRowsBy,
  groupRowsBy,
  indexRowsBy,
} from '../../backend/src/core/row-index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const rows = [
  { id: '1', parent: 'A', active: true },
  { id: '2', parent: 'A', active: false },
  { id: '3', parent: 'B', active: true },
  { id: '4', parent: '', active: true },
];

test('los índices agrupan, cuentan y filtran filas sin alterar el orden', () => {
  const active = { predicate: (row) => row.active };
  const grouped = groupRowsBy(rows, (row) => row.parent, active);
  const counted = countRowsBy(rows, (row) => row.parent, active);
  const indexed = indexRowsBy(rows, (row) => row.id, active);

  assert.deepEqual(grouped.get('A').map((row) => row.id), ['1']);
  assert.deepEqual(grouped.get('B').map((row) => row.id), ['3']);
  assert.equal(grouped.has(''), false);
  assert.equal(counted.get('A'), 1);
  assert.equal(counted.get('B'), 1);
  assert.equal(indexed.get('3').parent, 'B');
  assert.equal(indexed.has('2'), false);
});

test('el repositorio expone una actualización múltiple y updateRow delega en ella', () => {
  const repository = source('backend/src/infra/sheets.repository.js');
  assert.match(repository, /export async function updateRows/);
  assert.match(repository, /spreadsheets\.values\.batchUpdate/);
  assert.match(repository, /return \(await updateRows\(sheetName, \[\{ idValue, patch \}\], idColumn\)\)\[0\]/);
  assert.match(repository, /patchCachedRows/);
});

test('los grupos de visitas y asignados usan escrituras agrupadas', () => {
  const visits = source('backend/src/services/ticket-visit-group.service.js');
  const tickets = source('backend/src/modules/tickets.module.js');

  assert.match(visits, /updateRows\(SHEET_NAME/);
  assert.doesNotMatch(visits, /for \(const visit of group\.visits\) \{\s*await updateRow/s);
  assert.match(tickets, /appendRows\('BoletaAsignados'/);
  assert.match(tickets, /updateRows\('BoletaAsignados'/);
  assert.doesNotMatch(tickets, /for \(const row of active\) await updateRow/);
});

test('mantenimientos y visitas construyen índices una sola vez por respuesta', () => {
  const maintenance = source('backend/src/modules/maintenance.module.js');
  const multi = source('backend/src/modules/ticket-multi.module.js');

  assert.match(maintenance, /readTables\(\['Mantenimiento', 'Evidencia_Mantenimientos'\]\)/);
  assert.match(maintenance, /countRowsBy/);
  assert.match(maintenance, /groupRowsBy/);
  assert.doesNotMatch(maintenance, /devices\.filter\(\(device\).*\.length/s);

  assert.match(multi, /assignmentsByTicket/);
  assert.match(multi, /evidencesByTicket/);
  assert.match(multi, /groupRowsBy/);
});
