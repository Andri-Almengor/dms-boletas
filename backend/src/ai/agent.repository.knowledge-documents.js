import { performance } from 'node:perf_hooks';
import { badRequest, notFound } from '../core/errors.js';
import { appendKnowledgeVisibility, assertAiCapability } from './agent.permissions.js';
import { aiConfig } from './agent.config.js';
import { queueKnowledgeDocumentIndexing } from './agent.knowledge-documents.js';
import {
  active, clean, entity, like, many, one, pageLimit, protectedAttachment, searchTerms, source,
} from './agent.repository.shared.js';

async function visibleDocument(ctx, documentId) {
  assertAiCapability(ctx, 'knowledge');
  const id = clean(documentId, 250);
  if (!id) throw badRequest('Falta documentId.');
  const params = [id];
  const visible = appendKnowledgeVisibility(ctx, params, 'a');
  const row = await one(
    `SELECT ka."AdjuntoID" AS id,ka."TutorialID" AS "articleId",ka."Nombre" AS name,
            ka."MimeType" AS "mimeType",ka."Size" AS size,ka."FechaCreacion" AS "createdAt",
            ka."ExtractionStatus" AS "extractionStatus",ka."IndexedAt" AS "indexedAt",
            ka."ExtractionError" AS "extractionError",ka."DriveFileID" AS "__file",
            a."Titulo" AS "articleTitle",a."Estado" AS "articleStatus",a."AutorUsuarioID" AS "authorUserId"
       FROM "KnowledgeAttachments" ka
       JOIN "KnowledgeArticles" a
         ON a."__valid"=TRUE AND a."TutorialID"=ka."TutorialID"
      WHERE ${active('ka')} AND ka."AdjuntoID"=$1 AND ${visible}
      LIMIT 1`,
    params,
    'ai.knowledgeDocuments.get',
  );
  if (!row) throw notFound('No se encontró el documento o no puede consultar su artículo.');
  return row;
}

function documentContext(item) {
  return {
    lastKnowledgeId: item.articleId,
    lastKnowledgeArticleId: item.articleId,
    lastKnowledgeDocumentId: item.id,
    lastKnowledgeDocumentName: item.name || '',
  };
}
function extractionState(status = '') {
  const value = String(status || '').toUpperCase();
  if (value === 'FAILED') return 'EXTRACTION_FAILED';
  if (['UPLOADED', 'PROCESSING', 'PENDING', ''].includes(value)) return 'PROCESSING';
  if (value === 'UNSUPPORTED') return 'UNSUPPORTED';
  if (value === 'EMPTY') return 'EMPTY';
  if (value === 'INDEXED' || value === 'READY') return 'READY';
  return value || 'PROCESSING';
}

function canRetryIndexing(ctx, row = {}) {
  const permissions = Array.isArray(ctx?.permissions) ? ctx.permissions : [];
  return permissions.includes('USUARIOS_GESTIONAR')
    || permissions.includes('CONOCIMIENTO_GESTIONAR')
    || String(row.authorUserId || '') === String(ctx?.user?.UsuarioID || '');
}

function knowledgeDocumentSource(ctx, row = {}) {
  const route = '/conocimiento/' + encodeURIComponent(row.articleId || '');
  const attachment = protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: 'knowledge:' + (row.articleId || ''),
    evidenceId: row.id,
    kind: 'knowledge-document',
    title: row.name || 'Documento',
    subtitle: row.articleTitle || 'Base de Conocimiento',
    entityType: 'knowledge',
    entityId: row.articleId || '',
  });
  return source(
    'knowledge_document',
    row.id,
    (row.name || 'Documento') + ' · ' + (row.articleTitle || 'Artículo'),
    attachment?.url || route,
    {
      articleId: clean(row.articleId, 250),
      articleTitle: clean(row.articleTitle, 300),
      documentId: clean(row.id, 250),
      documentName: clean(row.name || 'Documento', 300),
      mimeType: clean(row.mimeType, 150),
      extractionStatus: clean(row.extractionStatus, 80),
      pageNumber: null,
      sectionTitle: '',
    },
  );
}

