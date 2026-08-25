import { nowIso, pick } from '../core/utils.js';
import { updateRow, updateRows } from '../infra/sheets.repository.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { maintenanceDynamicQuestionHandlers } from '../modules/maintenance-question-ready.module.js';
import { maintenanceScalableImageHandlers } from '../modules/maintenance-scalable-images.module.js';
import { ensureSheetColumns } from './sheet-columns.service.js';
import {
  EVIDENCE_VIDEO_INLINE_MAX_BYTES,
  normalizeMacAddress,
  validateEvidenceMediaPayload,
} from './evidence-media-policy.service.js';

const INSTALL_FLAG = Symbol.for('dms.deviceMediaVideoMac');
const MAC_COLUMNS = ['DireccionMAC'];
const TICKET_MEDIA_COLUMNS = ['TipoMedio', 'DuracionSegundos', 'TamanoBytes'];
const MAINTENANCE_MEDIA_COLUMNS = ['TipoMedio', 'DuracionSegundos'];

function clean(value) {
  return String(value ?? '').trim();
}

function hasOwn(object, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(object || {}, key));
}

function requestedMac(payload = {}) {
  if (!hasOwn(payload, ['DireccionMAC', 'direccionMAC', 'macAddress', 'mac', 'MACAddress'])) return null;
  return normalizeMacAddress(pick(payload, ['DireccionMAC', 'direccionMAC', 'macAddress', 'mac', 'MACAddress']));
}

function ticketId(result = {}, payload = {}) {
  return clean(pick(
    result?.boleta || result,
    ['BoletaUID', 'boletaUid', 'TicketUID', 'id'],
    pick(payload, ['BoletaUID', 'boletaUid', 'id']),
  ));
}

function maintenanceDeviceId(result = {}, payload = {}) {
  return clean(pick(
    result,
    ['EvidenciaMantenimientoID', 'deviceId', 'id'],
    pick(payload, ['EvidenciaMantenimientoID', 'deviceId', 'id']),
  ));
}

async function persistTicketMac(ctx, result) {
  const mac = requestedMac(ctx.payload);
  if (mac === null) return result;
  const id = ticketId(result, ctx.payload);
  if (!id) return result;
  await ensureSheetColumns('Boletas', MAC_COLUMNS);
  const patch = {
    DireccionMAC: mac,
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: nowIso(),
  };
  const saved = await updateRow('Boletas', id, patch);
  return result?.boleta
    ? { ...result, boleta: { ...result.boleta, ...saved, DireccionMAC: mac } }
    : { ...result, ...saved, DireccionMAC: mac };
}

async function persistMaintenanceDeviceMac(ctx, result) {
  const mac = requestedMac(ctx.payload);
  if (mac === null) return result;
  const id = maintenanceDeviceId(result, ctx.payload);
  if (!id) return result;
  await ensureSheetColumns('Evidencia_Mantenimientos', MAC_COLUMNS);
  const saved = await updateRow('Evidencia_Mantenimientos', id, {
    DireccionMAC: mac,
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: nowIso(),
  });
  return { ...result, ...saved, DireccionMAC: mac };
}

function mediaPayload(payload = {}, metadata) {
  return {
    ...payload,
    mimeType: metadata.mimeType,
    MimeType: metadata.mimeType,
    mediaType: metadata.mediaType,
    TipoMedio: metadata.mediaType,
    durationSeconds: metadata.durationSeconds,
    DuracionSegundos: metadata.durationSeconds,
    size: metadata.size,
    TamanoBytes: metadata.size,
  };
}

function validateInlineMedia(payload, options = {}) {
  return validateEvidenceMediaPayload(payload, {
    ...options,
    maxVideoBytes: EVIDENCE_VIDEO_INLINE_MAX_BYTES,
  });
}

async function persistTicketEvidenceMetadata(result, metadata, actor) {
  const id = clean(pick(result, ['EvidenciaID', 'evidenciaId', 'id']));
  if (!id) return result;
  await ensureSheetColumns('EvidenciasBoleta', TICKET_MEDIA_COLUMNS);
  const saved = await updateRow('EvidenciasBoleta', id, {
    TipoMedio: metadata.mediaType,
    DuracionSegundos: metadata.durationSeconds,
    TamanoBytes: metadata.size,
    ActualizadoPor: actor || 'SISTEMA',
    FechaActualizacion: nowIso(),
  });
  return { ...result, ...saved };
}

