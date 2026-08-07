import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la aplicación muestra una recuperación visible y no queda en negro ante fallos de chunks', () => {
  const main = source('src/main.jsx');
  const boundary = source('src/components/system/AppErrorBoundary.jsx');
  const styles = source('src/styles/app-recovery.css');

  assert.match(main, /AppErrorBoundary/);
  assert.match(main, /<AppErrorBoundary>/);
  assert.match(boundary, /failed to fetch dynamically imported module/i);
  assert.match(boundary, /dms-boletas-shell-/);
  assert.match(boundary, /caches\.delete/);
  assert.match(boundary, /serviceWorker.*getRegistrations/s);
  assert.match(boundary, /Recargar aplicación/);
  assert.match(boundary, /Sus borradores locales no se eliminan/);
  assert.match(styles, /app-recovery-screen/);
  assert.match(styles, /data-theme='dark'/);
});

test('el service worker renueva el shell y conserva fallback de assets cuando una versión cambia', () => {
  const worker = source('public/sw.js');
  assert.match(worker, /CACHE_NAME = `\$\{CACHE_PREFIX\}v5`/);
  assert.match(worker, /cache\.match\(request\)\) \|\| response/);
  assert.match(worker, /updateViaCache/);
});
