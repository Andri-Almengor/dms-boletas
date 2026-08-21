import { badRequest, AppError } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { downloadAsDataUrl, extractDriveFileId, uploadBase64 } from '../infra/drive.repository.js';
import {
  appendRow,
  findById,
  readTable,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';
import {
  ensureMaintenanceSignatureStorage,
  synchronizeMaintenanceSignatureToTickets,
} from './maintenance-signature-request.service.js';

const REQUEST_SHEET = 'FirmaMantenimientoSolicitudes';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}

function normalizeBase64(value) {
  return String(value || '')
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    .replace(/\s+/g, '');
}

function validateSignaturePayload(base64, mimeType) {
  const normalized = normalizeBase64(base64);
  if (!normalized) throw badRequest('Debe dibujar la firma antes de guardarla.');
  if (!/^image\/(png|jpeg|jpg)$/i.test(clean(mimeType, 'image/png'))) {
    throw badRequest('La firma debe enviarse como una imagen PNG o JPEG.');
  }
  const estimatedBytes = Math.floor(normalized.length * 0.75);
  if (estimatedBytes > 4 * 1024 * 1024) {
    throw badRequest('La firma supera el tamaño máximo permitido de 4 MB.');
  }
  return normalized;
}

function signatureFromMaintenance(maintenance = {}) {
  const url = clean(pick(maintenance, ['FirmaURL', 'FirmaUrl', 'Firma']));
  const fileId = clean(pick(maintenance, ['FirmaArchivoID', 'FirmaFileID'])) || extractDriveFileId(url);
  return {
    signed: Boolean(fileId || url),
    fileId,
    url,
    mimeType: clean(maintenance.FirmaMimeType, 'image/png'),
    signedAt: maintenance.FirmaFecha || maintenance.FechaActualizacion || '',
    origin: clean(maintenance.FirmaOrigen, 'MANTENIMIENTO_GENERAL'),
    source: 'MANTENIMIENTO',
    requestId: '',
  };
}

function signatureFromRequest(row = {}) {
  const url = clean(row.FirmaURL);
  const fileId = clean(row.FirmaArchivoID) || extractDriveFileId(url);
  return {
    signed: Boolean(fileId || url),
    fileId,
    url,
    mimeType: 'image/png',
    signedAt: row.FechaFirma || row.FechaActualizacion || '',
    origin: 'SOLICITUD_FIRMA_MANTENIMIENTO',
    source: 'FIRMA_MANTENIMIENTO_SOLICITUDES',
    requestId: clean(row.SolicitudFirmaMantenimientoID),
  };
}

function newestFirst(left, right) {
  const leftDate = String(left.FechaFirma || left.FechaActualizacion || left.FechaCreacion || '');
  const rightDate = String(right.FechaFirma || right.FechaActualizacion || right.FechaCreacion || '');
  return rightDate.localeCompare(leftDate);
}

function realRequestsForMaintenance(rows, maintenanceId) {
  return (rows || [])
    .filter((row) => clean(row.MantenimientoID) === clean(maintenanceId) && !bool(row.ModoPrueba))
    .sort(newestFirst);
}

async function signatureMedia(signature) {
  if (!signature?.fileId) return { dataUrl: '', mediaError: '' };
  try {
    const media = await downloadAsDataUrl(signature.fileId, signature.mimeType || 'image/png');
    return {
      dataUrl: media.dataUrl || '',
      mediaError: '',
      mimeType: media.mimeType || signature.mimeType || 'image/png',
      url: signature.url || media.url || media.webViewLink || '',
    };
  } catch (error) {
    return {
      dataUrl: '',
      mediaError: clean(error?.message || error),
    };
  }
}

export async function currentMaintenanceSignature(
  maintenanceId,
  { includeDataUrl = true, backfill = true } = {},
) {
  const id = clean(maintenanceId);
  if (!id) throw badRequest('No se indicó el mantenimiento de la firma.');

  let maintenance = await findById('Mantenimiento', id);
  let signature = signatureFromMaintenance(maintenance);

  if (!signature.signed) {
    await ensureMaintenanceSignatureStorage();
    const requests = realRequestsForMaintenance(await readTable(REQUEST_SHEET, { force: true }), id);
    const signedRequest = requests.find((row) => (
      clean(row.Estado).toUpperCase() === 'FIRMADA'
      && Boolean(clean(row.FirmaArchivoID || row.FirmaURL))
    ));

    if (signedRequest) {
      signature = signatureFromRequest(signedRequest);
      if (backfill) {
        const patch = {
          FirmaArchivoID: signature.fileId,
          FirmaURL: signature.url,
          FirmaMimeType: signature.mimeType,
          FirmaOrigen: 'RECUPERADA_SOLICITUD_MANTENIMIENTO',
          FirmaFecha: signature.signedAt || nowIso(),
          ActualizadoPor: 'SISTEMA_RECUPERACION_FIRMA',
          FechaActualizacion: nowIso(),
        };
        const updated = await updateRow('Mantenimiento', id, patch);
        maintenance = { ...maintenance, ...updated, ...patch };
      }
    }
  }

  const media = includeDataUrl && signature.signed
    ? await signatureMedia(signature)
    : { dataUrl: '', mediaError: '' };

  return {
    ...signature,
    ...media,
    maintenance,
  };
}

