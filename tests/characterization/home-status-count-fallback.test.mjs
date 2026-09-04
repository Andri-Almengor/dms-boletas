import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Inicio no convierte en cero un resumen de boletas ausente', () => {
  const home = source('src/pages/HomePage.jsx');

  assert.match(home, /function hasStatusCounts\(data\)/);
  assert.match(home, /function responseTotal\(data\)/);
  assert.match(home, /async function loadTicketStatusFallback\(routes, sessionToken\)/);
  assert.match(home, /if \(hasStatusCounts\(data\)\)/);
  assert.match(home, /await loadTicketStatusFallback\(ticketListRoutes, sessionToken\)/);
  assert.match(home, /status:\s*'PENDIENTE'/);
  assert.match(home, /status:\s*'FINALIZADA'/);
  assert.match(home, /status:\s*'FINALIZADO'/);

  const fastPath = home.indexOf('if (hasStatusCounts(data))');
  const fallback = home.indexOf('await loadTicketStatusFallback(ticketListRoutes, sessionToken)');
  assert.ok(fastPath >= 0 && fallback > fastPath, 'El fallback solo debe ejecutarse cuando el resumen consolidado no exista.');
});
