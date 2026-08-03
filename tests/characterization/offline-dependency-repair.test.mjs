import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  collectOfflineIdentityRepairs,
  isIdentityStableOfflineId,
  offlineIdentityEntityType,
  repairOfflineIdentityMappings,
} from '../../src/services/offlineDependencyRepair.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('reconoce únicamente IDs de mantenimiento que el backend conserva', () => {
  assert.equal(isIdentityStableOfflineId('mantenimiento-12345678'), true);
  assert.equal(isIdentityStableOfflineId('dispositivo-12345678'), true);
  assert.equal(isIdentityStableOfflineId('foto-12345678'), true);
  assert.equal(isIdentityStableOfflineId('fabricante-12345678'), false);
  assert.equal(offlineIdentityEntityType('dispositivo-12345678'), 'maintenanceDevice');
});

test('reconstruye mapas faltantes desde payloads y dependencias de la cola', () => {
  const repairs = collectOfflineIdentityRepairs([
    {
      kind: 'maintenanceDeviceCreate',
      dependsOnLocalIds: ['mantenimiento-12345678'],
      payload: {
        maintenanceId: 'mantenimiento-12345678',
        deviceId: 'dispositivo-12345678',
        FabricanteID: 'fabricante-12345678',
      },
    },
    {
      kind: 'maintenanceImage',
      dependsOnLocalIds: ['mantenimiento-12345678', 'dispositivo-12345678'],
      payload: {
        imageId: 'foto-12345678',
        deviceId: 'dispositivo-12345678',
      },
    },
  ], [
    { localId: 'mantenimiento-12345678', serverId: 'mantenimiento-12345678' },
  ]);

  assert.deepEqual(repairs, [
    {
      localId: 'dispositivo-12345678',
      serverId: 'dispositivo-12345678',
      entityType: 'maintenanceDevice',
    },
    {
      localId: 'foto-12345678',
      serverId: 'foto-12345678',
      entityType: 'maintenanceImage',
    },
  ]);
});

test('guarda cada reparación una sola vez', async () => {
  const saved = [];
  const completed = await repairOfflineIdentityMappings({
    operations: [{
      kind: 'maintenanceFinalize',
      dependsOnLocalIds: ['mantenimiento-87654321'],
      payload: { maintenanceId: 'mantenimiento-87654321' },
    }],
    mappings: [],
    saveMapping: async (...args) => saved.push(args),
  });

  assert.equal(completed.length, 1);
  assert.deepEqual(saved, [[
    'mantenimiento-87654321',
    'mantenimiento-87654321',
    'maintenance',
  ]]);
});

test('el runtime ejecuta la reparación antes del gestor de sincronización', () => {
  const runtime = source('src/components/offline/OfflineSyncRuntime.jsx');
  const bridge = source('src/components/offline/OfflineDependencyRepairBridge.jsx');
  assert.match(runtime, /OfflineDependencyRepairBridge/);
  assert.match(runtime, /<OfflineDependencyRepairBridge\s*\/\>/);
  assert.match(runtime, /<OfflineSyncManager\s*\/\>/);
  assert.ok(runtime.indexOf('<OfflineDependencyRepairBridge') < runtime.indexOf('<OfflineSyncManager'));
  assert.match(bridge, /listOfflineIdMappings/);
  assert.match(bridge, /saveOfflineIdMapping/);
  assert.match(bridge, /dms-offline-sync-request/);
  assert.match(bridge, /dms-offline-queue-change/);
});
