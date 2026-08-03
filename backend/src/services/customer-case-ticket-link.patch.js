import { nowIso } from '../core/utils.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import { updateRow } from '../infra/sheets.repository.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseTicketLink');

function clean(value, maxLength = 8000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  const processCase = customerCaseHandlers.process;
  customerCaseHandlers.process = async (ctx) => {
    const result = await processCase(ctx);
    const item = result?.case || {};
    const ticketId = clean(item.BoletaUID || item.ticketId, 200);
    if (!ticketId) return result;

    const ticket = await updateRow('Boletas', ticketId, {
      Titulo: clean(item.AsuntoCorreoInicial || `${item.CasoNumero} - ${item.RazonVisita}`, 100),
      ClienteID: clean(item.ClienteID, 200),
      Cliente: clean(item.Cliente, 250),
      CorreoCliente: clean(item.CorreoSolicitante, 320),
      RazonVisita: clean(item.RazonVisita, 4000),
      Descripcion: clean(item.Problema, 8000),
      Fecha: clean(item.FechaVisita, 20),
      HoraInicio: clean(item.HoraVisita, 20),
      OrigenCasoID: clean(item.CasoID, 200),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      FechaActualizacion: nowIso(),
    });

    return {
      ...result,
      ticket,
    };
  };
  customerCaseHandlers[INSTALL_FLAG] = true;
}
