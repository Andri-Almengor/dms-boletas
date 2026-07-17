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

function clean(value) {
  return String(value || '').trim();
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

async function createSpreadsheetReport(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden crear reportes de mantenimiento.');
  const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const data = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId } });
  const title = `Mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'} - ${String(data.mantenimiento.Fecha || '').slice(0, 10)}`;
  const created = await createReportFile({ title, mimeType: GOOGLE_SHEET_MIME });
  const id = created.id;
  const values = [
    ['REPORTE DE MANTENIMIENTO DMS'],
    ['Título', data.mantenimiento.TituloMantenimiento],
    ['Cliente', data.mantenimiento.Cliente],
    ['Ubicación', data.mantenimiento.Ubicacion],
    ['Fecha', data.mantenimiento.Fecha],
    [],
    ['Categoría', 'Nombre', 'Zona', 'Fabricante', 'Modelo', 'Serie', 'Funcionamiento', 'En uso', 'Estado', 'Observación'],
    ...data.dispositivos.map((device) => [
      device.Categoria,
      device.NombreDispositivo,
      device.Zona,
      device.Fabricante,
      device.Modelo,
      device.Serie,
      device.Funcionamiento,
      device.EnUso,
      device.Estado,
      device.Observacion,
    ]),
  ];

  try {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: id,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } catch (error) {
    console.error(`[maintenance-report] No se pudo escribir el Sheet ${id}:`, error);
    throw new AppError(
      'MAINTENANCE_SPREADSHEET_WRITE_FAILED',
      'El archivo se creó en Drive, pero no fue posible escribir los datos del mantenimiento.',
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