import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  projectEvidenceTargetPatch,
  projectEvidenceTargets,
  projectEvidenceTargetValue,
} from '../../src/features/maintenance/maintenanceProjectRelations.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Proyecto deriva destinos de evidencia desde el dispositivo principal y sus componentes', () => {
  const device = {
    nombre: 'Puerta principal',
    categoria: 'Puerta',
    tipoDispositivoId: 'TIPO-PUERTA',
    respuestas: {
      lectores: {
        enabled: true,
        relatedTypeId: 'TIPO-LECTOR',
        relatedTypeName: 'Lector',
        items: [
          {
            localId: 'lector-1',
            tipoDispositivoId: 'TIPO-LECTOR',
            categoria: 'Lector',
            nombre: 'Lector entrada',
            fabricante: 'HID',
            modelo: 'Signo',
          },
          {
            localId: 'lector-2',
            tipoDispositivoId: 'TIPO-LECTOR',
            categoria: 'Lector',
            nombre: 'Lector salida',
          },
        ],
      },
      magneto: {
        enabled: false,
        relatedTypeId: 'TIPO-MAGNETO',
        items: [],
      },
    },
    questionDetails: [
      { key: 'lectores', label: '¿Tiene lectores?' },
      { key: 'magneto', label: '¿Tiene magneto?' },
    ],
  };

  const targets = projectEvidenceTargets(device);
  assert.equal(targets.length, 3);
  assert.equal(targets[0].value, 'DISPOSITIVO');
  assert.equal(targets[1].value, 'COMPONENTE:lectores:lector-1');
  assert.equal(targets[1].componentTypeId, 'TIPO-LECTOR');
  assert.match(targets[1].label, /Lector entrada/);
  assert.match(targets[1].label, /Tiene lectores/);

  const patch = projectEvidenceTargetPatch(targets[1]);
  assert.deepEqual(patch, {
    projectTargetType: 'COMPONENTE',
    projectRelationKey: 'lectores',
    projectComponentLocalId: 'lector-1',
    projectComponentTypeId: 'TIPO-LECTOR',
    projectComponentName: 'Lector entrada',
  });

  assert.equal(projectEvidenceTargetValue({
    ProyectoDestinoTipo: 'COMPONENTE',
    ProyectoRelacionClave: 'lectores',
    ProyectoComponenteLocalID: 'lector-1',
  }), 'COMPONENTE:lectores:lector-1');
});

test('migración 017 extiende la tabla existente sin crear almacenamiento paralelo', () => {
  const migration = source('backend/migrations/017_maintenance_project_evidence.sql');
  assert.match(migration, /ALTER TABLE "Mantenimiento imagenes"/);
  assert.match(migration, /"ContextoEvidencia" TEXT/);
  assert.match(migration, /"FechaCaptura" TEXT/);
  assert.match(migration, /"ProyectoComponenteLocalID" TEXT/);
  assert.match(migration, /ix_dms_maintenance_images_capture/);
  assert.match(migration, /ix_dms_project_evidence_component/);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
});

