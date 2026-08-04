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

const INSTALL_FLAG = Symbol.for('dms.maintenanceOptionalSignature');
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

async function recordSignatureState(ctx, id, included) {
  await ensureSheetColumns('Mantenimiento', SIGNATURE_FINALIZATION_COLUMNS);
  const timestamp = nowIso();
  const patch = {
    FirmaEstadoFinalizacion: included ? 'INCLUIDA' : 'OMITIDA',
    FirmaOmitidaAlFinalizar: !included,
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  };
  const updated = await updateRow('Mantenimiento', id, patch);
  await audit(
    ctx,
    included
      ? 'FINALIZAR_MANTENIMIENTO_CON_FIRMA'
      : 'FINALIZAR_MANTENIMIENTO_SIN_FIRMA',
    'Mantenimiento',
    id,
    null,
    {
      FirmaEstadoFinalizacion: patch.FirmaEstadoFinalizacion,
      FirmaOmitidaAlFinalizar: patch.FirmaOmitidaAlFinalizar,
    },
  ).catch(() => {});
  return updated;
}

async function finalizeWithoutSignature(ctx, id) {
  await ensureSheetColumns('Mantenimiento', MAINTENANCE_TICKET_COLUMNS);

  let ticketGeneration;
  try {
    ticketGeneration = await generateMaintenanceTickets(ctx, id);
  } catch (error) {
    await updateRow('Mantenimiento', id, {
      EstadoBoletasMantenimiento: 'ERROR',
      UltimoErrorBoletasMantenimiento: String(error?.message || error).slice(0, 1500),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: nowIso(),
    }).catch(() => {});
    throw error;
  }

  const result = await maintenanceReportAccessHandlers.finalize(ctx);
  await recordSignatureState(ctx, id, false);

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
      return finalizeWithoutSignature(ctx, id);
    }

    const result = await originalFinalize(ctx);
    await recordSignatureState(ctx, id, true);
    return {
      ...result,
      signatureIncluded: true,
      signatureStatus: 'INCLUIDA',
    };
  };

  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}

export const MAINTENANCE_OPTIONAL_SIGNATURE_POLICY = Object.freeze({
  signatureRequiredToFinalize: false,
  signedReportsPreserved: true,
  unsignedReportsAllowed: true,
});
