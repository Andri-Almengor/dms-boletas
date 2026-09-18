import { transferKnowledgeAttachment } from '../services/large-evidence-upload.service.js';
import { appendRow, filterRows, findById, findRows, queryKnowledgeArticlePage, readTable, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, trashFile } from '../infra/drive.repository.js';
import { query } from '../infra/postgres.js';
import { createProtectedMediaStreamUrl } from '../services/protected-media-stream.service.js';
import { indexKnowledgeDocument } from '../ai/agent.knowledge-documents.js';
import { getConfig } from './config.module.js';
import { asBool, nowIso, pick, uuid } from '../core/utils.js';
import { badRequest, forbidden, notFound } from '../core/errors.js';
import { ensureKnowledgeCategoryStorage } from '../services/knowledge-category-storage.service.js';
import {
  buildKnowledgeEnrichmentIndex,
  indexedArticleCategoryIds,
  isActiveKnowledgeRelation,
} from '../services/knowledge-enrichment-index.js';

const CATEGORY_PAYLOAD_KEYS = [
  'categoriaIds',
  'CategoriaIDs',
  'CategoriaConocimientoIDs',
  'categories',
  'Categorias',
  'categoriaId',
  'CategoriaConocimientoID',
];

function tutorialIdFrom(payload = {}) {
  return pick(payload, ['tutorialId', 'TutorialID', 'articleId', 'ArticuloID', 'id']);
}

function attachmentIdFrom(payload = {}) {
  return pick(payload, ['attachmentId', 'adjuntoId', 'AdjuntoID', 'id']);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return String(value).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }
}

function categoryIdFrom(value) {
  if (value && typeof value === 'object') {
    return String(pick(value, ['CategoriaConocimientoID', 'CategoriaID', 'categoryId', 'id'], '')).trim();
  }
  return String(value || '').trim();
}

function normalizeCategoryIds(value) {
  return [...new Set(parseArray(value).map(categoryIdFrom).filter(Boolean))];
}

function hasCategoryPayload(payload = {}) {
  return CATEGORY_PAYLOAD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function categoryIdsFromPayload(payload = {}) {
  const multiValue = pick(payload, ['categoriaIds', 'CategoriaIDs', 'CategoriaConocimientoIDs', 'categories', 'Categorias'], null);
  const ids = normalizeCategoryIds(multiValue);
  if (ids.length) return ids;
  return normalizeCategoryIds(pick(payload, ['categoriaId', 'CategoriaConocimientoID'], ''));
}

function isActiveRelation(row) {
  return isActiveKnowledgeRelation(row);
}

function articleCategoryIds(article, relations = [], enrichmentIndex = null) {
  if (enrichmentIndex) return indexedArticleCategoryIds(article, enrichmentIndex);
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const related = relations
    .filter((row) => String(row.TutorialID || '') === tutorialId && isActiveRelation(row))
    .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0))
    .map((row) => String(row.CategoriaConocimientoID || '').trim())
    .filter(Boolean);
  const unique = [...new Set(related)];
  if (unique.length) return unique;
  const legacy = String(article.CategoriaConocimientoID || '').trim();
  return legacy ? [legacy] : [];
}

function normalizeUploadPayload(payload = {}) {
  const dataUrl = String(payload.dataUrl || '');
  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
    if (match) return { mimeType: payload.mimeType || match[1] || 'application/octet-stream', base64: match[2] };
  }
  return { mimeType: payload.mimeType || 'application/octet-stream', base64: payload.base64 || dataUrl };
}


function publicKnowledgeAttachment(row = {}) {
  return {
    AdjuntoID: row.AdjuntoID || '',
    TutorialID: row.TutorialID || '',
    Nombre: row.Nombre || 'Documento',
    MimeType: row.MimeType || 'application/octet-stream',
    Size: row.Size || row.SizeBytes || '',
    SizeBytes: Number(row.SizeBytes || row.Size || 0) || 0,
    IsPrimary: asBool(row.IsPrimary, false),
    ExtractionStatus: row.ExtractionStatus || row.Status || 'UPLOADED',
    ExtractionError: row.ExtractionError || '',
    IndexedAt: row.IndexedAt || '',
    Status: row.Status || 'UPLOADED',
    FechaCreacion: row.FechaCreacion || '',
    FechaActualizacion: row.FechaActualizacion || '',
    Activo: row.Activo !== false,
  };
}

