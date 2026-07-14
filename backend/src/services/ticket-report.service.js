import { docsApi } from '../infra/google.js';
import {
  copyDriveFile,
  createFolder,
  createTemporaryPublicImageUrl,
  downloadFileBuffer,
  exportGoogleFile,
  extractDriveFileId,
  removeDrivePermission,
  uploadBuffer,
} from '../infra/drive.repository.js';
import { findById, readTables, updateRow } from '../infra/sheets.repository.js';
import { AppError } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { getConfig } from '../modules/config.module.js';

const IMAGE_MIME = /^image\/(png|jpe?g|gif)$/i;

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeName(value, fallback = 'Reporte') {
  return clean(value, fallback).replace(/[\\/:*?"<>|#%{}~&]/g, '-').replace(/\s+/g, ' ').slice(0, 100);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : String(value || '0.00');
}

function getDocumentEndIndex(document) {
  const content = document?.body?.content || [];
  return Math.max(1, Number(content.at(-1)?.endIndex || 2) - 1);
}

async function appendText(documentId, text) {
  const { data } = await docsApi.documents.get({ documentId });
  const index = getDocumentEndIndex(data);
  await docsApi.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index }, text: String(text || '') } }],
    },
  });
}

async function appendPageBreak(documentId) {
  const { data } = await docsApi.documents.get({ documentId });
  const index = getDocumentEndIndex(data);
  await docsApi.documents.batchUpdate({
    documentId,
    requestBody: { requests: [{ insertPageBreak: { location: { index } } }] },
  });
}

async function appendImage(documentId, uri, widthPt) {
  const { data } = await docsApi.documents.get({ documentId });
  const index = getDocumentEndIndex(data);
  await docsApi.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        insertInlineImage: {
          uri,
          location: { index },
          objectSize: { width: { magnitude: widthPt, unit: 'PT' } },
        },
      }],
    },
  });
  await appendText(documentId, '\n');
}

function placeholderRequests(ticket, assignedNames) {
  const values = {
    '{{Titulo}}': clean(ticket.Titulo),
    '{{BoletaID}}': clean(ticket.BoletaID),
    '{{Fecha}}': formatDate(ticket.Fecha),
    '{{HoraInicio}}': clean(ticket.HoraInicio),
    '{{HoraFinal}}': clean(ticket.HoraFinal),
    '{{HorasTotales}}': formatNumber(ticket.HorasTotales),
    '{{Cliente}}': clean(ticket.Cliente),
    '{{Ubicacion}}': clean(ticket.Ubicacion),
    '{{UbicacionEquipo}}': clean(ticket.UbicacionEquipo),
    '{{Supervisor}}': clean(ticket.Supervisor),
    '{{Categoria}}': clean(ticket.Categoria),
    '{{TipoFalla}}': clean(ticket.TipoFalla),
    '{{TipoDispositivo}}': clean(ticket.TipoDispositivo),
    '{{Fabricante}}': clean(ticket.Fabricante),
    '{{Modelo}}': clean(ticket.Modelo),
    '{{Serie}}': clean(ticket.Serie),
    '{{RazonVisita}}': clean(ticket.RazonVisita),
    '{{Descripcion}}': clean(ticket.Descripcion),
    '{{PruebasRealizadas}}': clean(ticket.PruebasRealizadas),
    '{{Resultado}}': clean(ticket.Resultado),
    '{{Recomendaciones}}': clean(ticket.Recomendaciones),
    '{{AsignadoA}}': assignedNames,
    '{{Firma}}': 'Firma incluida en los anexos del reporte.',
    '<<[ID]>>': clean(ticket.BoletaID),
    '<<[Categoría]>>': clean(ticket.Categoria),
    '<<[Fecha]>>': formatDate(ticket.Fecha),
    '<<TEXT([Fecha], "DD/MM/YYYY")>>': formatDate(ticket.Fecha),
    '<<[Cliente]>>': clean(ticket.Cliente),
    '<<[Hora de inicio]>>': clean(ticket.HoraInicio),
    '<<[Hora de Finalización]>>': clean(ticket.HoraFinal),
    '<<[Ubicación]>>': clean(ticket.Ubicacion),
    '<<[Supervisor]>>': clean(ticket.Supervisor),
    '<<[Razon_visita]>>': clean(ticket.RazonVisita),
    '<<[Descripción]>>': clean(ticket.Descripcion),
    '<<[Fabricante]>>': clean(ticket.Fabricante),
    '<<[Modelo]>>': clean(ticket.Modelo),
    '<<[Serie]>>': clean(ticket.Serie),
    '<<[Ubicacion_equipo]>>': clean(ticket.UbicacionEquipo || ticket.Ubicacion),
    '<<[Pruebas realizadas]>>': clean(ticket.PruebasRealizadas),
    '<<[Resultado]>>': clean(ticket.Resultado),
    '<<[Recomendaciones ]>>': clean(ticket.Recomendaciones),
    '<<[AsignadoA]>>': assignedNames,
    '<<[Firma]>>': 'Firma incluida en los anexos del reporte.',
  };

  return Object.entries(values).map(([text, replaceText]) => ({
    replaceAllText: {
      containsText: { text, matchCase: true },
      replaceText,
    },
  }));
}

