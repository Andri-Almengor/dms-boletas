import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function sourceFiles(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

test('runtime persistence no longer depends on GOOGLE_SHEET_ID', async () => {
  const files = await sourceFiles(path.join(ROOT, 'src'));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/GOOGLE_SHEET_ID|env\.sheetId\b/.test(source)) offenders.push(relative(file));
  }
  assert.deepEqual(offenders, []);
});

test('sheets.repository is a PostgreSQL compatibility shim', async () => {
  const source = await readFile(path.join(ROOT, 'src/infra/sheets.repository.js'), 'utf8');
  assert.match(source, /postgres\.repository\.js/);
  assert.doesNotMatch(source, /sheetsApi|google\.sheets|spreadsheets\./);
});

test('Google Sheets remains available only as a generated document/report integration', async () => {
  const source = await readFile(path.join(ROOT, 'src/infra/google.js'), 'utf8');
  assert.match(source, /google\.sheets/);
  assert.match(source, /reportOnly:\s*true/);
  const routeCache = await readFile(path.join(ROOT, 'src/services/sheets-route-read-cache.patch.js'), 'utf8');
  assert.doesNotMatch(routeCache, /spreadsheets\.|responseCache|SheetRevisionTracker/);
});

test('direct Sheets API access is restricted to generated-report integrations', async () => {
  const files = await sourceFiles(path.join(ROOT, 'src'));
  const allow = new Set([
    'src/infra/google.js',
    'src/services/maintenance-dynamic-spreadsheet.service.js',
  ]);
  const offenders = [];
  const sheetsApiPattern = /\bsheetsApi\b|google\.sheets\s*\(|spreadsheets\.(?:values|batchUpdate|get|create|developerMetadata)\b/;
  for (const file of files) {
    const name = relative(file);
    if (allow.has(name)) continue;
    const source = await readFile(file, 'utf8');
    if (sheetsApiPattern.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test('googleapis package is centralized behind the Google integration boundary', async () => {
  const files = await sourceFiles(path.join(ROOT, 'src'));
  const offenders = [];
  for (const file of files) {
    const name = relative(file);
    if (name === 'src/infra/google.js') continue;
    const source = await readFile(file, 'utf8');
    if (/from\s+['"]googleapis['"]|require\(['"]googleapis['"]\)/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test('auth, sessions and permissions use PostgreSQL repositories directly', async () => {
  const auth = await readFile(path.join(ROOT, 'src/services/auth.service.js'), 'utf8');
  const permissions = await readFile(path.join(ROOT, 'src/services/permissions.service.js'), 'utf8');
  assert.match(auth, /auth-postgres\.repository\.js/);
  assert.match(auth, /postgres\.repository\.js/);
  assert.doesNotMatch(auth, /sheets\.repository\.js|readTable\(['"]Usuarios['"]\)|readTable\(['"]Sesiones['"]\)|readTables\(/);
  assert.match(permissions, /postgres\.repository\.js/);
  assert.doesNotMatch(permissions, /sheets\.repository\.js/);
});

test('legacy sheet schema helpers cannot perform Google Sheets I/O', async () => {
  for (const name of ['sheet-columns.service.js', 'sheet-schema.service.js', 'sheets-route-read-cache.patch.js']) {
    const source = await readFile(path.join(ROOT, 'src/services', name), 'utf8');
    assert.doesNotMatch(source, /\bsheetsApi\b|google\.sheets|spreadsheets\./, name);
  }
});
