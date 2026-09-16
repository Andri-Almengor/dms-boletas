import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../backend/src/infra/sheets.repository.js', import.meta.url), 'utf8');
const filterRows = new Function(`${source.slice(source.indexOf('export function filterRows('), source.indexOf('export function sheetsRepositorySnapshot')).replace('export ', '')}; return filterRows;`)();
function referenceFilterRows(rows, payload = {}, searchFields = []) {
  const search = String(payload.search || payload.q || '').trim().toLowerCase();
  let result = rows.filter((row) => {
    if (payload.activo !== undefined && String(row.Activo).toLowerCase() !== String(payload.activo).toLowerCase()) return false;
    if (payload.estado && String(row.Estado || '').toUpperCase() !== String(payload.estado).toUpperCase()) return false;
    if (payload.clienteId && String(row.ClienteID || row.ClienteRef || '') !== String(payload.clienteId)) return false;
    if (search && !searchFields.some((field) => String(row[field] || '').toLowerCase().includes(search))) return false;
    return true;
  });
  if (payload.sortBy) result.sort((a, b) => String(a[payload.sortBy] || '').localeCompare(String(b[payload.sortBy] || ''), 'es') * (String(payload.sortDir).toLowerCase() === 'desc' ? -1 : 1));
  const page = Math.max(1, Number(payload.page || 1));
  const pageSize = Math.min(1000, Math.max(1, Number(payload.pageSize || 100)));
  const total = result.length;
  result = result.slice((page - 1) * pageSize, page * pageSize);
  return { items: result.map(({ __rowNumber, ...row }) => row), total, page, pageSize };
}

const rows = Array.from({ length: 211 }, (_, i) => ({
  __rowNumber: i + 2, id: i, Nombre: ['Árbol', 'Beta', 'cámara', '', null][i % 5],
  Activo: [true, false, 'TRUE', undefined][i % 4], Estado: ['PENDIENTE', 'FINALIZADA', ''][i % 3],
  ClienteID: i % 2 ? 'C1' : '', ClienteRef: 'C2',
}));

test('paginación compartida: conserva resultados, orden y entradas históricas sin mutar filas', () => {
  const before = structuredClone(rows);
  for (const sortBy of [undefined, 'Nombre', 'id']) {
    for (const sortDir of ['asc', 'desc']) {
      for (const page of [1, 2, 30, 1.5, 'invalid', Infinity]) {
        for (const pageSize of [1, 50, 3.7, 'invalid', 2000]) {
          for (const filters of [{}, { activo: false }, { estado: 'pendiente' }, { clienteId: 'C2' }, { q: 'CÁM', activo: 'TRUE' }]) {
            const payload = { sortBy, sortDir, page, pageSize, ...filters };
            assert.deepEqual(filterRows(rows, payload, ['Nombre']), referenceFilterRows(rows, payload, ['Nombre']));
          }
        }
      }
    }
  }
  assert.deepEqual(rows, before);
});

test('paginación sin ordenar: recorre una vez y materializa únicamente la página', () => {
  let visited = 0;
  const iterable = { *[Symbol.iterator]() { for (const row of rows) { visited++; yield row; } } };
  const result = filterRows(iterable, { page: 2, pageSize: 10 });
  assert.equal(visited, rows.length);
  assert.equal(result.total, rows.length);
  assert.deepEqual(result.items.map(row => row.id), Array.from({length: 10}, (_, i) => i + 10));
  assert.ok(result.items.every(row => !('__rowNumber' in row)));
});
