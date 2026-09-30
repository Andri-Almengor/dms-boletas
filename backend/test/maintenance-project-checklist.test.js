import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeProjectChecklistDefinition,
  projectChecklistJson,
  sameProjectChecklist,
  validateProjectDeviceProgress,
} from '../src/services/maintenance-project-checklist.service.js';

const CHECKLIST = {
  version: 1,
  groups: [{
    id: 'type:PUERTA',
    typeId: 'PUERTA',
    typeName: 'Puerta',
    countField: 'CantPuertas',
    questions: [
      { id: 'lector-instalado', label: '¿Lector instalado?', responseType: 'PENDIENTE_REALIZADO', order: 10 },
      { id: 'magneto-probado', label: '¿Magneto probado?', responseType: 'SI_NO', order: 20 },
    ],
  }],
};

test('Project checklist definition keeps only supported normalized question types', () => {
  const normalized = normalizeProjectChecklistDefinition(CHECKLIST);
  assert.equal(normalized.groups.length, 1);
  assert.equal(normalized.groups[0].questions.length, 2);
  assert.equal(normalized.groups[0].questions[0].responseType, 'PENDIENTE_REALIZADO');
  assert.equal(normalized.groups[0].questions[1].responseType, 'SI_NO');
});

test('Project progress preserves pending note and strips unknown answers', () => {
  const result = JSON.parse(validateProjectDeviceProgress({
    maintenance: {
      TipoMantenimiento: 'PROYECTO',
      ProyectoChecklistJSON: JSON.stringify(CHECKLIST),
    },
    payload: {
      TipoDispositivoID: 'PUERTA',
      Categoria: 'Puerta',
      ProyectoProgresoJSON: JSON.stringify({
        version: 1,
        answers: {
          'lector-instalado': { value: 'Pendiente', note: 'Falta cableado del lector.' },
          'magneto-probado': { value: 'Sí', note: 'Esta nota no corresponde.' },
          inventada: { value: 'REALIZADO', note: 'No debe persistirse.' },
        },
      }),
    },
  }));

  assert.deepEqual(result.answers['lector-instalado'], {
    value: 'PENDIENTE',
    note: 'Falta cableado del lector.',
  });
  assert.deepEqual(result.answers['magneto-probado'], {
    value: 'SI',
    note: '',
  });
  assert.equal(result.answers.inventada, undefined);
});

test('Project completed progress clears stale pending notes', () => {
  const result = JSON.parse(validateProjectDeviceProgress({
    maintenance: {
      TipoMantenimiento: 'PROYECTO',
      ProyectoChecklistJSON: JSON.stringify(CHECKLIST),
    },
    payload: {
      TipoDispositivoID: 'PUERTA',
      Categoria: 'Puerta',
      projectProgress: {
        version: 1,
        answers: {
          'lector-instalado': { value: 'Realizado', note: 'Ya no aplica.' },
        },
      },
    },
  }));

  assert.deepEqual(result.answers['lector-instalado'], { value: 'REALIZADO', note: '' });
  assert.deepEqual(result.answers['magneto-probado'], { value: '', note: '' });
});

test('normal maintenance does not reinterpret Project progress', () => {
  const historical = JSON.stringify({ version: 1, answers: { legacy: { value: 'PENDIENTE', note: 'histórico' } } });
  assert.equal(validateProjectDeviceProgress({
    maintenance: { TipoMantenimiento: 'MANTENIMIENTO' },
    payload: { ProyectoProgresoJSON: '{"version":1,"answers":{}}' },
    before: { ProyectoProgresoJSON: historical },
  }), historical);
});

test('locked Project checklist comparison ignores JSON formatting differences', () => {
  const compact = projectChecklistJson(CHECKLIST);
  const formatted = JSON.stringify(CHECKLIST, null, 2);
  assert.equal(sameProjectChecklist(compact, formatted), true);
});

test('Project checklist rejects blank persisted questions', () => {
  assert.throws(() => normalizeProjectChecklistDefinition({
    version: 1,
    groups: [{
      id: 'type:PUERTA',
      typeId: 'PUERTA',
      typeName: 'Puerta',
      questions: [{ id: 'q1', label: '   ', responseType: 'PENDIENTE_REALIZADO' }],
    }],
  }), /pregunta/i);
});
