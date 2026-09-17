import { pick } from '../core/utils.js';
import { findById, findRows, queryCustomerCasePage } from '../infra/sheets.repository.js';
import { env } from '../config/env.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import { ensureCustomerCaseSchema } from './customer-case-schema.service.js';
import { reconcileCustomerCases } from './customer-case-sync.service.js';
import { customerCaseView } from './customer-case-query.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseQueryOptimization');
const clean=(value,maxLength=12000)=>String(value??'').trim().slice(0,maxLength);
function publicBaseUrl(origin=''){return clean(env.appPublicUrl||origin,1000).replace(/\/$/,'');}
function ticketUrl(ticketId,origin=''){const base=publicBaseUrl(origin);return base?`${base}/boletas/${encodeURIComponent(ticketId)}`:`/boletas/${encodeURIComponent(ticketId)}`;}

async function detailBundle(caseId,origin=''){
  const item=customerCaseView(await findById('CasosClientes',caseId));
  const technicianIds=new Set(item.TecnicoIDs.map((value)=>clean(value)).filter(Boolean));
  const relatedTicketId=clean(item.BoletaUID);
  const [evidences,users,ticket]=await Promise.all([
    findRows('CasoEvidencias',{CasoID:item.CasoID},{limit:5000}),
    technicianIds.size?findRows('Usuarios',{UsuarioID:[...technicianIds]},{limit:5000}):Promise.resolve([]),
    relatedTicketId?findById('Boletas',relatedTicketId).catch(()=>null):Promise.resolve(null),
  ]);
  const technicians=users.filter((user)=>technicianIds.has(clean(user.UsuarioID))).map((user)=>({UsuarioID:user.UsuarioID,Nombre:clean(user.NombreCompleto||user.Nombre||user.NombreUsuario||user.UsuarioID,180),Correo:clean(user.Correo,320)}));
  return {case:item,evidences:evidences.filter((row)=>row.Activo!==false&&String(row.Activo??'true').toLowerCase()!=='false'),technicians,ticket,ticketUrl:relatedTicketId?ticketUrl(relatedTicketId,origin):''};
}

if(!customerCaseHandlers[INSTALL_FLAG]){
  customerCaseHandlers.list=async(ctx)=>{await ensureCustomerCaseSchema();await reconcileCustomerCases(ctx.user.UsuarioID).catch((error)=>console.warn(`[customer-cases] No se pudo reconciliar el cierre: ${error.message}`));const result=await queryCustomerCasePage(ctx.payload||{});return {...result,items:result.items.map(customerCaseView)};};
  customerCaseHandlers.get=async(ctx)=>{await ensureCustomerCaseSchema();await reconcileCustomerCases(ctx.user.UsuarioID).catch(()=>{});return detailBundle(pick(ctx.payload,['caseId','CasoID','id']),ctx.origin);};
  customerCaseHandlers[INSTALL_FLAG]=true;
}
