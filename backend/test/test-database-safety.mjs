import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(import.meta.dirname, '..');

function withoutTestDatabase() {
  const env = { ...process.env, DATABASE_URL: 'postgresql://production.invalid/never-connect' };
  delete env.TEST_DATABASE_URL;
  return env;
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: backendRoot,
    env: withoutTestDatabase(),
    encoding: 'utf8',
  });
}

for (const [name, args] of [
  ['postgres integration suite', ['test/postgres-integration.mjs']],
  ['XLSX import idempotence suite', ['test/xlsx-import-idempotence.mjs']],
  ['test database reset', ['src/scripts/db-test-reset.js']],
]) {
  test(`Stage 6 safety: ${name} refuses DATABASE_URL without TEST_DATABASE_URL`, () => {
    const result = run(args);
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /TEST_DATABASE_URL/);
    assert.doesNotMatch(output, /production\.invalid.*connect/i);
  });
}
