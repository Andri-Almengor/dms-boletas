import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las lecturas completas de Sheets se dividen y serializan para limitar el pico de memoria', () => {
  const guard = source('backend/src/services/sheets-memory-guard.service.js');
  assert.match(guard, /HEAVY_SHEETS/);
  assert.match(guard, /Mantenimiento imagenes/);
  assert.match(guard, /EvidenciasBoleta/);
  assert.match(guard, /splitRepositoryRanges/);
  assert.match(guard, /serializeRepositoryRead/);
  assert.match(guard, /repositoryReadTail = run\.then\(\(\) => undefined, \(\) => undefined\)/);
  assert.match(guard, /global\.gc\?\.\(\)/);
  assert.match(guard, /valueRanges\.push/);
});

test('el guard de memoria queda instalado antes de cargar las rutas y finalización', () => {
  const bootstrap = source('backend/src/services/maintenance-finalization-router.bootstrap.js');
  const guardImport = bootstrap.indexOf("await import('./sheets-memory-guard.service.js')");
  const finalizationImport = bootstrap.indexOf("await import('./maintenance-finalization-resume.patch.js')");
  assert.ok(guardImport >= 0);
  assert.ok(finalizationImport > guardImport);
  assert.match(bootstrap, /SHEETS_GLOBAL_MAX_CONCURRENT_READS \|\|= '1'/);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_WORKER_DELAY_MS \|\|= '2000'/);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_DRIVE_ITEMS_PER_STEP \|\|= '1'/);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_DRIVE_MAX_IMAGES_PER_STEP \|\|= '15'/);
});

test('producción expone GC solo para liberar buffers entre lotes de Sheets', () => {
  const backendPackage = source('backend/package.json');
  assert.match(backendPackage, /node --expose-gc --import/);
  assert.match(backendPackage, /node --check src\/services\/sheets-memory-guard\.service\.js/);
});

test('un fallo aislado de una acción confirma health antes de mostrar reconexión global', () => {
  const availability = source('src/services/backendAvailability.js');
  const guard = availability.indexOf("if (state.status === 'ready' && code !== 'HEALTH_UNAVAILABLE')");
  const probe = availability.indexOf('void probeBackend();', guard);
  const waking = availability.indexOf("status: 'waking'", guard);
  assert.ok(guard >= 0);
  assert.ok(probe > guard);
  assert.ok(waking > probe);
  assert.match(availability, /probeBackend coalesce las pruebas/);
});