async function loadTicketBundle(ticketId) {
  const ticket = await findById('Boletas', ticketId);
  const tables = await readTables(['BoletaAsignados', 'Usuarios', 'EvidenciasBoleta', 'Clientes']);
  const usersById = new Map(tables.Usuarios.map((user) => [String(user.UsuarioID), user]));
  const assigned = tables.BoletaAsignados
    .filter((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && row.Activo !== false)
    .map((row) => {
      const user = usersById.get(String(row.UsuarioID));
      return {
        ...row,
        Nombre: clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], row.NombreUsuarioSnapshot || row.UsuarioID)),
        Correo: clean(user?.Correo),
      };
    });
  const evidences = tables.EvidenciasBoleta
    .filter((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && row.Activo !== false)
    .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
  const client = tables.Clientes.find((row) => String(row.ClienteID) === String(ticket.ClienteID)) || null;
  return { ticket, assigned, evidences, client };
}

async function appendDriveImage({ documentId, fileId, widthPt, temporaryPermissions }) {
  const temporary = await createTemporaryPublicImageUrl(fileId);
  temporaryPermissions.push({ fileId, permissionId: temporary.permissionId });
  await appendImage(documentId, temporary.url, widthPt);
}

async function appendSignatureAndEvidence(documentId, bundle, temporaryPermissions) {
  const signatureId = extractDriveFileId(bundle.ticket.FirmaArchivoID || bundle.ticket.FirmaURL);
  await appendPageBreak(documentId);
  await appendText(documentId, '\nANEXOS\n\nFIRMA DEL CLIENTE\n');
  if (signatureId) {
    try {
      await appendDriveImage({ documentId, fileId: signatureId, widthPt: 250, temporaryPermissions });
    } catch {
      await appendText(documentId, `No fue posible insertar la firma como imagen. Archivo: ${clean(bundle.ticket.FirmaURL)}\n`);
    }
  } else {
    await appendText(documentId, 'Sin firma registrada.\n');
  }

  await appendText(documentId, '\nEVIDENCIAS FOTOGRÁFICAS\n');
  if (!bundle.evidences.length) {
    await appendText(documentId, 'Sin evidencias asociadas.\n');
    return;
  }

  for (let index = 0; index < bundle.evidences.length; index += 1) {
    const evidence = bundle.evidences[index];
    const name = clean(evidence.Nombre || evidence.NombreArchivo, `Evidencia ${index + 1}`);
    const note = clean(evidence.Nota);
    const fileId = extractDriveFileId(evidence.ArchivoID || evidence.ArchivoURL);
    await appendText(documentId, `\n${index + 1}. ${name}\n${note ? `${note}\n` : ''}`);
    if (fileId && IMAGE_MIME.test(clean(evidence.MimeType))) {
      try {
        await appendDriveImage({ documentId, fileId, widthPt: 420, temporaryPermissions });
      } catch {
        await appendText(documentId, `No fue posible insertar la imagen. Archivo: ${clean(evidence.ArchivoURL)}\n`);
      }
    } else {
      await appendText(documentId, `Archivo: ${clean(evidence.ArchivoURL, 'Sin enlace')}\n`);
    }
  }
}

