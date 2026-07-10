/**
 * DMS WebApp - Actualización 1.3
 * - Completa marcadores de la plantilla oficial.
 * - Inserta la firma dentro del documento.
 * - Formatea horas.
 * - Rediseña el correo.
 * - Permite previsualizar evidencias y firma desde React.
 *
 * Agregar dentro de ROUTES:
 * 'boletas.media.get': {
 *   handler: apiBoletaMediaGet_,
 *   permission: 'BOLETAS_VER'
 * },
 */

function instalarActualizacionBackendDMS_1_3() {
  PropertiesService.getScriptProperties().setProperty(
    'DMS_TEMPLATE_BOLETA_ID',
    '1BmxzuGmCbgB01OcJCW2pgOTXeztw3TW-_83HjT090RU'
  );
  return verificarActualizacionBackendDMS_1_3();
}

function verificarActualizacionBackendDMS_1_3() {
  const id = PropertiesService.getScriptProperties().getProperty('DMS_TEMPLATE_BOLETA_ID');
  const file = DriveApp.getFileById(id);
  const result = { ok: Boolean(file), templateId: id, templateName: file.getName(), mediaRouteRequired: true };
  Logger.log(JSON.stringify(result));
  return result;
}

function generateBoletaArtifacts_(boleta, user) {
  const templateId = PropertiesService.getScriptProperties().getProperty('DMS_TEMPLATE_BOLETA_ID');
  const baseFolder = getDmsFolderWithRepair_('DMS_BOLETAS_FOLDER_ID');
  const clientFolder = getOrCreateFolderApi_(baseFolder, sanitizeFileName_(boleta.Cliente || 'Sin cliente'));
  const boletaFolder = getOrCreateFolderApi_(clientFolder, 'Boleta_' + boleta.BoletaID + '_' + sanitizeFileName_(boleta.Titulo || 'Reporte'));
  const docCopy = DriveApp.getFileById(templateId).makeCopy('Reporte Técnico - ' + boleta.Titulo + ' - Boleta ' + boleta.BoletaID, boletaFolder);
  const doc = DocumentApp.openById(docCopy.getId());
  const body = doc.getBody();
  const assigned = getAssignedUsers_(boleta.BoletaUID).map(function(item) { return item.NombreCompleto; }).join(', ');

  const values = {
    'ID': boleta.BoletaID,
    'BoletaID': boleta.BoletaID,
    'Categoria': boleta.Categoria,
    'Categoría': boleta.Categoria,
    'Fecha': formatDateApi_(boleta.Fecha, 'dd/MM/yyyy'),
    'Cliente': boleta.Cliente,
    'Ubicacion': boleta.Ubicacion,
    'Ubicación': boleta.Ubicacion,
    'Supervisor': boleta.Supervisor,
    'Contacto': boleta.Supervisor,
    'Razon_visita': boleta.RazonVisita,
    'RazonVisita': boleta.RazonVisita,
    'Razón_visita': boleta.RazonVisita,
    'Descripción': boleta.Descripcion,
    'Descripcion': boleta.Descripcion,
    'TipoDispositivo': boleta.TipoDispositivo,
    'Nombre del equipo': boleta.Descripcion || boleta.TipoDispositivo,
    'Fabricante': boleta.Fabricante,
    'Modelo': boleta.Modelo,
    'Serie': boleta.Serie,
    'Ubicacion_equipo': boleta.UbicacionEquipo,
    'UbicacionEquipo': boleta.UbicacionEquipo,
    'Ubicación_equipo': boleta.UbicacionEquipo,
    'Pruebas realizadas': boleta.PruebasRealizadas,
    'PruebasRealizadas': boleta.PruebasRealizadas,
    'Resultado': boleta.Resultado,
    'Recomendaciones': boleta.Recomendaciones,
    'AsignadoA': assigned,
    'Asignado': assigned,
    'Hora de inicio': formatTimeDms_(boleta.HoraInicio),
    'Hora de finalización': formatTimeDms_(boleta.HoraFinal),
    'Hora de Finalización': formatTimeDms_(boleta.HoraFinal),
    'Titulo': boleta.Titulo,
    'Título': boleta.Titulo,
    'TipoFalla': boleta.TipoFalla,
    'Tipo de falla': boleta.TipoFalla
  };

  Object.keys(values).forEach(function(key) {
    replaceTextEverywhereDms_(body, '{{' + key + '}}', values[key]);
    replaceTextEverywhereDms_(body, '<<[' + key + ']>>', values[key]);
  });
  replaceTextEverywhereDms_(body, '<<TEXT([Fecha], "DD/MM/YYYY")>>', values.Fecha);
  replaceTextEverywhereDms_(body, '<<TEXT([Fecha],"DD/MM/YYYY")>>', values.Fecha);
  insertSignatureEverywhereDms_(body, boleta.FirmaArchivoID);
  doc.saveAndClose();

  const pdfFile = boletaFolder.createFile(docCopy.getBlob().getAs(MimeType.PDF).setName('Reporte Técnico - ' + boleta.Titulo + ' - Boleta ' + boleta.BoletaID + '.pdf'));
  registerFile_('BOLETA', boleta.BoletaUID, 'DOCUMENTO', docCopy, user.UsuarioID);
  registerFile_('BOLETA', boleta.BoletaUID, 'PDF', pdfFile, user.UsuarioID);
  return { documentId: docCopy.getId(), documentUrl: docCopy.getUrl(), pdfId: pdfFile.getId(), pdfUrl: pdfFile.getUrl(), folderId: boletaFolder.getId(), folderUrl: boletaFolder.getUrl() };
}

