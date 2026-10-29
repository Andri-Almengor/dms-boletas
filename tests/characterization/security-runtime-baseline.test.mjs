import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const file = (name) => readFileSync(path.join(ROOT, name), 'utf8');

test('Node.js LTS parchado se declara coherentemente en frontend, backend y Render', () => {
  const version = file('.node-version').trim();
  assert.equal(version, '24.22.1');
  assert.equal(JSON.parse(file('package.json')).engines.node, version);
  assert.equal(JSON.parse(file('backend/package.json')).engines.node, version);
  assert.equal(JSON.parse(file('package-lock.json')).packages[''].engines.node, version);
  assert.equal(JSON.parse(file('backend/package-lock.json')).packages[''].engines.node, version);
  assert.match(file('render.yaml'), /key: NODE_VERSION\s+value: "24\.22\.1"/);
  for (const workflow of ['.github/workflows/validate.yml', '.github/workflows/stage-0-characterization.yml', '.github/workflows/postgres-stage6-ci.yml']) {
    assert.match(file(workflow), /node-version-file:/);
  }
});

test('RSC vulnerable no se instala en los lockfiles del frontend ni del backend', () => {
  for (const lockfile of ['package-lock.json', 'backend/package-lock.json']) {
    const installed = Object.keys(JSON.parse(file(lockfile)).packages || {});
    assert.equal(installed.some((name) => /(^|\/)react-server-dom-(webpack|turbopack|parcel)(\/|$)/.test(name)), false, lockfile);
  }
});

test('invariantes de autorización, SQL parametrizado y medios protegidos no se modifican', () => {
  const router = file('backend/src/core/action-router.js');
  const db = file('backend/src/infra/postgres.repository.core.js');
  const vault = file('backend/src/modules/password-vault.module.js');
  const media = file('backend/src/services/protected-media-stream.service.js');
  const ai = file('backend/src/ai/agent.tools.js');
  assert.match(router, /auth=await authenticate\(sessionToken\)/);
  assert.match(router, /required\.some\(\(code\)=>auth\.permissions\.includes\(code\)\)/);
  assert.match(db, /if \(!meta\.columns\.includes\(name\)\)/);
  assert.match(db, /\[_writableValue\(idValue\)\]/);
  assert.match(vault, /assertCanRead\(ctx\)/);
  assert.match(media, /crypto\.createHmac\('sha256'/);
  assert.match(media, /crypto\.timingSafeEqual/);
  assert.match(ai, /executeAiTool/);
});

test('CI conserva gate de producción y audita también paquetes de desarrollo', () => {
  const wf = file('.github/workflows/validate.yml');
  assert.match(wf, /run: npm ci\n/);
  assert.match(wf, /run: npm ci --prefix backend/);
  assert.match(wf, /npm audit --json > \.artifacts\/npm-audit-frontend-all\.json/);
  assert.match(wf, /npm --prefix backend audit --json > \.artifacts\/npm-audit-backend-all\.json/);
  assert.match(wf, /run: npm run audit:security/);
  assert.match(wf, /actions\/upload-artifact@v4/);
});
