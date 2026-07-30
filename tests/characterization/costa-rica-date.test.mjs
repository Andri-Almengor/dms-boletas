import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COSTA_RICA_TIME_ZONE,
  costaRicaDateKey,
  formatCostaRicaDate,
  parseCostaRicaDate,
  todayInCostaRica,
} from '../../src/utils/costaRicaDate.js';

test('la zona horaria operativa continúa siendo Costa Rica', () => {
  assert.equal(COSTA_RICA_TIME_ZONE, 'America/Costa_Rica');
});

test('todayInCostaRica respeta el cambio de día a las 06:00 UTC', () => {
  assert.equal(todayInCostaRica(new Date('2026-07-30T05:59:59.000Z')), '2026-07-29');
  assert.equal(todayInCostaRica(new Date('2026-07-30T06:00:00.000Z')), '2026-07-30');
});

test('una fecha civil YYYY-MM-DD no retrocede al día anterior', () => {
  assert.equal(costaRicaDateKey('2026-07-29'), '2026-07-29');
  assert.equal(costaRicaDateKey('2026-07-29T00:00:00Z'), '2026-07-29');
});

test('parseCostaRicaDate acepta Date y rechaza valores inválidos', () => {
  const original = new Date('2026-07-29T18:00:00Z');
  assert.equal(parseCostaRicaDate(original), original);
  assert.equal(parseCostaRicaDate('fecha-invalida'), null);
  assert.equal(costaRicaDateKey('fecha-invalida'), '');
});

test('el formato vacío mantiene el texto de interfaz actual', () => {
  assert.equal(formatCostaRicaDate(''), 'Sin fecha');
});
