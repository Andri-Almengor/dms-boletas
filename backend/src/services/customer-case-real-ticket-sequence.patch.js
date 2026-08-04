import { nowIso, pick } from '../core/utils.js';
import { findById, readTable, updateRow } from '../infra/sheets.repository.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { audit } from './audit.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseRealTicketSequence');
let sequenceTail = Promise.resolve();

function clean(value, maxLength = 300) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'prueba'].includes(clean(value, 20).toLowerCase());
}

function ticketFromResult(result = {}) {
  return result.boleta || result.item || result.data || result;
}

function validRealTicketNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function nextRealTicketNumber(rows = []) {
  const highest = rows.reduce((max, row) => {
    if (booleanValue(row.EsPrueba || row.ModoPrueba)) return max;
    const value = Number(row.BoletaID);
    return Number.isInteger(value) && value > 0 ? Math.max(max, value) : max;
  }, 0);
  return highest + 1;
}

function withSequenceLock(operation) {
  const current = sequenceTail.then(operation, operation);
  sequenceTail = current.catch(() => {});
  return current;
}

if (!ticketMultiHandlers[INSTALL_FLAG]) {
  const originalCreate = ticketMultiHandlers.create;

  ticketMultiHandlers.create = async (ctx) => {
    const caseId = clean(pick(ctx.payload, ['OrigenCasoID', 'origenCasoId']), 220);
    if (!caseId) return originalCreate(ctx);

    const caseData = await findById('CasosClientes', caseId);
    if (booleanValue(caseData.ModoPrueba || caseData.EsPrueba || caseData.TipoCaso)) {
      return originalCreate(ctx);
    }

    const result = await originalCreate(ctx);
    const ticket = ticketFromResult(result);
    if (validRealTicketNumber(ticket.BoletaID)) return result;

    return withSequenceLock(async () => {
      const rows = await readTable('Boletas', { force: true });
      const current = rows.find((row) => clean(row.BoletaUID, 220) === clean(ticket.BoletaUID, 220)) || ticket;
      if (validRealTicketNumber(current.BoletaID)) {
        return ticketMultiHandlers.get({ ...ctx, payload: { boletaUid: current.BoletaUID } });
      }

      const nextNumber = nextRealTicketNumber(rows);
      const updated = await updateRow('Boletas', current.BoletaUID, {
        BoletaID: nextNumber,
        Version: Number(current.Version || 1) + 1,
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: nowIso(),
      });
      await audit(
        ctx,
        'NORMALIZAR_CONSECUTIVO_BOLETA_CASO',
        'Boletas',
        current.BoletaUID,
        current,
        { BoletaID: nextNumber, OrigenCasoID: caseId },
      ).catch(() => {});
      return ticketMultiHandlers.get({ ...ctx, payload: { boletaUid: updated.BoletaUID } });
    });
  };

  ticketMultiHandlers[INSTALL_FLAG] = true;
}

export const CUSTOMER_CASE_REAL_TICKET_SEQUENCE = Object.freeze({
  usesGlobalNumericSequence: true,
  preservesTestSequence: true,
});
