import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalMaintenanceCategoryName } from '../../src/config/maintenanceCategories.js';
import {
  maintenanceQuestionTypeIdentity as backendTypeIdentity,
} from '../../backend/src/services/maintenance-question-catalog.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Puerta y Puertas resuelven la misma identidad de preguntas en frontend y backend', () => {
  assert.equal(canonicalMaintenanceCategoryName('Puerta'), canonicalMaintenanceCategoryName('Puertas'));
  assert.equal(canonicalMaintenanceCategoryName('Control de acceso'), canonicalMaintenanceCategoryName('Puertas'));
  assert.equal(backendTypeIdentity('Puerta'), backendTypeIdentity('Puertas'));
  assert.equal(backendTypeIdentity('Control de acceso'), backendTypeIdentity('Puertas'));
});

test('frontend combina ID exacto + tipo equivalente y prioriza la clave exacta para no perder Puerta → Magneto', () => {
  const hook = source('src/hooks/useMaintenanceQuestionCatalog.js');

  assert.match(hook, /const exact = typeId && byTypeId\.has\(typeId\)/);
  assert.match(hook, /const equivalent = identity && byTypeIdentity\.has\(identity\)/);
  assert.match(hook, /mergeMaintenanceQuestionCandidates\(exact, equivalent\)/);
  assert.match(hook, /const seen = new Set\(\)/);
  assert.match(hook, /if \(!key \|\| seen\.has\(key\)\) return false/);
  assert.match(hook, /canonicalMaintenanceCategoryName\(value\)/);
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