async function persistMaintenanceEvidenceMetadata(result, metadata, actor) {
  const id = clean(pick(result, ['FotoDispositivoID', 'imageId', 'id']));
  if (!id) return result;
  await ensureSheetColumns('Mantenimiento imagenes', MAINTENANCE_MEDIA_COLUMNS);
  const saved = await updateRow('Mantenimiento imagenes', id, {
    TipoMedio: metadata.mediaType,
    DuracionSegundos: metadata.durationSeconds,
    ActualizadoPor: actor || 'SISTEMA',
    FechaActualizacion: nowIso(),
  });
  return { ...result, ...saved };
}

if (!ticketMultiHandlers[INSTALL_FLAG]) {
  for (const name of ['create', 'update', 'autosave']) {
    const original = ticketMultiHandlers[name];
    ticketMultiHandlers[name] = async (ctx) => persistTicketMac(ctx, await original(ctx));
  }

  const originalEvidenceUpload = ticketMultiHandlers.evidenceUpload;
  ticketMultiHandlers.evidenceUpload = async (ctx) => {
    const metadata = validateInlineMedia(ctx.payload, { allowDocuments: true });
    const result = await originalEvidenceUpload({ ...ctx, payload: mediaPayload(ctx.payload, metadata) });
    return persistTicketEvidenceMetadata(result, metadata, ctx.user?.UsuarioID);
  };

  ticketMultiHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceDynamicQuestionHandlers[INSTALL_FLAG]) {
  for (const name of ['deviceCreate', 'deviceUpdate', 'deviceAutosave']) {
    const original = maintenanceDynamicQuestionHandlers[name];
    maintenanceDynamicQuestionHandlers[name] = async (ctx) => persistMaintenanceDeviceMac(ctx, await original(ctx));
  }

  const originalImageUpload = maintenanceDynamicQuestionHandlers.imageUpload;
  maintenanceDynamicQuestionHandlers.imageUpload = async (ctx) => {
    const metadata = validateInlineMedia(ctx.payload, { allowDocuments: false });
    const result = await originalImageUpload({ ...ctx, payload: mediaPayload(ctx.payload, metadata) });
    return persistMaintenanceEvidenceMetadata(result, metadata, ctx.user?.UsuarioID);
  };

  maintenanceDynamicQuestionHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceScalableImageHandlers[INSTALL_FLAG]) {
  const originalUploadBatch = maintenanceScalableImageHandlers.uploadBatch;
  maintenanceScalableImageHandlers.uploadBatch = async (ctx) => {
    const source = Array.isArray(ctx.payload?.images) ? ctx.payload.images : [];
    const metadataByKey = new Map();
    const images = source.map((item, index) => {
      const metadata = validateInlineMedia(item, { allowDocuments: false, index });
      const key = clean(pick(item, ['localId', 'imageId', 'FotoDispositivoID'], String(index)));
      metadataByKey.set(key, metadata);
      return mediaPayload(item, metadata);
    });

    const result = await originalUploadBatch({ ...ctx, payload: { ...ctx.payload, images } });
    const uploaded = Array.isArray(result?.uploaded) ? result.uploaded : [];
    const updates = uploaded.map((row, index) => {
      const key = clean(pick(row, ['clientKey', 'FotoDispositivoID', 'imageId'], String(index)));
      const metadata = metadataByKey.get(key) || metadataByKey.get(clean(row.FotoDispositivoID));
      if (!metadata || !row.FotoDispositivoID) return null;
      return {
        idValue: row.FotoDispositivoID,
        patch: {
          TipoMedio: metadata.mediaType,
          DuracionSegundos: metadata.durationSeconds,
          ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
          FechaActualizacion: nowIso(),
        },
      };
    }).filter(Boolean);

    if (updates.length) {
      await ensureSheetColumns('Mantenimiento imagenes', MAINTENANCE_MEDIA_COLUMNS);
      const saved = await updateRows('Mantenimiento imagenes', updates);
      const byId = new Map(saved.map((row) => [clean(row.FotoDispositivoID), row]));
      result.uploaded = uploaded.map((row) => ({ ...row, ...(byId.get(clean(row.FotoDispositivoID)) || {}) }));
    }
    return result;
  };

  maintenanceScalableImageHandlers[INSTALL_FLAG] = true;
}

export const DEVICE_MEDIA_VIDEO_MAC_POLICY = Object.freeze({
  videoMaxSeconds: 90,
  videoInlineMaxBytes: EVIDENCE_VIDEO_INLINE_MAX_BYTES,
  ticketVideos: true,
  maintenanceVideos: true,
  macAddressField: 'DireccionMAC',
});
