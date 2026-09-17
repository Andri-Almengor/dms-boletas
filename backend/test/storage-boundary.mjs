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

test('runtime persistence no longer depends on GOOGLE_SHEET_ID', async () => {
  const files = await sourceFiles(path.join(ROOT, 'src'));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/GOOGLE_SHEET_ID|env\.sheetId\b/.test(source)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test('sheets.repository is a PostgreSQL compatibility shim', async () => {
  const source = await readFile(path.join(ROOT, 'src/infra/sheets.repository.js'), 'utf8');
  assert.match(source, /postgres\.repository\.js/);
  assert.doesNotMatch(source, /sheetsApi|spreadsheets\.values/);
});

test('Google Sheets remains available only as a document/report integration', async () => {
  const source = await readFile(path.join(ROOT, 'src/infra/google.js'), 'utf8');
  assert.match(source, /google\.sheets/);
  assert.match(source, /reportOnly:\s*true/);
  const routeCache = await readFile(path.join(ROOT, 'src/services/sheets-route-read-cache.patch.js'), 'utf8');
  assert.doesNotMatch(routeCache, /spreadsheets\.values|responseCache|SheetRevisionTracker/);
});


test('direct Sheets API access is restricted to generated-report integrations', async () => {
  const files = await sourceFiles(path.join(ROOT, 'src'));
  const allow = new Set([
    'src/infra/google.js',
    'src/services/maintenance-dynamic-spreadsheet.service.js',
  ]);
  const offenders = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll('\\', '/');
    if (allow.has(relative)) continue;
    const source = await readFile(file, 'utf8');
    if (/\bsheetsApi\b|spreadsheets\.values|spreadsheets\.batchUpdate/.test(source)) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});
