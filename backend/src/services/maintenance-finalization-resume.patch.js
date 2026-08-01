import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { maintenanceReportAccessHandlers } from '../modules/maintenance-report-access.module.js';
import { maintenanceHasSignature } from './maintenance-signature-request.service.js';
import {
  markMaintenanceFinalizationStep,
  runResumableMaintenanceFinalization,
} from './maintenance-finalization-state.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceFinalizationResume');

function clean(value) {
  return String(value ?? '').trim();
}

function maintenanceId(ctx) {
  return clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
}

function testMode(ctx) {
  return Boolean(ctx.payload?.testMode || ctx.payload?.prueba);
}

function deliveredResult(row = {}) {
  return {
    maintenanceId: clean(row.MantenimientoID),
    testMode: false,
    stateChanged: true,
    folderId: clean(row.CarpetaDriveID),
    folderUrl: clean(row.CarpetaDriveURL),
    destination: clean(row.ChatDestino),
    fallbackToTest: Boolean(row.ChatFallbackPruebas),
    devices: Number(row.DispositivosRegistrados || 0),
    imagesExpected: Number(row.ImagenesEsperadas || 0),
    imagesCopied: Number(row.ImagenesCopiadas || 0),
    imagesAlreadyPresent: Number(row.ImagenesYaExistentes || 0),
    errors: clean(row.ErroresCopia) ? clean(row.ErroresCopia).split(' | ').filter(Boolean) : [],
    reused: true,
  };
}

if (!maintenanceReportAccessHandlers[INSTALL_FLAG]) {
  const finalizeDelivery = maintenanceReportAccessHandlers.finalize;
  maintenanceReportAccessHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return finalizeDelivery(ctx);
    const id = maintenanceId(ctx);
    const row = await findById('Mantenimiento', id);
    const delivered = clean(row.EstadoNotificacion).toUpperCase() === 'ENVIADO'
      && Boolean(clean(row.CarpetaDriveID || row.CarpetaDriveURL));

    if (clean(row.Estado).toUpperCase() === 'FINALIZADO' || delivered) {
      const timestamp = nowIso();
      if (clean(row.Estado).toUpperCase() !== 'FINALIZADO') {
        await updateRow('Mantenimiento', id, {
          Estado: 'FINALIZADO',
          FechaFinalizacion: row.FechaFinalizacion || timestamp,
          EstadoNotificacion: 'ENVIADO',
          ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
          FechaActualizacion: timestamp,
        });
      }
      await markMaintenanceFinalizationStep(id, 'COMPLETANDO', {
        EstadoNotificacion: 'ENVIADO',
        ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      });
      const current = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId: id } });
      return { ...current, delivery: deliveredResult({ ...row, Estado: 'FINALIZADO' }), resumed: true };
    }

    const tracker = ctx.__maintenanceFinalizationTracker;
    const mark = typeof tracker?.mark === 'function'
      ? tracker.mark.bind(tracker)
      : (step, patch) => markMaintenanceFinalizationStep(id, step, patch);
    await mark('ENTREGANDO', {
      EstadoNotificacion: 'ENVIANDO',
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    });
    const result = await finalizeDelivery(ctx);
    await mark('COMPLETANDO', {
      EstadoNotificacion: 'ENVIADO',
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    });
    return result;
  };
  maintenanceReportAccessHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceAutomationHandlers[INSTALL_FLAG]) {
  const finalizeMaintenance = maintenanceAutomationHandlers.finalize;
  maintenanceAutomationHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return finalizeMaintenance(ctx);
    const id = maintenanceId(ctx);
    return runResumableMaintenanceFinalization(ctx, id, async (tracker, initialRow) => {
      await tracker.mark('VALIDANDO');
      if (maintenanceHasSignature(initialRow)) {
        await tracker.mark('GENERANDO_BOLETAS');
      }
      const trackedContext = { ...ctx, __maintenanceFinalizationTracker: tracker };
      const result = await finalizeMaintenance(trackedContext);
      return {
        ...result,
        finalization: {
          requestId: tracker.requestId,
          attempts: tracker.attempts,
          state: 'COMPLETADO',
          step: 'COMPLETADO',
        },
      };
    });
  };
  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}
