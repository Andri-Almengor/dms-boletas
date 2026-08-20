import { appendRow, findById, readTables } from '../infra/sheets.repository.js';
import { copyDriveFile, createFolder, uploadBuffer } from '../infra/drive.repository.js';
import { driveApi } from '../infra/google.js';
import { getConfig } from '../modules/config.module.js';
import { sendChatMessage } from './chat.service.js';
import { nowIso, uuid } from '../core/utils.js';
import { AppError } from '../core/errors.js';

const DEVICE_CONCURRENCY = 3;
const IMAGE_COPY_CONCURRENCY = 3;

function clean(value) { return String(value ?? '').trim(); }
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

function folderCache() {
  const promises = new Map();
  return async (name, parentId) => {
    const safeName = safe(name);
    const key = `${parentId}|${safeName}`;
    if (!promises.has(key)) {
      promises.set(key, createFolder(safeName, parentId).catch((error) => {
        promises.delete(key);
        throw error;
      }));
    }
    return promises.get(key);
  };
}

async function folderStructure(bundle, config, folderFor) {
  const rootId = rootFolder(config);
  if (!rootId) throw new AppError('MAINTENANCE_ROOT_FOLDER_MISSING', 'Configure una carpeta raíz para los mantenimientos.', 500);
  const client = await folderFor(bundle.maintenance.Cliente || bundle.client?.Nombre || 'Cliente sin nombre', rootId);
  const maintenance = await folderFor(
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

async function processDevice(device, images, parent, folderFor) {
  const zone = await folderFor(device.Zona || 'Zona sin nombre', parent.id);
  const category = await folderFor(device.Categoria || device.TipoDispositivo || 'Categoría sin nombre', zone.id);
  const folder = await folderFor(device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo', category.id);
  const [before, after, other] = await Promise.all([
    folderFor('Evidencia del antes', folder.id),
    folderFor('Evidencia del despues', folder.id),
    folderFor('Otras evidencias', folder.id),
  ]);

  const counters = { ANTES: 0, DESPUES: 0, OTRA: 0 };
  const tasks = images.map((image) => {
    const kind = imageKind(image.Tipo);
    counters[kind] += 1;
    const target = kind === 'ANTES' ? before : kind === 'DESPUES' ? after : other;
    const label = kind === 'ANTES' ? 'Antes' : kind === 'DESPUES' ? 'Despues' : 'Otra';
    return {
      image,
      target,
      name: `${safe(device.NombreDispositivo || device.EvidenciaMantenimientoID, 'Dispositivo', 70)} - ${label} ${String(counters[kind]).padStart(2, '0')}.${extension(image)}`,
    };
  });

  const copyResults = await concurrentMap(tasks, IMAGE_COPY_CONCURRENCY, async ({ image, target, name }) => {
    try {
      if (!clean(image.DriveFileID)) throw new Error('La evidencia no tiene DriveFileID.');
      const result = await copyOnce(image.DriveFileID, target.id, name);
      return { skipped: Boolean(result.skipped), error: '' };
    } catch (error) {
      return { skipped: false, error: `${name}: ${error?.message || error}` };
    }
  });

  const errors = copyResults.map((item) => item.error).filter(Boolean);
  const skipped = copyResults.filter((item) => item.skipped).length;
  const copied = copyResults.length - skipped - errors.length;
  await replaceText(folder.id, 'INFO-DISPOSITIVO.txt', deviceInfo(device, images));
  return {
    device,
    imageCount: images.length,
    copied,
    skipped,
    errors,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
  };
}

function destination(bundle, config, testMode) {
  const test = testWebhook(config);
  if (testMode) {
    return test
      ? { url: test, label: 'Chat de pruebas', fallback: false, skipped: false }
      : { url: '', label: 'Chat de pruebas no configurado', fallback: false, skipped: true };
  }
  const client = clientWebhook(bundle.client);
  if (client) return { url: client, label: `Chat del cliente: ${bundle.maintenance.Cliente}`, fallback: false, skipped: false };
  if (test) return { url: test, label: 'Chat de pruebas (cliente sin Chat)', fallback: true, skipped: false };
  return { url: '', label: 'Sin Chat configurado', fallback: false, skipped: true };
}

function message(bundle, folder, processed, testMode, fallback) {
  const total = processed.reduce((sum, item) => sum + item.imageCount, 0);
  const copied = processed.reduce((sum, item) => sum + item.copied, 0);
  const skipped = processed.reduce((sum, item) => sum + item.skipped, 0);
  const errors = processed.flatMap((item) => item.errors);
  return [
    testMode ? '🧪 PRUEBA DE MANTENIMIENTO DMS' : '✅ MANTENIMIENTO FINALIZADO',
    fallback ? '⚠️ El cliente no tiene Chat configurado. Se utilizó el Chat de pruebas.' : '',
    `Cliente: ${bundle.maintenance.Cliente || bundle.client?.Nombre || 'Sin cliente'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'Mantenimiento'}`,
    `Fecha: ${bundle.maintenance.Fecha || 'Sin fecha'}`,
    `Ubicación: ${bundle.maintenance.Ubicacion || 'Sin ubicación'}`,
    `Responsables: ${bundle.maintenance.Responsables || 'Sin responsables'}`,
    '',
    'Carpeta completa del mantenimiento:',
    folder.webViewLink,
    '',
    `Dispositivos: ${processed.length}`,
    `Imágenes registradas: ${total}`,
    `Imágenes copiadas: ${copied}`,
    `Imágenes ya existentes: ${skipped}`,
    `Errores de copia: ${errors.length}`,
    '',
    ...processed.flatMap((item, index) => [
      `Dispositivo ${index + 1}: ${item.device.NombreDispositivo || 'Sin nombre'}`,
      `Zona: ${item.device.Zona || 'N/A'} · Categoría: ${item.device.Categoria || 'N/A'}`,
      `Estado: ${item.device.Estado || 'N/A'} · Evidencias: ${item.imageCount}`,
      `Carpeta: ${item.folderUrl}`,
      '',
    ]),
    errors.length ? '⚠️ Algunas evidencias no pudieron copiarse. El mantenimiento se finalizó y el LOG conserva el detalle para reintento/revisión.' : '',
    testMode ? 'Esta prueba no cambió el estado del mantenimiento.' : '',
  ].filter(Boolean).join('\n');
}

function chunks(text, max = 3600) {
  const result = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    if (current && `${current}\n${line}`.length > max) {
      result.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) result.push(current);
  return result;
}

async function sendChunks(url, text) {
  const parts = chunks(text);
  const responses = [];
  for (let index = 0; index < parts.length; index += 1) {
    const body = parts.length > 1 ? `Parte ${index + 1} de ${parts.length}\n\n${parts[index]}` : parts[index];
    responses.push(await sendChatMessage(url, body));
  }
  return { sent: true, parts: responses.length, responses };
}

function logText(bundle, folder, processed, dest, testMode, chatError = '') {
  const errors = processed.flatMap((item) => item.errors);
  return [
    'LOG DE MANTENIMIENTO DMS',
    `Modo: ${testMode ? 'PRUEBA' : 'FINALIZACIÓN'}`,
    `MantenimientoID: ${bundle.maintenance.MantenimientoID}`,
    `Cliente: ${bundle.maintenance.Cliente || 'N/A'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'N/A'}`,
    `Fecha: ${bundle.maintenance.Fecha || 'N/A'}`,
    `Carpeta: ${folder.webViewLink}`,
    `Chat: ${dest.label}`,
    `Dispositivos: ${processed.length}`,
    `Imágenes: ${processed.reduce((sum, item) => sum + item.imageCount, 0)}`,
    `Errores de copia: ${errors.length}`,
    chatError ? `Error de Chat: ${chatError}` : '',
    '',
    ...processed.map((item, index) => `${index + 1}. ${item.device.NombreDispositivo || 'Dispositivo'} | ${item.folderUrl} | ${item.imageCount} evidencia(s)`),
    ...(errors.length ? ['', 'ERRORES DE COPIA', ...errors] : []),
    '',
    `Generado: ${nowIso()}`,
  ].filter(Boolean).join('\n');
}

async function notification(ctx, bundle, dest, result, testMode, error, skipped = false) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'MANTENIMIENTO',
    EntidadID: bundle.maintenance.MantenimientoID,
    Canal: 'CHAT',
    Destino: dest.label,
    Tipo: testMode ? 'PRUEBA_MANTENIMIENTO' : 'FINALIZACION_MANTENIMIENTO',
    Estado: skipped ? 'OMITIDO' : error ? 'ERROR' : 'ENVIADO',
    Intentos: skipped ? 0 : 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? String(error?.message || error).slice(0, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: !error && !skipped ? nowIso() : '',
    CreadoPor: ctx.user?.UsuarioID || 'SISTEMA',
  }).catch(() => {});
}

export async function deliverMaintenanceFast(ctx, id, { testMode = false } = {}) {
  const [bundle, config] = await Promise.all([loadBundle(id), getConfig()]);
  if (!bundle.devices.length) throw new AppError('MAINTENANCE_WITHOUT_DEVICES', 'Debe registrar al menos un dispositivo.', 400);

  const folderFor = folderCache();
  const folders = await folderStructure(bundle, config, folderFor);
  const imagesByDevice = new Map();
  bundle.images.forEach((image) => {
    const deviceId = String(image.DispositivoMantenimientoRef || '');
    if (!imagesByDevice.has(deviceId)) imagesByDevice.set(deviceId, []);
    imagesByDevice.get(deviceId).push(image);
  });

  const processed = await concurrentMap(
    bundle.devices,
    DEVICE_CONCURRENCY,
    (device) => processDevice(
      device,
      imagesByDevice.get(String(device.EvidenciaMantenimientoID)) || [],
      folders.maintenance,
      folderFor,
    ),
  );

  const dest = destination(bundle, config, testMode);
  let chat = { sent: false, skipped: true, parts: 0, responses: [] };
  let chatError = '';
  if (dest.skipped) {
    await notification(ctx, bundle, dest, null, testMode, null, true);
  } else {
    try {
      chat = await sendChunks(dest.url, message(bundle, folders.maintenance, processed, testMode, dest.fallback));
      await notification(ctx, bundle, dest, chat, testMode, null, false);
    } catch (error) {
      chatError = String(error?.message || error);
      await notification(ctx, bundle, dest, null, testMode, error, false);
      // El Chat es una notificación secundaria. La copia de evidencias y el
      // estado del mantenimiento no deben perderse porque Chat falle.
    }
  }

  await replaceText(
    folders.maintenance.id,
    `LOG-MANTENIMIENTO-${safe(id, 'SIN-ID', 80)}${testMode ? '-PRUEBA' : ''}.txt`,
    logText(bundle, folders.maintenance, processed, dest, testMode, chatError),
  );

  const copyErrors = processed.flatMap((item) => item.errors);
  return {
    maintenanceId: id,
    testMode,
    stateChanged: !testMode,
    folderId: folders.maintenance.id,
    folderUrl: folders.maintenance.webViewLink,
    destination: dest.label,
    fallbackToTest: dest.fallback,
    chat,
    chatError,
    notificationState: chatError || dest.skipped ? 'ERROR' : 'ENVIADO',
    devices: processed.length,
    imagesExpected: processed.reduce((sum, item) => sum + item.imageCount, 0),
    imagesCopied: processed.reduce((sum, item) => sum + item.copied, 0),
    imagesAlreadyPresent: processed.reduce((sum, item) => sum + item.skipped, 0),
    errors: copyErrors,
    optimized: true,
  };
}
