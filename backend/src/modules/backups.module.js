import { audit } from '../services/audit.service.js';
import {
  createWeeklyBackup,
  getWeeklyBackupStatus,
  updateWeeklyBackupSettings,
} from '../services/weekly-backup.service.js';

export const backupHandlers = {
  status: async () => getWeeklyBackupStatus(),

  update: async (ctx) => {
    const before = await getWeeklyBackupStatus();
    const after = await updateWeeklyBackupSettings({
      enabled: ctx.payload.enabled ?? ctx.payload.activo,
      day: ctx.payload.day ?? ctx.payload.dia,
      hour: ctx.payload.hour ?? ctx.payload.hora,
    });
    await audit(
      ctx,
      'ACTUALIZAR_RESPALDO_SEMANAL',
      'Configuracion',
      'BACKUP_WEEKLY',
      before,
      after,
    ).catch(() => {});
    return after;
  },

  create: async (ctx) => {
    const result = await createWeeklyBackup({
      actor: ctx.user?.UsuarioID || ctx.user?.Correo || 'SYSTEM',
    });
    await audit(
      ctx,
      'CREAR_RESPALDO_MANUAL',
      'Configuracion',
      'BACKUP_WEEKLY',
      null,
      {
        fileId: result.fileId,
        fileName: result.fileName,
        createdAt: result.createdAt,
        slot: result.slot,
      },
    ).catch(() => {});
    return result;
  },
};
