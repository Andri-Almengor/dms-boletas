import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergePaginatedItems,
  paginationMeta,
} from '../../src/utils/paginatedCollection.js';

test('mergePaginatedItems conserva el orden y sustituye registros repetidos', () => {
  const current = [
    { id: 'A', value: 1 },
    { id: 'B', value: 2 },
  ];
  const incoming = [
    { id: 'B', value: 20 },
    { id: 'C', value: 3 },
  ];

  assert.deepEqual(
    mergePaginatedItems(current, incoming, (item) => item.id),
    [
      { id: 'A', value: 1 },
      { id: 'B', value: 20 },
      { id: 'C', value: 3 },
    ],
  );
});

test('mergePaginatedItems permite claves de respaldo específicas por origen', () => {
  const merged = mergePaginatedItems(
    [{ name: 'actual' }],
    [{ name: 'nuevo' }],
    (item, index, source) => item.id || `${source}-${index}`,
  );

  assert.deepEqual(merged, [{ name: 'actual' }, { name: 'nuevo' }]);
});

test('paginationMeta utiliza el total entregado por el servidor', () => {
  assert.deepEqual(
    paginationMeta({ total: 120 }, { loadedCount: 50, incomingCount: 50, pageSize: 50 }),
    { total: 120, hasMore: true, hasServerTotal: true },
  );
  assert.deepEqual(
    paginationMeta({ total: 120 }, { loadedCount: 120, incomingCount: 20, pageSize: 50 }),
    { total: 120, hasMore: false, hasServerTotal: true },
  );
});

test('paginationMeta conserva el fallback histórico cuando no existe total', () => {
  assert.deepEqual(
    paginationMeta({}, { loadedCount: 80, incomingCount: 40, pageSize: 40 }),
    { total: 80, hasMore: true, hasServerTotal: false },
  );
  assert.deepEqual(
    paginationMeta({}, { loadedCount: 93, incomingCount: 13, pageSize: 40 }),
    { total: 93, hasMore: false, hasServerTotal: false },
  );
});

test('paginationMeta ignora totales negativos o no numéricos', () => {
  assert.deepEqual(
    paginationMeta({ total: -1 }, { loadedCount: 10, incomingCount: 10, pageSize: 10 }),
    { total: 10, hasMore: true, hasServerTotal: false },
  );
  assert.deepEqual(
    paginationMeta({ total: 'desconocido' }, { loadedCount: 4, incomingCount: 4, pageSize: 10 }),
    { total: 4, hasMore: false, hasServerTotal: false },
  );
});
