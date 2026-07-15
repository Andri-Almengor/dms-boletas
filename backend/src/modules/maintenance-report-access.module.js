import { AppError } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { driveApi } from '../infra/google.js';
import { getConfig } from './config.module.js';
import { maintenanceHandlers } from './maintenance.module.js';

function clean(value) {
  return String(value || '').trim();
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

export const maintenanceReportAccessHandlers = {
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
