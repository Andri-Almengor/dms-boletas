import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  catalogCreatedServerId,
  catalogEntityId,
  catalogLocalRow,
  catalogOperationPriority,
  collectOfflineDependencies,
  isOfflineLocalId,
  offlineCatalogWriteKind,
  prepareOfflineCatalogPayload,
  replaceOfflineReferences,
} from '../../src/services/offlineCatalogDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('reconoce escrituras offline de ubicaciones, fabricantes, modelos y relaciones', () => {
  assert.equal(offlineCatalogWriteKind(['clientLocations.create']), 'clientLocationCreate');
  assert.equal(offlineCatalogWriteKind(['equipmentLocations.create']), 'equipmentLocationCreate');
  assert.equal(offlineCatalogWriteKind(['catalog.manufacturers.create']), 'manufacturerCreate');
  assert.equal(offlineCatalogWriteKind(['catalog.models.create']), 'modelCreate');
  assert.equal(offlineCatalogWriteKind(['catalog.deviceManufacturers.create']), 'deviceManufacturerCreate');
  assert.equal(offlineCatalogWriteKind(['catalog.models.list']), '');
});

test('crea identificadores locales utilizables inmediatamente en el formulario', () => {
  const location = prepareOfflineCatalogPayload('clientLocationCreate', {
    clienteId: 'CLIENTE-1',
    nombre: 'Edificio norte',
  });
  const manufacturer = prepareOfflineCatalogPayload('manufacturerCreate', {
    nombre: 'Axis',
  });

  assert.ok(isOfflineLocalId(location.UbicacionID));
  assert.equal(location.ubicacionId, location.UbicacionID);
  assert.equal(location.id, location.UbicacionID);
  assert.ok(isOfflineLocalId(manufacturer.FabricanteID));
  assert.equal(catalogEntityId('manufacturerCreate', manufacturer), manufacturer.FabricanteID);
});

test('ordena catálogos padres antes de sus registros dependientes', () => {
  assert.ok(catalogOperationPriority('clientLocationCreate') < catalogOperationPriority('equipmentLocationCreate'));
  assert.ok(catalogOperationPriority('manufacturerCreate') < catalogOperationPriority('modelCreate'));
  assert.ok(catalogOperationPriority('manufacturerCreate') < catalogOperationPriority('deviceManufacturerCreate'));
});

test('detecta dependencias locales y reemplaza referencias al recuperar conexión', () => {
  const locationId = 'ubicacion-local-1';
  const manufacturerId = 'fabricante-local-1';
  const payload = {
    ubicacionId: locationId,
    fabricanteId: manufacturerId,
    nested: { ids: [locationId, 'SERVER-1'] },
  };

  assert.deepEqual(
    collectOfflineDependencies('maintenanceDeviceCreate', payload),
    [manufacturerId, locationId],
  );

  assert.deepEqual(replaceOfflineReferences(payload, new Map([
    [locationId, 'UBICACION-SERVER'],
    [manufacturerId, 'FABRICANTE-SERVER'],
  ])), {
    ubicacionId: 'UBICACION-SERVER',
    fabricanteId: 'FABRICANTE-SERVER',
    nested: { ids: ['UBICACION-SERVER', 'SERVER-1'] },
  });
});

test('construye filas locales compatibles y reconoce el identificador del servidor', () => {
  const payload = {
    FabricanteID: 'fabricante-local-1',
    fabricanteId: 'fabricante-local-1',
    nombre: 'Axis',
    activo: true,
  };
  const local = catalogLocalRow('manufacturerCreate', payload);
  const synchronized = catalogLocalRow('manufacturerCreate', {
    ...payload,
    __offlineLocalId: payload.FabricanteID,
  }, {
    FabricanteID: 'FAB-100',
    Nombre: 'Axis',
  });

  assert.equal(local.FabricanteID, 'fabricante-local-1');
  assert.equal(local.OfflinePendiente, true);
  assert.equal(catalogCreatedServerId('manufacturerCreate', synchronized), 'FAB-100');
  assert.equal(synchronized.FabricanteID, 'FAB-100');
  assert.equal(synchronized.OfflineLocalID, 'fabricante-local-1');
});

test('la infraestructura integra mapa de IDs, dependencias y sincronización diferida', () => {
  const core = source('src/services/offlineStoreCore.js');
  const api = source('src/services/moduleApi.js');
  const manager = source('src/components/offline/OfflineSyncManager.jsx');

  assert.match(core, /const DB_VERSION = 3/);
  assert.match(core, /const ID_MAP_STORE = 'idMap'/);
  assert.match(core, /export async function saveOfflineIdMapping/);
  assert.match(core, /export async function resolveOfflineOperationPayload/);
  assert.match(core, /dependsOnLocalIds/);
  assert.match(api, /offlineCatalogWriteKind/);
  assert.match(api, /patchOfflineCatalogCache/);
  assert.match(api, /resolveOfflineOperationPayload/);
  assert.match(api, /saveOfflineIdMapping/);
  assert.match(manager, /OFFLINE_DEPENDENCY_PENDING/);
});