export async function searchKnowledgeDocuments(ctx, args = {}) {
  assertAiCapability(ctx, 'knowledge');
  if (!aiConfig.knowledgeDocumentsEnabled) {
    return { modelData: { disabled: true, totalShown: 0, items: [] } };
  }

  const q = clean(args.query, 500);
  const articleId = clean(args.articleId, 250);
  if (!q && !articleId) throw badRequest('Indique el documento, artículo o tema a buscar.');

  const params = [];
  const visible = appendKnowledgeVisibility(ctx, params, 'a');
  const clauses = [active('ka'), active('a'), visible];

  if (articleId) {
    params.push(articleId);
    clauses.push('ka."TutorialID"=$' + params.length);
  }
  if (q) {
    params.push(like(q));
    const p = '$' + params.length;
    clauses.push(`(
      ka."Nombre" ILIKE ${p} ESCAPE '\\'
      OR COALESCE(ka."SearchText",'') ILIKE ${p} ESCAPE '\\'
      OR a."Titulo" ILIKE ${p} ESCAPE '\\'
      OR a."ProblemaResuelto" ILIKE ${p} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
          FROM "KnowledgeArticleCategories" rel
          JOIN "KnowledgeCategories" cat
            ON cat."__valid"=TRUE AND cat."CategoriaConocimientoID"=rel."CategoriaConocimientoID"
         WHERE rel."__valid"=TRUE
           AND rel."TutorialID"=a."TutorialID"
           AND LOWER(COALESCE(rel."Activo",'true')) <> 'false'
           AND cat."Nombre" ILIKE ${p} ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1
          FROM "KnowledgeDocumentChunks" kdc
         WHERE kdc."__valid"=TRUE
           AND kdc."DocumentID"=ka."AdjuntoID"
           AND (
             kdc."Content" ILIKE ${p} ESCAPE '\\'
             OR kdc."SectionTitle" ILIKE ${p} ESCAPE '\\'
           )
      )
    )`);
  }

  params.push(pageLimit(args.limit, 10));
  let rows = await many(
    `SELECT ka."AdjuntoID" AS id,ka."TutorialID" AS "articleId",ka."Nombre" AS name,
            ka."MimeType" AS "mimeType",ka."Size" AS size,ka."FechaCreacion" AS "createdAt",
            ka."ExtractionStatus" AS "extractionStatus",ka."IndexedAt" AS "indexedAt",
            ka."DriveFileID" AS "__file",a."Titulo" AS "articleTitle",a."Estado" AS "articleStatus"
       FROM "KnowledgeAttachments" ka
       JOIN "KnowledgeArticles" a
         ON a."__valid"=TRUE AND a."TutorialID"=ka."TutorialID"
      WHERE ${clauses.join(' AND ')}
      ORDER BY ka."FechaCreacion" DESC NULLS LAST,ka."Nombre" ASC
      LIMIT $${params.length}`,
    params,
    'ai.knowledgeDocuments.search',
  );

  for (const row of rows.slice(0, 2)) {
    if (!['INDEXED', 'UNSUPPORTED', 'EMPTY'].includes(String(row.extractionStatus || '').toUpperCase())) {
      await ensureKnowledgeDocumentIndexed(row, ctx.user?.UsuarioID || '').catch(() => {});
    }
  }

  if (rows.length) {
    const refreshed = await many(
      `SELECT "AdjuntoID" AS id,"ExtractionStatus" AS "extractionStatus","IndexedAt" AS "indexedAt"
         FROM "KnowledgeAttachments"
        WHERE "__valid"=TRUE AND "AdjuntoID"=ANY($1::text[])`,
      [rows.map((row) => row.id)],
      'ai.knowledgeDocuments.refresh',
    );
    const byId = new Map(refreshed.map((row) => [row.id, row]));
    rows = rows.map((row) => ({ ...row, ...(byId.get(row.id) || {}) }));
  }

  const items = rows.map((row) => ({
    id: row.id,
    articleId: row.articleId,
    name: row.name || 'Documento',
    mimeType: row.mimeType || 'application/octet-stream',
    size: row.size || '',
    createdAt: row.createdAt || '',
    extractionStatus: row.extractionStatus || 'PENDING',
    indexedAt: row.indexedAt || '',
    articleTitle: row.articleTitle || 'Artículo',
  }));

  return {
    modelData: { totalShown: items.length, items },
    entities: items.map((item) => entity(
      'knowledge',
      item.articleId,
      item.articleTitle,
      '/conocimiento/' + encodeURIComponent(item.articleId),
    )),
    sources: items.map((item) => source(
      'knowledge_document',
      item.id,
      item.name + ' · ' + item.articleTitle,
      '/conocimiento/' + encodeURIComponent(item.articleId),
    )),
    context: items.length === 1 ? documentContext(items[0]) : {},
  };
}

