import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCatalogById } from '../../src/utils/catalogCollection.js';

test('catálogos: índice conserva el primer registro, coerción y claves vacías históricas', () => {
  const records = [{ id: 1, Nombre: 'primero' }, { id: '1', Nombre: 'duplicado' }, { id: '', Nombre: '' }, { Nombre: 'sin ID' }, { id: null }];
  const index = indexCatalogById(records, 'id');
  for (const id of [1, '1', '', undefined, null, 'missing']) {
    assert.equal(index.get(String(id)), records.find(row => String(row.id) === String(id)));
  }
  const updated = [{ id: 1, Nombre: 'actualizado' }];
  assert.equal(indexCatalogById(updated, 'id').get('1').Nombre, 'actualizado');
  assert.equal(index.get('1').Nombre, 'primero');
});

test('catálogos: 1000 descripciones no vuelven a recorrer 750 referencias', () => {
  let scans = 0;
  const records = Array.from({ length: 750 }, (_, id) => ({ get id() { scans++; return id; }, Nombre: `Tipo ${id}` }));
  const index = indexCatalogById(records, 'id');
  for (let id = 0; id < 1000; id++) assert.equal(index.get(String(id % 750)).Nombre, `Tipo ${id % 750}`);
  assert.equal(scans, 750);
});

test('catálogos: render y búsqueda comparten índices memorizados por snapshot', () => {
  const code = readFileSync(new URL('../../src/pages/admin/CatalogsPage.jsx', import.meta.url), 'utf8');
  assert.match(code, /indexCatalogById\(data.deviceTypes, 'TipoDispositivoID'\), \[data.deviceTypes\]/);
  assert.match(code, /indexCatalogById\(data.manufacturers, 'FabricanteID'\), \[data.manufacturers\]/);
  assert.doesNotMatch(code, /records\.find\(/);
});
