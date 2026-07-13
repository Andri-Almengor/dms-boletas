/**
 * DMS BOLETAS - MÓDULO DE BASE DE CONOCIMIENTOS
 *
 * Compatible con el backend que utiliza:
 *   - ROUTES + handleRequest_
 *   - getRows_, insertObject_, updateById_, requireRecord_
 *   - listTable_, getEffectivePermissions_, apiError_, audit_, toBoolean_
 *
 * INSTALACIÓN:
 * 1. Agregue este archivo al mismo proyecto de Apps Script del backend.
 * 2. Copie las rutas indicadas abajo dentro del objeto ROUTES de Code.gs.
 * 3. Ejecute setupKnowledgeBaseModule() una sola vez.
 * 4. Cree una nueva implementación del Web App.
 *
 * RUTAS PARA PEGAR DENTRO DE ROUTES:
 *
 * 'knowledge.list': { handler: apiKnowledgeList_, permission: 'BOLETAS_VER' },
 * 'knowledge.get': { handler: apiKnowledgeGet_, permission: 'BOLETAS_VER' },
 * 'knowledge.create': { handler: apiKnowledgeCreate_, permission: 'BOLETAS_CREAR' },
 * 'knowledge.update': { handler: apiKnowledgeUpdate_, permission: 'BOLETAS_CREAR' },
 * 'knowledge.delete': { handler: apiKnowledgeDelete_, permission: 'USUARIOS_GESTIONAR' },
 * 'knowledge.attachments.upload': { handler: apiKnowledgeAttachmentUpload_, permission: 'BOLETAS_CREAR' },
 * 'knowledge.attachments.delete': { handler: apiKnowledgeAttachmentDelete_, permission: 'BOLETAS_CREAR' },
 * 'knowledge.media.get': { handler: apiKnowledgeMediaGet_, permission: 'BOLETAS_VER' },
 * 'knowledge.categories.list': { handler: apiKnowledgeCategoriesList_, permission: 'BOLETAS_VER' },
 * 'knowledge.categories.create': { handler: apiKnowledgeCategoriesCreate_, permission: 'USUARIOS_GESTIONAR' },
 * 'knowledge.categories.update': { handler: apiKnowledgeCategoriesUpdate_, permission: 'USUARIOS_GESTIONAR' },
 */

var KNOWLEDGE_SHEETS_ = Object.freeze({
  CATEGORIES: 'KnowledgeCategories',
  ARTICLES: 'KnowledgeArticles',
  ATTACHMENTS: 'KnowledgeAttachments'
});

var KNOWLEDGE_HEADERS_ = Object.freeze({
  KnowledgeCategories: [
    'CategoriaConocimientoID', 'Nombre', 'Descripcion', 'Activo',
    'CreadoPor', 'FechaCreacion', 'ActualizadoPor', 'FechaActualizacion'
  ],
  KnowledgeArticles: [
    'TutorialID', 'Titulo', 'CategoriaConocimientoID', 'ProblemaResuelto',
    'ContenidoHTML', 'VideosJSON', 'Estado', 'Activo', 'AutorUsuarioID',
    'CreadoPor', 'FechaCreacion', 'ActualizadoPor', 'FechaActualizacion'
  ],
  KnowledgeAttachments: [
    'AdjuntoID', 'TutorialID', 'Nombre', 'MimeType', 'Size', 'DriveFileID',
    'DriveURL', 'Activo', 'CreadoPor', 'FechaCreacion'
  ]
});

var KNOWLEDGE_MAX_FILE_BYTES_ = 20 * 1024 * 1024;
var KNOWLEDGE_ALLOWED_MIME_ = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\..+|zip)|text\/(plain|csv)|image\/.+|video\/.+)$/i;

function setupKnowledgeBaseModule() {
  var spreadsheet = ss_();
  Object.keys(KNOWLEDGE_HEADERS_).forEach(function (sheetName) {
    ensureKnowledgeSheet_(spreadsheet, sheetName, KNOWLEDGE_HEADERS_[sheetName]);
  });

  var categories = getRows_(KNOWLEDGE_SHEETS_.CATEGORIES);
  if (categories.length === 0) {
    var now = new Date();
    ['Lenel', 'Milestone', 'Axis', 'Barco', 'General'].forEach(function (name) {
      insertObject_(KNOWLEDGE_SHEETS_.CATEGORIES, {
        CategoriaConocimientoID: Utilities.getUuid(),
        Nombre: name,
        Descripcion: 'Documentación técnica de ' + name,
        Activo: true,
        CreadoPor: 'setup',
        FechaCreacion: now,
        ActualizadoPor: 'setup',
        FechaActualizacion: now
      });
    });
  }

  var folder = getKnowledgeRootFolder_();
  return {
    ok: true,
    sheets: Object.keys(KNOWLEDGE_HEADERS_),
    folderId: folder.getId(),
    folderUrl: folder.getUrl()
  };
}