async function ensureReportFolder(ticket, config, testMode) {
  const baseFolderId = clean(config.BOLETAS_FOLDER_ID || config.ROOT_FOLDER_ID);
  if (!baseFolderId) {
    throw new AppError('REPORT_FOLDER_NOT_CONFIGURED', 'No está configurada la carpeta de boletas en Google Drive.', 503);
  }
  if (testMode) {
    const testsFolder = await createFolder('Pruebas de boletas', baseFolderId);
    return createFolder(`Boleta ${ticket.BoletaID || ticket.BoletaUID}`, testsFolder.id);
  }
  const clientFolder = await createFolder(clean(ticket.Cliente, 'Sin cliente'), baseFolderId);
  return createFolder(`Boleta ${ticket.BoletaID || ticket.BoletaUID} - ${safeName(ticket.Titulo)}`, clientFolder.id);
}

export async function generateTicketReport({ ticketId, actorId = '', testMode = false }) {
  const bundle = await loadTicketBundle(ticketId);
  const config = await getConfig();
  const templateId = clean(process.env.TEMPLATE_BOLETA_ID || config.TEMPLATE_BOLETA_ID);
  if (!templateId) {
    throw new AppError('TICKET_TEMPLATE_NOT_CONFIGURED', 'No está configurada la plantilla de Google Docs para las boletas.', 503);
  }

  const folder = await ensureReportFolder(bundle.ticket, config, testMode);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${testMode ? 'PRUEBA - ' : ''}Boleta ${bundle.ticket.BoletaID || bundle.ticket.BoletaUID} - ${safeName(bundle.ticket.Titulo)}`;
  const documentName = testMode ? `${baseName} - ${timestamp}` : baseName;
  const document = await copyDriveFile({ fileId: templateId, name: documentName, folderId: folder.id });
  const temporaryPermissions = [];

  try {
    const assignedNames = bundle.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
    await docsApi.documents.batchUpdate({
      documentId: document.id,
      requestBody: { requests: placeholderRequests(bundle.ticket, assignedNames) },
    });
    await appendSignatureAndEvidence(document.id, bundle, temporaryPermissions);

    const pdfBuffer = await exportGoogleFile(document.id, 'application/pdf');
    const pdfName = `${documentName}.pdf`;
    const pdf = await uploadBuffer({ buffer: pdfBuffer, mimeType: 'application/pdf', fileName: pdfName, folderId: folder.id });
    const documentUrl = document.webViewLink || `https://docs.google.com/document/d/${document.id}/edit`;
    const pdfUrl = pdf.webViewLink || `https://drive.google.com/file/d/${pdf.id}/view`;

    if (!testMode) {
      await updateRow('Boletas', bundle.ticket.BoletaUID, {
        DocumentoURL: documentUrl,
        PDFURL: pdfUrl,
        CarpetaURL: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
        ActualizadoPor: actorId,
        FechaActualizacion: new Date().toISOString(),
      });
    }

    return {
      ...bundle,
      folderId: folder.id,
      folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      documentId: document.id,
      documentUrl,
      pdfId: pdf.id,
      pdfUrl,
      pdfName,
      pdfBuffer,
      testMode,
    };
  } finally {
    await Promise.allSettled(temporaryPermissions.map(({ fileId, permissionId }) => removeDrivePermission(fileId, permissionId)));
  }
}

export async function loadReportPdfBuffer(pdfUrlOrId) {
  const fileId = extractDriveFileId(pdfUrlOrId);
  if (!fileId) throw new AppError('PDF_NOT_FOUND', 'No se pudo identificar el archivo PDF de la boleta.', 404);
  return downloadFileBuffer(fileId, 'application/pdf');
}
