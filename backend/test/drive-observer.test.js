import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readdir, readFile } from 'node:fs/promises';
import { createObservedDriveApi, OBSERVED_DRIVE_METHODS } from '../src/infra/drive-observer.js';

function fixture(implementation) {
  const raw = {};
  for (const [name, methods] of Object.entries(OBSERVED_DRIVE_METHODS)) {
    const resource = {};
    for (const method of methods) {
      Object.defineProperty(resource, method, { value: function (...args) {
        assert.equal(this, resource, `${name}.${method}: correct this`);
        return implementation(name, method, args);
      }, writable: false, configurable: false });
    }
    Object.defineProperty(raw, name, { value: Object.freeze(resource), writable: false, configurable: false });
  }
  return Object.freeze(raw);
}

test('frozen files reproduces the old Proxy invariant and works through a plain facade', async () => {
  const response = { data: { id: 'file' } };
  const raw = fixture(() => Promise.resolve(response));
  const broken = new Proxy(raw, { get(target, property) { return new Proxy(target[property], {}); } });
  assert.throws(() => broken.files.create({}), /proxy.*files|files.*proxy/i);
  const calls = [];
  const safe = createObservedDriveApi(raw, { record: (metric) => calls.push(metric) });
  assert.equal(await safe.files.create({}), response);
  assert.equal(calls.length, 1);
  assert.equal(raw.files, Object.getOwnPropertyDescriptor(raw, 'files').value);
});

for (const [resource, methods] of Object.entries(OBSERVED_DRIVE_METHODS)) {
  for (const method of methods) {
    for (const outcome of ['resolve', 'reject', 'throw']) {
      test(`${resource}.${method} ${outcome}: arguments, this, identity and one metric`, async () => {
        const stream = Readable.from(['evidence']);
        const args = [{ media: { body: stream }, supportsAllDrives: true }, { responseType: 'stream', signal: new AbortController().signal }];
        const response = { data: stream };
        const failure = new Error('Drive fixture');
        let operations = 0;
        const raw = fixture((actualResource, actualMethod, received) => {
          operations++;
          assert.equal(actualResource, resource);
          assert.equal(actualMethod, method);
          assert.equal(received[0], args[0]);
          assert.equal(received[1], args[1]);
          if (outcome === 'throw') throw failure;
          return outcome === 'reject' ? Promise.reject(failure) : Promise.resolve(response);
        });
        const calls = [];
        let clock = 10;
        const safe = createObservedDriveApi(raw, { record: (metric) => calls.push(metric), now: () => clock++ });
        if (outcome === 'throw') assert.throws(() => safe[resource][method](...args), (error) => error === failure);
        else if (outcome === 'reject') await assert.rejects(safe[resource][method](...args), (error) => error === failure);
        else assert.equal(await safe[resource][method](...args), response);
        assert.equal(operations, 1);
        assert.deepEqual(calls, [{ count: 1, durationMs: 1 }]);
        assert.equal(stream.readableFlowing, null, 'wrapper does not consume the stream');
      });
    }
  }
}

test('all current Drive call sites are covered by explicit instrumentation', async () => {
  const root = new URL('../src/', import.meta.url);
  const used = new Set();
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/\bdriveApi\.(\w+)\.(\w+)\s*\(/g)) used.add(`${match[1]}.${match[2]}`);
  }
  const wrapped = new Set(Object.entries(OBSERVED_DRIVE_METHODS).flatMap(([resource, methods]) => methods.map((method) => `${resource}.${method}`)));
  assert.deepEqual([...used].sort(), [...wrapped].sort());
});
