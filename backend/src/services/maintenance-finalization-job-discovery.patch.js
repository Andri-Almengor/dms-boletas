import { pick } from '../core/utils.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { findFinalizationJobForMaintenance } from './maintenance-finalization-job.storage.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceFinalizationJobDiscovery');

function clean(value) {
  return String(value ?? '').trim();
}

function idFrom(ctx, row = {}) {
  return clean(
    pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id'])
      || row.MantenimientoID,
  );
}

function jobProjection(row = {}, job = null) {
  if (!job) return row;
  const jobState = clean(job.Estado).toUpperCase();
  const final = clean(row.Estado).toUpperCase() === 'FINALIZADO';
  return {
    ...row,
    EstadoFinalizacion: final ? 'COMPLETADO' : jobState,
    PasoFinalizacion: row.PasoFinalizacion || job.Fase || '',
    FinalizacionJobID: row.FinalizacionJobID || job.JobID || '',
    FinalizacionProgreso: Number(row.FinalizacionProgreso || job.Porcentaje || 0),
    FinalizacionTotalBoletas: Number(row.FinalizacionTotalBoletas || job.TotalBoletas || 0),
    FinalizacionBoletasCompletadas: Number(row.FinalizacionBoletasCompletadas || job.BoletasCompletadas || 0),
    FinalizacionTotalDispositivos: Number(row.FinalizacionTotalDispositivos || job.TotalDispositivos || 0),
    FinalizacionDispositivosCompletados: Number(row.FinalizacionDispositivosCompletados || job.DispositivosCompletados || 0),
    FinalizacionTotalEvidencias: Number(row.FinalizacionTotalEvidencias || job.TotalEvidencias || 0),
    FinalizacionEvidenciasProcesadas: Number(row.FinalizacionEvidenciasProcesadas || job.EvidenciasProcesadas || 0),
    FinalizacionMensaje: row.FinalizacionMensaje || (
      jobState === 'ERROR'
        ? 'La finalización se detuvo y puede reanudarse desde el último item confirmado.'
        : jobState === 'COMPLETADO'
          ? 'Mantenimiento finalizado correctamente.'
          : 'La finalización continúa en segundo plano.'
    ),
    UltimoErrorFinalizacion: row.UltimoErrorFinalizacion || job.UltimoError || '',
    FinalizacionActualizadaEn: row.FinalizacionActualizadaEn || job.FechaActualizacion || '',
    FinalizacionCompletadaEn: row.FinalizacionCompletadaEn || job.FechaFinalizacion || '',
  };
}

if (!maintenanceProgressChatHandlers[INSTALL_FLAG]) {
  const previousGet = maintenanceProgressChatHandlers.get;

  maintenanceProgressChatHandlers.get = async (ctx) => {
    const result = await previousGet(ctx);
    if (ctx.payload?.finalizationStatusOnly) return result;

    const row = result?.mantenimiento || result || {};
    const id = idFrom(ctx, row);
    if (!id || clean(row.Estado).toUpperCase() === 'FINALIZADO') return result;

    const job = await findFinalizationJobForMaintenance(id, row.FinalizacionJobID).catch(() => null);
    if (!job) return result;

    const projected = jobProjection(row, job);

    // Si Render se reinició, scheduledJobs quedó vacío. Invocar el handler
    // escalonado vuelve a registrar el job existente; no crea uno nuevo porque
    // findFinalizationJobForMaintenance lo recupera por MantenimientoID.
    if (clean(job.Estado).toUpperCase() === 'EN_PROCESO') {
      Promise.resolve().then(() => maintenanceProgressChatHandlers.finalize({
        ...ctx,
        payload: {
          ...(ctx.payload || {}),
          maintenanceId: id,
          MantenimientoID: id,
        },
      })).catch((error) => {
        console.error(`[maintenance-finalization-discovery][${id}]`, error);
      });
    }

    if (result?.mantenimiento) return { ...result, mantenimiento: projected };
    return projected;
  };

  maintenanceProgressChatHandlers[INSTALL_FLAG] = true;
}
