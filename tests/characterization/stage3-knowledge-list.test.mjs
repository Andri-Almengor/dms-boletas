import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const knowledgeModuleSource = readFileSync(new URL('../../backend/src/modules/knowledge.module.js', import.meta.url), 'utf8');
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

test('Etapa 3: la lista de Knowledge conserva visibilidad, filtros y campos de búsqueda antes de paginar', () => {
  const source = handlerSource('list', 'get');

  for (const table of [
    'KnowledgeArticles',
    'KnowledgeAttachments',
    'KnowledgeCategories',
    'KnowledgeArticleCategories',
    'Usuarios',
  ]) {
    assert.ok(source.includes(`'${table}'`), `La lista debe seguir leyendo ${table}`);
  }

  assert.match(source, /article\.Activo !== false/);
  assert.match(source, /if \(isPublished\(article\)\) return true/);
  assert.match(source, /includeDrafts && \(manager \|\| isAuthor\(ctx, article\)\)/);
  assert.match(source, /AutorUsuarioID/);
  assert.match(source, /CategoriaConocimientoID/);

  const visibilityIndex = source.indexOf('.filter((article) => {');
  const enrichmentIndex = source.indexOf('enrichArticle(');
  const paginationIndex = source.indexOf('filterRows(');
  assert.ok(visibilityIndex >= 0 && enrichmentIndex > visibilityIndex, 'La visibilidad debe resolverse antes del enriquecimiento.');
  assert.ok(paginationIndex > enrichmentIndex, 'La búsqueda/orden/paginación debe conservar el contrato actual sobre filas enriquecidas.');

  for (const field of ['Titulo', 'ProblemaResuelto', 'ContenidoHTML', 'CategoriaNombre', 'CategoriasNombres', 'AutorNombre']) {
    assert.ok(source.includes(`'${field}'`), `El campo de búsqueda ${field} debe conservarse.`);
  }
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
