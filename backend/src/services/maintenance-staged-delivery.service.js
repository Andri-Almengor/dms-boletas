import { appendRow, readTables } from '../infra/sheets.repository.js';
import { copyDriveFile, createFolder, uploadBuffer } from '../infra/drive.repository.js';
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
  if (!rootId) throw new AppError('MAINTENANCE_ROOT_FOLDER_MISSING', 'Configure una carpeta raíz para los mantenimientos.', 500);
  const client = await createFolder(bundle.maintenance.Cliente || bundle.client?.Nombre || 'Cliente sin nombre', rootId);
  const maintenance = await createFolder(
    `${dateName(bundle.maintenance.Fecha)} - ${safe(bundle.maintenance.TituloMantenimiento, 'Mantenimiento')} - ${safe(bundle.maintenance.MantenimientoID, 'SIN ID')}`,
    client.id,
  );
  return {
    client,
    maintenance: {
      ...maintenance,
      webViewLink: maintenance.webViewLink || `https://drive.google.com/drive/folders/${maintenance.id}`,
    },
  };
}

function deviceInfo(device, images) {
  let answers = {};
  try { answers = JSON.parse(device.RespuestasJSON || '{}'); } catch { answers = {}; }
  return [
    'INFORMACIÓN DEL DISPOSITIVO',
    `Nombre: ${device.NombreDispositivo || 'N/A'}`,
    `Zona: ${device.Zona || 'N/A'}`,
    `Categoría: ${device.Categoria || 'N/A'}`,
    `Tipo: ${device.TipoDispositivo || 'N/A'}`,
    `Fabricante: ${device.Fabricante || 'N/A'}`,
    `Modelo: ${device.Modelo || 'N/A'}`,
    `Serie: ${device.Serie || 'N/A'}`,
    `Funcionamiento: ${device.Funcionamiento || 'N/A'}`,
    `En uso: ${device.EnUso || 'N/A'}`,
    `Estado: ${device.Estado || 'N/A'}`,
    `Observación: ${device.Observacion || 'N/A'}`,
    '',
    'CHECKLIST',
    ...Object.entries(answers).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`),
    '',
    `Evidencias: ${images.length}`,
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
  const zone = await createFolder(device.Zona || 'Zona sin nombre', folders.maintenance.id);
  const category = await createFolder(device.Categoria || device.TipoDispositivo || 'Categoría sin nombre', zone.id);
  const folder = await createFolder(device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo', category.id);
  const [before, after, other] = await Promise.all([
    createFolder('Evidencia del antes', folder.id),
    createFolder('Evidencia del despues', folder.id),
    createFolder('Otras evidencias', folder.id),
  ]);

  const allImages = sortImages(bundle.images.filter((image) => clean(image.DispositivoMantenimientoRef) === deviceId));
  const start = (part - 1) * STAGED_DRIVE_IMAGE_CHUNK;
  const selected = allImages.slice(start, start + STAGED_DRIVE_IMAGE_CHUNK);
  const names = globalEvidenceNames(device, allImages);
  const copyResults = await concurrentMap(selected, IMAGE_COPY_CONCURRENCY, async (image) => {
    const meta = names.get(clean(image.FotoDispositivoID)) || { kind: imageKind(image.Tipo), name: safe(image.Nombre, 'Evidencia') };
    const target = meta.kind === 'ANTES' ? before : meta.kind === 'DESPUES' ? after : other;
    try {
      if (!clean(image.DriveFileID)) throw new Error('La evidencia no tiene DriveFileID.');
      const result = await copyOnce(image.DriveFileID, target.id, meta.name);
      return { skipped: Boolean(result.skipped), error: '' };
    } catch (error) {
      return { skipped: false, error: `${meta.name}: ${error?.message || error}` };
    }
  });

  if (part === totalParts) {
    await replaceText(folder.id, 'INFO-DISPOSITIVO.txt', deviceInfo(device, allImages));
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
    folderId: folder.id,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
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
  const text = [
    '✅ MANTENIMIENTO FINALIZADO',
    `Cliente: ${bundle.maintenance.Cliente || bundle.client?.Nombre || 'Sin cliente'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'Mantenimiento'}`,
    `Fecha: ${bundle.maintenance.Fecha || 'Sin fecha'}`,
    `Dispositivos procesados: ${deviceIds.size}`,
    `Evidencias procesadas: ${images}`,
    `Evidencias copiadas: ${copied}`,
    `Evidencias ya existentes: ${existing}`,
    `Errores registrados: ${errors.length}`,
    '',
    'Carpeta completa del mantenimiento:',
    folders.maintenance.webViewLink,
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
    'LOG DE FINALIZACIÓN ESCALONADA DMS',
    `MantenimientoID: ${id}`,
    `Cliente: ${bundle.maintenance.Cliente || 'N/A'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'N/A'}`,
    `Carpeta: ${folders.maintenance.webViewLink}`,
    `Dispositivos: ${deviceIds.size}`,
    `Evidencias: ${images}`,
    `Copiadas: ${copied}`,
    `Ya existentes: ${existing}`,
    `Errores: ${errors.length}`,
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
    destination: dest.label,
    fallbackToTest: dest.fallback,
    chat,
    chatError,
    notificationState: chatError || dest.skipped ? 'ERROR' : 'ENVIADO',
    devices: deviceIds.size,
    imagesExpected: images,
    imagesCopied: copied,
    imagesAlreadyPresent: existing,
    errors,
    staged: true,
  };
}
