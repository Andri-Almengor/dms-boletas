import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AI_INTENTS, classifyAiIntent, isKnowledgeDocumentQuery, isTechnicalKnowledgeQuery } from '../src/ai/agent.intent.js';
import { appendKnowledgeVisibility } from '../src/ai/agent.permissions.js';
import { searchTerms } from '../src/ai/agent.repository.shared.js';
import { declarationsForUser } from '../src/ai/agent.tools.js';
import { buildAgentSystemPrompt } from '../src/ai/agent.prompt.js';
import { runDmsAgent, _resetAiRateLimitForTests } from '../src/ai/agent.service.js';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const namesFor = (ctx) => declarationsForUser(ctx, { intent: AI_INTENTS.KNOWLEDGE_DOCUMENTS })
  .filter((item) => item.type === 'function')
  .map((item) => item.name);

test('Knowledge reading tools are exposed to admin and ordinary authenticated readers', () => {
  const expected = ['search_knowledge_base', 'get_knowledge_article', 'search_knowledge_documents', 'get_knowledge_document', 'search_knowledge_document_chunks'];
  const admin = namesFor({ user: { UsuarioID: 'ADMIN-1' }, permissions: ['USUARIOS_GESTIONAR'] });
  const reader = namesFor({ user: { UsuarioID: 'USER-1' }, permissions: ['BOLETAS_VER'] });
  for (const name of expected) {
    assert.equal(admin.includes(name), true, name);
    assert.equal(reader.includes(name), true, name);
  }
  assert.deepEqual(namesFor({ user: {}, permissions: [] }), []);
});

test('Knowledge visibility follows the parent article published-or-author rule', () => {
  const params = [];
  const sql = appendKnowledgeVisibility({ user: { UsuarioID: 'AUTHOR-1' }, permissions: [] }, params, 'a');
  assert.deepEqual(params, ['AUTHOR-1']);
  assert.match(sql, /PUBLICADO/);
  assert.match(sql, /"AutorUsuarioID"=\$1/);
  const managerParams = [];
  assert.equal(appendKnowledgeVisibility({ user: { UsuarioID: 'ADMIN-1' }, permissions: ['CONOCIMIENTO_GESTIONAR'] }, managerParams, 'a'), 'TRUE');
});

test('Axis guide queries and natural document follow-ups route to Knowledge', () => {
  assert.equal(classifyAiIntent({ message: '¿Qué dice nuestra guía del Axis C1410 y C8110?' }), AI_INTENTS.KNOWLEDGE_DOCUMENTS);
  assert.equal(classifyAiIntent({ message: 'Busca la guía Axis C1410 + C8110.pdf' }), AI_INTENTS.KNOWLEDGE_DOCUMENTS);
  assert.equal(isTechnicalKnowledgeQuery({ message: '¿Cómo configuro el C8110 con Axis?' }), true);
  assert.equal(isTechnicalKnowledgeQuery({ message: 'El C8110 no envía audio al C1410.' }), true);
  assert.equal(isKnowledgeDocumentQuery({
    message: '¿qué dice sobre PoE?',
    context: { lastKnowledgeDocumentId: 'DOC-1', lastKnowledgeDocumentName: 'Guia Axis.pdf' },
  }), true);
  assert.equal(classifyAiIntent({
    message: '¿y sobre integración de audio?',
    context: { lastKnowledgeDocumentId: 'DOC-1', lastKnowledgeDocumentName: 'Guia Axis.pdf' },
  }), AI_INTENTS.KNOWLEDGE_DOCUMENTS);
});

test('Knowledge search terms preserve product and model tokens', () => {
  assert.deepEqual(searchTerms('¿Qué dice nuestra guía del Axis C1410 y C8110?'), ['axis', 'c1410', 'c8110']);
  assert.deepEqual(searchTerms('network audio bridge speaker'), ['network', 'audio', 'bridge', 'speaker']);
});

test('Repositories search document-only guides through parent visibility, categories, attachments and chunks', () => {
  const documents = source('../src/ai/agent.repository.knowledge-documents.js');
  const articles = source('../src/ai/agent.repository.knowledge.js');
  assert.match(documents, /JOIN "KnowledgeArticles" a/);
  assert.match(documents, /appendKnowledgeVisibility\(ctx, params, 'a'\)/);
  assert.match(documents, /KnowledgeArticleCategories/);
  assert.match(documents, /KnowledgeCategories/);
  assert.match(documents, /KnowledgeDocumentChunks/);
  assert.match(documents, /kdc\."SearchText"/);
  assert.match(documents, /kdc\."SectionTitle"/);
  assert.match(documents, /knowledgeMaxChunks/);
  assert.match(documents, /knowledgeMaxChunkBytes/);
  assert.match(documents, /EXTRACTION_FAILED/);
  assert.match(documents, /PROCESSING/);
  assert.match(articles, /KnowledgeAttachments/);
  assert.match(articles, /KnowledgeDocumentChunks/);
  assert.match(articles, /ka\."Nombre"/);
  assert.match(articles, /ka\."SearchText"/);
});

