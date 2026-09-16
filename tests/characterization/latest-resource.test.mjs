import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbortError } from '../../src/services/requestErrors.js';

const source = readFileSync(new URL('../../src/hooks/useLatestResource.js', import.meta.url), 'utf8');
function harness() {
  const states = [];
  const writes = [];
  let effect;
  const useState = initial => {
    const i = states.push(initial) - 1;
    return [initial, value => { states[i] = value; writes.push([i, value]); }];
  };
  const hook = new Function('useState', 'useRef', 'useCallback', 'useEffect', 'isAbortError',
    source.replace(/^import .*;\n/gm, '').replace('export default ', '') + '; return useLatestResource;'
  )(useState, value => ({ current: value }), fn => fn, fn => { effect = fn; }, isAbortError);
  const requests = [];
  const resource = hook(signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), 'Fallback');
  const cleanup = effect();
  return { resource, requests, states, writes, cleanup };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('recurso: una carga al montar, cancela la anterior e ignora respuestas fuera de orden', async () => {
  const h = harness();
  assert.equal(h.requests.length, 1);
  const second = h.resource.load();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[1].resolve({ total: 2 });
  await second;
  h.requests[0].resolve({ total: 1 });
  await flush();
  assert.deepEqual(h.states, [{ total: 2 }, false, '']);
});

test('recurso: errores/finally antiguos no ocultan la carga nueva ni reemplazan su error', async () => {
  const h = harness();
  const second = h.resource.load();
  h.requests[0].reject(new Error('old'));
  await flush();
  assert.deepEqual(h.states, [null, true, '']);
  h.requests[1].reject(new Error('current'));
  await second;
  assert.deepEqual(h.states, [null, false, 'current']);
});

test('recurso: desmontar aborta y no vuelve a escribir estado aunque el transporte ignore abort', async () => {
  const h = harness();
  h.cleanup();
  assert.equal(h.requests[0].signal.aborted, true);
  const count = h.writes.length;
  h.requests[0].resolve({ stale: true });
  await flush();
  assert.equal(h.writes.length, count);
});

test('ambos dashboards usan el recurso y pasan señal al transporte compartido', () => {
  for (const name of ['Ticket', 'Maintenance']) {
    const code = readFileSync(new URL(`../../src/components/metrics/${name}MetricsDashboard.jsx`, import.meta.url), 'utf8');
    assert.match(code, /useLatestResource\(/);
    assert.match(code, /filters, sessionToken, \{ signal \}/);
    assert.doesNotMatch(code, /setData\(await requestAvailable/);
  }
});
