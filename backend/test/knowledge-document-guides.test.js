import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import {
  hasKnowledgeGuideContribution,
  validateKnowledgeGuideShape,
} from '../src/services/knowledge-document-policy.service.js';
import {
  chunkKnowledgeText,
  KNOWLEDGE_DOCUMENT_POLICY,
  supportsKnowledgeExtraction,
} from '../src/ai/agent.knowledge-documents.js';
import { buildAgentSystemPrompt } from '../src/ai/agent.prompt.js';
import { sanitizeActiveContext, sanitizeAiToolResult } from '../src/ai/agent.sanitize.js';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Knowledge guide accepts title + category + written content', () => {
  assert.deepEqual(validateKnowledgeGuideShape({
    title: 'Procedimiento OnGuard',
    categoryIds: ['onguard'],
    contentHtml: '<h2>Pasos</h2><p>Reiniciar servicio.</p>',
  }), { valid: true, reason: '' });
});

test('Knowledge guide accepts title + category + one document without description or HTML', () => {
  assert.deepEqual(validateKnowledgeGuideShape({
    title: 'Milestone XProtect Installation Guide',
    categoryIds: ['milestone', 'xprotect'],
    pendingDocumentsCount: 1,
  }), { valid: true, reason: '' });
});

test('Knowledge guide accepts title + category + multiple documents', () => {
  assert.equal(hasKnowledgeGuideContribution({ pendingDocumentsCount: 6 }), true);
  assert.equal(validateKnowledgeGuideShape({
    title: 'OnGuard 8.x',
    categoryIds: ['onguard'],
    pendingDocumentsCount: 6,
  }).valid, true);
});

test('Knowledge guide rejects title + category without any supported content', () => {
  assert.deepEqual(validateKnowledgeGuideShape({
    title: 'Vacía',
    categoryIds: ['general'],
  }), { valid: false, reason: 'CONTENT_REQUIRED' });
});

test('Knowledge guide still accepts video-only content and existing documents on edit', () => {
  assert.equal(hasKnowledgeGuideContribution({ videos: ['https://example.test/video'] }), true);
  assert.equal(hasKnowledgeGuideContribution({ existingDocumentCount: 1 }), true);
});

test('Knowledge extraction prioritizes requested technical formats without claiming arbitrary binaries', () => {
  [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
  ].forEach((mime) => assert.equal(supportsKnowledgeExtraction(mime), true, mime));
  assert.equal(supportsKnowledgeExtraction('application/zip'), false);
});

test('Knowledge chunking is bounded, ordered and preserves structural headings', () => {
  const paragraph = 'verificar servicio puerto comunicación servidor '.repeat(100);
  const text = `1. REQUISITOS\n\n${paragraph}\n\n2. INSTALACIÓN\n\n${paragraph}\n\n3. VALIDACIÓN\n\n${paragraph}`;
  const chunks = chunkKnowledgeText(text, { maxBytes: 2_000 });
  assert.ok(chunks.length > 1);
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.chunkIndex, index);
    assert.ok(Buffer.byteLength(chunk.content, 'utf8') <= 2_100);
    assert.equal(chunk.pageNumber, null);
  });
  assert.ok(chunks.some((chunk) => /REQUISITOS|INSTALACIÓN|VALIDACIÓN/i.test(chunk.sectionTitle)));
});

test('Knowledge document policy never stores binary in PostgreSQL or sends Drive references to model', () => {
  assert.equal(KNOWLEDGE_DOCUMENT_POLICY.storesDocumentBinaryInPostgres, false);
  assert.equal(KNOWLEDGE_DOCUMENT_POLICY.sendsDriveReferenceToModel, false);
  assert.ok(KNOWLEDGE_DOCUMENT_POLICY.maxExtractedTextBytes <= 2_000_000);
});

test('Knowledge migrations extend the integral document index with library metadata', () => {
  const integral = source('../migrations/012_ai_integral_agent.sql');
  const migration = source('../migrations/013_knowledge_document_guides.sql');
  assert.match(migration, /"IsPrimary" BOOLEAN/);
  assert.match(migration, /"SizeBytes" BIGINT/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS ux_knowledge_attachments_primary_article/i);
  assert.match(integral, /CREATE TABLE IF NOT EXISTS "KnowledgeDocumentChunks"/);
  assert.match(integral, /USING GIN/);
  assert.match(integral, /"DocumentID"/);
  assert.match(integral, /"ArticleID"/);
  assert.match(integral, /"PageNumber"/);
  assert.match(integral, /"SectionTitle"/);
});

