const DEFAULT_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';
const DEFAULT_TIME_ZONE = 'America/Costa_Rica';
const MAX_EMAIL_BYTES = 18 * 1024 * 1024;

function doGet() {
  return jsonResponse_({ ok: true, service: 'dms-boletas-apps-script', time: new Date().toISOString() });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    validateSecret_(payload.secret);

    if (payload.action !== 'ticket.report.deliver') {
      throw new Error('Acción no soportada.');
    }

    lock.waitLock(30000);
    const idempotencyKey = String(payload.idempotencyKey || '').trim();
    const propertyKey = idempotencyKey ? `DELIVERY_${digest_(idempotencyKey)}` : '';
    if (propertyKey) {
      const stored = PropertiesService.getScriptProperties().getProperty(propertyKey);
      if (stored) return jsonResponse_(JSON.parse(stored));
    }

    const result = createReportAndMaybeSend_(payload);
    const response = { ok: true, data: result };
    if (propertyKey) {
      PropertiesService.getScriptProperties().setProperty(propertyKey, JSON.stringify(response));
    }
    return jsonResponse_(response);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({
      ok: false,
      error: {
        code: 'APPS_SCRIPT_REPORT_ERROR',
        message: String(error && error.message ? error.message : error),
      },
    });
  } finally {
    try { lock.releaseLock(); } catch (_) { /* no-op */ }
  }
}

function validateSecret_(received) {
  const expected = PropertiesService.getScriptProperties().getProperty('REPORT_WEBHOOK_SECRET');
  if (!expected) throw new Error('Falta configurar REPORT_WEBHOOK_SECRET en las propiedades del script.');
  if (String(received || '') !== expected) throw new Error('Credencial inválida para el servicio de reportes.');
}

function createReportAndMaybeSend_(payload) {
  const ticket = payload.ticket || {};
  if (!ticket.BoletaUID) throw new Error('La solicitud no incluye BoletaUID.');

  const properties = PropertiesService.getScriptProperties();
  const templateId = String(payload.templateId || properties.getProperty('TEMPLATE_BOLETA_ID') || DEFAULT_TEMPLATE_ID).trim();
  const baseFolderId = String(payload.baseFolderId || properties.getProperty('BOLETAS_FOLDER_ID') || '').trim();
  if (!templateId) throw new Error('No se configuró la plantilla de la boleta.');
  if (!baseFolderId) throw new Error('No se configuró la carpeta principal de boletas.');

  const testMode = Boolean(payload.testMode);
  const sendEmail = payload.sendEmail !== false;
  const assigned = Array.isArray(payload.assigned) ? payload.assigned : [];
  const evidences = Array.isArray(payload.evidences) ? payload.evidences : [];
  const creator = payload.creator || null;
  const client = payload.client || null;
  const assignedNames = assigned.map(function (item) { return clean_(item.Nombre || item.NombreCompleto || item.NombreUsuario); }).filter(Boolean).join(', ');

  const baseFolder = DriveApp.getFolderById(baseFolderId);
  const parentFolder = testMode
    ? getOrCreateFolder_(baseFolder, 'Pruebas de boletas')
    : getOrCreateFolder_(baseFolder, safeName_(ticket.Cliente || 'Sin cliente'));
  const folderName = `Boleta ${ticket.BoletaID || ticket.BoletaUID} - ${safeName_(ticket.Titulo || 'Reporte de visita')}`;
  const reportFolder = getOrCreateFolder_(parentFolder, folderName);

  const timestamp = Utilities.formatDate(new Date(), DEFAULT_TIME_ZONE, 'yyyyMMdd-HHmmss');
  const reportName = `${testMode ? 'PRUEBA - ' : ''}Boleta ${ticket.BoletaID || ticket.BoletaUID} - ${safeName_(ticket.Titulo || 'Reporte de visita')}${testMode ? ` - ${timestamp}` : ''}`;
  const template = DriveApp.getFileById(templateId);
  const documentFile = template.makeCopy(reportName, reportFolder);
  const document = DocumentApp.openById(documentFile.getId());
  const body = document.getBody();

  const signatureBlob = getDriveBlob_(ticket.FirmaArchivoID || ticket.FirmaFileID || ticket.FirmaURL);
  let signatureInserted = false;
  if (signatureBlob) {
    signatureInserted = replaceMarkerWithImage_(body, '<<[Firma]>>', signatureBlob, 180)
      || replaceMarkerWithImage_(body, '{{Firma}}', signatureBlob, 180);
  }

  replaceMarkers_(body, ticket, assignedNames);
  appendAnnexes_(body, signatureBlob, signatureInserted, evidences);
  document.saveAndClose();

  const pdfBlob = documentFile.getAs(MimeType.PDF).setName(`${reportName}.pdf`);
  const pdfFile = reportFolder.createFile(pdfBlob);
  const documentUrl = documentFile.getUrl();
  const pdfUrl = pdfFile.getUrl();
  const folderUrl = reportFolder.getUrl();

  let email = { sent: false, skipped: true };
  if (sendEmail) {
    email = sendReportEmail_({
      ticket: ticket,
      assigned: assigned,
      evidences: evidences,
      creator: creator,
      client: client,
      recipients: payload.recipients || {},
      testMode: testMode,
      pdfBlob: pdfBlob,
      pdfUrl: pdfUrl,
      documentUrl: documentUrl,
      folderUrl: folderUrl,
    });
  }

  return {
    documentId: documentFile.getId(),
    documentUrl: documentUrl,
    pdfId: pdfFile.getId(),
    pdfUrl: pdfUrl,
    folderId: reportFolder.getId(),
    folderUrl: folderUrl,
    evidenceCount: evidences.length,
    templateId: templateId,
    email: email,
  };
}

