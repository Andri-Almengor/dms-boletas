import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildKnowledgeEnrichmentIndex,
  indexedArticleCategoryIds,
  isActiveKnowledgeRelation,
} from '../../backend/src/services/knowledge-enrichment-index.js';

const knowledgeModuleSource = readFileSync(new URL('../../backend/src/modules/knowledge.module.js', import.meta.url), 'utf8');
const postgresQuerySource = readFileSync(new URL('../../backend/src/infra/postgres.repository.queries.js', import.meta.url), 'utf8');
const longContentPatchSource = readFileSync(new URL('../../backend/src/services/knowledge-long-content.patch.js', import.meta.url), 'utf8');
const knowledgeListPageSource = readFileSync(new URL('../../src/pages/knowledge/KnowledgeListPage.jsx', import.meta.url), 'utf8');
const knowledgeCardSource = readFileSync(new URL('../../src/components/knowledge/KnowledgeCard.jsx', import.meta.url), 'utf8');

function handlerSource(name, nextName) {
  const start = knowledgeModuleSource.indexOf(`  ${name}: async (ctx) => {`);
  assert.notEqual(start, -1, `No se encontró knowledgeHandlers.${name}`);
  const end = nextName
    ? knowledgeModuleSource.indexOf(`\n  ${nextName}: async (ctx) => {`, start)
    : knowledgeModuleSource.length;
  assert.notEqual(end, -1, `No se encontró el final de knowledgeHandlers.${name}`);
  return knowledgeModuleSource.slice(start, end);
}

function counted(values, counter, key) {
  return {
    *[Symbol.iterator]() {
      for (const value of values) {
        counter[key] += 1;
        yield value;
      }
    },
  };
}