function apiKnowledgeCategoriesList_(ctx) {
  return listTable_(KNOWLEDGE_SHEETS_.CATEGORIES, ctx.payload, {
    searchFields: ['Nombre', 'Descripcion'],
    filterMap: { activo: 'Activo' }
  });
}

function apiKnowledgeCategoriesCreate_(ctx) {
  var name = String(ctx.payload.nombre || ctx.payload.Nombre || '').trim();
  if (!name) throw apiError_('VALIDATION_ERROR', 'El nombre de la categoría es obligatorio.', 400);

  var duplicate = getRows_(KNOWLEDGE_SHEETS_.CATEGORIES).some(function (row) {
    return String(row.Nombre || '').trim().toLowerCase() === name.toLowerCase();
  });
  if (duplicate) throw apiError_('DUPLICATE_CATEGORY', 'Ya existe una categoría con ese nombre.', 409);

  var now = new Date();
  var row = {
    CategoriaConocimientoID: Utilities.getUuid(),
    Nombre: name,
    Descripcion: String(ctx.payload.descripcion || ctx.payload.Descripcion || '').trim(),
    Activo: ctx.payload.activo === undefined ? true : toBoolean_(ctx.payload.activo),
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: now,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: now
  };
  insertObject_(KNOWLEDGE_SHEETS_.CATEGORIES, row);
  auditKnowledge_(ctx, 'CREAR_CATEGORIA', KNOWLEDGE_SHEETS_.CATEGORIES, row.CategoriaConocimientoID, null, row);
  return row;
}

function apiKnowledgeCategoriesUpdate_(ctx) {
  var id = String(ctx.payload.categoriaId || ctx.payload.CategoriaConocimientoID || '').trim();
  var before = requireRecord_(KNOWLEDGE_SHEETS_.CATEGORIES, 'CategoriaConocimientoID', id);
  var patch = {
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: new Date()
  };
  if (ctx.payload.nombre !== undefined || ctx.payload.Nombre !== undefined) {
    patch.Nombre = String(ctx.payload.nombre || ctx.payload.Nombre || '').trim();
    if (!patch.Nombre) throw apiError_('VALIDATION_ERROR', 'El nombre no puede quedar vacío.', 400);
  }
  if (ctx.payload.descripcion !== undefined || ctx.payload.Descripcion !== undefined) {
    patch.Descripcion = String(ctx.payload.descripcion || ctx.payload.Descripcion || '').trim();
  }
  if (ctx.payload.activo !== undefined || ctx.payload.Activo !== undefined) {
    patch.Activo = toBoolean_(ctx.payload.activo !== undefined ? ctx.payload.activo : ctx.payload.Activo);
  }
  updateById_(KNOWLEDGE_SHEETS_.CATEGORIES, 'CategoriaConocimientoID', id, patch);
  var after = requireRecord_(KNOWLEDGE_SHEETS_.CATEGORIES, 'CategoriaConocimientoID', id);
  auditKnowledge_(ctx, 'EDITAR_CATEGORIA', KNOWLEDGE_SHEETS_.CATEGORIES, id, before, after);
  return after;
}

function apiKnowledgeList_(ctx) {
  var payload = ctx.payload || {};
  var result = listTable_(KNOWLEDGE_SHEETS_.ARTICLES, payload, {
    searchFields: ['Titulo', 'ProblemaResuelto', 'ContenidoHTML', 'Estado'],
    filterMap: {
      categoriaId: 'CategoriaConocimientoID',
      autorUsuarioId: 'AutorUsuarioID',
      estado: 'Estado',
      activo: 'Activo'
    }
  });

  var canManage = canManageKnowledge_(ctx.user.UsuarioID);
  var includeDrafts = toBoolean_(payload.includeDrafts);
  result.items = (result.items || []).filter(function (article) {
    if (!knowledgeBoolean_(article.Activo, true)) return false;
    if (String(article.Estado || 'PUBLICADO').toUpperCase() === 'PUBLICADO') return true;
    return canManage || (includeDrafts && String(article.AutorUsuarioID) === String(ctx.user.UsuarioID));
  }).map(enrichKnowledgeArticle_);

  return result;
}

