import { assertAiCapability } from './agent.permissions.js';
import { addRange, clean, entity, like, many, pageLimit, pageOffset, source } from './agent.repository.shared.js';

function isAdmin(ctx){return ctx.permissions?.includes('USUARIOS_GESTIONAR');}

export async function searchAgenda(ctx,args={}){
  // Agenda is available to authenticated users. Non-admins are forcibly scoped to themselves.
  const params=[];const clauses=['a."__valid"=TRUE'];
  const requestedUser=clean(args.technicianId,250);
  if(isAdmin(ctx)&&requestedUser){
    params.push(requestedUser);
    clauses.push(`EXISTS(SELECT 1 FROM "AgendaAsignados" aa WHERE aa."__valid"=TRUE AND LOWER(COALESCE(aa."Activo",'true'))<>'false' AND aa."AgendaID"=a."AgendaID" AND aa."UsuarioID"=$${params.length})`);
  }else if(!isAdmin(ctx)){
    params.push(clean(ctx.user?.UsuarioID,250));
    clauses.push(`EXISTS(SELECT 1 FROM "AgendaAsignados" aa WHERE aa."__valid"=TRUE AND LOWER(COALESCE(aa."Activo",'true'))<>'false' AND aa."AgendaID"=a."AgendaID" AND aa."UsuarioID"=$${params.length})`);
  }
  if(clean(args.query)){
    params.push(like(args.query));const p='$'+params.length;
    clauses.push(`(a."Detalle" ILIKE ${p} ESCAPE '\\' OR a."ClienteNombre" ILIKE ${p} ESCAPE '\\')`);
  }
  if(clean(args.status)){params.push(clean(args.status,60).toUpperCase());clauses.push(`UPPER(COALESCE(a."Estado",''))=$${params.length}`);}
  const period=addRange(clauses,params,'a."Fecha"',args);
  const countParams=[...params];
  const queryParams=[...params,pageLimit(args.limit,30),pageOffset(args.offset)];
  const counted=(await many(`SELECT COUNT(*)::bigint AS total FROM "Agendas" a WHERE ${clauses.join(' AND ')}`,countParams,'ai.agenda.count'))[0];
  const rows=await many(
    `SELECT a."AgendaID" AS id,a."Fecha" AS date,a."HoraInicio" AS "startTime",a."HoraFin" AS "endTime",
            a."Detalle" AS detail,a."Estado" AS status,a."ClienteID" AS "clientId",a."ClienteNombre" AS client,
            a."RequiereBoleta" AS "requiresTicket",a."BoletaUID" AS "ticketId",
            STRING_AGG(DISTINCT COALESCE(NULLIF(u."NombreCompleto",''),u."NombreUsuario"),', ') FILTER(WHERE u."UsuarioID" IS NOT NULL) AS technicians
       FROM "Agendas" a
       LEFT JOIN "AgendaAsignados" aa ON aa."__valid"=TRUE AND LOWER(COALESCE(aa."Activo",'true'))<>'false' AND aa."AgendaID"=a."AgendaID"
       LEFT JOIN "Usuarios" u ON u."__valid"=TRUE AND u."UsuarioID"=aa."UsuarioID"
      WHERE ${clauses.join(' AND ')}
      GROUP BY a."AgendaID",a."Fecha",a."HoraInicio",a."HoraFin",a."Detalle",a."Estado",a."ClienteID",a."ClienteNombre",a."RequiereBoleta",a."BoletaUID",a."__db_id"
      ORDER BY a."Fecha" DESC NULLS LAST,a."HoraInicio" DESC NULLS LAST,a."__db_id" DESC
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,'ai.agenda.items');
  const items=rows.map(row=>({
    id:row.id,date:row.date||'',startTime:row.startTime||'',endTime:row.endTime||'',detail:clean(row.detail,2000),
    status:row.status||'',clientId:row.clientId||'',client:row.client||'',requiresTicket:row.requiresTicket||'',
    ticketId:row.ticketId||'',technicians:row.technicians||'',
  }));
  return {
    modelData:{total:Number(counted?.total||0),totalShown:items.length,period,items},
    entities:items.map(item=>entity('agenda',item.id,(item.date||'Agenda')+' · '+(item.client||item.detail||''),'/agenda?month='+encodeURIComponent(String(item.date||'').slice(0,7))+'&agendaId='+encodeURIComponent(item.id))),
    sources:items.slice(0,10).map(item=>source('agenda',item.id,(item.date||'Agenda')+' · '+(item.client||item.detail||''),'/agenda?month='+encodeURIComponent(String(item.date||'').slice(0,7))+'&agendaId='+encodeURIComponent(item.id))),
    context:{lastIntent:'agenda_search'},
  };
}

export const agendaRepositoryTools=Object.freeze({search_agenda:searchAgenda});