test('Etapa 3: la lista de Knowledge conserva visibilidad y filtros delegados a PostgreSQL antes de enriquecer', () => {
  const source = handlerSource('list', 'get');

  assert.match(source, /queryKnowledgeArticlePage\(payload,/);
  assert.match(source, /viewerUserId: ctx\.user\?\.UsuarioID \|\| ''/);
  assert.match(source, /canManage: manager/);
  assert.doesNotMatch(source, /readTable\('KnowledgeArticles'\)|filterRows\(/);

  for (const field of ['Titulo', 'ProblemaResuelto', 'ContenidoHTML']) {
    assert.ok(postgresQuerySource.includes(`COALESCE(a."${field}",'') ILIKE`), `El campo de búsqueda ${field} debe conservarse en SQL.`);
  }
  assert.match(postgresQuerySource, /KnowledgeArticleCategories/);
  assert.match(postgresQuerySource, /KnowledgeCategories/);
  assert.match(postgresQuerySource, /AutorUsuarioID/);
  assert.match(postgresQuerySource, /includeDrafts/);
  assert.match(postgresQuerySource, /PUBLICADO/);
});
test('Etapa 3: el contenido largo de Knowledge se hidrata después del resultado paginado', () => {
  assert.match(
    longContentPatchSource,
    /knowledgeHandlers\.list = async \(ctx\) => hydrateResult\(await originalHandlers\.list\(ctx\)\);/,
  );
  assert.match(longContentPatchSource, /const ids = \[\.\.\.collectTutorialIds\(result\)\]/);
  assert.match(longContentPatchSource, /readKnowledgeArticleContents\(ids\)/);
});

test('Etapa 3: el frontend conserva página 30, orden por actualización y conteo de adjuntos', () => {
  assert.match(knowledgeListPageSource, /const PAGE_SIZE = 30/);
  assert.match(knowledgeListPageSource, /search: search\.trim\(\)/);
  assert.match(knowledgeListPageSource, /categoriaId: categoryId/);
  assert.match(knowledgeListPageSource, /autorUsuarioId: mineOnly/);
  assert.match(knowledgeListPageSource, /includeDrafts: canManageAll \|\| mineOnly/);
  assert.match(knowledgeListPageSource, /sortBy: 'FechaActualizacion'/);
  assert.match(knowledgeListPageSource, /sortDir: 'desc'/);
  assert.match(knowledgeCardSource, /item\.attachments\.length/);
});

test('Etapa 3: los índices de Knowledge recorren cada tabla relacionada una sola vez y conservan semántica histórica', () => {
  const counter = { attachments: 0, categories: 0, users: 0, relations: 0 };
  const attachments = [
    { AdjuntoID: 'a1', TutorialID: 't1', Activo: true },
    { AdjuntoID: 'a2', TutorialID: 't1', Activo: false },
    { AdjuntoID: 'a3', TutorialID: 't1', Activo: 'false' },
    { AdjuntoID: 'a4', TutorialID: 't2', Activo: true },
  ];
  const categories = [
    { CategoriaConocimientoID: 'c1', Nombre: 'Primera versión' },
    { CategoriaConocimientoID: 'c2', Nombre: 'Categoría 2' },
    { CategoriaConocimientoID: 'c1', Nombre: 'Última versión' },
  ];
  const users = [
    { UsuarioID: 'u1', Nombre: 'Primer usuario' },
    { UsuarioID: 'u1', Nombre: 'Usuario duplicado' },
    { UsuarioID: 'u2', Nombre: 'Segundo usuario' },
  ];
  const relations = [
    { TutorialID: 't1', CategoriaConocimientoID: 'c1', Orden: 2, Activo: true },
    { TutorialID: 't1', CategoriaConocimientoID: 'c2', Orden: 1, Activo: 'true' },
    { TutorialID: 't1', CategoriaConocimientoID: 'c3', Orden: 0, Activo: 'false' },
    { TutorialID: 't1', CategoriaConocimientoID: 'c4', Orden: 0, Estado: 'INACTIVO' },
    { TutorialID: 't1', CategoriaConocimientoID: 'c2', Orden: 3, Activo: true },
  ];

  const index = buildKnowledgeEnrichmentIndex({
    attachments: counted(attachments, counter, 'attachments'),
    categories: counted(categories, counter, 'categories'),
    users: counted(users, counter, 'users'),
    relations: counted(relations, counter, 'relations'),
  });

  assert.deepEqual(counter, {
    attachments: attachments.length,
    categories: categories.length,
    users: users.length,
    relations: relations.length,
  });
  assert.equal(index.categoriesById.get('c1').Nombre, 'Última versión', 'Map histórico de categorías conserva la última fila duplicada.');
  assert.equal(index.usersById.get('u1').Nombre, 'Primer usuario', 'users.find histórico conserva el primer usuario duplicado.');
  assert.deepEqual(index.attachmentsByTutorialId.get('t1').map((item) => item.AdjuntoID), ['a1', 'a3']);
  assert.deepEqual(indexedArticleCategoryIds({ TutorialID: 't1', CategoriaConocimientoID: 'legacy' }, index), ['c2', 'c1']);
  assert.deepEqual(indexedArticleCategoryIds({ TutorialID: 't2', CategoriaConocimientoID: 'legacy' }, index), ['legacy']);
  assert.equal(isActiveKnowledgeRelation({ Activo: false }), false);
  assert.equal(isActiveKnowledgeRelation({ Activo: 'false' }), false);
  assert.equal(isActiveKnowledgeRelation({ Estado: 'inactivo' }), false);
  assert.equal(isActiveKnowledgeRelation({ Activo: true }), true);
});

test('Etapa 3: knowledge.list enriquece únicamente la página SQL con consultas relacionadas acotadas', () => {
  const source = handlerSource('list', 'get');
  assert.match(source, /const page = await queryKnowledgeArticlePage/);
  assert.match(source, /const tutorialIds = page\.items\.map/);
  assert.match(source, /findRows\('KnowledgeAttachments', \{ TutorialID: tutorialIds \}/);
  assert.match(source, /findRows\('KnowledgeArticleCategories', \{ TutorialID: tutorialIds \}/);
  assert.match(source, /findRows\('Usuarios', \{ UsuarioID: authorIds \}/);
  assert.match(source, /findRows\('KnowledgeCategories', \{ CategoriaConocimientoID: categoryIds \}/);
  assert.match(source, /const enrichmentIndex = buildKnowledgeEnrichmentIndex\(\{ attachments, categories, users, relations \}\)/);
  assert.match(source, /items: page\.items\.map\(\(article\) => enrichArticle/);
  assert.doesNotMatch(source, /readTables\(|readTable\('KnowledgeAttachments'\)|readTable\('KnowledgeCategories'\)/);
});
