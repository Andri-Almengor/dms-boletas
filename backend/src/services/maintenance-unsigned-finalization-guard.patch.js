import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceReportAccessHandlers } from '../modules/maintenance-report-access.module.js';
import {
  generateMaintenanceTickets,
  MAINTENANCE_TICKET_COLUMNS,
} from './maintenance-ticket-generation.service.js';
import { maintenanceHasSignature } from './maintenance-signature-request.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';
import { audit } from './audit.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceUnsignedFinalizationGuard');
const SIGNATURE_FINALIZATION_COLUMNS = [
  'FirmaEstadoFinalizacion',
  'FirmaOmitidaAlFinalizar',
];

function clean(value) {
  return String(value ?? '').trim();
}

function maintenanceId(ctx) {
  return clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']));
}

function testMode(ctx) {
  return Boolean(ctx.payload?.testMode || ctx.payload?.prueba);
}

async function recordUnsignedFinalization(ctx, id) {
  await ensureSheetColumns('Mantenimiento', SIGNATURE_FINALIZATION_COLUMNS);
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    FirmaEstadoFinalizacion: 'OMITIDA',
    FirmaOmitidaAlFinalizar: true,
    UltimoErrorFinalizacion: '',
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });
  await audit(
    ctx,
    'FINALIZAR_MANTENIMIENTO_SIN_FIRMA',
    'Mantenimiento',
    id,
    null,
    {
      FirmaEstadoFinalizacion: 'OMITIDA',
      FirmaOmitidaAlFinalizar: true,
      ProteccionFirmaOpcional: true,
    },
  ).catch(() => {});
}

async function finalizeUnsigned(ctx, id) {
  await ensureSheetColumns('Mantenimiento', MAINTENANCE_TICKET_COLUMNS);
  let ticketGeneration;
  try {
    ticketGeneration = await generateMaintenanceTickets(ctx, id);
  } catch (error) {
    await updateRow('Mantenimiento', id, {
      EstadoBoletasMantenimiento: 'ERROR',
      UltimoErrorBoletasMantenimiento: clean(error?.message || error).slice(0, 1500),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: nowIso(),
    }).catch(() => {});
    throw error;
  }

  const result = await maintenanceReportAccessHandlers.finalize(ctx);
  await recordUnsignedFinalization(ctx, id);

  return {
    ...result,
    signatureIncluded: false,
    signatureStatus: 'OMITIDA',
    ticketGeneration: {
      ...ticketGeneration,
      signatureIncluded: false,
      refreshedSignedReports: [],
    },
    message: `Mantenimiento finalizado sin firma. Se generaron y enviaron ${ticketGeneration.ticketCount} boleta(s) por fecha y grupo técnico. Los PDF fueron creados sin firma del cliente.`,
  };
}

if (!maintenanceAutomationHandlers[INSTALL_FLAG]) {
  const originalFinalize = maintenanceAutomationHandlers.finalize;

  maintenanceAutomationHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return originalFinalize(ctx);

    const id = maintenanceId(ctx);
    const maintenance = await findById('Mantenimiento', id);
    if (!maintenanceHasSignature(maintenance)) {
      return finalizeUnsigned(ctx, id);
    }

    return originalFinalize(ctx);
  };

  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}

export const MAINTENANCE_UNSIGNED_FINALIZATION_GUARD = Object.freeze({
  signatureRequired: false,
  bypassesLegacySignatureBlock: true,
});
