import { appendRow, readTables } from '../infra/sheets.repository.js';
import {
  copyDriveFile,
  createFolder,
  extractDriveFileId,
  uploadBuffer,
} from '../infra/drive.repository.js';
import { driveApi } from '../infra/google.js';
import { getConfig } from '../modules/config.module.js';
import { sendChatMessage } from './chat.service.js';
import { nowIso, uuid } from '../core/utils.js';
import { AppError } from '../core/errors.js';

const IMAGE_COPY_CONCURRENCY = 3;

function clean(value) { return String(value ?? '').trim(); }
function positiveEnvInteger(name, fallback, minimum = 1, maximum = 500) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export const STAGED_DRIVE_IMAGE_CHUNK = positiveEnvInteger(
  'MAINTENANCE_FINALIZATION_DRIVE_IMAGE_CHUNK',
  15,
  1,
  50,
);

function safe(value, fallback = 'Sin nombre', max = 120) {
  return (clean(value) || fallback)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, max) || fallback;
}

function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function dateName(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : safe(value, 'Sin fecha', 30);
}

function validWebhook(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:'
      && url.hostname === 'chat.googleapis.com'
      && url.pathname.includes('/messages')
      && url.searchParams.has('key')
      && url.searchParams.has('token');
  } catch {
    return false;
  }
}

function webhook(...values) { return values.map(clean).find(validWebhook) || ''; }
function testWebhook(config) {
  return webhook(
    process.env.GOOGLE_CHAT_TEST_WEBHOOK,
    config.CHAT_TEST_WEBHOOK,
    config.CHAT_WEBHOOK_PRUEBAS,
    config.CHAT_TEST_MODE,
  );
}
function clientWebhook(client) { return webhook(client?.ChatWebhook, client?.ChatWebhookURL); }
function rootFolder(config) {
  return clean(
    config.MANTENIMIENTOS_EVIDENCE_ROOT_FOLDER_ID
      || config.EVIDENCE_ROOT_FOLDER_ID
      || config.MANTENIMIENTOS_FOLDER_ID
      || config.MANTENIMIENTOS_REPORTS_FOLDER_ID
      || config.EVIDENCIAS_FOLDER_ID
      || config.ROOT_FOLDER_ID,
  );
}

function imageKind(value) {
  const source = norm(value);
  if (source.includes('desp') || source.includes('after')) return 'DESPUES';
  if (source.includes('antes') || source.includes('before')) return 'ANTES';
  return 'OTRA';
}

