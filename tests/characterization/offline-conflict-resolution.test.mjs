import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildOfflineConflictMetadata,
  detectOfflineFieldConflicts,
  offlineConflictPatch,
  sameOfflineValue,
} from '../../src/services/offlineConflictDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('captura únicamente los campos realmente modificados por una operación offline', () => {
  const payload = {
    maintenanceId: 'm-1',
    TituloMantenimiento: 'Inspección mensual',
    descripcion: 'Revisión de cámaras',
  };
  const base = {
    MantenimientoID: 'm-1',
    TituloMantenimiento: 'Inspección anterior',
    DescripcionGeneral: 'Revisión general',
    Cliente: 'Cliente sin cambios',
    FechaActualizacion: '2026-07-31T10:00:00.000Z',
  };

  assert.deepEqual(offlineConflictPatch('maintenanceUpdate', payload), {
    TituloMantenimiento: 'Inspección mensual',
    DescripcionGeneral: 'Revisión de cámaras',
  });

  const metadata = buildOfflineConflictMetadata('maintenanceUpdate', payload, base);
  assert.equal(metadata.entityId, 'm-1');
  assert.deepEqual(metadata.fields, ['TituloMantenimiento', 'DescripcionGeneral']);
  assert.deepEqual(metadata.baseValues, {
    TituloMantenimiento: 'Inspección anterior',
    DescripcionGeneral: 'Revisión general',
  });
});

test('permite combinar cambios de campos diferentes y bloquea la colisión real', () => {
  const metadata = {
    fields: ['TituloMantenimiento', 'DescripcionGeneral'],
    baseValues: {
      TituloMantenimiento: 'Título original',
      DescripcionGeneral: 'Descripción original',
    },
  };

  const unrelatedServerChange = {
    TituloMantenimiento: 'Título original',
    DescripcionGeneral: 'Descripción original',
    ResponsableIDsJSON: '["otro-tecnico"]',
  };
  assert.deepEqual(detectOfflineFieldConflicts(metadata, unrelatedServerChange), []);

  const overlappingServerChange = {
    ...unrelatedServerChange,
    DescripcionGeneral: 'Descripción modificada por otro técnico',
  };
  assert.deepEqual(detectOfflineFieldConflicts(metadata, overlappingServerChange), ['DescripcionGeneral']);
});

test('normaliza JSON y arreglos para evitar conflictos falsos por formato', () => {
  assert.equal(sameOfflineValue('["a","b"]', ['a', 'b']), true);
  assert.equal(sameOfflineValue('{"b":2,"a":1}', { a: 1, b: 2 }), true);
  assert.equal(sameOfflineValue(' Pendiente ', 'Pendiente'), true);
});

test('el backend valida la precondición y limpia la metainformación antes del handler', () => {
  const service = source('backend/src/services/offline-conflict.service.js');
  const router = source('backend/src/core/action-router.js');

  assert.match(service, /export async function assertOfflineWritePrecondition/);
  assert.match(service, /export function detectOfflineFieldConflicts/);
  assert.match(service, /OFFLINE_SYNC_CONFLICT/);
  assert.match(service, /SERVER_RECORD_MISSING/);
  assert.match(service, /CONCURRENT_UPDATE/);
  assert.match(service, /export function stripOfflineConflictMetadata/);
  assert.match(router, /await assertOfflineWritePrecondition\(route, normalizedPayload\)/);
  assert.match(router, /stripOfflineConflictMetadata\(normalizedPayload\)/);
});

test('la integración conserva conflicto, resolución explícita y bloqueo de finalización', () => {
  const moduleApi = source('src/services/moduleApi.js');
  const store = source('src/services/offlineStoreCore.js');
  const manager = source('src/components/offline/OfflineSyncManager.jsx');
  const css = source('src/styles/offline.css');

  assert.match(moduleApi, /buildOfflineConflictMetadata/);
  assert.match(moduleApi, /__offlineConflict/);
  assert.match(moduleApi, /refreshConflictServerVersion/);
  assert.match(store, /conflictDetails/);
  assert.match(store, /conflicts:/);
  assert.match(store, /conflict: existing\?\.conflict \|\| conflict \|\| null/);
  assert.match(manager, /isOfflineConflictError/);
  assert.match(manager, /Conservar mis cambios/);
  assert.match(manager, /Usar versión del servidor/);
  assert.match(css, /offline-status\.is-conflict/);
});
