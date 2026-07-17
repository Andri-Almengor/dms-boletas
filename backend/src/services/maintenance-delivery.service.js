import { appendRow, findById, readTable } from '../infra/sheets.repository.js';
import { copyDriveFile, createFolder, uploadBuffer } from '../infra/drive.repository.js';
import { driveApi } from '../infra/google.js';
import { getConfig } from '../modules/config.module.js';
import { sendChatMessage } from './chat.service.js';
import { nowIso, uuid } from '../core/utils.js';
import { AppError } from '../core/errors.js';

const running = new Map();

function clean(value) { return String(value ?? '').trim(); }
function safe(value, fallback = 'Sin nombre', max = 120) {
  return (clean(value) || fallback)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ').replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '').slice(0, max) || fallback;
}
function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function dateName(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : safe(value, 'Sin fecha', 30);
}
function webhook(...values) { return values.map(clean).find(Boolean) || ''; }
function testWebhook(config) { return webhook(config.CHAT_TEST_WEBHOOK, config.CHAT_WEBHOOK_PRUEBAS); }
function clientWebhook(client) { return webhook(client?.ChatWebhook, client?.ChatWebhookURL); }
function rootFolder(config) {
  return clean(config.MANTENIMIENTOS_EVIDENCE_ROOT_FOLDER_ID
    || config.EVIDENCE_ROOT_FOLDER_ID || config.MANTENIMIENTOS_FOLDER_ID
    || config.MANTENIMIENTOS_REPORTS_FOLDER_ID || config.EVIDENCIAS_FOLDER_ID || config.ROOT_FOLDER_ID);
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
  return ({ 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' })[clean(image.MimeType).toLowerCase()] || 'jpg';
}
async function findNamed(folderId, name) {
  const escaped = clean(name).replace(/'/g, "\\'");
  const response = await driveApi.files.list({
    q: `'${folderId}' in parents and name='${escaped}' and trashed=false`,
    fields: 'files(id,name,webViewLink,mimeType,size)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return response.data.files?.[0] || null;
}
async function textOnce(folderId, name, content) {
  return (await findNamed(folderId, name)) || uploadBuffer({
    buffer: Buffer.from(String(content || ''), 'utf8'), mimeType: 'text/plain', fileName: name, folderId,
  });
}
async function copyOnce(fileId, folderId, name) {
  const existing = await findNamed(folderId, name);
  return existing ? { ...existing, skipped: true } : copyDriveFile({ fileId, folderId, name });
}
async function loadBundle(id) {
  const [maintenance, devices, images, clients] = await Promise.all([
    findById('Mantenimiento', id), readTable('Evidencia_Mantenimientos'),
    readTable('Mantenimiento imagenes'), readTable('Clientes'),
  ]);
  const activeDevices = devices.filter((item) => String(item.MantenimientoRef) === String(id) && item.Activo !== false);
  const deviceIds = new Set(activeDevices.map((item) => String(item.EvidenciaMantenimientoID)));
  return {
    maintenance,
    devices: activeDevices,
    images: images.filter((item) => deviceIds.has(String(item.DispositivoMantenimientoRef)) && item.Activo !== false),
    client: clients.find((item) => String(item.ClienteID) === String(maintenance.ClienteID)) || null,
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
  return { client, maintenance: { ...maintenance, webViewLink: maintenance.webViewLink || `https://drive.google.com/drive/folders/${maintenance.id}` } };
}
function deviceInfo(device, images) {
  let answers = {};
  try { answers = JSON.parse(device.RespuestasJSON || '{}'); } catch { answers = {}; }
  return [
    'INFORMACIÓN DEL DISPOSITIVO',
    `Nombre: ${device.NombreDispositivo || 'N/A'}`, `Zona: ${device.Zona || 'N/A'}`,
    `Categoría: ${device.Categoria || 'N/A'}`, `Tipo: ${device.TipoDispositivo || 'N/A'}`,
    `Fabricante: ${device.Fabricante || 'N/A'}`, `Modelo: ${device.Modelo || 'N/A'}`,
    `Serie: ${device.Serie || 'N/A'}`, `Funcionamiento: ${device.Funcionamiento || 'N/A'}`,
    `En uso: ${device.EnUso || 'N/A'}`, `Estado: ${device.Estado || 'N/A'}`,
    `Observación: ${device.Observacion || 'N/A'}`, '', 'CHECKLIST',
    ...Object.entries(answers).map(([key, value]) => `${key}: ${value}`), '',
    `Evidencias: ${images.length}`,
  ].join('\n');
}
async function processDevice(device, images, parent) {
  const zone = await createFolder(device.Zona || 'Zona sin nombre', parent.id);
  const category = await createFolder(device.Categoria || device.TipoDispositivo || 'Categoría sin nombre', zone.id);
  const folder = await createFolder(device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo', category.id);
  const before = await createFolder('Evidencia del antes', folder.id);
  const after = await createFolder('Evidencia del despues', folder.id);
  const other = await createFolder('Otras evidencias', folder.id);
  const counters = { ANTES: 0, DESPUES: 0, OTRA: 0 };
  let copied = 0; let skipped = 0; const errors = [];
  for (const image of images) {
    const kind = imageKind(image.Tipo); counters[kind] += 1;
    const target = kind === 'ANTES' ? before : kind === 'DESPUES' ? after : other;
    const label = kind === 'ANTES' ? 'Antes' : kind === 'DESPUES' ? 'Despues' : 'Otra';
    const name = `${safe(device.NombreDispositivo || device.EvidenciaMantenimientoID, 'Dispositivo', 70)} - ${label} ${String(counters[kind]).padStart(2, '0')}.${extension(image)}`;
    try {
      if (!clean(image.DriveFileID)) throw new Error('La evidencia no tiene DriveFileID.');
      const result = await copyOnce(image.DriveFileID, target.id, name);
      if (result.skipped) skipped += 1; else copied += 1;
    } catch (error) { errors.push(`${name}: ${error?.message || error}`); }
  }
  await textOnce(folder.id, 'INFO-DISPOSITIVO.txt', deviceInfo(device, images));
  return {
    device, imageCount: images.length, copied, skipped, errors,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
  };
}
function destination(bundle, config, testMode) {
  const test = testWebhook(config);
  if (testMode) {
    if (!test) throw new AppError('MAINTENANCE_TEST_CHAT_MISSING', 'No se configuró el Chat de pruebas.', 500);
    return { url: test, label: 'Chat de pruebas', fallback: false };
  }
  const client = clientWebhook(bundle.client);
  if (client) return { url: client, label: `Chat del cliente: ${bundle.maintenance.Cliente}`, fallback: false };
  if (test) return { url: test, label: 'Chat de pruebas (cliente sin Chat)', fallback: true };
  throw new AppError('MAINTENANCE_CHAT_MISSING', 'El cliente no tiene Chat y tampoco existe un Chat de pruebas.', 500);
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
    `Fecha: ${bundle.maintenance.Fecha || 'Sin fecha'}`, `Ubicación: ${bundle.maintenance.Ubicacion || 'Sin ubicación'}`,
    `Responsables: ${bundle.maintenance.Responsables || 'Sin responsables'}`,
    `Descripción: ${bundle.maintenance.DescripcionGeneral || 'Sin descripción'}`, '',
    'Carpeta completa del mantenimiento:', folder.webViewLink, '',
    `Dispositivos: ${processed.length}`, `Imágenes registradas: ${total}`,
    `Imágenes copiadas: ${copied}`, `Imágenes ya existentes: ${skipped}`, `Errores: ${errors.length}`, '',
    ...processed.flatMap((item, index) => [
      `Dispositivo ${index + 1}: ${item.device.NombreDispositivo || 'Sin nombre'}`,
      `Zona: ${item.device.Zona || 'N/A'} · Categoría: ${item.device.Categoria || 'N/A'}`,
      `Fabricante/Modelo: ${item.device.Fabricante || 'N/A'} / ${item.device.Modelo || 'N/A'}`,
      `Serie: ${item.device.Serie || 'N/A'}`,
      `Funcionamiento: ${item.device.Funcionamiento || 'N/A'} · En uso: ${item.device.EnUso || 'N/A'} · Estado: ${item.device.Estado || 'N/A'}`,
      `Observación: ${item.device.Observacion || 'N/A'}`, `Evidencias: ${item.imageCount}`,
      `Carpeta del dispositivo: ${item.folderUrl}`, '',
    ]),
    errors.length ? '⚠️ Revise el archivo LOG dentro de la carpeta para conocer los errores de copia.' : '',
    testMode ? 'Esta prueba no cambió el estado del mantenimiento.' : '',
  ].filter(Boolean).join('\n');
}
function chunks(text, max = 3600) {
  const result = []; let current = '';
  for (const line of String(text).split('\n')) {
    if (current && `${current}\n${line}`.length > max) { result.push(current); current = line; }
    else current = current ? `${current}\n${line}` : line;
  }
  if (current) result.push(current);
  return result;
}
async function sendChunks(url, text) {
  const parts = chunks(text); const responses = [];
  for (let index = 0; index < parts.length; index += 1) {
    const body = parts.length > 1 ? `Parte ${index + 1} de ${parts.length}\n\n${parts[index]}` : parts[index];
    responses.push(await sendChatMessage(url, body));
  }
  return { sent: true, parts: responses.length, responses };
}
function logText(bundle, folder, processed, dest, testMode) {
  const errors = processed.flatMap((item) => item.errors);
  return [
    'LOG DE MANTENIMIENTO DMS', `Modo: ${testMode ? 'PRUEBA' : 'FINALIZACIÓN'}`,
    `MantenimientoID: ${bundle.maintenance.MantenimientoID}`, `Cliente: ${bundle.maintenance.Cliente || 'N/A'}`,
    `Título: ${bundle.maintenance.TituloMantenimiento || 'N/A'}`, `Fecha: ${bundle.maintenance.Fecha || 'N/A'}`,
    `Carpeta: ${folder.webViewLink}`, `Chat: ${dest.label}`, `Dispositivos: ${processed.length}`,
    `Imágenes: ${processed.reduce((sum, item) => sum + item.imageCount, 0)}`, `Errores: ${errors.length}`, '',
    ...processed.map((item, index) => `${index + 1}. ${item.device.NombreDispositivo || 'Dispositivo'} | ${item.folderUrl} | ${item.imageCount} evidencia(s)`),
    ...(errors.length ? ['', 'ERRORES', ...errors] : []), '', `Generado: ${nowIso()}`,
  ].join('\n');
}
async function notification(ctx, bundle, dest, result, testMode, error) {
  await appendRow('Notificaciones', {
    NotificacionID: uuid(), Entidad: 'MANTENIMIENTO', EntidadID: bundle.maintenance.MantenimientoID,
    Canal: 'CHAT', Destino: dest.label, Tipo: testMode ? 'PRUEBA_MANTENIMIENTO' : 'FINALIZACION_MANTENIMIENTO',
    Estado: error ? 'ERROR' : 'ENVIADO', Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '', Error: error ? String(error?.message || error).slice(0, 1500) : '',
    FechaCreacion: nowIso(), FechaEnvio: error ? '' : nowIso(), CreadoPor: ctx.user?.UsuarioID || 'SISTEMA',
  }).catch(() => {});
}
async function run(ctx, id, testMode) {
  const [bundle, config] = await Promise.all([loadBundle(id), getConfig()]);
  if (!bundle.devices.length) throw new AppError('MAINTENANCE_WITHOUT_DEVICES', 'Debe registrar al menos un dispositivo.', 400);
  const folders = await folderStructure(bundle, config); const processed = [];
  for (const device of bundle.devices) {
    const images = bundle.images.filter((item) => String(item.DispositivoMantenimientoRef) === String(device.EvidenciaMantenimientoID));
    processed.push(await processDevice(device, images, folders.maintenance));
  }
  const dest = destination(bundle, config, testMode);
  await textOnce(folders.maintenance.id, `LOG-MANTENIMIENTO-${safe(id, 'SIN-ID', 80)}${testMode ? '-PRUEBA' : ''}.txt`, logText(bundle, folders.maintenance, processed, dest, testMode));
  try {
    const chat = await sendChunks(dest.url, message(bundle, folders.maintenance, processed, testMode, dest.fallback));
    await notification(ctx, bundle, dest, chat, testMode, null);
    return {
      maintenanceId: id, testMode, stateChanged: !testMode, folderId: folders.maintenance.id,
      folderUrl: folders.maintenance.webViewLink, destination: dest.label, fallbackToTest: dest.fallback,
      chat, devices: processed.length, imagesExpected: processed.reduce((sum, item) => sum + item.imageCount, 0),
      imagesCopied: processed.reduce((sum, item) => sum + item.copied, 0),
      imagesAlreadyPresent: processed.reduce((sum, item) => sum + item.skipped, 0), errors: processed.flatMap((item) => item.errors),
    };
  } catch (error) { await notification(ctx, bundle, dest, null, testMode, error); throw error; }
}
export async function deliverMaintenance(ctx, id, { testMode = false } = {}) {
  const key = `${testMode ? 'test' : 'final'}:${id}`;
  if (running.has(key)) return running.get(key);
  const promise = run(ctx, id, testMode).finally(() => running.delete(key));
  running.set(key, promise); return promise;
}