export async function replaceMaintenanceSignature({
  maintenanceId,
  base64,
  mimeType = 'image/png',
  actor = 'SISTEMA',
}) {
  const id = clean(maintenanceId);
  if (!id) throw badRequest('No se indicó el mantenimiento de la firma.');
  const normalizedBase64 = validateSignaturePayload(base64, mimeType);

  await ensureMaintenanceSignatureStorage();
  const maintenance = await findById('Mantenimiento', id);
  const config = await getConfig();
  const folderId = clean(config.FIRMAS_FOLDER_ID || process.env.FIRMAS_FOLDER_ID);
  if (!folderId) {
    throw new AppError(
      'SIGNATURE_FOLDER_NOT_CONFIGURED',
      'No está configurada la carpeta de firmas.',
      503,
    );
  }

  const timestamp = nowIso();
  const file = await uploadBase64({
    base64: normalizedBase64,
    mimeType,
    fileName: `firma_cliente_mantenimiento_${id}_${Date.now()}.png`,
    folderId,
  });

  const signatureSource = {
    ...maintenance,
    FirmaArchivoID: file.id,
    FirmaURL: file.webViewLink || '',
    FirmaMimeType: mimeType,
    FirmaOrigen: 'EDICION_MANTENIMIENTO',
    FirmaFecha: timestamp,
  };

  const updatedMaintenance = await updateRow('Mantenimiento', id, {
    FirmaArchivoID: file.id,
    FirmaURL: file.webViewLink || '',
    FirmaMimeType: mimeType,
    FirmaOrigen: 'EDICION_MANTENIMIENTO',
    FirmaFecha: timestamp,
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
  });

  const requests = realRequestsForMaintenance(await readTable(REQUEST_SHEET, { force: true }), id);
  const current = requests[0] || null;
  const stalePending = requests
    .filter((row) => row.SolicitudFirmaMantenimientoID !== current?.SolicitudFirmaMantenimientoID)
    .filter((row) => clean(row.Estado).toUpperCase() === 'PENDIENTE')
    .map((row) => ({
      idValue: row.SolicitudFirmaMantenimientoID,
      patch: {
        Estado: 'REEMPLAZADA',
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    }));
  if (stalePending.length) await updateRows(REQUEST_SHEET, stalePending);

  let requestId = '';
  if (current) {
    requestId = clean(current.SolicitudFirmaMantenimientoID);
    await updateRow(REQUEST_SHEET, requestId, {
      Estado: 'FIRMADA',
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink || '',
      FechaFirma: timestamp,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  } else {
    requestId = uuid();
    await appendRow(REQUEST_SHEET, {
      SolicitudFirmaMantenimientoID: requestId,
      Token: `mntsig_manual_${uuid()}`,
      MantenimientoID: id,
      ClienteID: maintenance.ClienteID || '',
      ClienteNombre: maintenance.Cliente || 'Cliente',
      TituloMantenimiento: maintenance.TituloMantenimiento || 'Mantenimiento técnico',
      FirmaURLPublica: '',
      Estado: 'FIRMADA',
      ModoPrueba: false,
      FirmaArchivoID: file.id,
      FirmaURL: file.webViewLink || '',
      FechaCreacion: timestamp,
      FechaExpiracion: '',
      FechaFirma: timestamp,
      CreadoPor: actor,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  }

  const synchronization = await synchronizeMaintenanceSignatureToTickets(
    id,
    signatureSource,
    actor,
  );
  const media = await signatureMedia({
    signed: true,
    fileId: file.id,
    url: file.webViewLink || '',
    mimeType,
  });

  return {
    signed: true,
    fileId: file.id,
    url: file.webViewLink || '',
    mimeType,
    signedAt: timestamp,
    origin: 'EDICION_MANTENIMIENTO',
    source: 'EDICION_MANTENIMIENTO',
    requestId,
    dataUrl: media.dataUrl || '',
    mediaError: media.mediaError || '',
    synchronizedTickets: synchronization.updated || 0,
    maintenance: { ...maintenance, ...updatedMaintenance, ...signatureSource },
  };
}
