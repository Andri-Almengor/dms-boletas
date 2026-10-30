import './stage2-maintenance-list.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readFile } from 'node:fs';
import { fileURLToPath as filePath } from 'node:url';
import { join as pathJoin } from 'node:path';
import {
  AUTOMATIC_PENDING_STATE,
  MANUAL_PENDING_STATE,
  activeMaintenanceQuestionView,
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

test('el catálogo vigente conserva la respuesta pero no el orden ni la definición obsoleta de una cámara', () => {
  const saved = {
    questionId: 'CAM-1',
    key: 'limpieza',
    label: 'Texto anterior',
    order: 10,
    responseType: 'SI_NO',
    config: { required: true },
    value: 'Sí',
  };
  const current = {
    ...saved,
    label: '¿Se realizó la limpieza correctamente?',
    order: 50,
    responseType: 'TEXTO',
    config: { required: false },
    value: '',
  };
  const merged = activeMaintenanceQuestionView(current, saved);

  assert.deepEqual(merged, { ...current, value: 'Sí' });
  assert.equal(merged.order, 50);
  assert.equal(merged.label, current.label);
  assert.equal(merged.responseType, 'TEXTO');
  assert.deepEqual(merged.config, { required: false });
  assert.equal(activeMaintenanceQuestionView(current, undefined), current);
});

test('cambiar una pregunta a opcional no mantiene una obligación almacenada en RespuestasJSON o questionDetails', () => {
  const previous = { key: 'montaje', order: 10, config: { required: true }, activeAtSave: true };
  const device = {
    funcionamiento: 'Sí',
    enUso: 'Sí, en uso',
    respuestas: { montaje: '', __preguntas: [previous] },
    questionDetails: [previous],
  };
  const catalog = [{ key: 'montaje', order: 50, config: { required: false }, activeAtSave: true }];
  assert.deepEqual(maintenanceChecklistCompletion(device, catalog), {
    complete: true,
    missing: [],
    requiredKeys: [],
  });
});

test('una pregunta desactivada no bloquea la checklist aunque su snapshot anterior siga activo', () => {
  const device = {
    funcionamiento: 'Sí',
    enUso: 'Sí, en uso',
    respuestas: {
      antigua: '',
      nueva: '',
      __preguntas: [{ key: 'antigua', activeAtSave: true, config: { required: true } }],
    },
    questionDetails: [{ key: 'antigua', activeAtSave: true, config: { required: true } }],
  };
  const catalog = [
    { key: 'antigua', historical: true, activeAtSave: false },
    { key: 'nueva', order: 10, config: { required: true }, activeAtSave: true },
  ];
  assert.deepEqual(maintenanceChecklistCompletion(device, catalog), {
    complete: false,
    missing: ['nueva'],
    requiredKeys: ['nueva'],
  });
});

test('reordenar preguntas modifica también el orden de los faltantes, sin perder respuestas', () => {
  const previous = [
    { key: 'montaje', order: 10, config: { required: true } },
    { key: 'limpieza', order: 20, config: { required: true } },
  ];
  const device = {
    funcionamiento: 'Sí',
    enUso: 'Sí, en uso',
    respuestas: { __preguntas: previous },
    questionDetails: previous,
  };
  const catalog = [
    { key: 'limpieza', order: 10, config: { required: true } },
    { key: 'montaje', order: 20, config: { required: true } },
  ];
  assert.deepEqual(maintenanceChecklistCompletion(device, catalog), {
    complete: false,
    missing: ['limpieza', 'montaje'],
    requiredKeys: ['limpieza', 'montaje'],
  });
});

test('editor y backend usan la definición vigente y conservan snapshots históricos', () => {
  const { readFileSync } = requireSourceContracts();
  const hook = readFileSync('src/hooks/useMaintenanceQuestionCatalog.js');
  const editor = readFileSync('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const backend = readFileSync('backend/src/modules/maintenance-dynamic-questions.module.js');
  const catalog = readFileSync('backend/src/services/maintenance-question-catalog.service.js');
  const excel = readFileSync('backend/src/services/maintenance-dynamic-spreadsheet.service.js');

  assert.match(hook, /activeMaintenanceQuestionView\(question, savedByKey\.get\(question\.key\)\)/);
  assert.match(editor, /catalogQuestions\.map\(\(question\) => \(\{/);
  assert.match(editor, /\.sort\(\(left, right\) => left\.order - right\.order/);
  assert.match(backend, /if \(!saved \|\| item\.activeAtSave !== false\) return item/);
  assert.match(catalog, /activeAtSave: false/);
  assert.match(catalog, /return snapshot\.sort\(\(left, right\) => left\.order - right\.order/);
  // El Excel actualizado respeta el orden activo sin alterar snapshots previos
  // ni consultar preguntas por cada dispositivo.
  assert.match(excel, /const rows = await readMaintenanceQuestions\(\{ includeInactive: false \}\)/);
  assert.match(excel, /const order = currentOrders\.get\(/);
  assert.match(excel, /order === undefined \? item : \{ \.\.\.item, order \}/);
  assert.match(excel, /questionsForDevice\(device, currentOrders\)/);
});

// Lectura de contratos mínimos del flujo real sin importar módulos con side effects de infraestructura.
function requireSourceContracts() {
  const readFileSync = readFile;
  const fileURLToPath = filePath;
  const join = pathJoin;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return { readFileSync: (file) => readFileSync(join(root, file), 'utf8') };
}

