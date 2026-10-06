import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeFileReadError } from '../../src/utils/fileEncoding.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('convierte NotReadableError del navegador en un error accionable en español', () => {
  const browserError = new Error(
    'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.',
  );
  browserError.name = 'NotReadableError';

  const error = normalizeFileReadError(browserError, { name: 'foto-camara.jpg' });

  assert.equal(error.name, 'NotReadableError');
  assert.equal(error.code, 'EVIDENCE_FILE_NOT_READABLE');
  assert.match(error.message, /foto-camara\.jpg/);
  assert.match(error.message, /Vuelva a tomar o seleccionar la evidencia/);
  assert.doesNotMatch(error.message, /requested file could not be read/i);
});

test('el editor conserva acceso del selector hasta estabilizar evidencias transitorias', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const media = source('src/utils/evidenceMedia.js');

  assert.match(editor, /const input = event\.currentTarget;/);
  assert.match(editor, /stabilizeTransientFiles: true/);
  assert.match(editor, /prepared\.every\(\(item\) => item\.transientFileStabilized\)/);
  assert.doesNotMatch(editor, /const files = Array\.from\(event\.target\.files \|\| \[\]\);\s*event\.target\.value = '';/);

  assert.match(media, /export async function stabilizeTransientEvidenceFile/);
  assert.match(media, /file\.arrayBuffer\(\)/);
  assert.match(media, /maxBytes = EVIDENCE_IMAGE_MAX_BYTES/);
  assert.match(media, /normalizeFileReadError\(error, file\)/);
  assert.match(media, /transientFileStabilized: snapshot\.stabilized/);
});

test('el cambio no altera los permisos backend de creación ni evidencias de mantenimiento', () => {
  const router = source('backend/src/core/action-router.js');

  assert.match(router, /const maintenanceEditPermissions=\['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR'\]/);
  assert.match(router, /deviceCreate:\['maintenance\.devices\.create'/);
  assert.match(router, /imageUpload:\['maintenance\.images\.upload'/);
  assert.match(router, /let permission=maintenanceEditPermissions/);
});
