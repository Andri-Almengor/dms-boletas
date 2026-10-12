import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getOfflineMedia, listOfflineMediaByEntityId, removeOfflineMedia,
  saveOfflineMedia, updateOfflineMedia,
} from '../../src/services/offlineMediaStore.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (name) => readFileSync(path.join(ROOT, name), 'utf8');

test('borrado de evidencia pasa por handler activo y verifica autorización, estado y pertenencia', () => {
  const patch = source('backend/src/services/maintenance-evidence-permissions.patch.js');
  const router = source('backend/src/core/action-router.js');
  const editor = source('src/components/maintenance/MaintenanceEvidenceEditor.jsx');
  const deviceEditor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');

  assert.match(router, /const maintenanceEditPermissions=\['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR'\]/);
  assert.match(router, /maintenanceAutomationHandlers\[key\]/);
  assert.match(patch, /maintenanceProgressChatHandlers\.imageDelete = \(ctx\) => maintenanceDynamicQuestionHandlers\.imageDelete\(ctx\)/);
  assert.match(patch, /maintenanceDynamicQuestionHandlers\.imageDelete = deleteAuthorizedMaintenanceEvidence/);
  assert.match(patch, /maintenanceHandlers\.imageDelete = deleteAuthorizedMaintenanceEvidence/);
  assert.match(patch, /loadMaintenanceEvidenceContext/);
  assert.match(patch, /requestedDeviceId !== deviceId/);
  assert.match(patch, /maintenance\.Estado/);
  assert.match(patch, /MANTENIMIENTOS_EDITAR/);
  assert.match(patch, /BOLETAS_EDITAR/);
  assert.match(patch, /MANTENIMIENTOS_GESTIONAR/);
  assert.match(patch, /MANTENIMIENTOS_ELIMINAR/);
  assert.match(patch, /softDelete\('Mantenimiento imagenes'/);
  assert.match(patch, /ELIMINAR_EVIDENCIA_MANTENIMIENTO/);
  assert.match(editor, /canDeleteEvidence/);
  assert.match(editor, /MODULE_ROUTES\.maintenance\.imageDelete/);
  assert.match(deviceEditor, /MODULE_ROUTES\.maintenance\.imageDelete/);
});

test('IndexedDB recupera fotos pendientes por usuario y dispositivo sin mezclar otros borradores', async () => {
  const oldWindow = globalThis.window;
  globalThis.window = { indexedDB };
  const scope = 'maintenance-evidence-draft:T1:M1:D1';
  const secondScope = 'maintenance-evidence-draft:T2:M1:D1';
  try {
    const photo = new Blob(['contenido de la foto'], { type:'image/jpeg' });
    await saveOfflineMedia({
      mediaId: scope + ':foto-1',
      localId: 'foto-1',
      entityId: scope,
      kind: 'maintenanceEvidenceDraft',
      status: 'DRAFT',
      blob: photo,
      fileName: 'camara.jpg',
      type: 'Antes',
      note: 'Ubicación uno',
      capturedAt:'2026-10-12T14:30:00.000Z',
    });
    await saveOfflineMedia({
      mediaId: secondScope + ':foto-2', localId:'foto-2',
      entityId: secondScope, kind:'maintenanceEvidenceDraft',
      status:'DRAFT', blob: photo, fileName:'privado.jpg',
    });
    const before = await listOfflineMediaByEntityId(scope);
    assert.equal(before.length, 1);
    assert.equal(before[0].localId, 'foto-1');
    assert.equal(before[0].note, 'Ubicación uno');
    assert.equal(await before[0].blob.text(), 'contenido de la foto');

    await updateOfflineMedia(scope + ':foto-1', { note:'Revisado', type:'Despues' });
    const reopened = await listOfflineMediaByEntityId(scope);
    assert.equal(reopened[0].note,'Revisado');
    assert.equal(reopened[0].type,'Despues');
    assert.equal(await reopened[0].blob.text(),'contenido de la foto');

    await removeOfflineMedia(scope + ':foto-1');
    assert.deepEqual(await listOfflineMediaByEntityId(scope),[]);
    assert.equal((await listOfflineMediaByEntityId(secondScope)).length,1);
    await removeOfflineMedia(secondScope + ':foto-2');
    assert.equal(await getOfflineMedia(scope + ':foto-1'),null);
  } finally {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
});

test('cámara conserva referencias temporales hasta copiar el archivo y guarda antes de mostrarlo', () => {
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const store = source('src/services/offlineMediaStore.js');
  assert.match(uploader, /const input = event\.currentTarget/);
  assert.match(uploader, /stabilizeTransientFiles: true/);
  assert.match(uploader, /prepared\.every\(\(item\) => item\.transientFileStabilized\)/);
  assert.match(uploader, /saveOfflineMedia\(/);
  assert.match(uploader, /listOfflineMediaByEntityId\(draftScope\)/);
  assert.match(uploader, /await draftWriteQueueRef\.current/);
  assert.match(uploader, /for \(const localId of uploadedKeys\)/);
  assert.match(uploader, /result\.failed\?\.length/);
  assert.doesNotMatch(uploader, /const selected = Array\.from\(event\.target\.files \|\| \[\]\);\s*event\.target\.value = ''/);
  assert.match(store, /index\('entityId'\)\.getAll\(id\)/);
});
