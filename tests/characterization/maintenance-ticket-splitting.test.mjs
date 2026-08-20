import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('los mantenimientos grandes se dividen en varias boletas con límites conservadores', () => {
  const contents = source('backend/src/services/maintenance-fast-ticket-generation.service.js');

  assert.match(contents, /MAINTENANCE_TICKET_MAX_DEVICES', 12/);
  assert.match(contents, /MAINTENANCE_TICKET_MAX_EVIDENCES', 18/);
  assert.match(contents, /MAINTENANCE_TICKET_MAX_TEXT_CHARS', 24_000/);
  assert.match(contents, /function splitBaseGroup\(bundle, baseGroup\)/);
  assert.match(contents, /nextDeviceCount > limits\.maxDevices/);
  assert.match(contents, /nextEvidenceCount > limits\.maxEvidences/);
  assert.match(contents, /nextTextChars > limits\.maxEstimatedTextChars/);
});

test('la primera parte conserva el identificador histórico y las siguientes son deterministas', () => {
  const contents = source('backend/src/services/maintenance-fast-ticket-generation.service.js');

  assert.match(contents, /key: index === 0 \? baseGroup\.key : `\$\{baseGroup\.key\}\|parte:\$\{index \+ 1\}`/);
  assert.match(contents, /partIndex: index \+ 1/);
  assert.match(contents, /partCount,/);
  assert.match(contents, /Parte \$\{group\.partIndex\} de \$\{group\.partCount\}/);
});

test('cada parte lleva únicamente sus evidencias y el resultado informa la división', () => {
  const contents = source('backend/src/services/maintenance-fast-ticket-generation.service.js');

  assert.match(contents, /function groupImages\(bundle, group\)/);
  assert.match(contents, /const allowed = new Set\(group\.imageIds\.map\(String\)\)/);
  assert.match(contents, /evidenceCount: groupImages\(bundle, group\)\.length/);
  assert.match(contents, /splitLimits: MAINTENANCE_TICKET_SPLIT_LIMITS/);
  assert.match(contents, /splitLargeGroups: true/);
});
