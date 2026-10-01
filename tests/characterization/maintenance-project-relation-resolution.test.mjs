import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  maintenanceQuestionTypeIdentity as frontendTypeIdentity,
  mergeMaintenanceQuestionCandidates,
} from '../../src/hooks/useMaintenanceQuestionCatalog.js';
import {
  maintenanceQuestionTypeIdentity as backendTypeIdentity,
} from '../../backend/src/services/maintenance-question-catalog.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Puerta y Puertas resuelven la misma identidad de preguntas en frontend y backend', () => {
  assert.equal(frontendTypeIdentity('Puerta'), frontendTypeIdentity('Puertas'));
  assert.equal(frontendTypeIdentity('Control de acceso'), frontendTypeIdentity('Puertas'));
  assert.equal(backendTypeIdentity('Puerta'), backendTypeIdentity('Puertas'));
  assert.equal(backendTypeIdentity('Control de acceso'), backendTypeIdentity('Puertas'));
});

test('una relación Puerta → Magneto configurada en un tipo equivalente no se pierde cuando existe un ID exacto', () => {
  const exact = [
    {
      questionId: 'Q-EXACT',
      typeId: 'TIPO-PUERTAS',
      typeName: 'Puertas',
      key: 'lector',
      label: '¿Lector colocado?',
      responseType: 'SI_NO',
      appliesTo: 'PROYECTO',
    },
  ];
  const equivalent = [
    {
      questionId: 'Q-ALIAS-DUP',
      typeId: 'TIPO-PUERTA-LEGACY',
      typeName: 'Puerta',
      key: 'lector',
      label: '¿Lector colocado?',
      responseType: 'SI_NO',
      appliesTo: 'PROYECTO',
    },
    {
      questionId: 'Q-MAGNETO',
      typeId: 'TIPO-PUERTA-LEGACY',
      typeName: 'Puerta',
      key: 'magneto',
      label: '¿Tiene magneto?',
      responseType: 'RELACION_DISPOSITIVO',
      relatedTypeId: 'TIPO-MAGNETO',
      appliesTo: 'PROYECTO',
    },
  ];

  const merged = mergeMaintenanceQuestionCandidates(exact, equivalent);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.key === 'lector')?.questionId, 'Q-EXACT');
  assert.equal(merged.find((item) => item.key === 'magneto')?.relatedTypeId, 'TIPO-MAGNETO');
  assert.equal(merged.find((item) => item.key === 'magneto')?.responseType, 'RELACION_DISPOSITIVO');
});

test('backend consulta preguntas de todos los TipoDispositivoID equivalentes en un solo batch', () => {
  const catalog = source('backend/src/services/maintenance-question-catalog.service.js');

  assert.match(catalog, /const equivalentTypeIds = deviceTypes/);
  assert.match(catalog, /maintenanceQuestionTypeIdentity\(row\.Nombre\) === identity/);
  assert.match(catalog, /findRows\(MAINTENANCE_QUESTION_SHEET, \{[\s\S]*TipoDispositivoID: equivalentTypeIds/s);
  assert.match(catalog, /dedupeMaintenanceQuestions\(rows, cleanTypeId\)/);
  assert.doesNotMatch(catalog, /for \(const .*equivalentTypeIds[\s\S]*findRows/);
});

test('el editor compartido sigue renderizando RELACION_DISPOSITIVO con MaintenanceProjectRelationField', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const relation = source('src/components/maintenance/MaintenanceProjectRelationField.jsx');

  assert.match(editor, /question\.responseType === 'RELACION_DISPOSITIVO'/);
  assert.match(editor, /<MaintenanceProjectRelationField/);
  assert.match(relation, /fixedTypeId=\{relatedTypeId\}/);
  assert.match(relation, /relatedTypeName/);
});