function extension(image) {
  const match = clean(image.Nombre).match(/\.([a-zA-Z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  return ({
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  })[clean(image.MimeType).toLowerCase()] || 'jpg';
}

function sortImages(rows = []) {
  return [...rows].sort((a, b) => {
    const byOrder = Number(a.Orden || 0) - Number(b.Orden || 0);
    if (byOrder) return byOrder;
    const byRow = Number(a.__rowNumber || 0) - Number(b.__rowNumber || 0);
    if (byRow) return byRow;
    return clean(a.FotoDispositivoID).localeCompare(clean(b.FotoDispositivoID));
  });
}

async function concurrentMap(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

async function findNamed(folderId, name) {
  const escaped = clean(name).replace(/'/g, "\\'");
  const response = await driveApi.files.list({
    q: `'${folderId}' in parents and name='${escaped}' and trashed=false`,
    fields: 'files(id,name,webViewLink,mimeType,size)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files?.[0] || null;
}

async function replaceText(folderId, name, content) {
  const existing = await findNamed(folderId, name);
  if (existing?.id) {
    await driveApi.files.update({
      fileId: existing.id,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  }
  return uploadBuffer({
    buffer: Buffer.from(String(content || ''), 'utf8'),
    mimeType: 'text/plain',
    fileName: name,
    folderId,
  });
}

async function copyOnce(fileId, folderId, name) {
  const existing = await findNamed(folderId, name);
  return existing ? { ...existing, skipped: true } : copyDriveFile({ fileId, folderId, name });
}

async function loadBundle(id) {
  const tables = await readTables([
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'Mantenimiento imagenes',
    'Clientes',
  ]);
  const maintenance = tables.Mantenimiento.find((row) => String(row.MantenimientoID) === String(id));
  if (!maintenance) throw new AppError('MAINTENANCE_NOT_FOUND', 'No se encontró el mantenimiento que se desea finalizar.', 404);
  const devices = tables.Evidencia_Mantenimientos
    .filter((item) => String(item.MantenimientoRef) === String(id) && item.Activo !== false);
  const deviceIds = new Set(devices.map((item) => String(item.EvidenciaMantenimientoID)));
  return {
    maintenance,
    devices,
    images: tables['Mantenimiento imagenes']
      .filter((item) => deviceIds.has(String(item.DispositivoMantenimientoRef)) && item.Activo !== false),
    client: tables.Clientes.find((item) => String(item.ClienteID) === String(maintenance.ClienteID)) || null,
  };
}

async function folderStructure(bundle, config) {
  const rootId = rootFolder(config);
  if (!rootId) {
    throw new AppError('MAINTENANCE_ROOT_FOLDER_MISSING', 'Configure la carpeta raíz Mantenimientos.', 500);
  }
  // El root configurado representa la carpeta "Mantenimientos". Debajo se
  // conserva un único expediente por cliente y mantenimiento.
  const client = await createFolder(
    bundle.maintenance.Cliente || bundle.client?.Nombre || 'Cliente sin nombre',
    rootId,
  );
  const maintenance = await createFolder(
    `${dateName(bundle.maintenance.Fecha)} - ${safe(bundle.maintenance.TituloMantenimiento, 'Mantenimiento')} - ${safe(bundle.maintenance.MantenimientoID, 'SIN ID')}`,
    client.id,
  );
  const [boletas, zones] = await Promise.all([
    createFolder('Boletas', maintenance.id),
    createFolder('Zonas', maintenance.id),
  ]);
  return {
    client,
    boletas,
    zones,
    maintenance: {
      ...maintenance,
      webViewLink: maintenance.webViewLink || `https://drive.google.com/drive/folders/${maintenance.id}`,
    },
  };
}

function deviceInfo(bundle, device, images) {
  let answers = {};
  try { answers = JSON.parse(device.RespuestasJSON || '{}'); } catch { answers = {}; }
  const evidenceLines = images.length
    ? images.map((image, index) => [
      `${index + 1}. ${image.Tipo || 'Evidencia'}`,
      `Archivo: ${image.Nombre || 'N/A'}`,
      `Nota: ${image.Nota || 'N/A'}`,
      `Drive: ${image.DriveURL || image.DriveFileID || 'N/A'}`,
    ].join(' | '))
    : ['Sin evidencias registradas.'];
  return [
    'LOG DE DISPOSITIVO - MANTENIMIENTO DMS',
    '',
    'MANTENIMIENTO',
    `MantenimientoID: ${bundle.maintenance.MantenimientoID || 'N/A'}`,
    `Cliente: ${bundle.maintenance.Cliente || bundle.client?.Nombre || 'N/A'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'N/A'}`,
    `Fecha: ${bundle.maintenance.Fecha || 'N/A'}`,
    '',
    'DISPOSITIVO',
    `DispositivoID: ${device.EvidenciaMantenimientoID || 'N/A'}`,
    `Nombre: ${device.NombreDispositivo || 'N/A'}`,
    `Zona: ${device.Zona || 'N/A'}`,
    `Tipo de dispositivo: ${device.TipoDispositivo || 'N/A'}`,
    `Categoría: ${device.Categoria || 'N/A'}`,
    `Fabricante: ${device.Fabricante || 'N/A'}`,
    `Modelo: ${device.Modelo || 'N/A'}`,
    `Serie: ${device.Serie || 'N/A'}`,
    `Funcionamiento: ${device.Funcionamiento || 'N/A'}`,
    `En uso: ${device.EnUso || 'N/A'}`,
    `Estado: ${device.Estado || 'N/A'}`,
    `Observación: ${device.Observacion || 'N/A'}`,
    '',
    'CHECKLIST / RESPUESTAS',
    ...(Object.keys(answers).length
      ? Object.entries(answers).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      : ['Sin respuestas adicionales.']),
    '',
    `EVIDENCIAS (${images.length})`,
    ...evidenceLines,
    '',
    `Log generado: ${nowIso()}`,
  ].join('\n');
}

function globalEvidenceNames(device, images) {
  const counters = { ANTES: 0, DESPUES: 0, OTRA: 0 };
  const map = new Map();
  images.forEach((image) => {
    const kind = imageKind(image.Tipo);
    counters[kind] += 1;
    const label = kind === 'ANTES' ? 'Antes' : kind === 'DESPUES' ? 'Despues' : 'Otra';
    map.set(clean(image.FotoDispositivoID), {
      kind,
      name: `${safe(device.NombreDispositivo || device.EvidenciaMantenimientoID, 'Dispositivo', 70)} - ${label} ${String(counters[kind]).padStart(3, '0')}.${extension(image)}`,
    });
  });
  return map;
}

async function evidenceFolder(deviceFolderId, kind, cache) {
  if (cache.has(kind)) return cache.get(kind);
  const name = kind === 'ANTES' ? 'Antes' : kind === 'DESPUES' ? 'Despues' : 'Otros';
  const folder = await createFolder(name, deviceFolderId);
  cache.set(kind, folder);
  return folder;
}

export async function archiveMaintenanceTicketPdf({
  maintenanceId,
  ticketId,
  ticketNumber,
  title,
  pdfId = '',
  pdfUrl = '',
}) {
  const id = clean(maintenanceId);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento para archivar la boleta.', 400);
  const sourceId = clean(pdfId) || extractDriveFileId(pdfUrl);
  if (!sourceId) {
    throw new AppError(
      'MAINTENANCE_TICKET_PDF_MISSING',
      `La boleta ${ticketNumber || ticketId || ''} no tiene un PDF de Drive válido.`,
      500,
    );
  }
  const [bundle, config] = await Promise.all([loadBundle(id), getConfig()]);
  const folders = await folderStructure(bundle, config);
  const fileName = `Boleta ${safe(ticketNumber || ticketId, 'SIN-ID', 50)} - ${safe(title, 'Mantenimiento', 80)}.pdf`;
  const copied = await copyOnce(sourceId, folders.boletas.id, fileName);
  return {
    maintenanceId: id,
    ticketId: clean(ticketId),
    pdfId: sourceId,
    archivedPdfId: copied.id,
    archivedPdfUrl: copied.webViewLink || `https://drive.google.com/file/d/${copied.id}/view`,
    boletasFolderId: folders.boletas.id,
    boletasFolderUrl: folders.boletas.webViewLink || `https://drive.google.com/drive/folders/${folders.boletas.id}`,
    maintenanceFolderId: folders.maintenance.id,
    maintenanceFolderUrl: folders.maintenance.webViewLink,
    skipped: Boolean(copied.skipped),
  };
}

export async function prepareStagedDrivePlan(maintenanceId) {
  const id = clean(maintenanceId);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento.', 400);
  const bundle = await loadBundle(id);
  if (!bundle.devices.length) throw new AppError('MAINTENANCE_WITHOUT_DEVICES', 'Debe registrar al menos un dispositivo.', 400);
  const byDevice = new Map();
  bundle.images.forEach((image) => {
    const deviceId = clean(image.DispositivoMantenimientoRef);
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
    byDevice.get(deviceId).push(image);
  });
  let order = 0;
  const items = [];
  bundle.devices.forEach((device) => {
    const deviceId = clean(device.EvidenciaMantenimientoID);
    const images = sortImages(byDevice.get(deviceId) || []);
    const totalParts = Math.max(1, Math.ceil(images.length / STAGED_DRIVE_IMAGE_CHUNK));
    for (let part = 1; part <= totalParts; part += 1) {
      const start = (part - 1) * STAGED_DRIVE_IMAGE_CHUNK;
      const selected = images.slice(start, start + STAGED_DRIVE_IMAGE_CHUNK);
      order += 1;
      items.push({
        type: 'DRIVE',
        referenceId: deviceId,
        order,
        part,
        totalParts,
        evidences: selected.length,
      });
    }
  });
  return {
    maintenance: bundle.maintenance,
    devices: bundle.devices,
    images: bundle.images,
    items,
    imageChunkSize: STAGED_DRIVE_IMAGE_CHUNK,
  };
}

export async function processStagedDriveItem(ctx, maintenanceId, item) {
  const id = clean(maintenanceId);
  const deviceId = clean(item?.ReferenciaID || item?.referenceId);
  const part = Math.max(1, Number(item?.Parte || item?.part || 1));
  const totalParts = Math.max(1, Number(item?.TotalPartes || item?.totalParts || 1));
  const [bundle, config] = await Promise.all([loadBundle(id), getConfig()]);
  const device = bundle.devices.find((candidate) => clean(candidate.EvidenciaMantenimientoID) === deviceId);
  if (!device) throw new AppError('MAINTENANCE_DEVICE_NOT_FOUND', `No se encontró el dispositivo ${deviceId}.`, 404);

  const folders = await folderStructure(bundle, config);
  const zone = await createFolder(device.Zona || 'Zona sin nombre', folders.zones.id);
  const type = await createFolder(
    device.TipoDispositivo || device.Categoria || 'Tipo de dispositivo sin nombre',
    zone.id,
  );
  const deviceFolder = await createFolder(
    device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo',
    type.id,
  );

  const allImages = sortImages(
    bundle.images.filter((image) => clean(image.DispositivoMantenimientoRef) === deviceId),
  );
  const start = (part - 1) * STAGED_DRIVE_IMAGE_CHUNK;
  const selected = allImages.slice(start, start + STAGED_DRIVE_IMAGE_CHUNK);
  const names = globalEvidenceNames(device, allImages);
  const evidenceFolders = new Map();

  const copyResults = await concurrentMap(selected, IMAGE_COPY_CONCURRENCY, async (image) => {
    const meta = names.get(clean(image.FotoDispositivoID))
      || { kind: imageKind(image.Tipo), name: safe(image.Nombre, 'Evidencia') };
    try {
      if (!clean(image.DriveFileID)) throw new Error('La evidencia no tiene DriveFileID.');
      const target = await evidenceFolder(deviceFolder.id, meta.kind, evidenceFolders);
      const result = await copyOnce(image.DriveFileID, target.id, meta.name);
      return { skipped: Boolean(result.skipped), error: '' };
    } catch (error) {
      return { skipped: false, error: `${meta.name}: ${error?.message || error}` };
    }
  });

  if (part === totalParts) {
    await replaceText(
      deviceFolder.id,
      `LOG - ${safe(device.NombreDispositivo || deviceId, 'Dispositivo', 80)}.txt`,
      deviceInfo(bundle, device, allImages),
    );
  }

  const errors = copyResults.map((result) => result.error).filter(Boolean);
  const skipped = copyResults.filter((result) => result.skipped).length;
  const copied = copyResults.length - skipped - errors.length;
  return {
    maintenanceId: id,
    deviceId,
    part,
    totalParts,
    evidenceCount: selected.length,
    copied,
    skipped,
    errors,
    folderId: deviceFolder.id,
    folderUrl: deviceFolder.webViewLink || `https://drive.google.com/drive/folders/${deviceFolder.id}`,
    maintenanceFolderId: folders.maintenance.id,
    maintenanceFolderUrl: folders.maintenance.webViewLink,
  };
}

function destination(bundle, config) {
  const client = clientWebhook(bundle.client);
  if (client) return { url: client, label: `Chat del cliente: ${bundle.maintenance.Cliente}`, fallback: false, skipped: false };
  const test = testWebhook(config);
  if (test) return { url: test, label: 'Chat de pruebas (cliente sin Chat)', fallback: true, skipped: false };
  return { url: '', label: 'Sin Chat configurado', fallback: false, skipped: true };
}

async function notification(ctx, bundle, dest, result, error, skipped = false) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'MANTENIMIENTO',
    EntidadID: bundle.maintenance.MantenimientoID,
    Canal: 'CHAT',
    Destino: dest.label,
    Tipo: 'FINALIZACION_MANTENIMIENTO',
    Estado: skipped ? 'OMITIDO' : error ? 'ERROR' : 'ENVIADO',
    Intentos: skipped ? 0 : 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? String(error?.message || error).slice(0, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: !error && !skipped ? nowIso() : '',
    CreadoPor: ctx.user?.UsuarioID || 'SISTEMA',
  }).catch(() => {});
}

export async function finalizeStagedMaintenanceDelivery(ctx, maintenanceId, driveItems = []) {
  const id = clean(maintenanceId);
  const [bundle, config] = await Promise.all([loadBundle(id), getConfig()]);
  const folders = await folderStructure(bundle, config);
  const completed = driveItems.filter((item) => clean(item.Estado).toUpperCase() === 'COMPLETADO');
  const deviceIds = new Set(completed.map((item) => clean(item.ReferenciaID)).filter(Boolean));
  const images = completed.reduce((sum, item) => sum + Number(item.Evidencias || 0), 0);
  const copied = completed.reduce((sum, item) => sum + Number(item.Copiadas || 0), 0);
  const existing = completed.reduce((sum, item) => sum + Number(item.Existentes || 0), 0);
  const errors = driveItems.map((item) => clean(item.UltimoError)).filter(Boolean);
  const dest = destination(bundle, config);

  // Chat deja de transportar el expediente. Toda la información queda en Drive.
  const text = [
    '✅ Mantenimiento finalizado correctamente.',
    `Expediente completo: ${folders.maintenance.webViewLink}`,
  ].join('\n');

  let chat = { sent: false, skipped: true };
  let chatError = '';
  if (dest.skipped) {
    await notification(ctx, bundle, dest, null, null, true);
  } else {
    try {
      chat = await sendChatMessage(dest.url, text);
      await notification(ctx, bundle, dest, chat, null, false);
    } catch (error) {
      chatError = String(error?.message || error);
      await notification(ctx, bundle, dest, null, error, false);
    }
  }

  const logLines = [
    'LOG DE FINALIZACIÓN DE MANTENIMIENTO DMS',
    `MantenimientoID: ${id}`,
    `Cliente: ${bundle.maintenance.Cliente || bundle.client?.Nombre || 'N/A'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'N/A'}`,
    `Fecha: ${bundle.maintenance.Fecha || 'N/A'}`,
    `Carpeta: ${folders.maintenance.webViewLink}`,
    `Carpeta de boletas: ${folders.boletas.webViewLink || `https://drive.google.com/drive/folders/${folders.boletas.id}`}`,
    `Carpeta de zonas: ${folders.zones.webViewLink || `https://drive.google.com/drive/folders/${folders.zones.id}`}`,
    `Dispositivos: ${deviceIds.size}`,
    `Evidencias: ${images}`,
    `Copiadas: ${copied}`,
    `Ya existentes: ${existing}`,
    `Errores de copia: ${errors.length}`,
    chatError ? `Error de Chat: ${chatError}` : '',
    '',
    ...(errors.length ? ['ERRORES REGISTRADOS', ...errors] : []),
    '',
    `Generado: ${nowIso()}`,
  ].filter(Boolean);
  await replaceText(
    folders.maintenance.id,
    `LOG-MANTENIMIENTO-${safe(id, 'SIN-ID', 80)}.txt`,
    logLines.join('\n'),
  );

  return {
    maintenanceId: id,
    folderId: folders.maintenance.id,
    folderUrl: folders.maintenance.webViewLink,
    boletasFolderId: folders.boletas.id,
    boletasFolderUrl: folders.boletas.webViewLink || `https://drive.google.com/drive/folders/${folders.boletas.id}`,
    zonesFolderId: folders.zones.id,
    zonesFolderUrl: folders.zones.webViewLink || `https://drive.google.com/drive/folders/${folders.zones.id}`,
    destination: dest.label,
    fallbackToTest: dest.fallback,
    chat,
    chatError,
    notificationState: dest.skipped ? 'OMITIDO' : chatError ? 'ERROR' : 'ENVIADO',
    devices: deviceIds.size,
    imagesExpected: images,
    imagesCopied: copied,
    imagesAlreadyPresent: existing,
    errors,
    staged: true,
    archiveOnlyChat: true,
  };
}
