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
    || ctx.permissions.includes('MANTENIMIENTOS_GESTIONAR');
}

async function moveToReportFolder(fileId) {
  const config = await getConfig();
  const folderId = clean(pick(config, [
    'MANTENIMIENTOS_REPORTS_FOLDER_ID',
    'REPORTES_MANTENIMIENTOS_FOLDER_ID',
    'REPORTES_FOLDER_ID',
    'ROOT_FOLDER_ID',
  ]));
  if (!folderId) return;

  const current = await driveApi.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  const parents = current.data.parents || [];
  await driveApi.files.update({
    fileId,
    addParents: folderId,
    removeParents: parents.join(',') || undefined,
    fields: 'id,parents,webViewLink',
    supportsAllDrives: true,
  });
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
}

async function prepareAccess(fileId, ctx) {
  try {
    await moveToReportFolder(fileId);
    await grantAccess(fileId, ctx);
  } catch (error) {
    console.error(`[maintenance-report] No se pudo compartir ${fileId}:`, error);
    throw new AppError(
      'MAINTENANCE_REPORT_ACCESS_FAILED',
      `El reporte fue creado, pero no se pudo compartir con ${clean(pick(ctx.user, ['Correo', 'Email', 'email'])) || 'el usuario actual'}. Revise los permisos de Drive y la carpeta de reportes.`,
      502,
      { cause: String(error?.message || error), fileId },
    );
  }
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
  spreadsheetReport: async (ctx) => {
    const result = await maintenanceHandlers.spreadsheetReport(ctx);
    await prepareAccess(result.spreadsheetId, ctx);
    return result;
  },
  slidesReport: async (ctx) => {
    const result = await maintenanceHandlers.slidesReport(ctx);
    await prepareAccess(result.slidesId, ctx);
    return result;
  },
};
