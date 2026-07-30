import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function includesAll(contents, fragments) {
  fragments.forEach((fragment) => assert.ok(contents.includes(fragment), `Falta el contrato: ${fragment}`));
}

test('usePaginatedResource centraliza cancelación, paginación y estados de carga', () => {
  const contents = source('src/hooks/usePaginatedResource.js');
  includesAll(contents, [
    'const controller = new AbortController();',
    'controllerRef.current?.abort();',
    'mergePaginatedItems(current, incoming, getItemKeyRef.current)',
    'const meta = paginationMeta(data, {',
    'const loadFirst = useCallback',
    'const loadMore = useCallback',
    'return cancel;',
  ]);
});

test('usuarios usa el recurso paginado sin secuencias o merge locales', () => {
  const contents = source('src/pages/users/UsersPage.jsx');
  includesAll(contents, [
    "import usePaginatedResource from '../../hooks/usePaginatedResource';",
    'items: users',
    'loadFirst,',
    'loadMore,',
    'apiRequest(\'users.list\'',
  ]);
  assert.equal(contents.includes('requestSequence'), false);
  assert.equal(contents.includes('mergePaginatedItems'), false);
});

test('conocimiento usa el recurso paginado y cancela la carga auxiliar de categorías', () => {
  const contents = source('src/pages/knowledge/KnowledgeListPage.jsx');
  includesAll(contents, [
    "import usePaginatedResource from '../../hooks/usePaginatedResource';",
    'const controller = new AbortController();',
    '{ signal: controller.signal }',
    'items,',
    'loadMore,',
  ]);
  assert.equal(contents.includes('requestSequence'), false);
  assert.equal(contents.includes('mergePaginatedItems'), false);
});

test('encuestas separa la paginación de respuestas de la carga de preguntas', () => {
  const contents = source('src/pages/surveys/SurveysAdminPage.jsx');
  includesAll(contents, [
    "import usePaginatedResource from '../../hooks/usePaginatedResource';",
    'const questionsRequestSequence = useRef(0);',
    'const questionsController = useRef(null);',
    "enabled: tab === 'responses'",
    'items: responses',
    'loadFirst: loadResponses',
    'loadMore,',
  ]);
  assert.equal(contents.includes('mergePaginatedItems'), false);
});
