import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('catálogos administrativos consultan PostgreSQL de forma paginada sin materializar tablas completas', () => {
  const crud = source('backend/src/modules/crud.module.js');

  assert.match(crud, /queryPage\(def\.table, request/);
  assert.match(crud, /findById\(def\.table, id\)/);
  assert.match(crud, /findRows\('TipoDispositivoFabricantes'/);
  assert.match(crud, /findRows\('Modelos'/);
  assert.doesNotMatch(crud, /readTable\(/);
  assert.doesNotMatch(crud, /filterRows\(/);
});

test('validación de modelos conserva relaciones pero limita las lecturas al tipo y fabricante solicitados', () => {
  const crud = source('backend/src/modules/crud.module.js');

  assert.match(crud, /findById\('TiposDispositivo', typeId\)/);
  assert.match(crud, /findById\('Fabricantes', manufacturerId\)/);
  assert.match(crud, /TipoDispositivoID:\s*typeId,[\s\S]*FabricanteID:\s*manufacturerId/s);
  assert.match(crud, /normalizedName\(row\.Nombre\) === normalizedName\(name\)/);
  assert.match(crud, /appendRow\('TipoDispositivoFabricantes', relation\)/);
  assert.match(crud, /CREAR_TIPODISPOSITIVOFABRICANTES/);
});

test('queryPage permite omitir conteos no usados sin cambiar el comportamiento por defecto', () => {
  const repository = source('backend/src/infra/postgres.repository.queries.js');

  assert.match(repository, /const includeTotal = payload\.includeTotal !== false/);
  assert.match(repository, /includeTotal\s*\?\s*query\(/);
  assert.match(repository, /Promise\.all\(\[rowsPromise, countPromise\]\)/);
  assert.match(repository, /total:\s*includeTotal \? Number\(countResult\?\.rows\?\.\[0\]\?\.total \|\| 0\) : null/);
});

test('gestor de Catálogos evita COUNT innecesario sin cambiar rutas ni permisos', () => {
  const page = source('src/pages/admin/CatalogsPage.jsx');

  assert.match(page, /includeTotal:\s*false/);
  assert.match(page, /MODULE_ROUTES\.categories\.list/);
  assert.match(page, /MODULE_ROUTES\.models\.list/);
  assert.match(page, /hasPermission\('CATALOGOS_VER'\)/);
  assert.match(page, /hasPermission\('CATALOGOS_GESTIONAR'\)/);
  assert.match(page, /requestAvailable\(activeConfig\.routes\.(?:create|update)/);
});

test('preguntas de mantenimiento usan consultas acotadas para tipos y preguntas', () => {
  const catalog = source('backend/src/services/maintenance-question-catalog.service.js');
  const module = source('backend/src/modules/maintenance-dynamic-questions.module.js');

  assert.match(catalog, /findRows\(MAINTENANCE_QUESTION_SHEET, \{ TipoDispositivoID: requestedTypeId \}/);
  assert.match(catalog, /findById\('TiposDispositivo', cleanTypeId\)/);
  assert.match(module, /queryPage\([\s\S]*MAINTENANCE_QUESTION_SHEET/s);
  assert.match(module, /includeTypeName === false/);
  assert.match(module, /findRows\('TiposDispositivo', \{ TipoDispositivoID: requested \}/);
});

test('crear pregunta reutiliza una sola lectura del grupo para duplicados y orden', () => {
  const module = source('backend/src/modules/maintenance-dynamic-questions.module.js');

  assert.match(module, /const existingQuestions = await readMaintenanceQuestions\(\{ includeInactive: true, typeId \}\)/);
  assert.match(module, /assertUniqueQuestion\(typeId, text, '', existingQuestions\)/);
  assert.match(module, /nextOrder\(typeId, existingQuestions\)/);
  assert.match(module, /const deviceType = await assertMaintenanceDeviceType\(typeId\)/);
});

test('frontend de preguntas parchea el registro devuelto y no recarga todo después de escribir', () => {
  const page = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const submitStart = page.indexOf('async function submit');
  const toggleStart = page.indexOf('async function toggle');
  const removeStart = page.indexOf('async function remove');
  const renderStart = page.indexOf('if (!canView)', removeStart);

  assert.ok(submitStart >= 0 && toggleStart > submitStart && removeStart > toggleStart && renderStart > removeStart);
  assert.match(page, /function upsertQuestion\(items, record\)/);
  assert.match(page, /includeTotal:\s*false/);
  assert.match(page, /includeTypeName:\s*false/);

  const submit = page.slice(submitStart, toggleStart);
  const toggle = page.slice(toggleStart, removeStart);
  const remove = page.slice(removeStart, renderStart);

  for (const block of [submit, toggle, remove]) {
    assert.match(block, /setQuestions\(\(current\) => upsertQuestion\(current, response\)\)/);
    assert.doesNotMatch(block, /await load\(\)/);
  }
});

test('permisos backend de configuración permanecen sin cambios', () => {
  const router = source('backend/src/core/action-router.js');

  assert.match(router, /maintenance\.questions\.list[\s\S]*\['CATALOGOS_VER','CATALOGOS_GESTIONAR'\]/);
  assert.match(router, /maintenance\.questions\.create[\s\S]*'CATALOGOS_GESTIONAR'/);
  assert.match(router, /maintenance\.questions\.update[\s\S]*'CATALOGOS_GESTIONAR'/);
  assert.match(router, /maintenance\.questions\.delete[\s\S]*'CATALOGOS_GESTIONAR'/);
  assert.match(router, /let createPermission='CATALOGOS_GESTIONAR'/);
  assert.match(router, /let updatePermission='CATALOGOS_GESTIONAR'/);
});
