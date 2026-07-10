/**
 * PARCHE DMS
 * - Repara propiedades faltantes para evidencias, firmas y boletas.
 * - Crea automáticamente las carpetas si no existen.
 * - Muestra evidencias de imagen dentro del correo y también las adjunta.
 *
 * PASOS:
 * 1. Copiar este archivo al proyecto Apps Script del backend.
 * 2. Ejecutar repararEstructuraDriveDMS().
 * 3. Crear una nueva versión de la implementación web.
 */

function repararEstructuraDriveDMS() {
  const props = PropertiesService.getScriptProperties();
  const projectFolderId = props.getProperty('DMS_PROJECT_FOLDER_ID');

  if (!projectFolderId) {
    throw new Error('Falta DMS_PROJECT_FOLDER_ID. Debe apuntar a la carpeta principal DMS_WebApp.');
  }

  const root = DriveApp.getFolderById(projectFolderId);
  const generated = getOrCreateFolderRepair_(root, '03_Documentos_Generados');
  const boletas = getOrCreateFolderRepair_(generated, 'Boletas');
  const evidencias = getOrCreateFolderRepair_(root, '04_Evidencias');
  const firmas = getOrCreateFolderRepair_(root, '05_Firmas');
  const catalogImages = getOrCreateFolderRepair_(root, '06_Imagenes_Catalogo');
  const temp = getOrCreateFolderRepair_(root, '07_Temporales');
  const logs = getOrCreateFolderRepair_(root, '08_Logs');
  const backups = getOrCreateFolderRepair_(root, '09_Backups');

  props.setProperties({
    DMS_BOLETAS_FOLDER_ID: boletas.getId(),
    DMS_EVIDENCIAS_FOLDER_ID: evidencias.getId(),
    DMS_FIRMAS_FOLDER_ID: firmas.getId(),
    DMS_CATALOG_IMAGES_FOLDER_ID: catalogImages.getId(),
    DMS_TEMP_FOLDER_ID: temp.getId(),
    DMS_LOGS_FOLDER_ID: logs.getId(),
    DMS_BACKUPS_FOLDER_ID: backups.getId()
  }, false);

  Logger.log('Carpetas reparadas correctamente.');
  Logger.log('Boletas: ' + boletas.getUrl());
  Logger.log('Evidencias: ' + evidencias.getUrl());
  Logger.log('Firmas: ' + firmas.getUrl());

  return {
    ok: true,
    boletasFolderId: boletas.getId(),
    evidenciasFolderId: evidencias.getId(),
    firmasFolderId: firmas.getId()
  };
}

function verificarEstructuraDriveDMS() {
  const props = PropertiesService.getScriptProperties();
  const required = [
    'DMS_PROJECT_FOLDER_ID',
    'DMS_BOLETAS_FOLDER_ID',
    'DMS_EVIDENCIAS_FOLDER_ID',
    'DMS_FIRMAS_FOLDER_ID',
    'DMS_TEMPLATE_BOLETA_ID',
    'DMS_SPREADSHEET_ID'
  ];

  const result = {};
  required.forEach(function (key) {
    const id = props.getProperty(key);
    result[key] = {
      configured: Boolean(id),
      id: id || ''
    };

    if (id && key.indexOf('FOLDER_ID') >= 0) {
      try {
        result[key].name = DriveApp.getFolderById(id).getName();
        result[key].accessible = true;
      } catch (error) {
        result[key].accessible = false;
        result[key].error = error.message;
      }
    }
  });

  Logger.log(JSON.stringify(result));
  return result;
}

function getOrCreateFolderRepair_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

/**
 * Devuelve una carpeta configurada. Si falta la propiedad, repara la estructura.
 */
function getDmsFolderWithRepair_(propertyName) {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty(propertyName);

  if (!folderId) {
    repararEstructuraDriveDMS();
    folderId = props.getProperty(propertyName);
  }

  if (!folderId) {
    throw new Error('No fue posible configurar la carpeta ' + propertyName + '.');
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    repararEstructuraDriveDMS();
    folderId = props.getProperty(propertyName);
    return DriveApp.getFolderById(folderId);
  }
}

