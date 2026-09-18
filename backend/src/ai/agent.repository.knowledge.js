import { badRequest, notFound } from '../core/errors.js';
import { appendKnowledgeVisibility, assertAiCapability } from './agent.permissions.js';
import { active, addRange, aliasQuery, clean, entity, like, many, one, pageLimit, source } from './agent.repository.shared.js';

export async function searchKnowledgeBase(ctx,args={}){
  assertAiCapability(ctx,'knowledge');
  const q=clean(args.query,500); if(!q) throw badRequest('Indique el tema a buscar en la base de conocimiento.');
  const params=[];const visible=appendKnowledgeVisibility(ctx,params,'a');params.push(like(q));const p='$'+params.length;params.push(pageLimit(args.limit,10));
  const rows=await many(`SELECT a."TutorialID" AS id,a."Titulo" AS title,a."ProblemaResuelto" AS problem,a."Estado" AS status,a."FechaActualizacion" AS "updatedAt",LEFT(COALESCE(NULLIF(a."ContenidoHTML",''),''),5000) AS content FROM "KnowledgeArticles" a WHERE ${active('a')} AND ${visible} AND (a."Titulo" ILIKE ${p} ESCAPE '\\' OR a."ProblemaResuelto" ILIKE ${p} ESCAPE '\\' OR a."ContenidoHTML" ILIKE ${p} ESCAPE '\\' OR EXISTS(SELECT 1 FROM "KnowledgeArticleContent" kc WHERE ${active('kc')} AND kc."TutorialID"=a."TutorialID" AND kc."Contenido" ILIKE ${p} ESCAPE '\\')) ORDER BY a."FechaActualizacion" DESC NULLS LAST,a."Titulo" ASC LIMIT $${params.length}`,params,'ai.knowledge.search');
  const items=rows.map(r=>({id:r.id,title:r.title||'Artículo',problem:clean(r.problem,1600),status:r.status||'',updatedAt:r.updatedAt||'',excerpt:clean(String(r.content||'').replace(/<[^>]+>/g,' '),2600)}));
  return {modelData:{totalShown:items.length,items},entities:items.map(i=>entity('knowledge',i.id,i.title,'/conocimiento/'+encodeURIComponent(i.id))),sources:items.map(i=>source('knowledge',i.id,i.title,'/conocimiento/'+encodeURIComponent(i.id))),context:items.length===1?{lastKnowledgeId:items[0].id}:{}};
}

export async function getKnowledgeArticle(ctx,args={}){
  assertAiCapability(ctx,'knowledge');
  const id=clean(args.articleId,250);if(!id) throw badRequest('Falta articleId.');
  const params=[id];const visible=appendKnowledgeVisibility(ctx,params,'a');
  const row=await one(`SELECT a."TutorialID" AS id,a."Titulo" AS title,a."ProblemaResuelto" AS problem,a."ContenidoHTML" AS content,a."Estado" AS status,a."FechaCreacion" AS "createdAt",a."FechaActualizacion" AS "updatedAt" FROM "KnowledgeArticles" a WHERE ${active('a')} AND a."TutorialID"=$1 AND ${visible} LIMIT 1`,params,'ai.knowledge.get');
  if(!row) throw notFound('No se encontró el artículo o no puede consultar ese borrador.');
  const parts=await many(`SELECT kc."Parte" AS part,kc."Contenido" AS content FROM "KnowledgeArticleContent" kc WHERE ${active('kc')} AND kc."TutorialID"=$1 ORDER BY kc."Parte" ASC,kc."__db_id" ASC LIMIT 50`,[id],'ai.knowledge.parts');
  const text=[row.content,...parts.map(x=>x.content)].filter(Boolean).join('\n').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,16000);
  const item={id:row.id,title:row.title||'Artículo',problem:clean(row.problem,2200),content:text,status:row.status||'',createdAt:row.createdAt||'',updatedAt:row.updatedAt||''};
  return {modelData:item,entities:[entity('knowledge',item.id,item.title,'/conocimiento/'+encodeURIComponent(item.id))],sources:[source('knowledge',item.id,item.title,'/conocimiento/'+encodeURIComponent(item.id))],context:{lastKnowledgeId:item.id}};
}