test('backend deriva el contexto de evidencia desde el mantenimiento y valida el componente real', () => {
  const policy = source('backend/src/services/maintenance-evidence-policy.service.js');
  const maintenance = source('backend/src/modules/maintenance.module.js');
  const scalable = source('backend/src/modules/maintenance-scalable-images.module.js');
  const large = source('backend/src/services/large-evidence-upload.service.js');

  assert.match(policy, /findById\('Evidencia_Mantenimientos'/);
  assert.match(policy, /findById\('Mantenimiento'/);
  assert.match(policy, /maintenanceType === 'PROYECTO'/);
  assert.match(policy, /ProyectoDestinoTipo: 'COMPONENTE'/);
  assert.match(policy, /El componente relacionado seleccionado ya no existe/);
  assert.match(policy, /assertProjectEvidenceTargetsStillExist/);
  assert.match(policy, /No se puede quitar un componente que todavía tiene evidencias relacionadas/);

  assert.match(maintenance, /loadMaintenanceEvidenceContext/);
  assert.match(maintenance, /maintenanceEvidenceMetadata/);
  assert.match(maintenance, /sortMaintenanceEvidenceNewestFirst/);
  assert.match(scalable, /FechaCaptura: input\.capturedAt/);
  assert.match(scalable, /ProyectoComponenteLocalID: input\.projectComponentLocalId/);
  assert.match(large, /evidenceMetadata/);
  assert.match(large, /ProyectoDestinoTipo/);
  assert.match(large, /maintenanceId: evidenceContext\.maintenanceId/);
  assert.match(large, /kind === 'maintenance' \? \{ maintenanceId: token\.maintenanceId \} : \{\}/);
});

test('Proyecto reutiliza uploader editor y galería sin Antes/Después', () => {
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const editor = source('src/components/maintenance/MaintenanceEvidenceEditor.jsx');
  const deviceEditor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const projectDetail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');

  assert.match(uploader, /projectMode \? 'Proyecto' : 'Antes'/);
  assert.match(uploader, /Corresponde a/);
  assert.match(uploader, /capturedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(uploader, /!projectMode && <label>[\s\S]*Tipo de evidencia/);

  assert.match(editor, /!projectMode && <label className="field-group">[\s\S]*Tipo de evidencia/);
  assert.match(editor, /ProyectoDestinoTipo/);
  assert.match(editor, /Fecha y hora/);

  assert.match(deviceEditor, /maintenance-project-evidence-section/);
  assert.match(deviceEditor, /projectEvidenceTargetErrors/);
  assert.match(deviceEditor, /Sin Antes\/Después/);
  assert.match(deviceEditor, /Corresponde a/);

  assert.match(inventory, /sortedEvidence/);
  assert.match(inventory, /evidenceTimestamp\(right\) - evidenceTimestamp\(left\)/);
  assert.match(projectDetail, /galleryImages=\{images\}/);
  assert.match(projectDetail, /projectEvidenceLabel/);
  assert.match(detail, /projectMode=\{projectMode\}/);
  assert.match(detail, /evidenceEnabled/);
});

test('sync offline conserva fecha objetivo y snapshot del componente de Proyecto', () => {
  const syncBase = source('src/services/maintenanceSyncBase.js');
  const moduleApi = source('src/services/moduleApi.js');
  const batches = source('src/services/maintenanceImageBatch.js');
  const large = source('src/services/largeEvidenceUpload.js');
  const conflicts = source('backend/src/services/maintenance-sync-conflict.patch.js');
  const registry = source('backend/src/services/sync-resource-registry.js');

  for (const field of [
    'ContextoEvidencia',
    'FechaCaptura',
    'ProyectoDestinoTipo',
    'ProyectoRelacionClave',
    'ProyectoComponenteLocalID',
    'ProyectoComponenteTipoDispositivoID',
    'ProyectoComponenteNombre',
  ]) {
    assert.match(syncBase, new RegExp(field));
    assert.match(conflicts, new RegExp(field));
  }

  assert.match(moduleApi, /FechaCaptura/);
  assert.match(moduleApi, /ProyectoComponenteNombre/);
  assert.match(batches, /ProyectoDestinoTipo: image\.projectTargetType/);
  assert.match(batches, /ProyectoComponenteNombre: image\.projectComponentName/);
  assert.match(large, /ProyectoComponenteLocalID: item\.projectComponentLocalId/);
  assert.match(registry, /maintenance\.images\.upload/);
  assert.match(registry, /maintenance\.images\.update/);
  assert.match(registry, /maintenance\.images\.delete/);
  assert.match(registry, /MAINTENANCE_LARGE_CHUNKS/);
});

test('cambiar relaciones de Proyecto valida evidencias relacionadas antes de persistir', () => {
  const dynamicQuestions = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  assert.match(dynamicQuestions, /assertProjectEvidenceTargetsStillExist/);
  assert.match(dynamicQuestions, /prepared\.payload\.TipoMantenimiento === 'PROYECTO'/);
  assert.match(dynamicQuestions, /String\(before\.RespuestasJSON \|\| ''\) !== String\(prepared\.payload\.RespuestasJSON \|\| ''\)/);
});
