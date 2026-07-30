import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATIC_PENDING_STATE,
  MANUAL_PENDING_STATE,
  effectiveMaintenanceDeviceState,
  isMaintenanceChecklistPending,
  isManualChecklistPending,
  maintenanceChecklistCompletion,
  parseMaintenanceAnswers,
} from '../../src/utils/maintenanceChecklistStatus.js';

const CAMERA_QUESTIONS = [
  ['limpieza', '¿Se realizó la limpieza?'],
  ['alimentacion', '¿La alimentación funciona correctamente?'],
];

test('el pendiente manual bloquea la checklist aunque todos los campos estén completos', () => {
  const device = {
    estado: MANUAL_PENDING_STATE,
    funcionamiento: 'Sí',
    enUso: 'Sí, en uso',
    respuestas: { limpieza: 'Sí', alimentacion: 'Sí' },
  };

  assert.equal(isManualChecklistPending(device), true);
  assert.equal(effectiveMaintenanceDeviceState(device, CAMERA_QUESTIONS), MANUAL_PENDING_STATE);
  assert.equal(isMaintenanceChecklistPending(device, CAMERA_QUESTIONS), true);
});

test('el pendiente automático cambia a Correcto al completar toda la checklist', () => {
  const device = {
    estado: AUTOMATIC_PENDING_STATE,
    funcionamiento: 'Sí',
    enUso: 'No, está guardado',
    respuestas: { limpieza: 'Sí', alimentacion: 'Sí' },
  };

  assert.deepEqual(maintenanceChecklistCompletion(device, CAMERA_QUESTIONS), {
    complete: true,
    missing: [],
    requiredKeys: ['limpieza', 'alimentacion'],
  });
  assert.equal(effectiveMaintenanceDeviceState(device, CAMERA_QUESTIONS), 'Correcto');
  assert.equal(isMaintenanceChecklistPending(device, CAMERA_QUESTIONS), false);
});

test('un dispositivo incompleto conserva el pendiente automático y expone campos faltantes', () => {
  const device = {
    funcionamiento: 'Sí',
    enUso: '',
    respuestas: { limpieza: 'Sí', alimentacion: '' },
  };
  const completion = maintenanceChecklistCompletion(device, CAMERA_QUESTIONS);

  assert.equal(completion.complete, false);
  assert.deepEqual(completion.missing, ['En uso', 'alimentacion']);
  assert.equal(effectiveMaintenanceDeviceState(device, CAMERA_QUESTIONS), AUTOMATIC_PENDING_STATE);
});

test('las preguntas históricas o inactivas no se vuelven obligatorias', () => {
  const device = {
    funcionamiento: 'Sí',
    enUso: 'Sí, en uso',
    respuestas: {
      activa: 'Sí',
      __preguntas: [
        { key: 'activa', activeAtSave: true },
        { key: 'historica', historical: true },
        { key: 'inactiva', Activo: false },
      ],
    },
  };

  const completion = maintenanceChecklistCompletion(device);
  assert.deepEqual(completion.requiredKeys, ['activa']);
  assert.equal(completion.complete, true);
});

test('RespuestasJSON conserva respuestas y metadatos históricos', () => {
  const parsed = parseMaintenanceAnswers({
    RespuestasJSON: JSON.stringify({
      limpieza: 'No',
      __preguntas: [{ key: 'limpieza', label: 'Limpieza' }],
    }),
  });

  assert.deepEqual(parsed.answers, { limpieza: 'No' });
  assert.deepEqual(parsed.metadataQuestions, [{ key: 'limpieza', label: 'Limpieza' }]);
});

test('un estado explícito distinto de pendiente se conserva después de completar', () => {
  const state = effectiveMaintenanceDeviceState({
    Estado: 'Mal estado',
    Funcionamiento: 'No',
    EnUso: 'No',
    respuestas: { limpieza: 'No', alimentacion: 'No' },
  }, CAMERA_QUESTIONS);

  assert.equal(state, 'Mal estado');
});
