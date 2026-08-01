import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { replaceOfflineReferences } from '../../src/services/offlineReferenceMap.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('reemplaza IDs locales dentro de payloads anidados sin alterar los demás valores', () => {
  const result = replaceOfflineReferences({
    fabricanteId: 'local-fabricante-1',
    modelo: {
      fabricante: 'local-fabricante-1',
      tags: ['activo', 'local-modelo-2'],
    },
  }, {
    'local-fabricante-1': 'FAB-100',
    'local-modelo-2': 'MOD-200',
  });

  assert.deepEqual(result, {
    fabricanteId: 'FAB-100',
    modelo: {
      fabricante: 'FAB-100',
      tags: ['activo', 'MOD-200'],
    },
  });
});

test('la cola prioriza catálogos antes de mantenimientos y evidencias', () => {
  const core = source('src/services/offlineStoreCore.js');
  assert.match(core, /catalogLocationCreate:\s*5/);
  assert.match(core, /catalogManufacturerCreate:\s*6/);
  assert.match(core, /catalogModelCreate:\s*7/);
  assert.match(core, /maintenanceCreate:\s*10/);
  assert.match(core, /maintenanceDeviceCreate:\s*30/);
});

test('moduleApi admite crear ubicaciones, fabricantes y modelos sin conexión', () => {
  const api = source('src/services/moduleApi.js');
  assert.match(api, /catalogLocationCreate/);
  assert.match(api, /catalogEquipmentLocationCreate/);
  assert.match(api, /catalogManufacturerCreate/);
  assert.match(api, /catalogModelCreate/);
  assert.match(api, /resolveOfflineReferences/);
  assert.match(api, /saveOfflineIdMapping/);
  assert.match(api, /patchCatalogCache/);
});
