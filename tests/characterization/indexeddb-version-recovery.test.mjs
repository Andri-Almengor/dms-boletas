import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INDEXED_DB_COMPATIBILITY,
  compatibleIndexedDbVersion,
  installIndexedDbVersionGuard,
  isIndexedDbVersionError,
} from '../../src/services/indexedDbVersionGuard.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('eleva solicitudes antiguas de la base offline a la versión vigente', () => {
  assert.equal(INDEXED_DB_COMPATIBILITY.coreDatabaseName, 'dms-boletas-offline');
  assert.equal(INDEXED_DB_COMPATIBILITY.coreDatabaseVersion, 3);
  assert.equal(compatibleIndexedDbVersion('dms-boletas-offline', 2), 3);
  assert.equal(compatibleIndexedDbVersion('dms-boletas-offline', 3), 3);
  assert.equal(compatibleIndexedDbVersion('otra-base', 2), 2);
});

test('el guardián intercepta únicamente la apertura incompatible', () => {
  const calls = [];
  class FakeIndexedDbFactory {
    open(...args) {
      calls.push(args);
      return { args };
    }
  }

  const scope = { indexedDB: new FakeIndexedDbFactory() };
  assert.equal(installIndexedDbVersionGuard(scope), true);

  scope.indexedDB.open('dms-boletas-offline', 2);
  scope.indexedDB.open('dms-boletas-offline', 3);
  scope.indexedDB.open('dms-boletas-form-drafts', 1);
  scope.indexedDB.open('dms-boletas-offline');

  assert.deepEqual(calls, [
    ['dms-boletas-offline', 3],
    ['dms-boletas-offline', 3],
    ['dms-boletas-form-drafts', 1],
    ['dms-boletas-offline'],
  ]);
});

test('reconoce el VersionError reportado por el navegador móvil', () => {
  assert.equal(isIndexedDbVersionError({
    name: 'VersionError',
    message: 'The requested version (2) is less than the existing version (3).',
  }), true);
  assert.equal(isIndexedDbVersionError(new Error('Fallo de red')), false);
});

test('la protección se instala antes de cargar los módulos offline', () => {
  const main = source('src/main.jsx');
  const guardImport = main.indexOf("import './services/indexedDbVersionGuard'");
  const maintenanceImport = main.indexOf("import './services/maintenanceRoutes'");
  const operationalImport = main.indexOf("import './services/operationalRoutes'");

  assert.ok(guardImport >= 0);
  assert.ok(guardImport < maintenanceImport);
  assert.ok(guardImport < operationalImport);
  assert.match(main, /serviceWorker\.addEventListener\('controllerchange'/);
  assert.match(main, /window\.location\.reload\(\)/);
  assert.match(main, /updateViaCache:\s*'none'/);
});

test('el Service Worker renueva el shell y elimina cachés incompatibles', () => {
  const worker = source('public/sw.js');
  const core = source('src/services/offlineStoreCore.js');

  assert.match(core, /const DB_VERSION = 3/);
  assert.match(worker, /CACHE_NAME = `\$\{CACHE_PREFIX\}v5`/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.match(worker, /DMS_SW_ACTIVATED/);
  assert.match(worker, /\['script', 'style'\][\s\S]*codeAssetResponse/);
});