export async function getKnowledgeDocument(ctx, args = {}) {
  let row = await visibleDocument(ctx, args.documentId);
  if (!['INDEXED', 'UNSUPPORTED', 'EMPTY'].includes(String(row.extractionStatus || '').toUpperCase())) {
    await ensureKnowledgeDocumentIndexed(row, ctx.user?.UsuarioID || '').catch(() => {});
    row = await visibleDocument(ctx, args.documentId);
  }

  const attachment = protectedAttachment(ctx, {
    fileId: row.__file,
    mimeType: row.mimeType,
    scopeId: 'knowledge:' + row.articleId,
    evidenceId: row.id,
    kind: 'knowledge-document',
    title: row.name || 'Documento',
    subtitle: row.articleTitle || 'Base de Conocimiento',
    entityType: 'knowledge',
    entityId: row.articleId,
  });

  const item = {
    id: row.id,
    articleId: row.articleId,
    name: row.name || 'Documento',
    mimeType: row.mimeType || 'application/octet-stream',
    size: row.size || '',
    createdAt: row.createdAt || '',
    extractionStatus: row.extractionStatus || 'PENDING',
    indexedAt: row.indexedAt || '',
    articleTitle: row.articleTitle || 'Artículo',
  };

  return {
    modelData: item,
    attachments: attachment ? [attachment] : [],
    entities: [entity('knowledge', row.articleId, row.articleTitle || 'Artículo', '/conocimiento/' + encodeURIComponent(row.articleId))],
    sources: [source('knowledge_document', row.id, item.name + ' · ' + item.articleTitle, '/conocimiento/' + encodeURIComponent(row.articleId))],
    context: documentContext(item),
  };
}

