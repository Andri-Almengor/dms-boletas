import { knowledgeHandlers } from '../modules/knowledge.module.js';
import {
  firstKnowledgeContentChunk,
  isLongKnowledgeContent,
} from './knowledge-content-chunks.js';
import {
  deactivateKnowledgeArticleContent,
  ensureKnowledgeLongContentStorage,
  readKnowledgeArticleContents,
  replaceKnowledgeArticleContent,
} from './knowledge-long-content.storage.js';

const CONTENT_KEYS = ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'];

const originalHandlers = {
  list: knowledgeHandlers.list,
  get: knowledgeHandlers.get,
  create: knowledgeHandlers.create,
  update: knowledgeHandlers.update,
  delete: knowledgeHandlers.delete,
};

function hasContentPayload(payload = {}) {
  return CONTENT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function contentFromPayload(payload = {}) {
  for (const key of CONTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) return String(payload[key] ?? '');
  }
  return '';
}

function withSafeContentPayload(payload, content) {
  return {
    ...(payload || {}),
    ContenidoHTML: firstKnowledgeContentChunk(content),
  };
}

function collectTutorialIds(value, ids = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return ids;
  if (seen.has(value)) return ids;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectTutorialIds(item, ids, seen));
    return ids;
  }

  const tutorialId = String(value.TutorialID || value.tutorialId || '').trim();
  if (tutorialId) ids.add(tutorialId);
  Object.values(value).forEach((item) => collectTutorialIds(item, ids, seen));
  return ids;
}

function hydrateKnowledgeContent(value, contentMap, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => hydrateKnowledgeContent(item, contentMap, seen));
    return value;
  }

  const tutorialId = String(value.TutorialID || value.tutorialId || '').trim();
  const isArticle = Boolean(
    tutorialId
    && (
      Object.prototype.hasOwnProperty.call(value, 'ContenidoHTML')
      || Object.prototype.hasOwnProperty.call(value, 'Titulo')
    )
  );

  if (isArticle && contentMap.has(tutorialId)) {
    const fullContent = contentMap.get(tutorialId);
    value.ContenidoHTML = fullContent;
    if (Object.prototype.hasOwnProperty.call(value, 'contenidoHtml')) value.contenidoHtml = fullContent;
    if (Object.prototype.hasOwnProperty.call(value, 'Contenido')) value.Contenido = fullContent;
    if (Object.prototype.hasOwnProperty.call(value, 'contenido')) value.contenido = fullContent;
  }

  Object.values(value).forEach((item) => hydrateKnowledgeContent(item, contentMap, seen));
  return value;
}

async function hydrateResult(result) {
  const ids = [...collectTutorialIds(result)];
  if (!ids.length) return result;
  const contentMap = await readKnowledgeArticleContents(ids);
  if (!contentMap.size) return result;
  return hydrateKnowledgeContent(result, contentMap);
}

function resultTutorialId(result) {
  return String(
    result?.TutorialID
    || result?.tutorialId
    || result?.item?.TutorialID
    || result?.article?.TutorialID
    || result?.articulo?.TutorialID
    || '',
  ).trim();
}

knowledgeHandlers.list = async (ctx) => hydrateResult(await originalHandlers.list(ctx));

knowledgeHandlers.get = async (ctx) => hydrateResult(await originalHandlers.get(ctx));

knowledgeHandlers.create = async (ctx) => {
  const supplied = hasContentPayload(ctx.payload);
  const fullContent = supplied ? contentFromPayload(ctx.payload) : '';
  const longContent = supplied && isLongKnowledgeContent(fullContent);

  if (longContent) await ensureKnowledgeLongContentStorage();

  const result = await originalHandlers.create(
    longContent
      ? { ...ctx, payload: withSafeContentPayload(ctx.payload, fullContent) }
      : ctx,
  );

  const tutorialId = resultTutorialId(result);
  if (longContent && tutorialId) {
    await replaceKnowledgeArticleContent(tutorialId, fullContent, ctx.user?.UsuarioID || '');
  }

  return hydrateResult(result);
};

knowledgeHandlers.update = async (ctx) => {
  const supplied = hasContentPayload(ctx.payload);
  if (!supplied) return hydrateResult(await originalHandlers.update(ctx));

  const fullContent = contentFromPayload(ctx.payload);
  const longContent = isLongKnowledgeContent(fullContent);
  if (longContent) await ensureKnowledgeLongContentStorage();

  const result = await originalHandlers.update(
    longContent
      ? { ...ctx, payload: withSafeContentPayload(ctx.payload, fullContent) }
      : ctx,
  );

  const tutorialId = resultTutorialId(result) || String(
    ctx.payload?.tutorialId
    || ctx.payload?.TutorialID
    || ctx.payload?.articleId
    || ctx.payload?.ArticuloID
    || ctx.payload?.id
    || '',
  ).trim();

  if (tutorialId) {
    if (longContent) {
      await replaceKnowledgeArticleContent(tutorialId, fullContent, ctx.user?.UsuarioID || '');
    } else {
      await deactivateKnowledgeArticleContent(tutorialId, ctx.user?.UsuarioID || '');
    }
  }

  return hydrateResult(result);
};

knowledgeHandlers.delete = async (ctx) => {
  const result = await originalHandlers.delete(ctx);
  const tutorialId = String(
    ctx.payload?.tutorialId
    || ctx.payload?.TutorialID
    || ctx.payload?.articleId
    || ctx.payload?.ArticuloID
    || ctx.payload?.id
    || '',
  ).trim();
  if (tutorialId) await deactivateKnowledgeArticleContent(tutorialId, ctx.user?.UsuarioID || '');
  return result;
};