/**
 * Sustituye la función del backend original para evidencias.
 * Apps Script usará esta versión al estar en el mismo proyecto.
 */
function getBoletaEvidenceFolder_(boleta) {
  const root = getDmsFolderWithRepair_('DMS_EVIDENCIAS_FOLDER_ID');
  const clientFolder = getOrCreateFolderApi_(
    root,
    sanitizeFileName_(boleta.Cliente || 'Sin cliente')
  );
  return getOrCreateFolderApi_(clientFolder, 'Boleta_' + boleta.BoletaID);
}

/**
 * Sustituye la subida de firma para reparar automáticamente la propiedad faltante.
 */
function apiSignatureUpload_(ctx) {
  const p = ctx.payload;
  requireFields_(p, ['boletaUid', 'base64']);
  const boleta = requireRecord_('Boletas', 'BoletaUID', p.boletaUid);

  const mimeType = p.mimeType || 'image/png';
  const fileName = sanitizeFileName_(
    p.fileName || ('firma_boleta_' + boleta.BoletaID + '.png')
  );
  const bytes = Utilities.base64Decode(stripDataUrlPrefix_(p.base64));
  const blob = Utilities.newBlob(bytes, mimeType, fileName);

  const folder = getDmsFolderWithRepair_('DMS_FIRMAS_FOLDER_ID');
  const file = folder.createFile(blob);

  updateById_('Boletas', 'BoletaUID', boleta.BoletaUID, {
    FirmaArchivoID: file.getId(),
    FirmaURL: file.getUrl(),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: new Date()
  });

  registerFile_('BOLETA', boleta.BoletaUID, 'FIRMA', file, ctx.user.UsuarioID);
  audit_(
    ctx.user,
    'SUBIR_FIRMA',
    'Boletas',
    boleta.BoletaUID,
    null,
    { FirmaURL: file.getUrl() },
    ctx.meta
  );

  return {
    fileId: file.getId(),
    fileUrl: file.getUrl()
  };
}

/**
 * Sustituye el correo original.
 * - El PDF se adjunta.
 * - Todas las evidencias se adjuntan.
 * - Las imágenes se muestran directamente dentro del cuerpo mediante cid.
 * - Los archivos no visualizables conservan su enlace de Drive.
 */