function apiKnowledgeGet_(ctx) {
  var id = String(ctx.payload.tutorialId || ctx.payload.TutorialID || '').trim();
  var article = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id);
  assertCanReadKnowledge_(ctx.user, article);
  return enrichKnowledgeArticle_(article);
}

function apiKnowledgeCreate_(ctx) {
  var p = normalizeKnowledgePayload_(ctx.payload);
  validateKnowledgePayload_(p);
  requireRecord_(KNOWLEDGE_SHEETS_.CATEGORIES, 'CategoriaConocimientoID', p.categoryId);

  var now = new Date();
  var row = {
    TutorialID: Utilities.getUuid(),
    Titulo: p.title,
    CategoriaConocimientoID: p.categoryId,
    ProblemaResuelto: p.problem,
    ContenidoHTML: sanitizeKnowledgeHtmlServer_(p.content),
    VideosJSON: JSON.stringify(p.videos),
    Estado: p.status,
    Activo: true,
    AutorUsuarioID: ctx.user.UsuarioID,
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: now,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: now
  };
  insertObject_(KNOWLEDGE_SHEETS_.ARTICLES, row);
  getKnowledgeTutorialFolder_(row.TutorialID, row.Titulo);
  auditKnowledge_(ctx, 'CREAR_TUTORIAL', KNOWLEDGE_SHEETS_.ARTICLES, row.TutorialID, null, row);
  return enrichKnowledgeArticle_(row);
}

function apiKnowledgeUpdate_(ctx) {
  var id = String(ctx.payload.tutorialId || ctx.payload.TutorialID || '').trim();
  var before = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id);
  assertCanEditKnowledge_(ctx.user, before);

  var p = normalizeKnowledgePayload_(ctx.payload);
  validateKnowledgePayload_(p);
  requireRecord_(KNOWLEDGE_SHEETS_.CATEGORIES, 'CategoriaConocimientoID', p.categoryId);

  var patch = {
    Titulo: p.title,
    CategoriaConocimientoID: p.categoryId,
    ProblemaResuelto: p.problem,
    ContenidoHTML: sanitizeKnowledgeHtmlServer_(p.content),
    VideosJSON: JSON.stringify(p.videos),
    Estado: p.status,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: new Date()
  };
  updateById_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id, patch);
  var after = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id);
  auditKnowledge_(ctx, 'EDITAR_TUTORIAL', KNOWLEDGE_SHEETS_.ARTICLES, id, before, after);
  return enrichKnowledgeArticle_(after);
}

function apiKnowledgeDelete_(ctx) {
  var id = String(ctx.payload.tutorialId || ctx.payload.TutorialID || '').trim();
  var before = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id);
  updateById_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', id, {
    Activo: false,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: new Date()
  });
  auditKnowledge_(ctx, 'ELIMINAR_TUTORIAL', KNOWLEDGE_SHEETS_.ARTICLES, id, before, { Activo: false });
  return { deleted: true, TutorialID: id };
}

function apiKnowledgeAttachmentUpload_(ctx) {
  var p = ctx.payload || {};
  var tutorialId = String(p.tutorialId || p.TutorialID || '').trim();
  var article = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', tutorialId);
  assertCanEditKnowledge_(ctx.user, article);

  var dataUrl = String(p.dataUrl || '');
  var match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw apiError_('INVALID_FILE', 'El archivo no contiene datos base64 válidos.', 400);

  var mimeType = String(p.mimeType || match[1] || 'application/octet-stream');
  if (!KNOWLEDGE_ALLOWED_MIME_.test(mimeType)) {
    throw apiError_('FILE_TYPE_NOT_ALLOWED', 'El tipo de archivo no está permitido.', 400);
  }

  var bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > KNOWLEDGE_MAX_FILE_BYTES_) {
    throw apiError_('FILE_TOO_LARGE', 'El archivo supera el límite de 20 MB.', 413);
  }

  var fileName = sanitizeKnowledgeFileName_(p.nombre || 'Documento');
  var folder = getKnowledgeTutorialFolder_(tutorialId, article.Titulo);
  var file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  file.setDescription('Adjunto de tutorial DMS: ' + article.Titulo);

  var row = {
    AdjuntoID: Utilities.getUuid(),
    TutorialID: tutorialId,
    Nombre: fileName,
    MimeType: mimeType,
    Size: bytes.length,
    DriveFileID: file.getId(),
    DriveURL: file.getUrl(),
    Activo: true,
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: new Date()
  };
  insertObject_(KNOWLEDGE_SHEETS_.ATTACHMENTS, row);
  auditKnowledge_(ctx, 'SUBIR_ADJUNTO', KNOWLEDGE_SHEETS_.ATTACHMENTS, row.AdjuntoID, null, row);
  return row;
}

