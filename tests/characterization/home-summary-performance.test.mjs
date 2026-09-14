import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  summarizeMaintenanceHomeRows,
  summarizeTicketHomeRows,
} from '../../backend/src/core/home-summary.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function legacyCounts(rows, pendingState, finishedState) {
  return {
    pending: rows.filter((row) => String(row.Estado || '').trim().toUpperCase() === pendingState).length,
    finished: rows.filter((row) => String(row.Estado || '').trim().toUpperCase() === finishedState).length,
  };
}

test('Home summaries preserve legacy status totals on the same visible rows', () => {
  const tickets = [
    { BoletaUID: 'b1', Estado: 'PENDIENTE' },
    { BoletaUID: 'b2', Estado: 'FINALIZADA' },
    { BoletaUID: 'b3', Estado: 'pendiente' },
    { BoletaUID: 'b4', Estado: 'ANULADA' },
    { BoletaUID: 'b5', Estado: '' },
  ];
  const maintenance = [
    { MantenimientoID: 'm1', Estado: 'PENDIENTE' },
    { MantenimientoID: 'm2', Estado: 'FINALIZADO' },
    { MantenimientoID: 'm3', Estado: 'finalizado' },
    { MantenimientoID: 'm4', Estado: 'OTRO' },
  ];

  assert.deepEqual(
    summarizeTicketHomeRows(tickets),
    legacyCounts(tickets, 'PENDIENTE', 'FINALIZADA'),
  );
  assert.deepEqual(
    summarizeMaintenanceHomeRows(maintenance),
    legacyCounts(maintenance, 'PENDIENTE', 'FINALIZADO'),
  );
});

test('Home requests one opt-in summary per supported module and keeps legacy fallback isolated', () => {
  const home = source('src/pages/HomePage.jsx');
  assert.match(home, /homeSummary: true/);
  assert.match(home, /loadTicketHome\(sessionToken, controller\.signal\)/);
  assert.match(home, /loadMaintenanceHome\(sessionToken, controller\.signal\)/);
  assert.match(home, /if \(summary\) return \{ recentData, summary \}/);
  assert.match(home, /if \(summary\) return summary/);
  assert.match(home, /controller\.abort\(\)/);
});

test('Home never converts a failed count request into a confirmed zero', () => {
  const home = source('src/pages/HomePage.jsx');
  assert.match(home, /useState\(\{ pending: null, finished: null \}\)/);
  assert.match(home, /setCounts\(\{ pending: null, finished: null \}\)/);
  assert.match(home, /setMaintenanceCounts\(\{ pending: null, finished: null \}\)/);
  assert.match(home, /counts\.pending === null \? '—'/);
  assert.match(home, /maintenanceCounts\.finished === null \? '—'/);
  assert.doesNotMatch(home, /\.catch\([^)]*\)[\s\S]{0,240}setCounts\([^\n]*pending:\s*0/);
  assert.doesNotMatch(home, /\.catch\([^)]*\)[\s\S]{0,240}setMaintenanceCounts\([^\n]*pending:\s*0/);
});

test('maintenance Home summary avoids loading devices and delegates every non-summary list', () => {
  const progress = source('backend/src/modules/maintenance-progress-chat.module.js');
  const summaryPath = progress.slice(progress.indexOf('async function list(ctx)'), progress.indexOf('async function requestedMaintenanceAlreadyExists'));
  assert.match(summaryPath, /readTable\('Mantenimiento'\)/);
  assert.doesNotMatch(summaryPath, /Evidencia_Mantenimientos|Mantenimiento imagenes/);
  assert.match(summaryPath, /return baseMaintenanceHandlers\.list\(ctx\)/);
  assert.match(summaryPath, /homeSummary: summarizeMaintenanceHomeRows\(rows\)/);
});
