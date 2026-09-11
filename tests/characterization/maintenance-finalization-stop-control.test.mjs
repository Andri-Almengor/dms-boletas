import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('el control de finalizaciones conserva el permiso administrativo existente', () => {
  const service = source('backend/src/services/maintenance-finalization-control.service.js');
  const router = source('backend/src/core/action-router.js');
  assert.match(service, /ADMIN_PERMISSION\s*=\s*'USUARIOS_GESTIONAR'/);
  assert.match(service, /function assertAuthorized\(ctx\)/);
  assert.match(router, /else if\(key==='finalize'\) permission='USUARIOS_GESTIONAR'/);
  assert.doesNotMatch(router, /finalization\.stop|finalization\.active/);
});

test('solo PROGRAMADO y EN_PROCESO aparecen como finalizaciones activas', () => {
  const service = source('backend/src/services/maintenance-finalization-control.service.js');
  assert.match(service, /ACTIVE_STATES\s*=\s*new Set\(\['PROGRAMADO', 'EN_PROCESO'\]\)/);
  assert.match(service, /\.filter\(active\)/);
  assert.match(service, /EstadoFinalizacion:\s*'DETENIDO'/);
  assert.match(service, /Estado:\s*'DETENIDO'/);
  assert.match(service, /DETENER_FINALIZACION_MANTENIMIENTO/);
});

test('el worker respeta DETENIDO sin convertirlo en error ni iniciar nuevas unidades', () => {
  const worker = source('backend/src/services/maintenance-staged-finalization.patch.js');
  assert.match(worker, /assertMaintenanceFinalizationNotStopped\(job\.JobID\)/);
  assert.match(worker, /\['COMPLETADO', 'DETENIDO'\]\.includes/);
  assert.match(worker, /jobState === 'DETENIDO'/);
  assert.match(worker, /result\.completed \|\| result\.error \|\| result\.stopped/);
  assert.match(worker, /FINALIZATION_STOPPED_CODE/);
  assert.match(worker, /await import\('\.\/maintenance-finalization-control\.patch\.js'\)/);
});

test('frontend reutiliza lista, finalización y cancelación programada existentes', () => {
  const service = source('src/services/maintenanceFinalization.js');
  assert.match(service, /MODULE_ROUTES\.maintenance\.list/);
  assert.match(service, /finalizationActiveOnly:\s*true/);
  assert.match(service, /MODULE_ROUTES\.maintenance\.finalize/);
  assert.match(service, /stopFinalization:\s*true/);
  assert.match(service, /cancelScheduledMaintenanceFinalization\(\{ maintenanceId: id, sessionToken \}\)/);
});

test('Más expone el panel solo a administrador y la ruta mantiene USUARIOS_GESTIONAR', () => {
  const more = source('src/pages/MorePage.jsx');
  const app = source('src/app/App.jsx');
  const page = source('src/pages/maintenance/MaintenanceFinalizationsPage.jsx');
  assert.match(more, /isAdmin && <MenuRow to="\/mas\/finalizaciones-mantenimiento"/);
  assert.match(app, /path="mas\/finalizaciones-mantenimiento"/);
  assert.match(app, /PermissionRoute permission="USUARIOS_GESTIONAR"><MaintenanceFinalizationsPage/);
  assert.match(page, /Detener finalización/);
  assert.match(page, /Cancelar programación/);
  assert.match(page, /listActiveMaintenanceFinalizations/);
});