function apiKnowledgeAttachmentDelete_(ctx) {
  var tutorialId = String(ctx.payload.tutorialId || ctx.payload.TutorialID || '').trim();
  var attachmentId = String(ctx.payload.adjuntoId || ctx.payload.AdjuntoID || '').trim();
  var article = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', tutorialId);
  assertCanEditKnowledge_(ctx.user, article);
  var before = requireRecord_(KNOWLEDGE_SHEETS_.ATTACHMENTS, 'AdjuntoID', attachmentId);
  if (String(before.TutorialID) !== tutorialId) throw apiError_('INVALID_ATTACHMENT', 'El archivo no pertenece al tutorial.', 400);

  if (before.DriveFileID) {
    try { DriveApp.getFileById(before.DriveFileID).setTrashed(true); } catch (ignored) { /* Ya no existe o no hay acceso. */ }
  }
  updateById_(KNOWLEDGE_SHEETS_.ATTACHMENTS, 'AdjuntoID', attachmentId, { Activo: false });
  auditKnowledge_(ctx, 'ELIMINAR_ADJUNTO', KNOWLEDGE_SHEETS_.ATTACHMENTS, attachmentId, before, { Activo: false });
  return { deleted: true, AdjuntoID: attachmentId };
}

function apiKnowledgeMediaGet_(ctx) {
  var tutorialId = String(ctx.payload.tutorialId || ctx.payload.TutorialID || '').trim();
  var attachmentId = String(ctx.payload.adjuntoId || ctx.payload.AdjuntoID || '').trim();
  var article = requireRecord_(KNOWLEDGE_SHEETS_.ARTICLES, 'TutorialID', tutorialId);
  assertCanReadKnowledge_(ctx.user, article);
  var attachment = requireRecord_(KNOWLEDGE_SHEETS_.ATTACHMENTS, 'AdjuntoID', attachmentId);
  if (String(attachment.TutorialID) !== tutorialId || !knowledgeBoolean_(attachment.Activo, true)) {
    throw apiError_('ATTACHMENT_NOT_FOUND', 'No se encontró el archivo solicitado.', 404);
  }
  return {
    AdjuntoID: attachment.AdjuntoID,
    Nombre: attachment.Nombre,
    MimeType: attachment.MimeType,
    url: attachment.DriveURL || (attachment.DriveFileID ? DriveApp.getFileById(attachment.DriveFileID).getUrl() : '')
  };
}

function normalizeKnowledgePayload_(payload) {
  var p = payload || {};
  var videos = p.videos || p.Videos || p.VideosJSON || [];
  if (!Array.isArray(videos)) {
    try { videos = JSON.parse(videos || '[]'); } catch (ignored) { videos = []; }
  }
  return {
    title: String(p.titulo || p.Titulo || '').trim(),
    categoryId: String(p.categoriaId || p.CategoriaConocimientoID || '').trim(),
    problem: String(p.problemaResuelto || p.ProblemaResuelto || '').trim(),
    content: String(p.contenidoHtml || p.ContenidoHTML || ''),
    videos: videos.map(function (url) { return String(url || '').trim(); }).filter(Boolean),
    status: String(p.estado || p.Estado || 'BORRADOR').toUpperCase() === 'PUBLICADO' ? 'PUBLICADO' : 'BORRADOR'
  };
}

function validateKnowledgePayload_(p) {
  if (!p.title) throw apiError_('VALIDATION_ERROR', 'El título es obligatorio.', 400);
  if (!p.categoryId) throw apiError_('VALIDATION_ERROR', 'La categoría es obligatoria.', 400);
  if (!p.problem) throw apiError_('VALIDATION_ERROR', 'La descripción del problema es obligatoria.', 400);
  if (!stripKnowledgeHtmlServer_(p.content)) throw apiError_('VALIDATION_ERROR', 'El contenido del tutorial es obligatorio.', 400);
}

