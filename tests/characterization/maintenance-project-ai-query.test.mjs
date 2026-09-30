import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Gemini extends existing maintenance tools for project component queries', () => {
  const tools = source('backend/src/ai/agent.tools.js');

  assert.ok(tools.includes("get_maintenance_devices:fn('get_maintenance_devices'"));
  assert.ok(tools.includes("search_maintenance_evidence:fn('search_maintenance_evidence'"));
  assert.ok(tools.includes("search_devices:fn('search_devices'"));
  assert.ok(tools.includes('componentType'));
  assert.ok(tools.includes('componentManufacturer'));
  assert.ok(tools.includes('componentModel'));
  assert.ok(tools.includes('componentSerial'));
  assert.ok(tools.includes('componentMac'));
  assert.ok(tools.includes('evidenceNote'));
  assert.equal(tools.includes('search_project_devices:fn'), false);
  assert.equal(tools.includes('search_project_evidence:fn'), false);
});

test('project device queries reuse RespuestasJSON and evidence notes without N plus one', () => {
  const repository = source('backend/src/ai/agent.repository.maintenance.js');

  assert.ok(repository.includes('projectMaintenanceComponentsFromAnswers'));
  assert.ok(repository.includes('projectMaintenanceScalarAnswers'));
  assert.ok(repository.includes('d."RespuestasJSON" AS "answersJson"'));
  assert.ok(repository.includes('ARRAY('));
  assert.ok(repository.includes('note_row."Nota"'));
  assert.ok(repository.includes('EXISTS ('));
  assert.ok(repository.includes('ai_note."Nota" ILIKE'));
  assert.ok(repository.includes('projectComponents:projectData.projectComponents'));
  assert.ok(repository.includes('projectAnswers:projectData.projectAnswers'));
  assert.ok(repository.includes('truncated:projectFilters&&!exactTotal'));
});

test('project evidence search returns only authorized filtered attachments with component metadata', () => {
  const repository = source('backend/src/ai/agent.repository.maintenance.integral.js');

  assert.equal((repository.match(/export const maintenanceIntegralRepositoryTools/g) || []).length, 1);
  assert.ok(repository.includes('projectEvidenceComponentMatches'));
  assert.ok(repository.includes('mi."ProyectoComponenteLocalID"'));
  assert.ok(repository.includes('mi."ProyectoComponenteTipoDispositivoID"'));
  assert.ok(repository.includes('mi."ProyectoComponenteNombre"'));
  assert.ok(repository.includes('COALESCE(NULLIF(mi."FechaCaptura"'));
  assert.ok(repository.includes('protectedAttachment(ctx'));
  assert.ok(repository.includes('selectedRows.map'));
  assert.ok(repository.includes("Los Proyectos no clasifican evidencias como ANTES o DESPUÉS"));
  assert.ok(repository.includes("stage: String(maintenance.maintenanceType"));
});

test('natural project inventory language is routed to maintenance domain', () => {
  const intent = source('backend/src/ai/agent.intent.js');
  const prompt = source('backend/src/ai/agent.prompt.js');

  assert.ok(intent.includes('PROJECT_COMPONENT_HINT'));
  assert.ok(intent.includes('INVENTORY_QUERY_HINT'));
  assert.ok(intent.includes('AI_INTENTS.MAINTENANCE_DEVICES'));
  assert.ok(intent.includes('AI_INTENTS.MAINTENANCE_EVIDENCE'));
  assert.ok(prompt.includes('puertas con magneto modelo X'));
  assert.ok(prompt.includes('search_maintenance_evidence'));
  assert.ok(prompt.includes('no elijas una por intuición'));
  assert.ok(prompt.includes('tabla Markdown'));
});

test('safe AI context retains only reusable project search filters', () => {
  const sanitize = source('backend/src/ai/agent.sanitize.js');
  const service = source('backend/src/ai/agent.service.js');

  for (const key of [
    'lastSearchDeviceType',
    'lastSearchComponentType',
    'lastSearchComponentManufacturer',
    'lastSearchComponentModel',
    'lastSearchComponentSerial',
    'lastSearchComponentMac',
    'lastSearchEvidenceNote',
    'lastSearchMaintenanceType',
  ]) {
    assert.ok(sanitize.includes(`'${key}'`), key);
    assert.ok(service.includes(`${key}:`), key);
  }
});

test('migration 018 accelerates project AI filters without parallel storage', () => {
  const migration = source('backend/migrations/018_ai_project_inventory_search.sql');

  assert.ok(migration.includes('ix_ai_project_answers_trgm'));
  assert.ok(migration.includes('ix_ai_maintenance_image_note_trgm'));
  assert.ok(migration.includes('ix_ai_project_component_name_trgm'));
  assert.ok(migration.includes('ix_ai_maintenance_type_date'));
  assert.ok(migration.includes('ix_ai_project_evidence_component_type'));
  assert.equal(/CREATE\s+TABLE/i.test(migration), false);
});
