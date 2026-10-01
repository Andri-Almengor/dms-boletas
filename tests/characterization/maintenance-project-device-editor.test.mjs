import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  normalizeProjectRelationValue,
  projectQuestionMissing,
  resizeProjectRelation,
  toggleProjectRelation,
  updateProjectRelationItem,
} from '../../src/features/maintenance/maintenanceProjectRelations.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las relaciones de Proyecto son opcionales por defecto y conservan componentes estructurados', () => {
  const question = {
    key: 'lectores',
    responseType: 'RELACION_DISPOSITIVO',
    relatedTypeId: 'TIPO-LECTOR',
    config: { fields: ['cantidad', 'fabricante', 'modelo', 'serie'] },
  };

  assert.equal(projectQuestionMissing(question, undefined), false);

  let relation = toggleProjectRelation({}, true, {
    relatedTypeId: 'TIPO-LECTOR',
    relatedTypeName: 'Lector',
  });
  assert.equal(relation.enabled, true);
  assert.equal(relation.quantity, 1);
  assert.equal(relation.items.length, 1);
  assert.equal(relation.items[0].tipoDispositivoId, 'TIPO-LECTOR');

  relation = resizeProjectRelation(relation, 2, {
    relatedTypeId: 'TIPO-LECTOR',
    relatedTypeName: 'Lector',
  });
  assert.equal(relation.items.length, 2);
  assert.notEqual(relation.items[0].localId, relation.items[1].localId);

  relation = updateProjectRelationItem(relation, relation.items[0].localId, {
    fabricanteId: 'FAB-HID',
    fabricante: 'HID',
    modeloId: 'MOD-1',
    modelo: 'Signo',
    serie: 'SER-1',
  });
  const restored = normalizeProjectRelationValue(JSON.stringify(relation), {
    relatedTypeId: 'TIPO-LECTOR',
    relatedTypeName: 'Lector',
  });
  assert.equal(restored.items[0].fabricante, 'HID');
  assert.equal(restored.items[0].modelo, 'Signo');
  assert.equal(restored.items[0].serie, 'SER-1');
});

test('una relación puede configurarse como obligatoria', () => {
  const question = {
    key: 'magnetos',
    responseType: 'RELACION_DISPOSITIVO',
    relatedTypeId: 'TIPO-MAGNETO',
    config: { required: true },
  };
  assert.equal(projectQuestionMissing(question, undefined), true);
  assert.equal(projectQuestionMissing(question, { enabled: false, items: [] }), true);
  assert.equal(projectQuestionMissing(question, {
    enabled: true,
    items: [{ localId: 'M-1', tipoDispositivoId: 'TIPO-MAGNETO' }],
  }), false);
});

test('el formulario activa Proyecto sin modificar la ruta histórica de Mantenimiento', () => {
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const general = source('src/components/maintenance/MaintenanceGeneralStep.jsx');
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const quick = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');

  assert.match(general, /<option value="MANTENIMIENTO">Mantenimiento<\/option>/);
  assert.match(general, /<option value="PROYECTO">Proyecto<\/option>/);
  assert.match(form, /maintenanceType=\{state\.form\.tipoMantenimiento\}/);
  assert.match(form, /canFinalize=\{!projectMode && isAdministrator\}/);
  assert.match(editor, /MaintenanceProjectRelationField/);
  assert.match(editor, /questionCatalog\.forDevice\(device, projectMode \? 'PROYECTO' : 'MANTENIMIENTO'\)/);
  assert.match(editor, /maintenance-project-evidence-section/);
  assert.ok(editor.includes('Sin Antes/Después'));
  assert.match(quick, /maintenanceType=\{maintenanceType\}/);
});

test('los componentes relacionados reutilizan catálogos tipo marca modelo y creación inline', () => {
  const catalogs = source('src/components/maintenance/MaintenanceDeviceCatalogFields.jsx');
  const relation = source('src/components/maintenance/MaintenanceProjectRelationField.jsx');
  const sharedHook = source('src/hooks/useMaintenanceDeviceCatalogData.js');

  assert.match(catalogs, /fixedTypeId/);
  assert.match(catalogs, /catalogData/);
  assert.match(catalogs, /MODULE_ROUTES\.manufacturers\.create/);
  assert.match(catalogs, /MODULE_ROUTES\.models\.create/);
  assert.match(catalogs, /MODULE_ROUTES\.deviceManufacturers\.create/);
  assert.match(relation, /fixedTypeId=\{relatedTypeId\}/);
  assert.match(relation, /questionCatalog\?\.forDevice\?\.\(item, 'PROYECTO'\)/);
  assert.match(sharedHook, /Promise\.allSettled/);
  assert.match(sharedHook, /MODULE_ROUTES\.deviceManufacturers\.list/);
});

test('el backend valida modo, catálogos y preguntas de componentes sin N+1', () => {
  const backend = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  const automation = source('backend/src/modules/maintenance-automation.module.js');
  const base = source('backend/src/modules/maintenance.module.js');

  assert.match(backend, /validateProjectAnswers/);
  assert.match(backend, /readTables\(\['TiposDispositivo', 'Fabricantes', 'Modelos', 'TipoDispositivoFabricantes'\]\)/);
  assert.match(backend, /readMaintenanceQuestions\(\{ includeInactive: false, mode: 'PROYECTO' \}\)/);
  assert.match(backend, /validateScalarProjectValue/);
  assert.match(backend, /normalizeMacAddress/);
  assert.match(automation, /Los proyectos no utilizan la finalización automática/);
  assert.match(base, /No se puede cambiar entre Mantenimiento y Proyecto después de registrar dispositivos/);
});

test('sync offline y detalle conservan relaciones estructuradas', () => {
  const state = source('src/features/maintenance/maintenanceDeviceState.js');
  const draft = source('src/hooks/useMaintenanceDeviceDraft.js');
  const formData = source('src/pages/maintenance/maintenanceFormData.js');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const projectDetail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');

  assert.match(state, /cloneAnswerValue/);
  assert.match(draft, /cloneDraftValue/);
  assert.match(formData, /maintenanceType: normalizedType/);
  assert.match(formData, /normalizedType === 'PROYECTO'/);
  assert.match(projectDetail, /ProjectDeviceAnswers/);
  assert.match(inventory, /JSON\.stringify\(parseAnswers\(device\)\)/);
  assert.match(detail, /projectMode=\{projectMode\}/);
  assert.match(detail, /evidenceEnabled/);
  assert.match(detail, /!projectMode && pending && !offlinePending/);
});
