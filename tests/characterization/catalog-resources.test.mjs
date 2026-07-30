import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  includeSelectedCatalogItem,
  mergeCatalogItems,
  stableCatalogPayload,
} from '../../src/utils/catalogCollection.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la clave de catálogo es estable aunque cambie el orden de propiedades', () => {
  const first = stableCatalogPayload({ page: 1, filters: { activo: true, q: 'axis' }, ids: ['2', '1'] });
  const second = stableCatalogPayload({ ids: ['2', '1'], filters: { q: 'axis', activo: true }, page: 1 });
  assert.equal(first, second);
});

test('une páginas por identificador conservando orden y reemplazando registros', () => {
  const current = [{ id: '1', name: 'Uno' }, { id: '2', name: 'Dos' }];
  const incoming = [{ id: '2', name: 'Dos actualizado' }, { id: '3', name: 'Tres' }];
  const merged = mergeCatalogItems(current, incoming, (item) => item.id);

  assert.deepEqual(merged.map((item) => item.id), ['1', '2', '3']);
  assert.equal(merged[1].name, 'Dos actualizado');
});

test('conserva el valor seleccionado aunque no pertenezca a la página actual', () => {
  const items = [{ id: '1', name: 'Primero' }];
  const selected = { id: '99', name: 'Cliente histórico' };
  const result = includeSelectedCatalogItem(items, selected, (item) => item.id);

  assert.deepEqual(result.map((item) => item.id), ['1', '99']);
  assert.equal(result[1].name, 'Cliente histórico');
});

test('el servicio aplica caché por sesión, ruta y payload sin cambiar requestAvailable', () => {
  const service = source('src/services/catalogResource.js');

  assert.match(service, /const DEFAULT_CATALOG_TTL_MS = 5 \* 60_000/);
  assert.match(service, /catalogRequestKey/);
  assert.match(service, /sessionToken/);
  assert.match(service, /stableCatalogPayload/);
  assert.match(service, /requestAvailable/);
  assert.match(service, /normalizeItems/);
  assert.match(service, /clearCatalogResourceCache/);
  assert.match(service, /signal\?\.aborted/);
});

test('los selectores conservan búsqueda local y admiten búsqueda remota opcional', () => {
  const select = source('src/components/forms/DependentSelect.jsx');

  assert.match(select, /normalizeSearch/);
  assert.match(select, /onSearch/);
  assert.match(select, /searchDelay = 300/);
  assert.match(select, /searchMinLength = 0/);
  assert.match(select, /selectedLabel = ''/);
  assert.match(select, /Promise\.resolve\(onSearch\(term\)\)/);
  assert.match(select, /No se encontraron coincidencias\./);
});
