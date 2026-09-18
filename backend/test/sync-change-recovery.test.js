import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(ROOT, 'src/services/sync-change.service.js'), 'utf8');

test('SyncChanges persistence is PostgreSQL-only after cutover', () => {
  assert.match(source, /from ['"]\.\.\/infra\/postgres\.js['"]/);
  assert.doesNotMatch(source, /sheetsApi|google\.sheets|spreadsheets\.|GOOGLE_SHEET_ID|env\.sheetId/);
  assert.match(source, /INSERT INTO sync_state/);
  assert.match(source, /FROM sync_state WHERE singleton=TRUE/);
});

test('cursor is monotonic database state and deltas are bounded after the requested cursor', () => {
  assert.match(source, /MAX\(cursor\)/);
  assert.match(source, /cursor>\$1 ORDER BY cursor ASC LIMIT \$2/);
  assert.match(source, /invalidCursor:true/);
  assert.match(source, /cursor>tail/);
});

test('business change and SyncChanges append use PostgreSQL transaction boundary', () => {
  assert.match(source, /export async function appendSyncChanges/);
  assert.match(source, /return withTransaction\(async\(\)=>/);
  assert.match(source, /INSERT INTO "SyncChanges"/);
  assert.match(source, /RETURNING cursor/);
});

test('classified changes dedupe primary and derived resource identities before persistence', () => {
  assert.match(source, /const changes=new Map\(\)/);
  assert.match(source, /changes\.set\(\`\$\{change\.resource\}:\$\{entityId\}\`/);
  assert.match(source, /appendSyncChanges\(\[\.\.\.changes\.values\(\)\]\)/);
});

test('unresolved resource identity becomes an explicit INVALIDATE event', () => {
  assert.match(source, /entityIds\.length\?entityIds:\['\*'\]/);
  assert.match(source, /operation:entityId==='\*'\?'INVALIDATE'/);
});

test('sync unsafe state rotates generation in PostgreSQL instead of writing legacy Sheets metadata', () => {
  assert.match(source, /UPDATE sync_state SET generation=\$1,schema_version=\$2,unsafe=TRUE/);
  assert.match(source, /cachedDescriptor=\{enabled:true,generation,schemaVersion:SYNC_SCHEMA_VERSION,unsafe:true/);
});
