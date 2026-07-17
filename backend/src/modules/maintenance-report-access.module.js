import { AppError, forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { env } from '../config/env.js';
import { driveApi, sheetsApi } from '../infra/google.js';
import {
  findById,
  getHeaders,
  invalidateTableCache,
  updateRow,
} from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { deliverMaintenance } from '../services/maintenance-delivery.service.js';
import { getConfig } from './config.module.js';
import { maintenanceHandlers } from './maintenance.module.js';

const DELIVERY_COLUMNS = [
  'CarpetaDriveID',
  'CarpetaDriveURL',
  'EstadoNotificacion',
  'ChatDestino',
  'ChatEnviadoEn',
  'ChatFallbackPruebas',
  'ImagenesEsperadas',
  'ImagenesCopiadas',
  'ImagenesYaExistentes',
  'ErroresCopia',
];

const REPORT_FOLDER_KEYS = [
  'MANTENIMIENTOS_REPORTS_FOLDER_ID',
  'REPORTES_MANTENIMIENTOS_FOLDER_ID',
  'REPORTES_FOLDER_ID',
  'ROOT_FOLDER_ID',
];

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const DMS_RED = { red: 183 / 255, green: 19 / 255, blue: 26 / 255 };
const HEADER_GRAY = { red: 229 / 255, green: 231 / 255, blue: 235 / 255 };
const CHECK_GREEN = { red: 0, green: 166 / 255, blue: 81 / 255 };
const CHECK_GREEN_BG = { red: 236 / 255, green: 253 / 255, blue: 243 / 255 };
const CROSS_RED = { red: 217 / 255, green: 48 / 255, blue: 37 / 255 };
const CROSS_RED_BG = { red: 252 / 255, green: 232 / 255, blue: 230 / 255 };
const LINK_BLUE = { red: 17 / 255, green: 85 / 255, blue: 204 / 255 };

const SHEET_CHECKLIST_SCHEMAS = [
  {
    name: 'Cámaras',
    keys: ['camara', 'camaras', 'camera', 'cctv'],
    headers: ['Nombre', 'Modelo', 'Serie', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Visualización', 'Estado', 'Observaciones', 'Nota imagen', 'Carpeta dispositivo', 'Link Imagen'],
  },
  {
    name: 'Puertas',
    keys: ['puerta', 'puertas', 'door', 'control de acceso'],
    headers: ['Nombre', 'Modelo', 'Serie', 'Lector', 'Cerradura', 'Función', 'Contactos', 'Estado', 'Observaciones', 'Nota imagen', 'Carpeta dispositivo', 'Link Imagen'],
  },
  {
    name: 'Gabinetes',
    keys: ['gabinete', 'gabinetes', 'rack', 'gabinet'],
    headers: ['Nombre', 'Modelo', 'Serie', 'Limpieza', 'Conexiones', 'Mediciones', 'Respaldo', 'Estado', 'Observaciones', 'Nota imagen', 'Carpeta dispositivo', 'Link Imagen'],
  },
  {
    name: 'Servidores',
    keys: ['servidor', 'servidores', 'server'],
    headers: ['Nombre', 'Limpieza', 'Conexiones', 'Alimentación', 'Red', 'Servicios', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Grabadores',
    keys: ['grabador', 'grabadores', 'nvr', 'dvr', 'recorder'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Discos', 'Grabación', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Bocinas',
    keys: ['bocina', 'bocinas', 'speaker', 'parlante', 'audio'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Audio', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Sensores Perimetrales',
    keys: ['sensor perimetral', 'sensores perimetrales', 'perimetral'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Prueba', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Sensores Movimiento',
    keys: ['sensor movimiento', 'sensor de movimiento', 'sensores movimiento', 'movimiento'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Prueba', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Sensores Ruptura',
    keys: ['sensor ruptura', 'sensor de ruptura', 'ruptura'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Prueba', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Impresoras',
    keys: ['impresora', 'impresoras', 'printer'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Consumibles', 'Prueba', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'VideoWall',
    keys: ['videowall', 'video wall', 'video-wall', 'video_wall'],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Visualización', 'Estado', 'Observaciones', 'Link Imagen'],
  },
  {
    name: 'Otros',
    keys: [],
    headers: ['Nombre', 'Limpieza', 'Alimentación', 'Conexión', 'Montaje', 'Prueba', 'Estado', 'Observaciones', 'Link Imagen'],
  },
];

const NON_CHECKLIST_HEADERS = new Set([
  'nombre', 'modelo', 'serie', 'observaciones', 'nota imagen', 'carpeta dispositivo', 'link imagen',
]);

const FIELD_ALIASES = {
  limpieza: ['Limpieza'],
  alimentacion: ['Alimentación', 'Alimentacion'],
  conexion: ['Conexión', 'Conexion', 'Conexiones'],
  conexiones: ['Conexiones', 'Conexión', 'Conexion'],
  montaje: ['Montaje'],
  visualizacion: ['Visualización', 'Visualizacion'],
  lector: ['Lector'],
  cerradura: ['Cerradura'],
  funcion: ['Función', 'Funcion'],
  contactos: ['Contactos'],
  mediciones: ['Mediciones'],
  respaldo: ['Respaldo'],
  red: ['Red', 'ConexionRed', 'ConexiónRed', 'Conexiones', 'Conexion'],
  servicios: ['Servicios', 'Servicio'],
  discos: ['Discos', 'Almacenamiento', 'Disco'],
  grabacion: ['Grabación', 'Grabacion'],
  audio: ['Audio', 'PruebaSonido', 'Prueba de sonido'],
  prueba: ['Prueba', 'PruebaSonido', 'PruebaDeteccion', 'PruebaMovimiento', 'PruebaRuptura', 'PruebaImpresion'],
  consumibles: ['Consumibles'],
  calibracion: ['Calibración', 'Calibracion'],
};

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,_;:.]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonical(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function columnLetter(index) {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function googleStatus(error) {
  return Number(error?.code || error?.response?.status || error?.response?.data?.error?.code || 0);
}

function googleMessage(error) {
  return clean(
    error?.response?.data?.error?.message
      || error?.errors?.[0]?.message
      || error?.message
      || error,
  );
}

function safeSheetName(value) {
  return (clean(value) || 'Hoja')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 90)
    .trim() || 'Hoja';
}

function quotedSheetName(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeDriveName(value) {
  return (clean(value) || 'Sin nombre')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 120) || 'Sin nombre';
}

async function ensureDeliveryColumns() {
  const headers = await getHeaders('Mantenimiento', true);
  const missing = DELIVERY_COLUMNS.filter((column) => !headers.includes(column));
  if (!missing.length) return;
  const start = headers.length;
  const end = start + missing.length - 1;
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: env.sheetId,
    range: `'Mantenimiento'!${columnLetter(start)}1:${columnLetter(end)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  });
  invalidateTableCache('Mantenimiento');
  await getHeaders('Mantenimiento', true);
}

function isAdmin(ctx) {
  return ctx.permissions.includes('USUARIOS_GESTIONAR')
    || ctx.permissions.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions.includes('MANTENIMIENTOS_ELIMINAR');
}

async function reportFolderId() {
  const config = await getConfig();
  const folderId = clean(pick(config, REPORT_FOLDER_KEYS));
  if (!folderId) {
    throw new AppError(
      'MAINTENANCE_REPORT_FOLDER_MISSING',
      'No hay una carpeta de Drive configurada para los reportes de mantenimiento.',
      500,
    );
  }
  return folderId;
}

async function createReportFile({ title, mimeType }) {
  const folderId = await reportFolderId();
  try {
    const created = await driveApi.files.create({
      requestBody: {
        name: title,
        mimeType,
        parents: [folderId],
      },
      fields: 'id,name,mimeType,parents,webViewLink',
      supportsAllDrives: true,
    });
    return { ...created.data, folderId };
  } catch (error) {
    const status = googleStatus(error);
    const detail = googleMessage(error);
    console.error('[maintenance-report] No se pudo crear el archivo en Drive:', error);
    throw new AppError(
      'MAINTENANCE_REPORT_DRIVE_CREATE_FAILED',
      status === 403
        ? 'La cuenta de servicio no tiene permiso para crear archivos en la carpeta de reportes de mantenimiento. Comparta esa carpeta o unidad compartida con la cuenta de servicio como Gestor de contenido.'
        : 'No se pudo crear el reporte dentro de la carpeta configurada de Drive.',
      status === 403 ? 403 : 502,
      { cause: detail, folderId },
    );
  }
}

async function moveToReportFolder(fileId) {
  const folderId = await reportFolderId();
  const current = await driveApi.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  const parents = current.data.parents || [];
  if (parents.includes(folderId)) return folderId;
  await driveApi.files.update({
    fileId,
    addParents: folderId,
    removeParents: parents.join(',') || undefined,
    fields: 'id,parents,webViewLink',
    supportsAllDrives: true,
  });
  return folderId;
}

async function grantAccess(fileId, ctx) {
  const email = clean(pick(ctx.user, ['Correo', 'Email', 'email']));
  if (!email) {
    throw new AppError(
      'REPORT_USER_EMAIL_MISSING',
      'El usuario administrador no tiene un correo configurado para compartir el reporte.',
      400,
    );
  }

  await driveApi.permissions.create({
    fileId,
    supportsAllDrives: true,
    sendNotificationEmail: false,
    requestBody: {
      type: 'user',
      role: 'writer',
      emailAddress: email,
    },
  });
  return email;
}

async function prepareAccess(fileId, ctx) {
  await moveToReportFolder(fileId);
  try {
    const email = await grantAccess(fileId, ctx);
    return { shared: true, email };
  } catch (error) {
    const status = googleStatus(error);
    const detail = googleMessage(error);
    if (status === 403) {
      console.warn(`[maintenance-report] Drive no permitió crear un permiso directo para ${fileId}. Se conserva el acceso heredado de la carpeta.`, detail);
      return {
        shared: false,
        inheritedAccess: true,
        warning: 'Drive no permitió crear un permiso directo; el archivo conserva los permisos heredados de la carpeta de reportes.',
      };
    }
    console.error(`[maintenance-report] No se pudo compartir ${fileId}:`, error);
    throw new AppError(
      'MAINTENANCE_REPORT_ACCESS_FAILED',
      `El reporte fue creado, pero no se pudo compartir con ${clean(pick(ctx.user, ['Correo', 'Email', 'email'])) || 'el usuario actual'}. Revise los permisos de Drive y la carpeta de reportes.`,
      502,
      { cause: detail, fileId },
    );
  }
}

function schemaForCategory(category) {
  const categoryKey = canonical(category);
  if (!categoryKey) return SHEET_CHECKLIST_SCHEMAS[SHEET_CHECKLIST_SCHEMAS.length - 1];
  return SHEET_CHECKLIST_SCHEMAS.find((schema) => schema.keys.some((key) => {
    const keyValue = canonical(key);
    return categoryKey === keyValue || categoryKey.includes(keyValue);
  })) || SHEET_CHECKLIST_SCHEMAS[SHEET_CHECKLIST_SCHEMAS.length - 1];
}

function parseAnswers(device) {
  const value = device?.RespuestasJSON;
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function fieldValue(device, aliases) {
  const sources = [parseAnswers(device), device || {}];
  const wanted = aliases.map(canonical);
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (wanted.includes(canonical(key)) && clean(value)) return value;
    }
  }
  return '';
}

function checklistMark(value) {
  const normalized = normalize(value);
  const canonicalValue = canonical(value);
  const good = new Set(['si', 'ok', 'correcto', 'funciona', 'bueno', 'aprobado', 'bien', 'true', '1', 'realizado', 'completado']);
  const bad = new Set(['no', 'x', 'incorrecto', 'falla', 'malo', 'pendiente', 'false', '0', 'defectuoso', 'nofunciona']);
  if (good.has(normalized) || good.has(canonicalValue)) return '✅';
  if (bad.has(normalized) || bad.has(canonicalValue)) return '❌';
  return clean(value);
}

function normalizedUsage(value) {
  const normalized = normalize(value);
  if (['si en uso', 'en uso', 'si', 'activo'].includes(normalized)) return 'si_en_uso';
  if (['no esta guardado', 'no esta guardo', 'guardado', 'no', 'almacenado'].includes(normalized)) return 'no_guardado';
  return normalized;
}

function deviceOverallMark(device) {
  const functioning = checklistMark(device?.Funcionamiento) === '✅';
  const usage = normalizedUsage(device?.EnUso);
  return functioning && (usage === 'si_en_uso' || usage === 'no_guardado') ? '✅' : '❌';
}

function imageTypeLabel(image) {
  const type = normalize(image?.Tipo || image?.Estado || image?.EstadoFoto || image?.TipoFoto);
  if (type.includes('desp') || type === 'after') return 'Foto después';
  if (type.includes('antes') || type === 'before') return 'Foto antes';
  return 'Foto adicional';
}

function latestImageInfo(device) {
  const images = (device?.Imagenes || []).filter((image) => image?.Activo !== false);
  const latest = images[images.length - 1] || null;
  if (!latest) return { note: '', label: '', url: '' };
  return {
    note: clean(latest.Nota),
    label: `${clean(device.NombreDispositivo) || 'Dispositivo'} - ${imageTypeLabel(latest)}`,
    url: clean(latest.DriveURL) || (clean(latest.DriveFileID) ? `https://drive.google.com/file/d/${encodeURIComponent(latest.DriveFileID)}/view` : ''),
  };
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findChildFolder(parentId, name, cache) {
  if (!parentId || !clean(name)) return null;
  const safeName = safeDriveName(name);
  const cacheKey = `${parentId}::${normalize(safeName)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const response = await driveApi.files.list({
    q: `'${escapeDriveQuery(parentId)}' in parents and name='${escapeDriveQuery(safeName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folder = response.data.files?.[0] || null;
  cache.set(cacheKey, folder);
  return folder;
}

async function deviceFolderInfo(maintenance, device, cache) {
  const maintenanceFolderId = clean(maintenance?.CarpetaDriveID);
  if (!maintenanceFolderId) return { id: '', url: '' };
  const zone = await findChildFolder(maintenanceFolderId, device.Zona || 'Zona sin nombre', cache);
  if (!zone) return { id: '', url: '' };
  const category = await findChildFolder(zone.id, device.Categoria || device.TipoDispositivo || 'Categoría sin nombre', cache);
  if (!category) return { id: '', url: '' };
  const folder = await findChildFolder(category.id, device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo', cache);
  if (!folder) return { id: '', url: '' };
  return { id: folder.id, url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` };
}

function valueByHeader(device, header) {
  const key = normalize(header);
  if (key === 'nombre') return clean(device.NombreDispositivo) || 'Sin nombre';
  if (key === 'modelo') return clean(device.Modelo);
  if (key === 'serie') return clean(device.Serie);
  if (key === 'observaciones') return clean(device.Observacion);
  if (key === 'estado') return deviceOverallMark(device);
  const aliases = FIELD_ALIASES[key] || [header];
  return checklistMark(fieldValue(device, aliases));
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return output;
}

async function buildChecklistSections(data) {
  const grouped = new Map(SHEET_CHECKLIST_SCHEMAS.map((schema) => [schema.name, []]));
  for (const device of data.dispositivos || []) grouped.get(schemaForCategory(device.Categoria).name).push(device);
  const folderCache = new Map();
  const sections = [];

  for (const schema of SHEET_CHECKLIST_SCHEMAS) {
    const devices = grouped.get(schema.name) || [];
    if (!devices.length) continue;
    const rows = await mapLimit(devices, 6, async (device) => {
      const latest = latestImageInfo(device);
      const folder = schema.headers.includes('Carpeta dispositivo')
        ? await deviceFolderInfo(data.mantenimiento, device, folderCache).catch(() => ({ id: '', url: '' }))
        : { id: '', url: '' };
      const values = schema.headers.map((header) => {
        const key = normalize(header);
        if (key === 'nota imagen') return latest.note;
        if (key === 'carpeta dispositivo') return folder.url ? 'Abrir carpeta' : '';
        if (key === 'link imagen') return latest.url ? (latest.label || 'Abrir imagen') : '';
        return valueByHeader(device, header);
      });
      const links = [];
      const folderColumn = schema.headers.indexOf('Carpeta dispositivo');
      const imageColumn = schema.headers.indexOf('Link Imagen');
      if (folderColumn >= 0 && folder.url) links.push({ column: folderColumn, url: folder.url });
      if (imageColumn >= 0 && latest.url) links.push({ column: imageColumn, url: latest.url });
      return { values, links };
    });
    sections.push({ schema, rows });
  }
  return sections;
}

function checklistColumnIndexes(headers) {
  return headers
    .map((header, index) => ({ header: normalize(header), index }))
    .filter((item) => !NON_CHECKLIST_HEADERS.has(item.header))
    .map((item) => item.index);
}

function columnWidth(header) {
  const key = normalize(header);
  if (key === 'nombre') return 220;
  if (key === 'modelo' || key === 'serie') return 150;
  if (key === 'observaciones' || key === 'nota imagen' || key === 'link imagen') return 240;
  if (key === 'carpeta dispositivo') return 170;
  return 115;
}

function sheetSetupRequests(sheetId, section, sectionIndex) {
  const { schema, rows } = section;
  const rowCount = Math.max(rows.length + 10, 100);
  const columnCount = schema.headers.length;
  const requests = [];
  if (sectionIndex === 0) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          title: safeSheetName(schema.name),
          gridProperties: { rowCount, columnCount, frozenRowCount: 2 },
        },
        fields: 'title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount',
      },
    });
  }
  requests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
      cell: {
        userEnteredFormat: {
          backgroundColor: DMS_RED,
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 14 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: columnCount },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_GRAY,
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
          textFormat: { bold: true, fontSize: 10 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });
  if (rows.length) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy',
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    });
    for (const column of checklistColumnIndexes(schema.headers)) {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: column, endColumnIndex: column + 1 },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              textFormat: { bold: true, fontSize: 14 },
            },
          },
          fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat',
        },
      });
    }
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '✅' }] },
            format: { backgroundColor: CHECK_GREEN_BG, textFormat: { foregroundColor: CHECK_GREEN, bold: true } },
          },
        },
      },
    });
    requests.push({
      addConditionalFormatRule: {
        index: 1,
        rule: {
          ranges: [{ sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '❌' }] },
            format: { backgroundColor: CROSS_RED_BG, textFormat: { foregroundColor: CROSS_RED, bold: true } },
          },
        },
      },
    });
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount },
        top: { style: 'SOLID', color: HEADER_GRAY },
        bottom: { style: 'SOLID', color: HEADER_GRAY },
        left: { style: 'SOLID', color: HEADER_GRAY },
        right: { style: 'SOLID', color: HEADER_GRAY },
        innerHorizontal: { style: 'SOLID', color: HEADER_GRAY },
        innerVertical: { style: 'SOLID', color: HEADER_GRAY },
      },
    });
  }
  schema.headers.forEach((header, index) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
        properties: { pixelSize: columnWidth(header) },
        fields: 'pixelSize',
      },
    });
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 30 },
      fields: 'pixelSize',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 42 },
      fields: 'pixelSize',
    },
  });
  return requests;
}

function linkRequests(sheetId, section) {
  const requests = [];
  section.rows.forEach((row, rowIndex) => {
    row.links.forEach((link) => {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: rowIndex + 2,
            endRowIndex: rowIndex + 3,
            startColumnIndex: link.column,
            endColumnIndex: link.column + 1,
          },
          rows: [{
            values: [{
              userEnteredFormat: {
                textFormat: {
                  foregroundColor: LINK_BLUE,
                  underline: true,
                  link: { uri: link.url },
                },
              },
            }],
          }],
          fields: 'userEnteredFormat.textFormat',
        },
      });
    });
  });
  return requests;
}

async function batchUpdateInChunks(spreadsheetId, requests, chunkSize = 180) {
  for (let index = 0; index < requests.length; index += chunkSize) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(index, index + chunkSize) },
    });
  }
}

async function writeChecklistSpreadsheet(spreadsheetId, sections, maintenance) {
  const metadata = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const defaultSheetId = metadata.data.sheets?.[0]?.properties?.sheetId ?? 0;
  const sheetIds = sections.map((_, index) => (index === 0 ? defaultSheetId : 1000 + index));
  const setupRequests = [];

  sections.forEach((section, index) => {
    if (index > 0) {
      setupRequests.push({
        addSheet: {
          properties: {
            sheetId: sheetIds[index],
            title: safeSheetName(section.schema.name),
            gridProperties: {
              rowCount: Math.max(section.rows.length + 10, 100),
              columnCount: section.schema.headers.length,
              frozenRowCount: 2,
            },
          },
        },
      });
    }
  });
  sections.forEach((section, index) => setupRequests.push(...sheetSetupRequests(sheetIds[index], section, index)));
  await batchUpdateInChunks(spreadsheetId, setupRequests);

  await Promise.all(sections.map(async (section, index) => {
    const headers = section.schema.headers;
    const title = `Checklist ${section.schema.name} - ${maintenance.Cliente || 'Cliente'} - ${String(maintenance.Fecha || '').slice(0, 10)}`;
    const values = [
      [title, ...new Array(Math.max(headers.length - 1, 0)).fill('')],
      headers,
      ...section.rows.map((row) => row.values),
    ];
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedSheetName(safeSheetName(section.schema.name))}!A1:${columnLetter(headers.length - 1)}${values.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }));

  const links = sections.flatMap((section, index) => linkRequests(sheetIds[index], section));
  if (links.length) await batchUpdateInChunks(spreadsheetId, links);
}

async function createSpreadsheetReport(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden crear reportes de mantenimiento.');
  const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const data = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId } });
  const sections = await buildChecklistSections(data);
  if (!sections.length) {
    throw new AppError('MAINTENANCE_REPORT_WITHOUT_DEVICES', 'No hay dispositivos registrados para crear el checklist.', 400);
  }
  const title = `Checklist mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'} - ${String(data.mantenimiento.Fecha || '').slice(0, 10)}`;
  const created = await createReportFile({ title, mimeType: GOOGLE_SHEET_MIME });
  const id = created.id;

  try {
    await writeChecklistSpreadsheet(id, sections, data.mantenimiento);
  } catch (error) {
    console.error(`[maintenance-report] No se pudo construir el Sheet ${id}:`, error);
    throw new AppError(
      'MAINTENANCE_SPREADSHEET_WRITE_FAILED',
      'El archivo se creó en Drive, pero no fue posible construir el checklist por categorías.',
      502,
      { cause: googleMessage(error), fileId: id },
    );
  }

  const access = await prepareAccess(id, ctx);
  const url = created.webViewLink || `https://docs.google.com/spreadsheets/d/${id}/edit`;
  await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, {
    SpreadsheetID: id,
    SpreadsheetURL: url,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  return {
    spreadsheetId: id,
    spreadsheetUrl: url,
    excelUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
    rows: sections.reduce((sum, section) => sum + section.rows.length, 0),
    sheets: sections.map((section) => section.schema.name),
    access,
  };
}

async function createSlidesReport(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden crear reportes de mantenimiento.');
  const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const data = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId } });
  const title = `Mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'}`;
  const created = await createReportFile({ title, mimeType: GOOGLE_SLIDES_MIME });
  const id = created.id;
  const access = await prepareAccess(id, ctx);
  const url = created.webViewLink || `https://docs.google.com/presentation/d/${id}/edit`;
  await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, {
    SlidesID: id,
    SlidesURL: url,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  return { slidesId: id, slidesUrl: url, access };
}

async function finalizeWithDelivery(ctx) {
  const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const testMode = Boolean(ctx.payload.testMode || ctx.payload.prueba);
  if (testMode && !isAdmin(ctx)) {
    throw forbidden('Solo los administradores pueden probar el envío de mantenimientos.');
  }

  const before = await findById('Mantenimiento', id);
  const delivery = await deliverMaintenance(ctx, id, { testMode });

  if (testMode) {
    await audit(ctx, 'PROBAR_ENVIO_MANTENIMIENTO', 'Mantenimiento', id, before, {
      Estado: before.Estado,
      CarpetaDriveURL: delivery.folderUrl,
      ChatDestino: delivery.destination,
      EstadoCambiado: false,
    });
    return {
      tested: true,
      stateChanged: false,
      maintenanceId: id,
      delivery,
      message: 'La prueba fue enviada al Chat de pruebas sin cambiar el estado del mantenimiento.',
    };
  }

  await ensureDeliveryColumns();
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: timestamp,
    CarpetaDriveID: delivery.folderId,
    CarpetaDriveURL: delivery.folderUrl,
    EstadoNotificacion: 'ENVIADO',
    ChatDestino: delivery.destination,
    ChatEnviadoEn: timestamp,
    ChatFallbackPruebas: delivery.fallbackToTest,
    ImagenesEsperadas: delivery.imagesExpected,
    ImagenesCopiadas: delivery.imagesCopied,
    ImagenesYaExistentes: delivery.imagesAlreadyPresent,
    ErroresCopia: delivery.errors.join(' | '),
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });
  const result = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId: id } });
  await audit(ctx, 'FINALIZAR_MANTENIMIENTO_CON_ENTREGA', 'Mantenimiento', id, before, {
    ...result.mantenimiento,
    CarpetaDriveURL: delivery.folderUrl,
    ChatDestino: delivery.destination,
    ImagenesCopiadas: delivery.imagesCopied,
  });
  return { ...result, delivery };
}

export const maintenanceReportAccessHandlers = {
  finalize: finalizeWithDelivery,
  spreadsheetReport: createSpreadsheetReport,
  slidesReport: createSlidesReport,
};
