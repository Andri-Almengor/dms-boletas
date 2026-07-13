import { appendRow, filterRows, findById, readTables, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { getConfig } from './config.module.js';
import { nowIso, pick, uuid } from '../core/utils.js';

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

function enrichArticle(article, attachments, categories) {
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const category = categories.find((item) => String(item.CategoriaConocimientoID) === String(article.CategoriaConocimientoID));
  const relatedAttachments = attachments.filter((item) => String(item.TutorialID || item.ArticuloID || item.ArticuloRef) === tutorialId && item.Activo !== false);
  const item = {
    ...article,
    TutorialID: tutorialId,
    CategoriaNombre: article.CategoriaNombre || category?.Nombre || '',
    Categoria: article.Categoria || category?.Nombre || '',
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

async function enrich(article) {
  const tables = await readTables(['KnowledgeAttachments', 'KnowledgeCategories']);
  return enrichArticle(article, tables.KnowledgeAttachments, tables.KnowledgeCategories);
}

export const knowledgeHandlers = {
  list: async ({ payload }) => {
    const tables = await readTables(['KnowledgeArticles', 'KnowledgeAttachments', 'KnowledgeCategories']);
    const rows = tables.KnowledgeArticles
      .filter((article) => article.Activo !== false)
      .map((article) => enrichArticle(article, tables.KnowledgeAttachments, tables.KnowledgeCategories).item);
    return filterRows(rows, payload, ['Titulo', 'ProblemaResuelto', 'ContenidoHTML', 'CategoriaNombre']);
  },

  get: async ({ payload }) => enrich(await findById('KnowledgeArticles', tutorialIdFrom(payload), 'TutorialID')),

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
      AutorUsuarioID: pick(payload, ['AutorUsuarioID', 'autorUsuarioId'], ctx.user.UsuarioID),
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
    const row = await updateRow('KnowledgeArticles', id, {
      Titulo: pick(payload, ['Titulo', 'titulo'], before.Titulo),
      CategoriaConocimientoID: pick(payload, ['CategoriaConocimientoID', 'categoriaId'], before.CategoriaConocimientoID),
      ProblemaResuelto: pick(payload, ['ProblemaResuelto', 'problemaResuelto', 'Resumen', 'resumen'], before.ProblemaResuelto),
      ContenidoHTML: pick(payload, ['ContenidoHTML', 'contenidoHtml', 'Contenido', 'contenido'], before.ContenidoHTML),
      VideosJSON: JSON.stringify(parseArray(payload.videos || payload.VideosJSON || before.VideosJSON)),
      Estado: pick(payload, ['Estado', 'estado'], before.Estado),
      AutorUsuarioID: pick(payload, ['AutorUsuarioID', 'autorUsuarioId'], before.AutorUsuarioID || ctx.user.UsuarioID),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    }, 'TutorialID');
    return enrich(row);
  },

  delete: async (ctx) => softDelete('KnowledgeArticles', tutorialIdFrom(ctx.payload), ctx.user.UsuarioID),

  attachmentUpload: async (ctx) => {
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
      TutorialID: tutorialIdFrom(ctx.payload),
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
    await trashFile(row.DriveFileID).catch(() => {});
    return softDelete('KnowledgeAttachments', row.AdjuntoID, ctx.user.UsuarioID);
  },

  mediaGet: async ({ payload }) => {
    const row = await findById('KnowledgeAttachments', attachmentIdFrom(payload));
    return { AdjuntoID: row.AdjuntoID, ...await downloadAsDataUrl(row.DriveFileID, row.MimeType) };
  },
};
