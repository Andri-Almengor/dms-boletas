import { appendRow, filterRows, findById, readTable, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { getConfig } from './config.module.js';
import { asBool, nowIso, pick, uuid } from '../core/utils.js';
import { badRequest, forbidden, notFound } from '../core/errors.js';
import { ensureKnowledgeCategoryStorage } from '../services/knowledge-category-storage.service.js';

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
  return row?.Activo !== false
    && String(row?.Activo ?? 'true').toLowerCase() !== 'false'
    && String(row?.Estado || '').toUpperCase() !== 'INACTIVO';
}

function articleCategoryIds(article, relations = []) {
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

function categoryViews(categoryIds, categories) {
  const categoryMap = new Map(categories.map((item) => [String(item.CategoriaConocimientoID), item]));
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

function enrichArticle(article, attachments, categories, users = [], relations = []) {
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const ids = articleCategoryIds(article, relations);
  const categoryList = categoryViews(ids, categories);
  const categoryNames = categoryList.map((item) => item.name);
  const primaryCategory = categoryList[0] || null;
  const author = users.find((item) => String(item.UsuarioID) === String(article.AutorUsuarioID));
  const relatedAttachments = attachments.filter((item) => String(item.TutorialID || item.ArticuloID || item.ArticuloRef) === tutorialId && item.Activo !== false);
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
    Adjuntos: relatedAttachments,
    Attachments: relatedAttachments,
    attachments: relatedAttachments,
  };
  return {
    TutorialID: tutorialId,
    tutorialId,
    item,
    article: item,
    articulo: item,
    attachments: relatedAttachments,
    adjuntos: relatedAttachments,
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
    const tables = await readTables(['KnowledgeArticles', 'KnowledgeAttachments', 'KnowledgeCategories', 'KnowledgeArticleCategories', 'Usuarios']);
    const includeDrafts = asBool(payload.includeDrafts, false);
    const requestedAuthor = String(payload.autorUsuarioId || payload.AutorUsuarioID || '').trim();
    const requestedCategory = String(payload.categoriaId || payload.CategoriaConocimientoID || '').trim();
    const manager = canManageKnowledge(ctx);

    let rows = tables.KnowledgeArticles
      .filter((article) => article.Activo !== false)
      .filter((article) => {
        if (isPublished(article)) return true;
        return includeDrafts && (manager || isAuthor(ctx, article));
      });

    if (requestedAuthor) rows = rows.filter((article) => String(article.AutorUsuarioID || '') === requestedAuthor);
    if (requestedCategory) {
      rows = rows.filter((article) => articleCategoryIds(article, tables.KnowledgeArticleCategories).includes(requestedCategory));
    }

    rows = rows.map((article) => enrichArticle(
      article,
      tables.KnowledgeAttachments,
      tables.KnowledgeCategories,
      tables.Usuarios,
      tables.KnowledgeArticleCategories,
    ).item);
    return filterRows(rows, payload, ['Titulo', 'ProblemaResuelto', 'ContenidoHTML', 'CategoriaNombre', 'CategoriasNombres', 'AutorNombre']);
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
    const cfg = await getConfig();
    const upload = normalizeUploadPayload(ctx.payload);
    const file = await uploadBase64({
      base64: upload.base64,
      mimeType: upload.mimeType,
      fileName: ctx.payload.fileName || ctx.payload.nombre,
      folderId: cfg.ROOT_FOLDER_ID,
    });
    const row = {
      AdjuntoID: uuid(),
      TutorialID: article.TutorialID,
      Nombre: pick(ctx.payload, ['nombre', 'Nombre'], file.name),
      MimeType: file.mimeType,
      Size: ctx.payload.size || file.size || '',
      DriveFileID: file.id,
      DriveURL: file.webViewLink,
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
    };
    await appendRow('KnowledgeAttachments', row);
    return row;
  },

  attachmentDelete: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleWrite(ctx, article);
    await trashFile(row.DriveFileID).catch(() => {});
    return softDelete('KnowledgeAttachments', row.AdjuntoID, ctx.user.UsuarioID);
  },

  mediaGet: async (ctx) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(ctx.payload));
    const article = await findArticleByAttachment(row);
    assertArticleRead(ctx, article);
    return { AdjuntoID: row.AdjuntoID, ...await downloadAsDataUrl(row.DriveFileID, row.MimeType) };
  },
};