function enrichKnowledgeArticle_(article) {
  var copy = Object.assign({}, article);
  var category = getRows_(KNOWLEDGE_SHEETS_.CATEGORIES).find(function (row) {
    return String(row.CategoriaConocimientoID) === String(article.CategoriaConocimientoID);
  });
  var author = getRows_('Usuarios').find(function (row) {
    return String(row.UsuarioID) === String(article.AutorUsuarioID);
  });
  copy.Categoria = category ? category.Nombre : 'Sin categoría';
  copy.AutorNombre = author ? (author.NombreCompleto || author.NombreUsuario || author.Correo) : 'Equipo técnico';
  copy.Videos = parseKnowledgeJsonList_(article.VideosJSON);
  copy.Adjuntos = getRows_(KNOWLEDGE_SHEETS_.ATTACHMENTS).filter(function (row) {
    return String(row.TutorialID) === String(article.TutorialID) && knowledgeBoolean_(row.Activo, true);
  });
  return copy;
}

function assertCanReadKnowledge_(user, article) {
  if (!knowledgeBoolean_(article.Activo, true)) throw apiError_('NOT_FOUND', 'No se encontró el tutorial.', 404);
  if (String(article.Estado || '').toUpperCase() === 'PUBLICADO') return;
  if (canManageKnowledge_(user.UsuarioID)) return;
  if (String(article.AutorUsuarioID) === String(user.UsuarioID)) return;
  throw apiError_('FORBIDDEN', 'No tiene acceso a este borrador.', 403);
}

function assertCanEditKnowledge_(user, article) {
  if (canManageKnowledge_(user.UsuarioID)) return;
  if (String(article.AutorUsuarioID) === String(user.UsuarioID)) return;
  throw apiError_('FORBIDDEN', 'Solo puede editar sus propios tutoriales.', 403);
}

function canManageKnowledge_(userId) {
  var permissions = getEffectivePermissions_(userId);
  return permissions.indexOf('USUARIOS_GESTIONAR') >= 0 || permissions.indexOf('CONOCIMIENTO_GESTIONAR') >= 0;
}

function ensureKnowledgeSheet_(spreadsheet, sheetName, headers) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#b7131a').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
    return;
  }
  var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  headers.forEach(function (header) {
    if (current.indexOf(header) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      current.push(header);
    }
  });
}

function getKnowledgeRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('DMS_KNOWLEDGE_FOLDER_ID');
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (ignored) { /* Se recrea. */ }
  }

  var parent = null;
  var parentCandidates = [
    props.getProperty('DMS_PROJECT_FOLDER_ID'),
    props.getProperty('DMS_DRIVE_ROOT_FOLDER_ID'),
    props.getProperty('DMS_BOLETAS_FOLDER_ID')
  ].filter(Boolean);
  for (var i = 0; i < parentCandidates.length && !parent; i += 1) {
    try { parent = DriveApp.getFolderById(parentCandidates[i]); } catch (ignored) { /* Continúa. */ }
  }

  var folder = parent ? parent.createFolder('Base de conocimientos') : DriveApp.createFolder('DMS - Base de conocimientos');
  props.setProperty('DMS_KNOWLEDGE_FOLDER_ID', folder.getId());
  return folder;
}

function getKnowledgeTutorialFolder_(tutorialId, title) {
  var root = getKnowledgeRootFolder_();
  var folderName = sanitizeKnowledgeFileName_('Tutorial ' + tutorialId + ' - ' + String(title || 'Sin título')).slice(0, 180);
  var iterator = root.getFoldersByName(folderName);
  return iterator.hasNext() ? iterator.next() : root.createFolder(folderName);
}

function sanitizeKnowledgeFileName_(value) {
  return String(value || 'Documento').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Documento';
}

function sanitizeKnowledgeHtmlServer_(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function stripKnowledgeHtmlServer_(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function parseKnowledgeJsonList_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    var parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignored) {
    return [];
  }
}

function knowledgeBoolean_(value, fallback) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  return toBoolean_(value);
}

function auditKnowledge_(ctx, action, table, recordId, before, after) {
  if (typeof audit_ !== 'function') return;
  try { audit_(ctx.user, action, table, recordId, before, after, ctx.meta); } catch (ignored) { /* No bloquea la operación. */ }
}
