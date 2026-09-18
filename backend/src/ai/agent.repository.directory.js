import { badRequest, notFound } from '../core/errors.js';
import { aiAccess, appendTicketVisibility, assertAiCapability } from './agent.permissions.js';
import { active, aliasQuery, clean, entity, like, many, one, pageLimit, source } from './agent.repository.shared.js';

export async function searchClients(ctx,args={}){
  assertAiCapability(ctx,'clients');
  const q=aliasQuery(args.query); const params=[]; const clauses=[active('c')];
  if(q){params.push(like(q));const p='$'+params.length;clauses.push(`(c."Nombre" ILIKE ${p} ESCAPE '\\' OR c."RazonSocial" ILIKE ${p} ESCAPE '\\' OR c."Identificacion" ILIKE ${p} ESCAPE '\\')`);}
  params.push(pageLimit(args.limit,10));
  const rows=await many(`SELECT c."ClienteID" AS id,c."Nombre" AS name,c."RazonSocial" AS "legalName",c."Identificacion" AS identification,c."Estado" AS status FROM "Clientes" c WHERE ${clauses.join(' AND ')} ORDER BY c."Nombre" ASC NULLS LAST LIMIT $${params.length}`,params,'ai.clients.search');
  const items=rows.map(r=>({id:r.id,name:r.name||r.legalName||'Cliente',legalName:r.legalName||'',identification:r.identification||'',status:r.status||''}));
  return {modelData:{totalShown:items.length,items},entities:items.map(i=>entity('client',i.id,i.name,'/clientes')),sources:items.slice(0,5).map(i=>source('client',i.id,i.name,'/clientes')),context:items.length===1?{lastClientId:items[0].id,lastClientName:items[0].name}:{}};
}

export async function getClient(ctx,args={}){
  assertAiCapability(ctx,'clients');
  const id=clean(args.clientId,250); if(!id) throw badRequest('Falta clientId.');
  const row=await one(`SELECT c."ClienteID" AS id,c."Nombre" AS name,c."RazonSocial" AS "legalName",c."Identificacion" AS identification,c."CorreoGeneral" AS email,c."Telefono" AS phone,c."Direccion" AS address,c."Contacto" AS contact,c."SitioWeb" AS website,c."Estado" AS status,c."Notas" AS notes FROM "Clientes" c WHERE ${active('c')} AND c."ClienteID"=$1 LIMIT 1`,[id],'ai.clients.get');
  if(!row) throw notFound('No se encontró el cliente solicitado.');
  const supervisors=await many(`SELECT cc."ContactoID" AS id,cc."Nombre" AS name,cc."Puesto" AS position,cc."Correo" AS email,cc."Telefono" AS phone FROM "ClienteContactos" cc WHERE ${active('cc')} AND cc."ClienteID"=$1 AND LOWER(COALESCE(cc."EsSupervisor",'false'))='true' ORDER BY cc."Nombre" ASC LIMIT 20`,[id],'ai.clients.supervisors');
  const access=aiAccess(ctx); let ticketCount=null,maintenanceCount=null;
  if(access.tickets){const p=[id];const visibility=appendTicketVisibility(ctx,p,'b');const x=await one(`SELECT COUNT(*)::bigint AS total FROM "Boletas" b WHERE b."__valid"=TRUE AND b."ClienteID"=$1 AND UPPER(COALESCE(b."Estado",''))<>'ANULADA' AND ${visibility}`,p,'ai.clients.ticketCount');ticketCount=Number(x?.total||0);}
  if(access.maintenance){const x=await one(`SELECT COUNT(*)::bigint AS total FROM "Mantenimiento" m WHERE ${active('m')} AND m."ClienteID"=$1`,[id],'ai.clients.maintenanceCount');maintenanceCount=Number(x?.total||0);}
  const item={id:row.id,name:row.name||row.legalName||'Cliente',legalName:row.legalName||'',identification:row.identification||'',email:row.email||'',phone:row.phone||'',address:row.address||'',contact:row.contact||'',website:row.website||'',status:row.status||'',notes:clean(row.notes,2200),supervisors,ticketCount,maintenanceCount};
  return {modelData:item,entities:[entity('client',item.id,item.name,'/clientes')],sources:[source('client',item.id,item.name,'/clientes')],context:{lastClientId:item.id,lastClientName:item.name}};
}

export async function searchUsers(ctx,args={}){
  assertAiCapability(ctx,'users');
  const q=clean(args.query,250); const params=[]; const clauses=['u."__valid"=TRUE',`UPPER(COALESCE(u."Estado",'ACTIVO'))='ACTIVO'`];
  if(q){params.push(like(q));const p='$'+params.length;clauses.push(`(u."NombreCompleto" ILIKE ${p} ESCAPE '\\' OR u."NombreUsuario" ILIKE ${p} ESCAPE '\\')`);}
  params.push(pageLimit(args.limit,10));
  const rows=await many(`SELECT u."UsuarioID" AS id,u."NombreCompleto" AS name,u."NombreUsuario" AS username,r."Nombre" AS role FROM "Usuarios" u LEFT JOIN "Roles" r ON r."__valid"=TRUE AND r."RolID"=u."RolID" WHERE ${clauses.join(' AND ')} ORDER BY u."NombreCompleto" ASC NULLS LAST LIMIT $${params.length}`,params,'ai.users.search');
  const items=rows.map(r=>({id:r.id,name:r.name||r.username||r.id,username:r.username||'',role:r.role||''}));
  return {modelData:{totalShown:items.length,items},entities:items.map(i=>entity('user',i.id,i.name,'/usuarios/'+encodeURIComponent(i.id))),sources:[],context:items.length===1?{lastUserId:items[0].id,lastUserName:items[0].name}:{}};
}

export const directoryRepositoryTools=Object.freeze({search_clients:searchClients,get_client:getClient,search_users:searchUsers});