export async function searchCases(ctx,args={}){
  assertAiCapability(ctx,'cases');
  const params=[];const clauses=[active('c')];const q=aliasQuery(args.query);
  if(q){params.push(like(q));const p='$'+params.length;clauses.push(`(c."CasoNumero" ILIKE ${p} ESCAPE '\\' OR c."Cliente" ILIKE ${p} ESCAPE '\\' OR c."RazonVisita" ILIKE ${p} ESCAPE '\\' OR c."Problema" ILIKE ${p} ESCAPE '\\' OR c."TecnicoNombres" ILIKE ${p} ESCAPE '\\')`);}
  if(clean(args.status)){params.push(clean(args.status,50).toUpperCase().replace(/\s+/g,'_'));clauses.push(`UPPER(REPLACE(COALESCE(c."Estado",''),' ','_'))=$${params.length}`);}
  addRange(clauses,params,'c."FechaCreacion"',args);params.push(pageLimit(args.limit,20));
  const rows=await many(`SELECT c."CasoID" AS id,c."CasoNumero" AS number,c."ClienteID" AS "clientId",c."Cliente" AS client,c."RazonVisita" AS reason,c."Problema" AS problem,c."Estado" AS status,c."TecnicoNombres" AS technicians,c."FechaVisita" AS "visitDate",c."BoletaUID" AS "ticketId",c."BoletaID" AS "ticketNumber",c."FechaCreacion" AS "createdAt",c."FechaFinalizacion" AS "finishedAt",c."EvidenciaCount" AS "evidenceCount" FROM "CasosClientes" c WHERE ${clauses.join(' AND ')} ORDER BY c."FechaCreacion" DESC NULLS LAST LIMIT $${params.length}`,params,'ai.cases.search');
  const items=rows.map(r=>({id:r.id,number:r.number||r.id,clientId:r.clientId||'',client:r.client||'',reason:clean(r.reason,1600),problem:clean(r.problem,2200),status:r.status||'',technicians:r.technicians||'',visitDate:r.visitDate||'',ticketId:r.ticketId||'',ticketNumber:r.ticketNumber||'',createdAt:r.createdAt||'',finishedAt:r.finishedAt||'',evidenceCount:Number(r.evidenceCount||0)}));
  return {modelData:{totalShown:items.length,items},entities:items.map(i=>entity('case',i.id,'Caso '+i.number,'/casos/'+encodeURIComponent(i.id))),sources:items.slice(0,8).map(i=>source('case',i.id,'Caso '+i.number+' · '+i.client,'/casos/'+encodeURIComponent(i.id))),context:items.length===1?{lastCaseId:items[0].id,lastClientId:items[0].clientId,lastClientName:items[0].client}:{}};
}

export async function getCase(ctx,args={}){
  assertAiCapability(ctx,'cases');
  const id=clean(args.caseId,250);if(!id) throw badRequest('Falta caseId.');
  const row=await one(`SELECT c."CasoID" AS id,c."CasoNumero" AS number,c."ClienteID" AS "clientId",c."Cliente" AS client,c."RazonVisita" AS reason,c."Problema" AS problem,c."Estado" AS status,c."TecnicoNombres" AS technicians,c."FechaVisita" AS "visitDate",c."HoraVisita" AS "visitTime",c."MensajeAdministrador" AS "adminMessage",c."BoletaUID" AS "ticketId",c."BoletaID" AS "ticketNumber",c."FechaProceso" AS "processedAt",c."FechaFinalizacion" AS "finishedAt",c."FechaCreacion" AS "createdAt",c."FechaActualizacion" AS "updatedAt",c."EvidenciaCount" AS "evidenceCount" FROM "CasosClientes" c WHERE ${active('c')} AND c."CasoID"=$1 LIMIT 1`,[id],'ai.cases.get');
  if(!row) throw notFound('No se encontró el caso solicitado.');
  const item={...row,reason:clean(row.reason,2200),problem:clean(row.problem,4200),adminMessage:clean(row.adminMessage,2200),evidenceCount:Number(row.evidenceCount||0)};
  return {modelData:item,entities:[entity('case',item.id,'Caso '+(item.number||item.id),'/casos/'+encodeURIComponent(item.id))],sources:[source('case',item.id,'Caso '+(item.number||item.id)+' · '+(item.client||''),'/casos/'+encodeURIComponent(item.id))],context:{lastCaseId:item.id,lastClientId:item.clientId||'',lastClientName:item.client||'',...(item.ticketId?{lastTicketId:item.ticketId,lastTicketNumber:item.ticketNumber||''}:{})}};
}

export const knowledgeRepositoryTools=Object.freeze({search_knowledge_base:searchKnowledgeBase,get_knowledge_article:getKnowledgeArticle,search_cases:searchCases,get_case:getCase});