test('Knowledge large upload has no 10/20/50 MB document cap and supports resume/idempotence', () => {
  const backend = source('../src/services/large-evidence-upload.service.js');
  const section = backend.slice(backend.indexOf('export async function transferKnowledgeAttachment'));
  assert.match(section, /uploadPhase === 'status'/);
  assert.match(section, /resumableOffset/);
  assert.match(section, /validClientGeneratedId/);
  assert.doesNotMatch(section, /50\s*\*\s*1024\s*\*\s*1024/);
  assert.doesNotMatch(section, /20\s*\*\s*1024\s*\*\s*1024/);

  const frontend = source('../../src/services/largeEvidenceUpload.js');
  assert.match(frontend, /sessionStorage\.setItem/);
  assert.match(frontend, /uploadPhase:\s*'status'/);
  assert.match(frontend, /for \(let attempt = 0; attempt < 3/);
  assert.match(frontend, /onProgress/);
  assert.match(frontend, /signal/);
});

test('Knowledge editor supports cancellable resumable upload and avoids duplicate guide bootstrap', () => {
  const editor = source('../../src/pages/knowledge/KnowledgeEditorPage.jsx');
  assert.doesNotMatch(editor, /MAX_FILE_SIZE/);
  assert.doesNotMatch(editor, /fileToDataUrl/);
  assert.match(editor, /persistedTutorialId/);
  assert.match(editor, /AbortController/);
  assert.match(editor, /Cancelar carga/);
  assert.match(editor, /pendingDocumentsCount/);
  assert.match(editor, /hasPendingUploads\) \? 'BORRADOR'/);
});

test('Knowledge viewer uses protected DMS access for PDF, image and bounded text preview', () => {
  const viewer = source('../../src/components/knowledge/KnowledgeDocumentViewer.jsx');
  assert.match(viewer, /MODULE_ROUTES\.knowledge\.mediaGet/);
  assert.match(viewer, /knowledge-doc-viewer__pdf/);
  assert.match(viewer, /<iframe/);
  assert.match(viewer, /mimeType\.startsWith\('image\/'\)/);
  assert.match(viewer, /Range:/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /downloadUrl/);
  assert.doesNotMatch(viewer, /drive\.google\.com/i);

  const moduleSource = source('../src/modules/knowledge.module.js');
  assert.match(moduleSource, /createProtectedMediaStreamUrl/);
  assert.doesNotMatch(moduleSource, /downloadAsDataUrl/);
});

