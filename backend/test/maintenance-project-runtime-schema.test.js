import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tableDefinition } from '../src/config/database-tables.js';

const PROJECT_MIGRATIONS = [
  '../migrations/016_maintenance_project_foundation.sql',
  '../migrations/017_maintenance_project_evidence.sql',
  '../migrations/019_maintenance_project_progress_checklist.sql',
];

function addedColumns(sql) {
  const result = new Map();
  const alterPattern = /ALTER TABLE\s+"([^"]+)"([\s\S]*?);/g;
  for (const alter of sql.matchAll(alterPattern)) {
    const table = alter[1];
    const columns = [...alter[2].matchAll(/ADD COLUMN IF NOT EXISTS\s+"([^"]+)"/g)]
      .map((match) => match[1]);
    if (!columns.length) continue;
    result.set(table, [...(result.get(table) || []), ...columns]);
  }
  return result;
}

test('Project migration columns are registered in the PostgreSQL runtime catalog', () => {
  const required = new Map();

  for (const relativePath of PROJECT_MIGRATIONS) {
    const sql = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    for (const [table, columns] of addedColumns(sql)) {
      required.set(table, [...new Set([...(required.get(table) || []), ...columns])]);
    }
  }

  assert.deepEqual(Object.fromEntries(required), {
    Mantenimiento: ['TipoMantenimiento', 'ProyectoChecklistJSON'],
    TipoDispositivoPreguntas: ['AplicaModo', 'TipoDispositivoRelacionadoID', 'ConfiguracionJSON'],
    'Mantenimiento imagenes': [
      'ContextoEvidencia',
      'FechaCaptura',
      'ProyectoDestinoTipo',
      'ProyectoRelacionClave',
      'ProyectoComponenteLocalID',
      'ProyectoComponenteTipoDispositivoID',
      'ProyectoComponenteNombre',
    ],
    Evidencia_Mantenimientos: ['ProyectoProgresoJSON'],
  });

  for (const [table, columns] of required) {
    const definition = tableDefinition(table);
    assert.ok(definition, `La tabla ${table} debe estar registrada.`);
    for (const column of columns) {
      assert.ok(
        definition.columns.includes(column),
        `${table}.${column} existe en una migración de Proyecto pero falta en el catálogo runtime.`,
      );
    }
  }
});

test('maintenance question runtime catalog exposes every column required by ensureMaintenanceQuestionCatalog', () => {
  const columns = tableDefinition('TipoDispositivoPreguntas')?.columns || [];
  for (const column of ['AplicaModo', 'TipoDispositivoRelacionadoID', 'ConfiguracionJSON']) {
    assert.ok(columns.includes(column), `Falta TipoDispositivoPreguntas.${column}`);
  }
});