function replaceTextEverywhereDms_(element, marker, value) {
  value = String(value == null ? '' : value);
  try { element.replaceText(escapeRegex_(marker), value); } catch (ignore) {}
  if (!element.getNumChildren) return;
  for (let i = 0; i < element.getNumChildren(); i++) replaceTextEverywhereDms_(element.getChild(i), marker, value);
}

function insertSignatureEverywhereDms_(body, fileId) {
  const markers = ['<<[Firma]>>', '{{Firma}}'];
  const blob = fileId ? DriveApp.getFileById(fileId).getBlob() : null;
  function walk(element) {
    if (element.getType && element.getType() === DocumentApp.ElementType.TEXT) {
      const text = element.asText();
      markers.forEach(function(marker) {
        const content = text.getText();
        const index = content.indexOf(marker);
        if (index >= 0) {
          text.deleteText(index, index + marker.length - 1);
          if (blob) {
            const parent = text.getParent();
            if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) parent.asParagraph().appendInlineImage(blob.copyBlob()).setWidth(150);
          }
        }
      });
    }
    if (element.getNumChildren) for (let i = 0; i < element.getNumChildren(); i++) walk(element.getChild(i));
  }
  walk(body);
}

function formatTimeDms_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return Utilities.formatDate(value, getRequiredProperty_('DMS_TIMEZONE'), 'hh:mm a');
  const raw = String(value).trim();
  const hhmm = raw.match(/^(\d{1,2}):(\d{2})/);
  if (hhmm) {
    let hour = Number(hhmm[1]);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return hour + ':' + hhmm[2] + ' ' + suffix;
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, getRequiredProperty_('DMS_TIMEZONE'), 'hh:mm a');
  return raw;
}