function replaceMarkers_(body, ticket, assignedNames) {
  const values = {
    '{{Titulo}}': ticket.Titulo,
    '{{BoletaID}}': ticket.BoletaID,
    '{{Fecha}}': formatDate_(ticket.Fecha),
    '{{HoraInicio}}': ticket.HoraInicio,
    '{{HoraFinal}}': ticket.HoraFinal,
    '{{HorasTotales}}': formatHours_(ticket.HorasTotales),
    '{{Cliente}}': ticket.Cliente,
    '{{Ubicacion}}': ticket.Ubicacion,
    '{{UbicacionEquipo}}': ticket.UbicacionEquipo,
    '{{Supervisor}}': ticket.Supervisor,
    '{{Categoria}}': ticket.Categoria,
    '{{TipoFalla}}': ticket.TipoFalla,
    '{{TipoDispositivo}}': ticket.TipoDispositivo,
    '{{Fabricante}}': ticket.Fabricante,
    '{{Modelo}}': ticket.Modelo,
    '{{Serie}}': ticket.Serie,
    '{{RazonVisita}}': ticket.RazonVisita,
    '{{Descripcion}}': ticket.Descripcion,
    '{{PruebasRealizadas}}': ticket.PruebasRealizadas,
    '{{Resultado}}': ticket.Resultado,
    '{{Recomendaciones}}': ticket.Recomendaciones,
    '{{AsignadoA}}': assignedNames,
    '<<[ID]>>': ticket.BoletaID,
    '<<[Categoría]>>': ticket.Categoria,
    '<<[Fecha]>>': formatDate_(ticket.Fecha),
    '<<TEXT([Fecha], "DD/MM/YYYY")>>': formatDate_(ticket.Fecha),
    '<<[Cliente]>>': ticket.Cliente,
    '<<[Hora de inicio]>>': ticket.HoraInicio,
    '<<[Hora de Finalización]>>': ticket.HoraFinal,
    '<<[Ubicación]>>': ticket.Ubicacion,
    '<<[Supervisor]>>': ticket.Supervisor,
    '<<[Razon_visita]>>': ticket.RazonVisita,
    '<<[Descripción]>>': ticket.Descripcion,
    '<<[Fabricante]>>': ticket.Fabricante,
    '<<[Modelo]>>': ticket.Modelo,
    '<<[Serie]>>': ticket.Serie,
    '<<[Ubicacion_equipo]>>': ticket.UbicacionEquipo || ticket.Ubicacion,
    '<<[Pruebas realizadas]>>': ticket.PruebasRealizadas,
    '<<[Resultado]>>': ticket.Resultado,
    '<<[Recomendaciones ]>>': ticket.Recomendaciones,
    '<<[AsignadoA]>>': assignedNames,
  };

  Object.keys(values).forEach(function (marker) {
    body.replaceText(escapeRegex_(marker), clean_(values[marker]));
  });
}