test('System prompt forbids false Knowledge-access limitations and distinguishes document states', () => {
  const prompt = buildAgentSystemPrompt({
    user: { UsuarioID: 'U1', NombreCompleto: 'Usuario' },
    permissions: ['BOLETAS_VER'],
    nowIso: '2026-09-18T10:00:00-06:00',
  });
  assert.match(prompt, /Nunca afirmes que no tienes acceso a Knowledge/i);
  assert.match(prompt, /Cero resultados significa NO_RESULTS/i);
  assert.match(prompt, /UPLOADED\/PROCESSING/i);
  assert.match(prompt, /falló la extracción/i);
  assert.match(prompt, /Puertos, voltajes, PoE, firmware/i);
  assert.match(prompt, /DATO NO CONFIABLE/i);
});

test('Knowledge indexing is queued, deduplicated and recovered after restart', () => {
  const indexer = source('../src/ai/agent.knowledge-documents.js');
  const moduleSource = source('../src/modules/knowledge.module.js');
  const server = source('../src/server.js');
  assert.match(indexer, /KNOWLEDGE_INDEX_QUEUE/);
  assert.match(indexer, /KNOWLEDGE_INDEX_QUEUED/);
  assert.match(indexer, /recoverKnowledgeDocumentIndexing/);
  assert.match(moduleSource, /queueKnowledgeDocumentIndexing/);
  assert.doesNotMatch(moduleSource, /void indexKnowledgeDocument/);
  assert.match(server, /startKnowledgeDocumentRecoveryScheduler/);
  assert.match(server, /stopKnowledgeDocumentRecoveryScheduler/);
});