function sendBoletaEmail_(boleta, artifacts, evidences, payload, testMode) {
  const config = getConfigMap_();
  const subject = 'Reporte Técnico - ' + boleta.Titulo;

  let to = '';
  let cc = '';

  if (testMode) {
    to = config.TEST_EMAIL || PropertiesService.getScriptProperties().getProperty('DMS_TEST_EMAIL');
  } else {
    to = payload.to || boleta.CorreoSupervisor || boleta.CorreoCliente || config.TEST_EMAIL;

    const ccList = [];
    const sendClientCopy = payload.sendClientCopy !== undefined
      ? toBoolean_(payload.sendClientCopy)
      : toBoolean_(boleta.EnviarCorreoCliente);

    if (sendClientCopy && boleta.CorreoCliente) {
      ccList.push(boleta.CorreoCliente);
    }

    String(config.DEFAULT_CC_EMAILS || '')
      .split(',')
      .map(function (value) { return value.trim(); })
      .filter(Boolean)
      .forEach(function (email) { ccList.push(email); });

    const customCc = Array.isArray(payload.cc)
      ? payload.cc
      : String(payload.cc || boleta.CorreosCC || '').split(',');

    customCc
      .map(function (value) { return String(value).trim(); })
      .filter(Boolean)
      .forEach(function (email) { ccList.push(email); });

    cc = Array.from(new Set(ccList)).join(',');
  }

  if (!to) {
    throw apiError_('EMAIL_DESTINATION_MISSING', 'No hay destinatario para el correo.', 400);
  }

  const attachments = [];
  const inlineImages = {};
  const evidenceSections = [];

  attachments.push(DriveApp.getFileById(artifacts.pdfId).getBlob());

  evidences.forEach(function (evidence, index) {
    const title = escapeHtml_(evidence.Nombre || ('Evidencia ' + (index + 1)));
    const note = evidence.Nota ? '<p>' + escapeHtml_(evidence.Nota) + '</p>' : '';
    const link = '<p><a href="' + evidence.ArchivoURL + '">Abrir en Google Drive</a></p>';

    try {
      const file = DriveApp.getFileById(evidence.ArchivoID);
      const blob = file.getBlob().setName(file.getName());
      attachments.push(blob.copyBlob());

      const mimeType = String(evidence.MimeType || blob.getContentType() || '').toLowerCase();
      if (mimeType.indexOf('image/') === 0) {
        const cid = 'evidencia_' + index;
        inlineImages[cid] = blob.copyBlob();
        evidenceSections.push(
          '<div style="margin:18px 0;padding:12px;border:1px solid #ddd">' +
            '<h3>' + title + '</h3>' +
            note +
            '<img src="cid:' + cid + '" alt="' + title + '" ' +
              'style="display:block;max-width:100%;height:auto;margin:10px 0">' +
            link +
          '</div>'
        );
      } else {
        evidenceSections.push(
          '<div style="margin:18px 0;padding:12px;border:1px solid #ddd">' +
            '<h3>' + title + '</h3>' + note + link +
          '</div>'
        );
      }
    } catch (error) {
      evidenceSections.push(
        '<div><h3>' + title + '</h3>' + note + link +
        '<p>No fue posible adjuntar este archivo: ' + escapeHtml_(error.message) + '</p></div>'
      );
    }
  });

  const htmlBody = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5">',
    '<h2>' + escapeHtml_(subject) + '</h2>',
    '<p><strong>Cliente:</strong> ' + escapeHtml_(boleta.Cliente) + '</p>',
    '<p><strong>Boleta:</strong> ' + escapeHtml_(boleta.BoletaID) + '</p>',
    '<p><strong>Ubicación:</strong> ' + escapeHtml_(boleta.Ubicacion) + '</p>',
    '<p><strong>Ubicación del equipo:</strong> ' + escapeHtml_(boleta.UbicacionEquipo) + '</p>',
    '<p><strong>Supervisor:</strong> ' + escapeHtml_(boleta.Supervisor) + '</p>',
    '<p><strong>Descripción:</strong><br>' + escapeHtml_(boleta.Descripcion) + '</p>',
    '<p><strong>Resultado:</strong><br>' + escapeHtml_(boleta.Resultado) + '</p>',
    '<p><strong>Recomendaciones:</strong><br>' + escapeHtml_(boleta.Recomendaciones) + '</p>',
    '<p><strong>PDF:</strong> <a href="' + artifacts.pdfUrl + '">Abrir reporte técnico</a></p>',
    '<p><strong>Carpeta de Drive:</strong> <a href="' + artifacts.folderUrl + '">Abrir carpeta</a></p>',
    '<h2>Evidencias (' + evidences.length + ')</h2>',
    evidenceSections.length ? evidenceSections.join('') : '<p>No se registraron evidencias.</p>',
    '</div>'
  ].join('');

  const message = {
    to: to,
    subject: subject,
    htmlBody: htmlBody,
    attachments: attachments,
    name: 'DMS Reportes Técnicos'
  };

  if (cc) message.cc = cc;
  if (Object.keys(inlineImages).length) message.inlineImages = inlineImages;

  MailApp.sendEmail(message);

  return {
    sent: true,
    to: to,
    cc: cc,
    subject: subject,
    attachedEvidenceCount: evidences.length,
    inlineImageCount: Object.keys(inlineImages).length
  };
}