function textFromHtml(value = '') {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function hasArticleContribution(payload = {}, existingAttachments = []) {
  const content = pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'], '');
  const videos = parseArray(payload.videos || payload.VideosJSON || payload.VideoURL);
  const pendingDocuments = Number(payload.pendingDocumentsCount || payload.PendingDocumentsCount || 0);
  return Boolean(textFromHtml(content) || videos.length || pendingDocuments > 0 || existingAttachments.length);
}

async function activeKnowledgeAttachments(tutorialId) {
  const rows = await findRows('KnowledgeAttachments', { TutorialID: [String(tutorialId)] }, { limit: 50_000 });
  return rows.filter((row) => row.__valid !== false && row.Activo !== false);
}

async function setPrimaryKnowledgeDocument(tutorialId, attachmentId, actor) {
  const rows = await activeKnowledgeAttachments(tutorialId);
  const target = rows.find((row) => String(row.AdjuntoID) === String(attachmentId));
  if (!target) throw notFound('No se encontró el documento principal solicitado.');
  const timestamp = nowIso();
  for (const row of rows) {
    const desired = String(row.AdjuntoID) === String(attachmentId);
    if (asBool(row.IsPrimary, false) !== desired) {
      await updateRow('KnowledgeAttachments', row.AdjuntoID, {
        IsPrimary: desired,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      });
    }
  }
  return publicKnowledgeAttachment(await findById('KnowledgeAttachments', attachmentId));
}

async function invalidateDocumentChunks(documentId) {
  await query(
    'UPDATE "KnowledgeDocumentChunks" SET "__valid"=FALSE WHERE "DocumentID"=$1 AND "__valid"=TRUE',
    [String(documentId)],
    { label: 'knowledge.documents.invalidateChunks', write: true },
  ).catch(() => {});
}

function canManageKnowledge(ctx) {
  return ctx.permissions?.includes('CONOCIMIENTO_GESTIONAR') || ctx.permissions?.includes('USUARIOS_GESTIONAR');
}

function isAuthor(ctx, article) {
  return Boolean(ctx.user?.UsuarioID) && String(article.AutorUsuarioID || '') === String(ctx.user.UsuarioID);
}

function isPublished(article) {
  return String(article.Estado || 'PUBLICADO').trim().toUpperCase() === 'PUBLICADO';
}

function assertArticleRead(ctx, article) {
  if (isPublished(article) || canManageKnowledge(ctx) || isAuthor(ctx, article)) return;
  throw forbidden('No cuenta con permiso para consultar este borrador.');
}

function assertArticleWrite(ctx, article) {
  if (canManageKnowledge(ctx) || isAuthor(ctx, article)) return;
  throw forbidden('Solo el autor o un administrador puede modificar este tutorial.');
}

function categoryViews(categoryIds, categories, enrichmentIndex = null) {
  const categoryMap = enrichmentIndex?.categoriesById
    || new Map(categories.map((item) => [String(item.CategoriaConocimientoID), item]));
  return categoryIds.map((id, index) => {
    const row = categoryMap.get(String(id));
    return {
      id: String(id),
      CategoriaConocimientoID: String(id),
      name: row?.Nombre || `Categoría ${index + 1}`,
      Nombre: row?.Nombre || `Categoría ${index + 1}`,
      order: index + 1,
      Orden: index + 1,
    };
  });
}

function enrichArticle(article, attachments, categories, users = [], relations = [], enrichmentIndex = null) {
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const ids = articleCategoryIds(article, relations, enrichmentIndex);
  const categoryList = categoryViews(ids, categories, enrichmentIndex);
  const categoryNames = categoryList.map((item) => item.name);
  const primaryCategory = categoryList[0] || null;
  const author = enrichmentIndex
    ? enrichmentIndex.usersById.get(String(article.AutorUsuarioID))
    : users.find((item) => String(item.UsuarioID) === String(article.AutorUsuarioID));
  const relatedAttachments = enrichmentIndex
    ? (enrichmentIndex.attachmentsByTutorialId.get(tutorialId) || [])
    : attachments.filter((item) => String(item.TutorialID || item.ArticuloID || item.ArticuloRef) === tutorialId && item.Activo !== false);
  const item = {
    ...article,
    TutorialID: tutorialId,
    CategoriaConocimientoID: primaryCategory?.id || article.CategoriaConocimientoID || '',
    CategoriaConocimientoIDs: ids,
    CategoriaIDs: ids,
    Categorias: categoryList,
    Categories: categoryList,
    categories: categoryList,
    CategoriaPrincipalNombre: primaryCategory?.name || '',
    CategoriaNombre: categoryNames.join(' + '),
    Categoria: categoryNames.join(' + ') || article.CategoriaNombre || article.Categoria || '',
    CategoriasNombres: categoryNames.join(' + '),
    AutorNombre: article.AutorNombre || author?.NombreCompleto || author?.Nombre || author?.NombreUsuario || '',
    Videos: parseArray(article.VideosJSON || article.Videos || article.VideoURL),
    Adjuntos: relatedAttachments.map(publicKnowledgeAttachment),
    Attachments: relatedAttachments.map(publicKnowledgeAttachment),
    attachments: relatedAttachments.map(publicKnowledgeAttachment),
  };
  return {
    TutorialID: tutorialId,
    tutorialId,
    item,
    article: item,
    articulo: item,
    attachments: relatedAttachments.map(publicKnowledgeAttachment),
    adjuntos: relatedAttachments.map(publicKnowledgeAttachment),
  };
}

async function knowledgeTables() {
  await ensureKnowledgeCategoryStorage();
  return readTables(['KnowledgeAttachments', 'KnowledgeCategories', 'KnowledgeArticleCategories', 'Usuarios']);
}

async function enrich(article) {
  const tables = await knowledgeTables();
  return enrichArticle(article, tables.KnowledgeAttachments, tables.KnowledgeCategories, tables.Usuarios, tables.KnowledgeArticleCategories);
}

async function findArticleByAttachment(attachment) {
  const id = String(attachment.TutorialID || attachment.ArticuloID || attachment.ArticuloRef || '');
  if (!id) throw notFound('El archivo no tiene un tutorial asociado.');
  return findById('KnowledgeArticles', id, 'TutorialID');
}

async function validateCategoryIds(categoryIds) {
  if (!categoryIds.length) throw badRequest('Seleccione al menos una categoría para el tutorial.');
  const categories = await readTable('KnowledgeCategories');
  const known = new Set(categories.map((row) => String(row.CategoriaConocimientoID || '')));
  const missing = categoryIds.filter((id) => !known.has(String(id)));
  if (missing.length) throw badRequest('Una o más categorías seleccionadas ya no existen. Actualice la página y vuelva a intentarlo.');
}

async function syncArticleCategories(tutorialId, categoryIds, ctx) {
  await ensureKnowledgeCategoryStorage();
  await validateCategoryIds(categoryIds);
  const rows = await readTable('KnowledgeArticleCategories', { force: true });
  const related = rows.filter((row) => String(row.TutorialID || '') === String(tutorialId));
  const timestamp = nowIso();
  const desired = new Set(categoryIds.map(String));

  for (const row of related) {
    const categoryId = String(row.CategoriaConocimientoID || '');
    const firstMatching = related.find((candidate) => (
      String(candidate.CategoriaConocimientoID || '') === categoryId
      && String(candidate.RelacionArticuloCategoriaID) === String(row.RelacionArticuloCategoriaID)
    ));
    const duplicate = firstMatching !== row;
    if ((duplicate || !desired.has(categoryId)) && isActiveRelation(row)) {
      await updateRow('KnowledgeArticleCategories', row.RelacionArticuloCategoriaID, {
        Activo: false,
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: timestamp,
      });
    }
  }

  for (let index = 0; index < categoryIds.length; index += 1) {
    const categoryId = String(categoryIds[index]);
    const matches = related.filter((row) => String(row.CategoriaConocimientoID || '') === categoryId);
    const active = matches.find(isActiveRelation);
    const reusable = active || matches[0];
    if (reusable) {
      if (!isActiveRelation(reusable) || Number(reusable.Orden || 0) !== index + 1) {
        await updateRow('KnowledgeArticleCategories', reusable.RelacionArticuloCategoriaID, {
          Orden: index + 1,
          Activo: true,
          ActualizadoPor: ctx.user.UsuarioID,
          FechaActualizacion: timestamp,
        });
      }
      continue;
    }
    await appendRow('KnowledgeArticleCategories', {
      RelacionArticuloCategoriaID: uuid(),
      TutorialID: tutorialId,
      CategoriaConocimientoID: categoryId,
      Orden: index + 1,
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    });
  }
}

async function deactivateArticleCategories(tutorialId, actor) {
  await ensureKnowledgeCategoryStorage();
  const rows = await readTable('KnowledgeArticleCategories', { force: true });
  const active = rows.filter((row) => String(row.TutorialID || '') === String(tutorialId) && isActiveRelation(row));
  for (const row of active) {
    await updateRow('KnowledgeArticleCategories', row.RelacionArticuloCategoriaID, {
      Activo: false,
      ActualizadoPor: actor,
      FechaActualizacion: nowIso(),
    });
  }
}

export const knowledgeHandlers = {
  list: async (ctx) => {
    const { payload = {} } = ctx;
    await ensureKnowledgeCategoryStorage();
    const manager = canManageKnowledge(ctx);
    const page = await queryKnowledgeArticlePage(payload, {
      viewerUserId: ctx.user?.UsuarioID || '',
      canManage: manager,
    });
    if (!page.items.length) return page;

    const tutorialIds = page.items.map((article) => String(article.TutorialID || '')).filter(Boolean);
    const authorIds = [...new Set(page.items.map((article) => String(article.AutorUsuarioID || '')).filter(Boolean))];
    const [attachments, relations, users] = await Promise.all([
      findRows('KnowledgeAttachments', { TutorialID: tutorialIds }, { limit: 50_000 }),
      findRows('KnowledgeArticleCategories', { TutorialID: tutorialIds }, { limit: 50_000 }),
      authorIds.length ? findRows('Usuarios', { UsuarioID: authorIds }, { limit: 50_000 }) : Promise.resolve([]),
    ]);
    const categoryIds = [...new Set([
      ...page.items.map((article) => String(article.CategoriaConocimientoID || '')).filter(Boolean),
      ...relations.map((row) => String(row.CategoriaConocimientoID || '')).filter(Boolean),
    ])];
    const categories = categoryIds.length
      ? await findRows('KnowledgeCategories', { CategoriaConocimientoID: categoryIds }, { limit: 50_000 })
      : [];
    const enrichmentIndex = buildKnowledgeEnrichmentIndex({ attachments, categories, users, relations });
    return {
      ...page,
      items: page.items.map((article) => enrichArticle(
        article,
        attachments,
        categories,
        users,
        relations,
        enrichmentIndex,
      ).item),
    };
  },

  get: async (ctx) => {
    const article = await findById('KnowledgeArticles', tutorialIdFrom(ctx.payload), 'TutorialID');
    assertArticleRead(ctx, article);
    return enrich(article);
  },

  create: async (ctx) => {
    const payload = ctx.payload;
    const categoryIds = categoryIdsFromPayload(payload);
    await ensureKnowledgeCategoryStorage();
    await validateCategoryIds(categoryIds);
    const title = pick(payload, ['Titulo', 'titulo']);
    if (!String(title || '').trim()) throw badRequest('El título del tutorial es obligatorio.');
    if (!hasArticleContribution(payload)) throw badRequest('Agregue contenido, un documento o un video para crear la guía.');
    const row = {
      TutorialID: uuid(),
      Titulo: title,
      CategoriaConocimientoID: categoryIds[0],
      ProblemaResuelto: pick(payload, ['ProblemaResuelto', 'problemaResuelto', 'Resumen', 'resumen']),
      ContenidoHTML: pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido']),
      VideosJSON: JSON.stringify(parseArray(payload.videos || payload.VideosJSON || payload.VideoURL)),
      Estado: pick(payload, ['Estado', 'estado'], 'PUBLICADO'),
      Activo: true,
      AutorUsuarioID: ctx.user.UsuarioID,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    await appendRow('KnowledgeArticles', row);
    await syncArticleCategories(row.TutorialID, categoryIds, ctx);
    return enrich(row);
  },

  update: async (ctx) => {
    const payload = ctx.payload;
    const id = tutorialIdFrom(payload);
    const before = await findById('KnowledgeArticles', id, 'TutorialID');
    assertArticleWrite(ctx, before);
    const categoriesSupplied = hasCategoryPayload(payload);
    const categoryIds = categoriesSupplied ? categoryIdsFromPayload(payload) : null;
    if (categoryIds) await validateCategoryIds(categoryIds);
    const existingAttachments = await activeKnowledgeAttachments(id);
    const prospective = {
      ...payload,
      ContenidoHTML: pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'], before.ContenidoHTML),
      VideosJSON: payload.videos || payload.VideosJSON || before.VideosJSON,
    };
    if (!hasArticleContribution(prospective, existingAttachments)) throw badRequest('La guía debe conservar contenido, al menos un documento o un video.');
    const row = await updateRow('KnowledgeArticles', id, {
      Titulo: pick(payload, ['Titulo', 'titulo'], before.Titulo),
      CategoriaConocimientoID: categoryIds ? categoryIds[0] : before.CategoriaConocimientoID,
      ProblemaResuelto: pick(payload, ['ProblemaResuelto', 'problemaResuelto', 'Resumen', 'resumen'], before.ProblemaResuelto),
      ContenidoHTML: pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'], before.ContenidoHTML),
      VideosJSON: JSON.stringify(parseArray(payload.videos || payload.VideosJSON || before.VideosJSON)),
      Estado: pick(payload, ['Estado', 'estado'], before.Estado),
      AutorUsuarioID: before.AutorUsuarioID || ctx.user.UsuarioID,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    }, 'TutorialID');
    if (categoryIds) await syncArticleCategories(id, categoryIds, ctx);
    return enrich(row);
  },

  delete: async (ctx) => {
    const id = tutorialIdFrom(ctx.payload);
    const article = await findById('KnowledgeArticles', id, 'TutorialID');
    assertArticleWrite(ctx, article);
    await deactivateArticleCategories(id, ctx.user.UsuarioID);
    return softDelete('KnowledgeArticles', id, ctx.user.UsuarioID);
  },

  attachmentUpload: async (ctx) => {
    const article = await findById('KnowledgeArticles', tutorialIdFrom(ctx.payload), 'TutorialID');
    assertArticleWrite(ctx, article);
    const replaceAttachmentId = String(pick(ctx.payload, ['replaceAttachmentId', 'ReplaceAttachmentID'], '') || '').trim();
    const replacing = replaceAttachmentId ? await findById('KnowledgeAttachments', replaceAttachmentId) : null;
    if (replacing && String(replacing.TutorialID) !== String(article.TutorialID)) throw badRequest('El documento a reemplazar no pertenece a esta guía.');
    const cfg = await getConfig();
    const transfer = ctx.payload.uploadPhase
      ? await transferKnowledgeAttachment(ctx, article.TutorialID, cfg.ROOT_FOLDER_ID) : null;
    if (transfer && !transfer.file) return transfer;
    const upload = normalizeUploadPayload(ctx.payload);
    const file = transfer?.file || await uploadBase64({
      base64: upload.base64,
      mimeType: upload.mimeType,
      fileName: ctx.payload.fileName || ctx.payload.nombre,
      folderId: cfg.ROOT_FOLDER_ID,
    });
    const existing = await activeKnowledgeAttachments(article.TutorialID);
    const requestedPrimary = asBool(ctx.payload.isPrimary ?? ctx.payload.IsPrimary, false);
    const isPrimary = requestedPrimary || existing.length === 0 || asBool(replacing?.IsPrimary, false);
    if (isPrimary) {
      for (const item of existing) {
        if (asBool(item.IsPrimary, false)) await updateRow('KnowledgeAttachments', item.AdjuntoID, {
          IsPrimary: false,
          ActualizadoPor: ctx.user.UsuarioID,
          FechaActualizacion: nowIso(),
        });
      }
    }
    const timestamp = nowIso();
    const row = {
      AdjuntoID: transfer?.token?.attachmentId || uuid(),
      TutorialID: article.TutorialID,
      Nombre: pick(ctx.payload, ['nombre', 'Nombre'], file.name),
      MimeType: file.mimeType || upload.mimeType,
      Size: String(ctx.payload.size || file.size || ''),
      SizeBytes: Number(ctx.payload.size || file.size || 0) || 0,
      DriveFileID: file.id,
      DriveURL: file.webViewLink,
      IsPrimary: isPrimary,
      ExtractionStatus: 'UPLOADED',
      ExtractionError: '',
      IndexedAt: '',
      SearchText: '',
      Status: 'UPLOADED',
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    await appendRow('KnowledgeAttachments', row);
    if (replacing) {
      await invalidateDocumentChunks(replacing.AdjuntoID);
      await trashFile(replacing.DriveFileID).catch(() => {});
      await softDelete('KnowledgeAttachments', replacing.AdjuntoID, ctx.user.UsuarioID);
    }
    void indexKnowledgeDocument(row, ctx.user.UsuarioID).catch(() => {});
    const safeRow = publicKnowledgeAttachment(row);
    return transfer ? {complete:true,evidence:safeRow} : safeRow;
  },

  attachmentDelete: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleWrite(ctx, article);
    const wasPrimary = asBool(row.IsPrimary, false);
    await invalidateDocumentChunks(row.AdjuntoID);
    await trashFile(row.DriveFileID).catch(() => {});
    const deleted = await softDelete('KnowledgeAttachments', row.AdjuntoID, ctx.user.UsuarioID);
    if (wasPrimary) {
      const remaining = await activeKnowledgeAttachments(article.TutorialID);
      if (remaining[0]) await setPrimaryKnowledgeDocument(article.TutorialID, remaining[0].AdjuntoID, ctx.user.UsuarioID);
    }
    return deleted;
  },

  attachmentPrimary: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleWrite(ctx, article);
    return setPrimaryKnowledgeDocument(article.TutorialID, row.AdjuntoID, ctx.user.UsuarioID);
  },

  attachmentReindex: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleWrite(ctx, article);
    await updateRow('KnowledgeAttachments', row.AdjuntoID, {
      ExtractionStatus: 'UPLOADED',
      ExtractionError: '',
      IndexedAt: '',
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    });
    void indexKnowledgeDocument({ ...row, ExtractionStatus: 'UPLOADED' }, ctx.user.UsuarioID).catch(() => {});
    return { ok: true, AdjuntoID: row.AdjuntoID, ExtractionStatus: 'PROCESSING' };
  },

  mediaGet: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleRead(ctx, article);
    const common = {
      fileId: row.DriveFileID,
      mimeType: row.MimeType || 'application/octet-stream',
      boletaUid: 'knowledge:' + article.TutorialID,
      evidenceId: row.AdjuntoID,
      kind: 'knowledge-document',
      userId: ctx.user.UsuarioID,
      sessionToken: ctx.sessionToken,
      fileName: row.Nombre || 'documento',
    };
    const inlineUrl = createProtectedMediaStreamUrl({ ...common, disposition: 'inline' });
    const downloadUrl = createProtectedMediaStreamUrl({ ...common, disposition: 'attachment' });
    return {
      ...publicKnowledgeAttachment(row),
      inlineUrl,
      downloadUrl,
      url: inlineUrl,
    };
  },
};