export async function searchKnowledgeDocumentChunks(ctx, args = {}) {
  const searchStarted = performance.now();
  assertAiCapability(ctx, 'knowledge');
  if (!aiConfig.knowledgeDocumentsEnabled) {
    return { modelData: { disabled: true, totalShown: 0, items: [] } };
  }

  const q = clean(args.query, 1000);
  if (!q) throw badRequest('Indique el texto o tema a buscar dentro de los documentos.');

  const documentId = clean(args.documentId, 250);
  const articleId = clean(args.articleId, 250);
  if (documentId) {
    const document = await visibleDocument(ctx, documentId);
    if (String(document.extractionStatus || '').toUpperCase() !== 'INDEXED') {
      await ensureKnowledgeDocumentIndexed(document, ctx.user?.UsuarioID || '').catch(() => {});
    }
  } else if (articleId) {
    const params = [articleId];
    const visible = appendKnowledgeVisibility(ctx, params, 'a');
    const pending = await many(
      `SELECT ka."AdjuntoID" AS id,ka."TutorialID" AS "articleId",ka."Nombre" AS name,
              ka."MimeType" AS "mimeType",ka."DriveFileID" AS "__file",
              ka."ExtractionStatus" AS "extractionStatus"
         FROM "KnowledgeAttachments" ka
         JOIN "KnowledgeArticles" a
           ON a."__valid"=TRUE AND a."TutorialID"=ka."TutorialID"
        WHERE ${active('ka')} AND ka."TutorialID"=$1 AND ${visible}
        ORDER BY ka."FechaCreacion" DESC NULLS LAST
        LIMIT 2`,
      params,
      'ai.knowledgeDocuments.pendingByArticle',
    );
    for (const row of pending) {
      if (String(row.extractionStatus || '').toUpperCase() !== 'INDEXED') {
        await ensureKnowledgeDocumentIndexed(row, ctx.user?.UsuarioID || '').catch(() => {});
      }
    }
  }

  const params = [];
  const visible = appendKnowledgeVisibility(ctx, params, 'a');
  const clauses = ['k."__valid"=TRUE', active('ka'), active('a'), visible];

  if (documentId) {
    params.push(documentId);
    clauses.push('k."DocumentID"=$' + params.length);
  } else if (articleId) {
    params.push(articleId);
    clauses.push('k."ArticleID"=$' + params.length);
  }

  params.push(q);
  const qp = '$' + params.length;
  clauses.push(`(
    to_tsvector('simple',COALESCE(k."SearchText",'') || ' ' || COALESCE(k."Content",''))
      @@ plainto_tsquery('simple',${qp})
    OR k."Content" ILIKE ('%' || ${qp} || '%')
    OR k."SectionTitle" ILIKE ('%' || ${qp} || '%')
  )`);

  const maxRows = Math.min(aiConfig.knowledgeMaxChunks, pageLimit(args.limit, aiConfig.knowledgeMaxChunks));
  params.push(maxRows);

  const rows = await many(
    `SELECT k."ChunkID" AS id,k."DocumentID" AS "documentId",k."ArticleID" AS "articleId",
            k."ChunkIndex" AS "chunkIndex",k."PageNumber" AS "pageNumber",
            k."SectionTitle" AS "sectionTitle",k."Content" AS content,
            ka."Nombre" AS "documentName",ka."MimeType" AS "mimeType",
            a."Titulo" AS "articleTitle"
       FROM "KnowledgeDocumentChunks" k
       JOIN "KnowledgeAttachments" ka
         ON ka."AdjuntoID"=k."DocumentID"
       JOIN "KnowledgeArticles" a
         ON a."TutorialID"=k."ArticleID"
      WHERE ${clauses.join(' AND ')}
      ORDER BY ts_rank(
        to_tsvector('simple',COALESCE(k."SearchText",'') || ' ' || COALESCE(k."Content",'')),
        plainto_tsquery('simple',${qp})
      ) DESC,k."ChunkIndex" ASC
      LIMIT $${params.length}`,
    params,
    'ai.knowledgeChunks.search',
  );

  const items = rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    articleId: row.articleId,
    chunkIndex: Number(row.chunkIndex || 0),
    pageNumber: row.pageNumber === null || row.pageNumber === undefined || row.pageNumber === '' ? null : Number(row.pageNumber),
    sectionTitle: row.sectionTitle || '',
    content: clean(row.content, aiConfig.knowledgeMaxChunkBytes),
    documentName: row.documentName || 'Documento',
    articleTitle: row.articleTitle || 'Artículo',
    mimeType: row.mimeType || '',
  }));

  console.info('[ai-knowledge-search] '+JSON.stringify({searchMs:Math.round(performance.now()-searchStarted),chunksReturned:items.length,sourceType:'knowledge_document_chunk',documentScoped:Boolean(documentId),articleScoped:Boolean(articleId)}));

  return {
    modelData: { totalShown: items.length, query: q, items },
    entities: items.slice(0, 1).map((item) => entity(
      'knowledge',
      item.articleId,
      item.articleTitle,
      '/conocimiento/' + encodeURIComponent(item.articleId),
    )),
    sources: items.map((item) => source(
      'knowledge_document_chunk',
      item.id,
      item.documentName
        + (item.pageNumber !== null ? ' · Página ' + item.pageNumber : '')
        + (item.sectionTitle ? ' · ' + item.sectionTitle : ''),
      '/conocimiento/' + encodeURIComponent(item.articleId),
    )),
    context: items.length ? {
      lastKnowledgeId: items[0].articleId,
      lastKnowledgeArticleId: items[0].articleId,
      lastKnowledgeDocumentId: items[0].documentId,
      lastKnowledgeDocumentName: items[0].documentName,
      ...(items[0].pageNumber !== null ? { lastKnowledgePage: String(items[0].pageNumber) } : {}),
    } : {},
  };
}

export const knowledgeDocumentRepositoryTools = Object.freeze({
  search_knowledge_documents: searchKnowledgeDocuments,
  get_knowledge_document: getKnowledgeDocument,
  search_knowledge_document_chunks: searchKnowledgeDocumentChunks,
});
