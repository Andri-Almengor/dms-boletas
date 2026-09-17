import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('PostgreSQL elimina el guard de lecturas completas de Sheets del runtime operativo', () => {
  const guard = source('backend/src/services/sheets-memory-guard.service.js');
  assert.match(guard, /postgres-persistence/);
  assert.match(guard, /enabled:\s*false/);
  assert.doesNotMatch(guard, /HEAVY_SHEETS|splitRepositoryRanges|serializeRepositoryRead|repositoryReadTail/);
});

test('el bootstrap conserva límites conservadores de finalización sin reactivar persistencia Sheets', () => {
  const bootstrap = source('backend/src/services/maintenance-finalization-router.bootstrap.js');
  const finalizationImport = bootstrap.indexOf("await import('./maintenance-finalization-resume.patch.js')");
  assert.ok(finalizationImport >= 0);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_WORKER_DELAY_MS \|\|= '2000'/);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_DRIVE_ITEMS_PER_STEP \|\|= '1'/);
  assert.match(bootstrap, /MAINTENANCE_FINALIZATION_DRIVE_MAX_IMAGES_PER_STEP \|\|= '15'/);
  const guard = source('backend/src/services/sheets-memory-guard.service.js');
  assert.doesNotMatch(guard, /sheetsApi|google\.sheets|spreadsheets\./);
});

test('producción conserva límites de proceso y valida el runtime PostgreSQL', () => {
  const backendPackage = source('backend/package.json');
  assert.match(backendPackage, /node --expose-gc --import/);
  assert.match(backendPackage, /test\/storage-boundary\.mjs/);
  assert.match(backendPackage, /db:migrate/);
  assert.match(backendPackage, /test:db/);
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