function replaceMarkerWithImage_(body, marker, blob, maxWidth) {
  const found = body.findText(escapeRegex_(marker));
  if (!found) return false;
  const text = found.getElement().asText();
  text.deleteText(found.getStartOffset(), found.getEndOffsetInclusive());
  let parent = text.getParent();
  while (parent && parent.getType() !== DocumentApp.ElementType.PARAGRAPH) parent = parent.getParent();
  if (!parent) return false;
  const image = parent.asParagraph().appendInlineImage(blob);
  resizeInlineImage_(image, maxWidth);
  return true;
}

function appendAnnexes_(body, signatureBlob, signatureInserted, evidences) {
  body.appendPageBreak();
  body.appendParagraph('ANEXOS').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (!signatureInserted) {
    body.appendParagraph('Firma del cliente').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (signatureBlob) {
      const image = body.appendParagraph('').appendInlineImage(signatureBlob);
      resizeInlineImage_(image, 260);
    } else {
      body.appendParagraph('Sin firma registrada.');
    }
  }

  body.appendParagraph('Evidencias fotográficas').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (!evidences.length) {
    body.appendParagraph('Sin evidencias asociadas.');
    return;
  }

  evidences.forEach(function (evidence, index) {
    const name = clean_(evidence.Nombre || evidence.NombreArchivo, `Evidencia ${index + 1}`);
    const note = clean_(evidence.Nota);
    body.appendParagraph(`${index + 1}. ${name}`).setBold(true);
    if (note) body.appendParagraph(note);
    const blob = getDriveBlob_(evidence.ArchivoID || evidence.ArchivoFileID || evidence.DriveFileID || evidence.ArchivoURL);
    if (blob && /^image\//i.test(blob.getContentType())) {
      const image = body.appendParagraph('').appendInlineImage(blob);
      resizeInlineImage_(image, 460);
    } else if (evidence.ArchivoURL) {
      body.appendParagraph(`Archivo: ${evidence.ArchivoURL}`);
    }
  });
}