function apiBoletaMediaGet_(ctx) {
  const p = ctx.payload || {};
  requireFields_(p, ['boletaUid', 'fileId']);
  const boleta = requireRecord_('Boletas', 'BoletaUID', p.boletaUid);
  const allowed = [];
  if (boleta.FirmaArchivoID) allowed.push(String(boleta.FirmaArchivoID));
  getRows_('EvidenciasBoleta').filter(function(row) { return row.BoletaUID === boleta.BoletaUID && toBoolean_(row.Activo); }).forEach(function(row) { allowed.push(String(row.ArchivoID)); });
  if (allowed.indexOf(String(p.fileId)) < 0) throw apiError_('FORBIDDEN_FILE', 'El archivo no pertenece a esta boleta.', 403);
  const file = DriveApp.getFileById(p.fileId);
  const blob = file.getBlob();
  const mimeType = blob.getContentType() || file.getMimeType();
  return { fileId: file.getId(), fileName: file.getName(), mimeType: mimeType, dataUrl: 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function sendBoletaEmail_(boleta, artifacts, evidences, payload, testMode) {
  const config = getConfigMap_();
  const subject = 'Reporte Técnico - ' + boleta.Titulo;
  const assigned = getAssignedUsers_(boleta.BoletaUID).map(function(item) { return item.NombreCompleto; }).join(', ');
  let to = '';
  let cc = '';
  if (testMode) {
    to = config.TEST_EMAIL || PropertiesService.getScriptProperties().getProperty('DMS_TEST_EMAIL');
  } else {
    to = payload.to || boleta.CorreoSupervisor || boleta.CorreoCliente || config.TEST_EMAIL;
    const ccList = [];
    if ((payload.sendClientCopy !== undefined ? toBoolean_(payload.sendClientCopy) : toBoolean_(boleta.EnviarCorreoCliente)) && boleta.CorreoCliente) ccList.push(boleta.CorreoCliente);
    String(config.DEFAULT_CC_EMAILS || '').split(',').forEach(function(v) { if (v.trim()) ccList.push(v.trim()); });
    const extra = Array.isArray(payload.cc) ? payload.cc : String(payload.cc || boleta.CorreosCC || '').split(',');
    extra.forEach(function(v) { if (String(v).trim()) ccList.push(String(v).trim()); });
    cc = Array.from(new Set(ccList)).join(',');
  }
  if (!to) throw apiError_('EMAIL_DESTINATION_MISSING', 'No hay destinatario para el correo.', 400);

  const attachments = [DriveApp.getFileById(artifacts.pdfId).getBlob()];
  const inlineImages = {};
  const evidenceCards = [];
  evidences.forEach(function(evidence, index) {
    const file = DriveApp.getFileById(evidence.ArchivoID);
    const blob = file.getBlob().setName(file.getName());
    attachments.push(blob.copyBlob());
    const mimeType = String(evidence.MimeType || blob.getContentType() || '').toLowerCase();
    let visual = '';
    if (mimeType.indexOf('image/') === 0) {
      const cid = 'evidence_' + index;
      inlineImages[cid] = blob.copyBlob();
      visual = '<img src="cid:' + cid + '" style="display:block;max-width:100%;height:auto;border-radius:6px;margin-top:10px">';
    }
    evidenceCards.push('<div style="border:1px solid #dedede;border-radius:8px;padding:12px;margin:10px 0"><strong>' + escapeHtml_(evidence.Nombre || ('Evidencia ' + (index + 1))) + '</strong>' + (evidence.Nota ? '<p>' + escapeHtml_(evidence.Nota) + '</p>' : '') + visual + '<p><a href="' + evidence.ArchivoURL + '">Abrir en Google Drive</a></p></div>');
  });

  const rows = [
    ['Fecha', formatDateApi_(boleta.Fecha, 'dd/MM/yyyy')], ['Cliente', boleta.Cliente], ['Categoría', boleta.Categoria], ['Tipo de falla', boleta.TipoFalla], ['Título', boleta.Titulo], ['Asignado a', assigned], ['Estado', 'Finalizado'], ['Hora de inicio', formatTimeDms_(boleta.HoraInicio)], ['Hora de finalización', formatTimeDms_(boleta.HoraFinal)], ['Horas totales', boleta.HorasTotales], ['Razón de visita', boleta.RazonVisita], ['Pruebas realizadas', boleta.PruebasRealizadas], ['Resultado', boleta.Resultado], ['Recomendaciones', boleta.Recomendaciones], ['Creado por', getUserEmailDms_(boleta.CreadoPor)], ['PDF', '<a href="' + artifacts.pdfUrl + '">Ver PDF en Drive</a>']
  ];
  const tableHtml = rows.map(function(row) { return '<tr><td style="width:28%;font-weight:bold;background:#f4f4f6;border:1px solid #d9dce1;padding:9px">' + escapeHtml_(row[0]) + '</td><td style="border:1px solid #d9dce1;padding:9px">' + (row[0] === 'PDF' ? row[1] : escapeHtml_(row[1])) + '</td></tr>'; }).join('');
  const htmlBody = '<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;border:1px solid #ddd"><div style="background:#242424;color:#fff;padding:22px"><h1 style="margin:0;font-size:24px">Reporte Técnico DMS</h1><p style="margin:12px 0 0">Boleta #' + escapeHtml_(boleta.BoletaID) + '</p></div><div style="padding:22px"><p>Estimado/a,</p><p>Adjunto encontrará el reporte técnico correspondiente a la gestión realizada.</p><table style="width:100%;border-collapse:collapse">' + tableHtml + '</table><h3 style="margin-top:24px">Evidencias</h3>' + (evidenceCards.length ? evidenceCards.join('') : '<p>No se registraron evidencias.</p>') + '</div></div>';
  const message = { to: to, subject: subject, htmlBody: htmlBody, attachments: attachments, name: 'DMS Reportes Técnicos' };
  if (cc) message.cc = cc;
  if (Object.keys(inlineImages).length) message.inlineImages = inlineImages;
  MailApp.sendEmail(message);
  return { sent: true, to: to, cc: cc, subject: subject, inlineImageCount: Object.keys(inlineImages).length };
}

function getUserEmailDms_(usuarioId) {
  if (!usuarioId) return '';
  const user = findOne_('Usuarios', function(row) { return row.UsuarioID === usuarioId; });
  return user ? (user.Correo || user.NombreCompleto || '') : usuarioId;
}
