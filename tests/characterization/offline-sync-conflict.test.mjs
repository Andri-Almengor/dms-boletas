import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveConflictAwarePayload } from '../../backend/src/services/sync-conflict.service.js';
import {
  maintenanceDeviceSyncBase,
  maintenanceImageSyncBase,
  maintenanceSyncBase,
} from '../../src/services/maintenanceSyncBase.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const FIELDS = {
  NombreDispositivo: ['nombre'],
  Observacion: ['observacion'],
  RespuestasJSON: ['respuestas'],
};

function syncBase(snapshot, overrides = {}) {
  return {
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
    maintenanceId: 'MNT-1',
    updatedAt: '2026-07-30T10:00:00.000Z',
    snapshot: {
      ...snapshot,
      FechaActualizacion: '2026-07-30T10:00:00.000Z',
    },
    ...overrides,
  };
}

test('permite la escritura completa cuando la versión del servidor no cambió', () => {
  const payload = {
    deviceId: 'DEV-1',
    NombreDispositivo: 'Cámara norte',
    Observacion: 'Limpia',
    __syncBase: syncBase({ NombreDispositivo: 'Cámara', Observacion: '' }),
  };
  const result = resolveConflictAwarePayload({
    payload,
    before: { FechaActualizacion: '2026-07-30T10:00:00.000Z' },
    fieldAliases: FIELDS,
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
    maintenanceId: 'MNT-1',
  });
  assert.equal(result, payload);
});

test('combina campos distintos sin reenviar valores locales obsoletos', () => {
  const payload = {
    deviceId: 'DEV-1',
    NombreDispositivo: 'Cámara',
    Observacion: 'Lente ajustado',
    __syncBase: syncBase({ NombreDispositivo: 'Cámara', Observacion: '' }),
  };
  const result = resolveConflictAwarePayload({
    payload,
    before: {
      NombreDispositivo: 'Cámara renombrada por otro técnico',
      Observacion: '',
      FechaActualizacion: '2026-07-30T11:00:00.000Z',
    },
    fieldAliases: FIELDS,
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
    maintenanceId: 'MNT-1',
  });
  assert.equal(result.Observacion, 'Lente ajustado');
  assert.equal(result.NombreDispositivo, undefined);
  assert.equal(result.deviceId, 'DEV-1');
});

test('bloquea un cambio sobre el mismo campo y expone ambas versiones', () => {
  const payload = {
    deviceId: 'DEV-1',
    Observacion: 'Versión local',
    __syncBase: syncBase({ NombreDispositivo: 'Cámara', Observacion: 'Original' }),
  };
  assert.throws(() => resolveConflictAwarePayload({
    payload,
    before: {
      NombreDispositivo: 'Cámara',
      Observacion: 'Versión del servidor',
      FechaActualizacion: '2026-07-30T11:00:00.000Z',
      ActualizadoPor: 'TECNICO-2',
    },
    fieldAliases: FIELDS,
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
    maintenanceId: 'MNT-1',
  }), (error) => {
    assert.equal(error.code, 'SYNC_CONFLICT');
    assert.equal(error.status, 409);
    assert.deepEqual(error.details.conflictFields, ['Observacion']);
    assert.equal(error.details.localRecord.Observacion, 'Versión local');
    assert.equal(error.details.serverRecord.Observacion, 'Versión del servidor');
    return true;
  });
});

test('mantener cambios locales conserva solo campos modificados y metadatos de preguntas', () => {
  const payload = {
    deviceId: 'DEV-1',
    RespuestasJSON: JSON.stringify({ limpieza: 'Sí' }),
    questionDetails: [{ key: 'limpieza', label: 'Limpieza' }],
    respuestasDetalle: [{ key: 'limpieza', label: 'Limpieza' }],
    __conflictResolution: 'KEEP_LOCAL',
    __syncBase: syncBase({ RespuestasJSON: JSON.stringify({ limpieza: 'No' }) }),
  };
  const result = resolveConflictAwarePayload({
    payload,
    before: {
      RespuestasJSON: JSON.stringify({ limpieza: 'Pendiente' }),
      FechaActualizacion: '2026-07-30T11:00:00.000Z',
    },
    fieldAliases: FIELDS,
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
    maintenanceId: 'MNT-1',
  });
  assert.equal(result.RespuestasJSON, payload.RespuestasJSON);
  assert.deepEqual(result.questionDetails, payload.questionDetails);
  assert.deepEqual(result.respuestasDetalle, payload.respuestasDetalle);
});

test('rechaza una base de sincronización perteneciente a otro registro', () => {
  assert.throws(() => resolveConflictAwarePayload({
    payload: {
      deviceId: 'DEV-1',
      Observacion: 'Cambio',
      __syncBase: syncBase({ Observacion: '' }, { entityId: 'DEV-2' }),
    },
    before: { Observacion: '', FechaActualizacion: '2026-07-30T11:00:00.000Z' },
    fieldAliases: FIELDS,
    entityType: 'maintenanceDevice',
    entityId: 'DEV-1',
  }), (error) => error.code === 'INVALID_SYNC_BASE' && error.status === 400);
});

test('genera bases limitadas para mantenimiento, dispositivo y evidencia', () => {
  const maintenance = maintenanceSyncBase({
    MantenimientoID: 'MNT-1',
    TituloMantenimiento: 'Preventivo',
    FechaActualizacion: '2026-07-30T10:00:00.000Z',
    CampoInterno: 'no debe incluirse',
  });
  const device = maintenanceDeviceSyncBase({
    EvidenciaMantenimientoID: 'DEV-1',
    MantenimientoRef: 'MNT-1',
    NombreDispositivo: 'Cámara',
    FechaActualizacion: '2026-07-30T10:00:00.000Z',
  });
  const image = maintenanceImageSyncBase({
    FotoDispositivoID: 'IMG-1',
    Tipo: 'Antes',
    Nota: 'Frontal',
    PreviewURL: 'https://example.test/private-preview',
    FechaActualizacion: '2026-07-30T10:00:00.000Z',
  }, 'MNT-1');

  assert.equal(maintenance.snapshot.TituloMantenimiento, 'Preventivo');
  assert.equal(maintenance.snapshot.CampoInterno, undefined);
  assert.equal(device.maintenanceId, 'MNT-1');
  assert.equal(image.snapshot.PreviewURL, undefined);
  assert.equal(image.snapshot.Nota, 'Frontal');
});

test('la integración registra conflictos, bloqueo y resolución explícita', () => {
  const permissionPatch = source('backend/src/services/maintenance-evidence-permissions.patch.js');
  const conflictPatch = source('backend/src/services/maintenance-sync-conflict.patch.js');
  const manager = source('src/components/offline/OfflineSyncManager.jsx');
  const formData = source('src/pages/maintenance/maintenanceFormData.js');
  const imageBatch = source('src/services/maintenanceImageBatch.js');

  assert.match(permissionPatch, /maintenance-sync-conflict\.patch/);
  assert.match(conflictPatch, /withConflictWrite/);
  assert.match(conflictPatch, /maintenanceScalableImageHandlers\.updateBatch/);
  assert.match(manager, /SYNC_CONFLICT/);
  assert.match(manager, /status: 'CONFLICT'/);
  assert.match(manager, /__conflictResolution: 'KEEP_LOCAL'/);
  assert.match(formData, /withSyncBase/);
  assert.match(imageBatch, /maintenanceImageSyncBase/);
});
