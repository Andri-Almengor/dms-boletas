import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('el runtime offline incluye las rutas de mantenimiento antes de visitarlas', () => {
  const runtime = source('src/components/offline/OfflineSyncRuntime.jsx');
  const bundle = source('src/components/offline/OfflineMaintenanceRouteBundle.jsx');

  assert.match(runtime, /OfflineMaintenanceRouteBundle/);
  assert.match(runtime, /<OfflineMaintenanceRouteBundle\s*\/\>/);
  assert.match(bundle, /MaintenanceListPage/);
  assert.match(bundle, /MaintenanceDetailPage/);
  assert.match(bundle, /MaintenanceFormPage/);
  assert.match(bundle, /styles\/routes\/maintenance\.js/);
  assert.match(bundle, /dms-offline-maintenance-routes-ready/);
});

test('el estado offline sustituye visualmente al guardado con un único icono', () => {
  const runtime = source('src/components/offline/OfflineSyncRuntime.jsx');
  const bridge = source('src/components/offline/OfflineStatusSlotBridge.jsx');
  const styles = source('src/styles/offline-compact-indicator.css');

  assert.match(runtime, /offline-compact-indicator\.css/);
  assert.match(runtime, /OfflineStatusSlotBridge/);
  assert.match(bridge, /dms-offline-active/);
  assert.match(bridge, /dms-workflow-status-slot/);
  assert.match(bridge, /window\.addEventListener\('offline'/);
  assert.match(bridge, /window\.addEventListener\('online'/);
  assert.match(styles, /\.offline-status\.is-offline/);
  assert.match(styles, /\.form-recovery-status--saving/);
  assert.match(styles, /\.form-recovery-status--local/);
  assert.match(styles, /body\.dms-offline-active/);
  assert.match(styles, /display:\s*none/);
  assert.match(styles, /cloud_off sustituye al icono de guardado/);
});