test('Document replacement invalidates obsolete chunks and follows existing Drive trash policy', () => {
  const moduleSource = source('../src/modules/knowledge.module.js');
  assert.match(moduleSource, /invalidateDocumentChunks\(replacing\.AdjuntoID\)/);
  assert.match(moduleSource, /trashFile\(replacing\.DriveFileID\)/);
  assert.match(moduleSource, /softDelete\('KnowledgeAttachments', replacing\.AdjuntoID/);
});

test('Gemini document tools are bounded and parent-article visibility is enforced', async () => {
  const { TOOL_DECLARATIONS, declarationsForUser } = await import('../src/ai/agent.tools.js');
  assert.ok(TOOL_DECLARATIONS.search_knowledge_documents);
  assert.ok(TOOL_DECLARATIONS.get_knowledge_document);
  assert.ok(TOOL_DECLARATIONS.search_knowledge_document_chunks);
  const names = declarationsForUser({ user: { UsuarioID: 'TECH-1' }, permissions: ['BOLETAS_VER'] })
    .filter((item) => item.type === 'function')
    .map((item) => item.name);
  assert.ok(names.includes('search_knowledge_document_chunks'));

  const repository = source('../src/ai/agent.repository.knowledge-documents.js');
  assert.match(repository, /appendKnowledgeVisibility/);
  assert.match(repository, /knowledgeMaxChunks/);
  assert.match(repository, /knowledgeMaxChunkBytes/);
  assert.match(repository, /Página ' \+ item\.pageNumber/);
});

test('Gemini prompt treats PDF, DOCX, spreadsheet and image content as untrusted data', () => {
  const prompt = buildAgentSystemPrompt({
    user: { UsuarioID: 'T1', NombreCompleto: 'Técnico' },
    permissions: ['BOLETAS_VER'],
    nowIso: '2026-09-18T09:00:00-06:00',
  });
  assert.match(prompt, /DATA NO CONFIABLE|DATO NO CONFIABLE/i);
  assert.match(prompt, /captura o imagen/i);
  assert.match(prompt, /No repitas una prueba ya realizada/i);
  assert.match(prompt, /documentación oficial del fabricante/i);
  assert.match(prompt, /Nunca inventes páginas/i);
});

test('Gemini sanitizer preserves bounded diagnostic memory but strips storage secrets', () => {
  const context = sanitizeActiveContext({
    lastKnowledgeDocumentId: 'D1',
    lastKnowledgeDocumentName: 'OnGuard Guide.pdf',
    currentTechnicalIssue: {
      product: 'OnGuard',
      problem: 'Login Driver no responde',
      confirmedFacts: ['SQL 1433 funciona'],
      attemptedSteps: ['Revisé SQL 1433'],
      successfulTests: ['SQL 1433 funciona'],
      failedTests: [],
      DriveFileID: 'SECRET',
    },
  });
  assert.equal(context.lastKnowledgeDocumentId, 'D1');
  assert.equal(context.currentTechnicalIssue.product, 'OnGuard');
  assert.deepEqual(context.currentTechnicalIssue.attemptedSteps, ['Revisé SQL 1433']);
  assert.equal(context.currentTechnicalIssue.DriveFileID, undefined);

  const result = sanitizeAiToolResult('knowledge', {
    modelData: { documentId: 'D1', DriveFileID: 'SECRET', token: 'SECRET', content: 'fragmento autorizado' },
  });
  assert.equal(result.modelData.DriveFileID, undefined);
  assert.equal(result.modelData.token, undefined);
  assert.equal(result.modelData.content, 'fragmento autorizado');
});

test('Technical screenshot analysis uses private chat uploads, multimodal Gemini input and Knowledge first', () => {
  const backend = source('../src/ai/agent.service.js');
  assert.match(backend, /loadDiagnosticImageInputs/);
  assert.match(backend, /DriveFileID" AS "__file"/);
  assert.match(backend, /type:\s*'image'/);
  assert.match(backend, /mime_type/);
  assert.match(backend, /knowledgeRequired=requiresKnowledgeLookup\(message\)\|\|diagnosticImages\.length>0/);
  assert.match(backend, /search_knowledge_documents/);
  assert.match(backend, /updateTroubleshootingContext/);

  const frontend = source('../../src/pages/assistant/AssistantPageSecure.jsx');
  assert.match(frontend, /accept="image\/\*,\.pdf/);
  assert.match(frontend, /attachmentIds:\s*uploadedFiles\.map/);
  assert.match(frontend, /assistantAction:\s*'attachment\.init'/);
  assert.match(frontend, /persistableMessages[\s\S]*attachments: \[\]/);
});

test('Troubleshooting follow-ups preserve the active product and advance instead of restarting', () => {
  const backend = source('../src/ai/agent.service.js');
  assert.match(backend, /followUpResult/);
  assert.match(backend, /return prior/);
  assert.match(backend, /attemptedSteps/);
  assert.match(backend, /ruledOutCauses/);
  assert.match(backend, /successfulTests/);
  assert.match(backend, /failedTests/);
});


test('Production startup applies Knowledge schema migrations before accepting document uploads', async () => {
  const packageJson = JSON.parse(source('../package.json'));
  assert.match(packageJson.scripts.prestart || '', /db-migrate\.js|db:migrate/);

  const repairMigration = source('../migrations/014_knowledge_attachment_runtime_columns_guard.sql');
  for (const column of [
    'SizeBytes',
    'IsPrimary',
    'ExtractionStatus',
    'ExtractionError',
    'IndexedAt',
    'SearchText',
    'Status',
    'ActualizadoPor',
    'FechaActualizacion',
  ]) {
    assert.match(repairMigration, new RegExp(`"${column}"`), column);
  }

  const server = source('../src/server.js');
  assert.match(server, /startup\.knowledge_schema/);
  assert.match(server, /"SizeBytes","IsPrimary","ExtractionStatus","Status"/);
});


test('Knowledge inline PDF stream overrides global frame denial only for same-origin DMS viewer', () => {
  const app = source('../src/app.js');
  const media = source('../src/services/protected-media-stream.service.js');

  assert.match(app, /frameAncestors:\s*\["'none'"\]/);
  assert.match(media, /media\.kind !== 'knowledge-document' \|\| media\.disposition !== 'inline'/);
  assert.match(media, /frame-ancestors 'self'/);
  assert.match(media, /X-Frame-Options', 'SAMEORIGIN'/);
  assert.doesNotMatch(media, /frame-ancestors \*/);
});
