import { pick } from '../core/utils.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { env } from '../config/env.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import { ensureCustomerCaseSchema } from './customer-case-schema.service.js';
import { reconcileCustomerCases } from './customer-case-sync.service.js';
import {
  buildCustomerCaseList,
  customerCaseView,
} from './customer-case-query.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseQueryOptimization');

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function publicBaseUrl(origin = '') {
  return clean(env.appPublicUrl || origin, 1000).replace(/\/$/, '');
}

function ticketUrl(ticketId, origin = '') {
  const base = publicBaseUrl(origin);
  return base ? `${base}/boletas/${encodeURIComponent(ticketId)}` : `/boletas/${encodeURIComponent(ticketId)}`;
}

async function evidenceRows(caseId) {
  const rows = await readTable('CasoEvidencias');
  return rows.filter((row) => clean(row.CasoID) === clean(caseId) && row.Activo !== false);
}

async function detailBundle(caseId, origin = '') {
  const item = customerCaseView(await findById('CasosClientes', caseId));
  const technicianIds = new Set(item.TecnicoIDs.map((value) => clean(value)).filter(Boolean));
  const relatedTicketId = clean(item.BoletaUID);
  const [evidences, users, tickets] = await Promise.all([
    evidenceRows(item.CasoID),
    technicianIds.size ? readTable('Usuarios') : Promise.resolve([]),
    relatedTicketId ? readTable('Boletas') : Promise.resolve([]),
  ]);

  // El orden histórico del detalle es el orden de la tabla Usuarios, no el
  // orden de TecnicoIDsJSON. Se conserva para evitar cambios visibles.
  const technicians = users
    .filter((user) => technicianIds.has(clean(user.UsuarioID)))
    .map((user) => ({
      UsuarioID: user.UsuarioID,
      Nombre: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.UsuarioID, 180),
      Correo: clean(user.Correo, 320),
    }));
  const ticket = relatedTicketId
    ? tickets.find((row) => clean(row.BoletaUID) === relatedTicketId) || null
    : null;

  return {
    case: item,
    evidences,
    technicians,
    ticket,
    ticketUrl: relatedTicketId ? ticketUrl(relatedTicketId, origin) : '',
  };
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  customerCaseHandlers.list = async (ctx) => {
    await ensureCustomerCaseSchema();
    await reconcileCustomerCases(ctx.user.UsuarioID).catch((error) => {
      console.warn(`[customer-cases] No se pudo reconciliar el cierre: ${error.message}`);
    });

    const rows = await readTable('CasosClientes');
    const page = Math.max(1, Number(ctx.payload.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(ctx.payload.pageSize || 60)));
    return buildCustomerCaseList(rows, {
      state: pick(ctx.payload, ['status', 'estado']),
      clientId: pick(ctx.payload, ['clientId', 'ClienteID']),
      search: pick(ctx.payload, ['search', 'q']),
      page,
      pageSize,
    });
  };

  customerCaseHandlers.get = async (ctx) => {
    await ensureCustomerCaseSchema();
    await reconcileCustomerCases(ctx.user.UsuarioID).catch(() => {});
    return detailBundle(pick(ctx.payload, ['caseId', 'CasoID', 'id']), ctx.origin);
  };

  customerCaseHandlers[INSTALL_FLAG] = true;
}