function sendReportEmail_(data) {
  const to = uniqueEmails_(data.recipients.to || []);
  const cc = uniqueEmails_(data.recipients.cc || []).filter(function (email) { return to.indexOf(email) === -1; });
  if (!to.length) throw new Error('No hay destinatarios válidos para enviar el reporte.');
  if (MailApp.getRemainingDailyQuota() < to.length + cc.length) {
    throw new Error('La cuota diaria de correo de Apps Script no es suficiente para estos destinatarios.');
  }

  const ticket = data.ticket;
  const evidenceParts = buildEvidenceEmailParts_(data.evidences, data.pdfBlob.getBytes().length);
  const assignedNames = data.assigned.map(function (item) { return clean_(item.Nombre || item.NombreCompleto || item.NombreUsuario); }).filter(Boolean).join(', ');
  const creatorText = data.creator
    ? `${escapeHtml_(data.creator.Nombre || data.creator.NombreUsuario || '')}${data.creator.Correo ? ` · ${escapeHtml_(data.creator.Correo)}` : ''}`
    : 'Sin especificar';
  const subject = `${data.testMode ? '[PRUEBA] ' : ''}Reporte técnico - Boleta #${ticket.BoletaID || ticket.BoletaUID} - ${ticket.Cliente || ''}`;
  const htmlBody = buildEmailHtml_({
    ticket: ticket,
    assignedNames: assignedNames,
    creatorText: creatorText,
    evidenceRows: evidenceParts.rows,
    testMode: data.testMode,
    pdfUrl: data.pdfUrl,
    documentUrl: data.documentUrl,
    folderUrl: data.folderUrl,
  });

  MailApp.sendEmail({
    to: to.join(','),
    cc: cc.join(',') || undefined,
    subject: subject,
    body: `Reporte técnico DMS\nBoleta #${ticket.BoletaID || ticket.BoletaUID}\nCliente: ${ticket.Cliente || ''}\nPDF: ${data.pdfUrl}`,
    htmlBody: htmlBody,
    name: 'DMS Boletas',
    attachments: [data.pdfBlob].concat(evidenceParts.attachments),
    inlineImages: evidenceParts.inlineImages,
  });

  return {
    sent: true,
    to: to,
    cc: cc,
    attachmentCount: 1 + evidenceParts.attachments.length,
    inlineImageCount: Object.keys(evidenceParts.inlineImages).length,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

function buildEvidenceEmailParts_(evidences, startingBytes) {
  const attachments = [];
  const inlineImages = {};
  const rows = [];
  let bytes = Number(startingBytes || 0);

  evidences.forEach(function (evidence, index) {
    const name = clean_(evidence.Nombre || evidence.NombreArchivo, `Evidencia ${index + 1}`);
    const note = clean_(evidence.Nota);
    const url = clean_(evidence.ArchivoURL);
    const blob = getDriveBlob_(evidence.ArchivoID || evidence.ArchivoFileID || evidence.DriveFileID || evidence.ArchivoURL);
    let attached = false;
    let cid = '';

    if (blob) {
      const namedBlob = blob.copyBlob().setName(clean_(evidence.NombreArchivo || blob.getName(), name));
      const size = namedBlob.getBytes().length;
      const isImage = /^image\//i.test(namedBlob.getContentType());
      const extraInlineBytes = isImage && index < 8 ? size : 0;
      if (bytes + size + extraInlineBytes <= MAX_EMAIL_BYTES) {
        attachments.push(namedBlob);
        bytes += size;
        attached = true;
        if (isImage && index < 8) {
          cid = `evidence${index + 1}`;
          inlineImages[cid] = namedBlob;
          bytes += size;
        }
      }
    }

    rows.push({ name: name, note: note, url: url, attached: attached, cid: cid });
  });

  return { attachments: attachments, inlineImages: inlineImages, rows: rows };
}

function buildEmailHtml_(data) {
  const ticket = data.ticket;
  const rows = [
    ['Fecha', formatDate_(ticket.Fecha)],
    ['Cliente', ticket.Cliente],
    ['Categoría', ticket.Categoria],
    ['Tipo de falla', ticket.TipoFalla],
    ['Título', ticket.Titulo],
    ['Asignado a', data.assignedNames],
    ['Estado', data.testMode ? 'Prueba' : 'Finalizado'],
    ['Hora de inicio', ticket.HoraInicio],
    ['Hora de finalización', ticket.HoraFinal],
    ['Horas totales', formatHours_(ticket.HorasTotales)],
    ['Razón de visita', ticket.RazonVisita],
    ['Descripción', ticket.Descripcion],
    ['Pruebas realizadas', ticket.PruebasRealizadas],
    ['Resultado', ticket.Resultado],
    ['Recomendaciones', ticket.Recomendaciones],
    ['Creado por', data.creatorText],
  ].map(function (row) {
    return `<tr><th style="width:28%;padding:11px;border:1px solid #dfe3e8;background:#f3f4f6;text-align:left;vertical-align:top">${escapeHtml_(row[0])}</th><td style="padding:11px;border:1px solid #dfe3e8;vertical-align:top">${nl2br_(row[1])}</td></tr>`;
  }).join('');

  const evidenceHtml = data.evidenceRows.length
    ? data.evidenceRows.map(function (item, index) {
      return `<div style="margin:16px 0;padding:14px;border:1px solid #dfe3e8;border-radius:8px"><strong>${index + 1}. ${escapeHtml_(item.name)}</strong>${item.note ? `<p>${nl2br_(item.note)}</p>` : ''}${item.cid ? `<img src="cid:${item.cid}" alt="${escapeHtml_(item.name)}" style="display:block;max-width:100%;height:auto;margin-top:10px;border-radius:6px">` : ''}<p style="margin-bottom:0">${item.url ? `<a href="${escapeHtml_(item.url)}">Abrir en Drive</a>` : 'Sin enlace'}${item.attached ? ' · Adjunto al correo' : ''}</p></div>`;
    }).join('')
    : '<p>Sin evidencias asociadas.</p>';

  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:890px;margin:auto;border:1px solid #dfe3e8"><div style="background:#272727;color:#fff;padding:18px 16px"><h1 style="margin:0;font-size:25px">Reporte Técnico DMS</h1><p style="margin:10px 0 0">Boleta #${escapeHtml_(ticket.BoletaID || ticket.BoletaUID)}</p></div><div style="padding:26px 16px"><p>Estimado/a,</p><p>Adjunto encontrará el reporte técnico correspondiente a la gestión realizada.</p>${data.testMode ? '<p style="padding:10px;background:#fff7ed;border:1px solid #fdba74"><strong>Modo de prueba:</strong> no se modificó el estado de la boleta.</p>' : ''}<table style="width:100%;border-collapse:collapse;margin-top:18px">${rows}</table><p style="margin-top:20px"><a href="${escapeHtml_(data.pdfUrl)}">Abrir PDF</a> · <a href="${escapeHtml_(data.documentUrl)}">Abrir documento</a> · <a href="${escapeHtml_(data.folderUrl)}">Abrir carpeta</a></p><h2 style="margin-top:28px">Evidencias fotográficas</h2>${evidenceHtml}</div></div>`;
}

function getDriveBlob_(value) {
  const fileId = extractFileId_(value);
  if (!fileId) return null;
  try { return DriveApp.getFileById(fileId).getBlob(); } catch (error) {
    console.warn(`No fue posible leer el archivo ${fileId}: ${error.message}`);
    return null;
  }
}

function extractFileId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/[-\w]{20,}/);
  return match ? match[0] : '';
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function resizeInlineImage_(image, maxWidth) {
  const width = image.getWidth();
  const height = image.getHeight();
  if (width <= maxWidth) return;
  const ratio = maxWidth / width;
  image.setWidth(Math.round(width * ratio));
  image.setHeight(Math.round(height * ratio));
}

function formatDate_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, DEFAULT_TIME_ZONE, 'dd/MM/yyyy');
}

function formatHours_(value) {
  const number = Number(value || 0);
  return isNaN(number) ? String(value || '') : number.toFixed(2);
}

function safeName_(value) {
  return clean_(value, 'Reporte').replace(/[\\/:*?"<>|#%{}~&]/g, '-').replace(/\s+/g, ' ').substring(0, 100);
}

function clean_(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  return text || String(fallback || '');
}

function uniqueEmails_(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/[;,]/);
  const seen = {};
  return source.map(function (value) { return String(value || '').trim().toLowerCase(); })
    .filter(function (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen[email]) return false;
      seen[email] = true;
      return true;
    });
}

function escapeRegex_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br_(value) {
  return escapeHtml_(value).replace(/\r?\n/g, '<br>');
}

function digest_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return (`0${(byte & 255).toString(16)}`).slice(-2); }).join('');
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
