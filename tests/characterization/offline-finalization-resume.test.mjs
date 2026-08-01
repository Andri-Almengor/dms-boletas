import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MAINTENANCE_FINALIZATION_PRIORITY,
  finalizationPhase,
  maintenanceFinalizationDedupeKey,
  maintenanceFinalizationPayload,
  maintenanceFinalizationView,
} from '../../src/services/maintenanceFinalizationDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la finalización usa una prioridad posterior a dispositivos, evidencias y conflictos', () => {
  assert.equal(MAINTENANCE_FINALIZATION_PRIORITY, 90);
  assert.equal(maintenanceFinalizationDedupeKey('MNT-1'), 'maintenanceFinalize:MNT-1');
  const payload = maintenanceFinalizationPayload('MNT-1', { retry: true });
  assert.equal(payload.maintenanceId, 'MNT-1');
  assert.equal(payload.MantenimientoID, 'MNT-1');
  assert.equal(payload.finalizationRequestId, 'finalize-MNT-1');
  assert.equal(payload.retryFinalization, true);
});

test('representa el progreso persistente de cada fase', () => {
  assert.equal(finalizationPhase('VALIDANDO').progress, 25);
  assert.equal(finalizationPhase('GENERANDO_BOLETAS').progress, 50);
  assert.equal(finalizationPhase('ENTREGANDO').progress, 75);
  assert.equal(finalizationPhase('COMPLETADO').progress, 100);
});

test('una operación local pendiente no marca el mantenimiento como finalizado', () => {
  const view = maintenanceFinalizationView(
    { Estado: 'PENDIENTE' },
    { kind: 'maintenanceFinalize', status: 'PENDING', lastError: '' },
  );
  assert.equal(view.active, true);
  assert.equal(view.completed, false);
  assert.equal(view.state, 'PENDIENTE_SINCRONIZACION');
  assert.equal(view.phaseId, 'ESPERANDO_SINCRONIZACION');
});

test('un error permite reintentar desde el último paso confirmado', () => {
  const view = maintenanceFinalizationView(
    {
      Estado: 'PENDIENTE',
      EstadoFinalizacion: 'ERROR',
      PasoFinalizacion: 'ENTREGANDO',
      UltimoErrorFinalizacion: 'Chat no disponible',
    },
    { kind: 'maintenanceFinalize', status: 'ERROR', lastError: 'Chat no disponible' },
  );
  assert.equal(view.canRetry, true);
  assert.equal(view.error, 'Chat no disponible');
  assert.equal(view.completed, false);
});

test('el estado final del servidor prevalece sobre una operación local obsoleta', () => {
  const view = maintenanceFinalizationView(
    { Estado: 'FINALIZADO', EstadoFinalizacion: 'COMPLETADO' },
    { kind: 'maintenanceFinalize', status: 'ERROR', lastError: 'Respuesta perdida' },
  );
  assert.equal(view.completed, true);
  assert.equal(view.progress, 100);
  assert.equal(view.phaseId, 'COMPLETADO');
});

test('la integración registra cola, reanudación, pasos y centro de recuperación', () => {
  const requestService = source('src/services/maintenanceFinalization.js');
  const backendState = source('backend/src/services/maintenance-finalization-state.service.js');
  const backendPatch = source('backend/src/services/maintenance-finalization-resume.patch.js');
  const appBackend = source('backend/src/app.js');
  const appFrontend = source('src/app/App.jsx');
  const baseHook = source('src/hooks/useOptimizedMaintenanceBase.js');
  const scalableHook = source('src/hooks/useScalableMaintenanceForm.js');

  assert.match(requestService, /kind: 'maintenanceFinalize'/);
  assert.match(requestService, /priority: MAINTENANCE_FINALIZATION_PRIORITY/);
  assert.match(requestService, /dms-offline-sync-request/);
  assert.match(backendState, /FinalizacionIntentos/);
  assert.match(backendState, /MAINTENANCE_FINALIZATION_RETRY_REQUIRED/);
  assert.match(backendPatch, /GENERANDO_BOLETAS/);
  assert.match(backendPatch, /ENTREGANDO/);
  assert.match(backendPatch, /EstadoNotificacion: 'ENVIANDO'/);
  assert.match(appBackend, /maintenance-finalization-resume\.patch/);
  assert.match(appFrontend, /MaintenanceFinalizationCenter/);
  assert.match(baseHook, /requestMaintenanceFinalization/);
  assert.match(scalableHook, /requestMaintenanceFinalization/);
});
