import { appendRow, filterRows, findById, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { getConfig } from './config.module.js';
import { asBool, nowIso, pick, uuid } from '../core/utils.js';
import { forbidden, notFound } from '../core/errors.js';

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
    return [String(value)];
  }
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

function enrichArticle(article, attachments, categories, users = []) {
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const category = categories.find((item) => String(item.CategoriaConocimientoID) === String(article.CategoriaConocimientoID));
  const author = users.find((item) => String(item.UsuarioID) === String(article.AutorUsuarioID));
  const relatedAttachments = attachments.filter((item) => String(item.TutorialID || item.ArticuloID || item.ArticuloRef) === tutorialId && item.Activo !== false);
  const item = {
    ...article,
    TutorialID: tutorialId,
    CategoriaNombre: article.CategoriaNombre || category?.Nombre || '',
    Categoria: article.Categoria || category?.Nombre || '',
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
  return readTables(['KnowledgeAttachments', 'KnowledgeCategories', 'Usuarios']);
}

async function enrich(article) {
  const tables = await knowledgeTables();
  return enrichArticle(article, tables.KnowledgeAttachments, tables.KnowledgeCategories, tables.Usuarios);
}

async function findArticleByAttachment(attachment) {
  const id = String(attachment.TutorialID || attachment.ArticuloID || attachment.ArticuloRef || '');
  if (!id) throw notFound('El archivo no tiene un tutorial asociado.');
  return findById('KnowledgeArticles', id, 'TutorialID');
}

export const knowledgeHandlers = {
  list: async (ctx) => {
    const { payload = {} } = ctx;
    const tables = await readTables(['KnowledgeArticles', 'KnowledgeAttachments', 'KnowledgeCategories', 'Usuarios']);
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
    if (requestedCategory) rows = rows.filter((article) => String(article.CategoriaConocimientoID || '') === requestedCategory);

    rows = rows.map((article) => enrichArticle(article, tables.KnowledgeAttachments, tables.KnowledgeCategories, tables.Usuarios).item);
    return filterRows(rows, payload, ['Titulo', 'ProblemaResuelto', 'ContenidoHTML', 'CategoriaNombre', 'AutorNombre']);
  },

  get: async (ctx) => {
    const article = await findById('KnowledgeArticles', tutorialIdFrom(ctx.payload), 'TutorialID');
    assertArticleRead(ctx, article);
    return enrich(article);
  },

  create: async (ctx) => {
    const payload = ctx.payload;
    const row = {
      TutorialID: uuid(),
      Titulo: pick(payload, ['Titulo', 'titulo']),
      CategoriaConocimientoID: pick(payload, ['CategoriaConocimientoID', 'categoriaId']),
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
    return enrich(row);
  },

  update: async (ctx) => {
    const payload = ctx.payload;
    const id = tutorialIdFrom(payload);
    const before = await findById('KnowledgeArticles', id, 'TutorialID');
    assertArticleWrite(ctx, before);
    const row = await updateRow('KnowledgeArticles', id, {
      Titulo: pick(payload, ['Titulo', 'titulo'], before.Titulo),
      CategoriaConocimientoID: pick(payload, ['CategoriaConocimientoID', 'categoriaId'], before.CategoriaConocimientoID),
      ProblemaResuelto: pick(payload, ['ProblemaResuelto', 'problemaResuelto', 'Resumen', 'resumen'], before.ProblemaResuelto),
      ContenidoHTML: pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'], before.ContenidoHTML),
      VideosJSON: JSON.stringify(parseArray(payload.videos || payload.VideosJSON || before.VideosJSON)),
      Estado: pick(payload, ['Estado', 'estado'], before.Estado),
      AutorUsuarioID: before.AutorUsuarioID || ctx.user.UsuarioID,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    }, 'TutorialID');
    return enrich(row);
  },

  delete: async (ctx) => {
    const id = tutorialIdFrom(ctx.payload);
    const article = await findById('KnowledgeArticles', id, 'TutorialID');
    assertArticleWrite(ctx, article);
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