test('Knowledge-first agent loop uses article, document and chunk tools end to end', async () => {
  _resetAiRateLimitForTests();
  let modelCall = 0;
  const executed = [];
  const fakeModel = async ({ tools }) => {
    modelCall += 1;
    const exposed = tools.filter((item) => item.type === 'function').map((item) => item.name);
    assert.equal(exposed.includes('search_knowledge_documents'), true);
    assert.equal(exposed.includes('search_knowledge_document_chunks'), true);
    if (modelCall === 1) return { steps: [{ type: 'function_call', id: 'c1', name: 'search_knowledge_base', arguments: { query: 'Axis C1410 C8110' } }] };
    if (modelCall === 2) return { steps: [{ type: 'function_call', id: 'c2', name: 'search_knowledge_documents', arguments: { query: 'Axis C1410 C8110' } }] };
    if (modelCall === 3) return { steps: [{ type: 'function_call', id: 'c3', name: 'search_knowledge_document_chunks', arguments: { documentId: 'DOC-AXIS', query: 'C1410 C8110 audio' } }] };
    return { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Según la guía interna Guia Axis C1410 + C8110.pdf, los fragmentos recuperados describen la integración de audio.' }] }] };
  };

  const fakeTool = async (_ctx, name, args) => {
    executed.push([name, args]);
    const emptyUi = { entities: [], attachments: [], confirmations: [], context: {}, sources: [] };
    if (name === 'search_knowledge_base') {
      return { tool: name, modelData: { state: 'OK', totalShown: 1, items: [{ id: 'ARTICLE-AXIS', title: 'Axis C1410 + C8110', excerpt: '' }] }, ui: emptyUi };
    }
    if (name === 'search_knowledge_documents') {
      return {
        tool: name,
        modelData: { state: 'OK', totalShown: 1, items: [{ id: 'DOC-AXIS', articleId: 'ARTICLE-AXIS', name: 'Guia Axis C1410 + C8110.pdf', state: 'READY', extractionStatus: 'INDEXED' }] },
        ui: {
          ...emptyUi,
          context: { lastKnowledgeArticleId: 'ARTICLE-AXIS', lastKnowledgeDocumentId: 'DOC-AXIS', lastKnowledgeDocumentName: 'Guia Axis C1410 + C8110.pdf' },
          sources: [{ type: 'knowledge_document', id: 'DOC-AXIS', label: 'Guia Axis C1410 + C8110.pdf', url: '/conocimiento/ARTICLE-AXIS', articleId: 'ARTICLE-AXIS', documentId: 'DOC-AXIS' }],
        },
      };
    }
    if (name === 'search_knowledge_document_chunks') {
      return {
        tool: name,
        modelData: {
          state: 'OK', totalShown: 2, query: args.query,
          items: [
            { id: 'CH-1', documentId: 'DOC-AXIS', articleId: 'ARTICLE-AXIS', documentName: 'Guia Axis C1410 + C8110.pdf', pageNumber: null, sectionTitle: 'Audio', content: 'Fragmento autorizado sobre C8110 y C1410.' },
            { id: 'CH-2', documentId: 'DOC-AXIS', articleId: 'ARTICLE-AXIS', documentName: 'Guia Axis C1410 + C8110.pdf', pageNumber: null, sectionTitle: 'Integración', content: 'Segundo fragmento autorizado.' },
          ],
        },
        ui: {
          ...emptyUi,
          context: { lastKnowledgeArticleId: 'ARTICLE-AXIS', lastKnowledgeDocumentId: 'DOC-AXIS', lastKnowledgeDocumentName: 'Guia Axis C1410 + C8110.pdf' },
          sources: [{ type: 'knowledge_document_chunk', id: 'CH-1', label: 'Guia Axis C1410 + C8110.pdf · Audio', url: '/conocimiento/ARTICLE-AXIS', articleId: 'ARTICLE-AXIS', documentId: 'DOC-AXIS', pageNumber: null, sectionTitle: 'Audio' }],
        },
      };
    }
    throw new Error('Unexpected tool ' + name);
  };

  const response = await runDmsAgent({
    requestId: 'REQ-AXIS',
    sessionToken: 'TEST-SESSION',
    user: { UsuarioID: 'USER-1', NombreCompleto: 'Usuario normal' },
    permissions: ['BOLETAS_VER'],
    payload: { message: '¿Qué dice nuestra guía del Axis C1410 y C8110?', conversationId: 'CONV-AXIS', history: [], context: {}, attachmentIds: [] },
  }, { models: ['test-model'], createInteraction: fakeModel, executeAiTool: fakeTool, audit: async () => {} });

  assert.deepEqual(executed.map(([name]) => name), ['search_knowledge_base', 'search_knowledge_documents', 'search_knowledge_document_chunks']);
  assert.match(response.answer, /Según la guía interna/);
  assert.doesNotMatch(response.answer, /no tengo herramientas/i);
  assert.equal(response.agent.webSearch, false);
  assert.equal(response.context.lastKnowledgeDocumentId, 'DOC-AXIS');
  assert.equal(response.sources.some((item) => item.type === 'knowledge_document_chunk'), true);
  assert.equal(response.sources.some((item) => item.pageNumber !== null && item.pageNumber !== undefined), false);
});

test('Processing document is reported as found and processing, not as unavailable tooling', async () => {
  _resetAiRateLimitForTests();
  let modelCall = 0;
  const fakeModel = async () => {
    modelCall += 1;
    if (modelCall === 1) return { steps: [{ type: 'function_call', id: 'p1', name: 'search_knowledge_base', arguments: { query: 'Axis C1410' } }] };
    if (modelCall === 2) return { steps: [{ type: 'function_call', id: 'p2', name: 'search_knowledge_documents', arguments: { query: 'Axis C1410' } }] };
    return { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Encontré la guía interna, pero su contenido todavía se está procesando.' }] }] };
  };
  const fakeTool = async (_ctx, name) => {
    const ui = { entities: [], attachments: [], confirmations: [], context: {}, sources: [] };
    if (name === 'search_knowledge_base') return { tool: name, modelData: { state: 'OK', totalShown: 1, items: [{ id: 'A1' }] }, ui };
    if (name === 'search_knowledge_documents') return {
      tool: name,
      modelData: { state: 'OK', totalShown: 1, items: [{ id: 'D1', articleId: 'A1', name: 'Guia Axis.pdf', state: 'PROCESSING', extractionStatus: 'PROCESSING' }] },
      ui: { ...ui, sources: [{ type: 'knowledge_document', id: 'D1', label: 'Guia Axis.pdf', url: '/conocimiento/A1', articleId: 'A1' }] },
    };
    throw new Error('Unexpected tool');
  };
  const response = await runDmsAgent({
    requestId: 'REQ-PROCESSING',
    sessionToken: 'TEST-SESSION-2',
    user: { UsuarioID: 'USER-2' },
    permissions: ['BOLETAS_VER'],
    payload: { message: '¿Qué dice nuestra guía Axis C1410?', conversationId: 'C2', history: [], context: {}, attachmentIds: [] },
  }, { models: ['test-model'], createInteraction: fakeModel, executeAiTool: fakeTool, audit: async () => {} });

  assert.match(response.answer, /todavía se está procesando/i);
  assert.doesNotMatch(response.answer, /no tengo herramientas/i);
  assert.equal(response.sources.some((item) => item.type === 'knowledge_document'), true);
});

test('Agent does not enable web immediately after one empty Knowledge result', () => {
  const service = source('../src/ai/agent.service.js');
  assert.doesNotMatch(service, /totalShown\|\|0\)===0&&aiConfig\.webSearchEnabled/);
  assert.match(service, /retryChunkSearch/);
  assert.match(service, /knowledge_document_search_failed/);
  assert.match(service, /knowledge_tool_not_exposed/);
  assert.match(service, /knowledge_tool_permission_denied/);
});
