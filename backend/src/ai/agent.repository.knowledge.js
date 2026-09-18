import { badRequest, notFound } from '../core/errors.js';
import { appendKnowledgeVisibility, assertAiCapability } from './agent.permissions.js';
import { active, addRange, aliasQuery, clean, entity, like, many, one, pageLimit, protectedAttachment, source } from './agent.repository.shared.js';
import { aiConfig } from './agent.config.js';
import { ensureKnowledgeDocumentIndexed } from './agent.knowledge-documents.js';

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
  const [parts,attachmentRows]=await Promise.all([
    many(`SELECT kc."Parte" AS part,kc."Contenido" AS content FROM "KnowledgeArticleContent" kc WHERE ${active('kc')} AND kc."TutorialID"=$1 ORDER BY kc."Parte" ASC,kc."__db_id" ASC LIMIT 50`,[id],'ai.knowledge.parts'),
    many(`SELECT ka."AdjuntoID" AS id,ka."Nombre" AS name,ka."MimeType" AS "mimeType",ka."Size" AS size,ka."FechaCreacion" AS "createdAt",ka."DriveFileID" AS "__file" FROM "KnowledgeAttachments" ka WHERE ${active('ka')} AND ka."TutorialID"=$1 ORDER BY ka."FechaCreacion" ASC NULLS LAST LIMIT 30`,[id],'ai.knowledge.attachments'),
  ]);
  const text=[row.content,...parts.map(x=>x.content)].filter(Boolean).join('\n').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,16000);
  const item={
    id:row.id,title:row.title||'Artículo',problem:clean(row.problem,2200),content:text,status:row.status||'',
    createdAt:row.createdAt||'',updatedAt:row.updatedAt||'',
    attachments:attachmentRows.map((attachment)=>({
      id:attachment.id,name:attachment.name||'Adjunto',mimeType:attachment.mimeType||'application/octet-stream',
      size:attachment.size||'',createdAt:attachment.createdAt||'',
    })),
  };
  const attachments=attachmentRows.map((attachment)=>protectedAttachment(ctx,{
    fileId:attachment.__file,mimeType:attachment.mimeType,scopeId:'knowledge:'+id,evidenceId:attachment.id,
    kind:'knowledge-attachment',title:attachment.name||'Adjunto de conocimiento',subtitle:item.title,
    entityType:'knowledge',entityId:id,
  })).filter(Boolean);
  return {modelData:item,attachments,entities:[entity('knowledge',item.id,item.title,'/conocimiento/'+encodeURIComponent(item.id))],sources:[source('knowledge',item.id,item.title,'/conocimiento/'+encodeURIComponent(item.id))],context:{lastKnowledgeId:item.id}};
}


async function visibleKnowledgeDocument(ctx, documentId) {
  assertAiCapability(ctx,'knowledge');
  const id=clean(documentId,250); if(!id) throw badRequest('Falta documentId.');
  const params=[id]; const visible=appendKnowledgeVisibility(ctx,params,'a');
  const row=await one(
    `SELECT ka."AdjuntoID" AS id,ka."TutorialID" AS "articleId",ka."Nombre" AS name,
            ka."MimeType" AS "mimeType",ka."Size" AS size,ka."FechaCreacion" AS "createdAt",
            ka."ExtractionStatus" AS "extractionStatus",ka."IndexedAt" AS "indexedAt",
            ka."ExtractionError" AS "extractionError",ka."DriveFileID" AS "__file",
            a."Titulo" AS "articleTitle",a."Estado" AS "articleStatus"
       FROM "KnowledgeAttachments" ka
       JOIN "KnowledgeArticles" a ON a."__valid"=TRUE AND a."TutorialID"=ka."TutorialID"
      WHERE ${active('ka')} AND ka."AdjuntoID"=$1 AND ${visible} LIMIT 1`,
    params,'ai.knowledgeDocuments.get',
  );
  if(!row) throw notFound('No se encontró el documento o no puede consultar su artículo.');
  return row;
}

export async function searchKnowledgeDocuments(ctx,args={}){
  assertAiCapability(ctx,'knowledge');
  if(!aiConfig.knowledgeDocumentsEnabled) return {modelData:{disabled:true,totalShown:0,items:[]}};
  const q=clean(args.query,500); if(!q&&!clean(args.articleId)) throw badRequest('Indique el documento o tema a buscar.');
  const params=[]; const visible=appendKnowledgeVisibility(ctx,params,'a');
  const clauses=[active('ka'),active('a'),visible];
  if(clean(args.articleId)){params.push(clean(args.articleId,250));clauses.push(`ka."TutorialID"=${params.length}`);}
  if(q){
    params.push(like(q)); const p='
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

export const knowledgeRepositoryTools=Object.freeze({
  search_knowledge_base:searchKnowledgeBase,
  get_knowledge_article:getKnowledgeArticle,
  search_knowledge_documents:searchKnowledgeDocuments,
  get_knowledge_document:getKnowledgeDocument,
  search_knowledge_document_chunks:searchKnowledgeDocumentChunks,
  search_cases:searchCases,
  get_case:getCase,
});
+params.length;
    clauses.push(`(
      ka."Nombre" ILIKE ${p} ESCAPE '\\'
      OR COALESCE(ka."SearchText",'') ILIKE ${p} ESCAPE '\\'
      OR a."Titulo" ILIKE ${p} ESCAPE '\\'
      OR a."ProblemaResuelto" ILIKE ${p} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM "KnowledgeDocumentChunks" kdc
         WHERE kdc."__valid"=TRUE AND kdc."DocumentID"=ka."AdjuntoID"
           AND (kdc."Content" ILIKE ${p} ESCAPE '\\' OR kdc."SectionTitle" ILIKE ${p} ESCAPE '\\')
      )
    )`);
  }
  params.push(pageLimit(args.limit,10));
  let rows=await many(
    `SELECT ka."AdjuntoID" AS id,ka."TutorialID" AS "articleId",ka."Nombre" AS name,
            ka."MimeType" AS "mimeType",ka."Size" AS size,ka."FechaCreacion" AS "createdAt",
            ka."ExtractionStatus" AS "extractionStatus",ka."IndexedAt" AS "indexedAt",
            ka."DriveFileID" AS "__file",a."Titulo" AS "articleTitle",a."Estado" AS "articleStatus"
       FROM "KnowledgeAttachments" ka
       JOIN "KnowledgeArticles" a ON a."__valid"=TRUE AND a."TutorialID"=ka."TutorialID"
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE WHEN ka."Nombre" ILIKE ${q?'
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
+(params.length-1):"'%'"} ESCAPE '\\' THEN 0 ELSE 1 END,
               ka."FechaCreacion" DESC NULLS LAST
      LIMIT ${params.length}`,
    params,'ai.knowledgeDocuments.search',
  );

  // Existing manuals predate the chunk index. Index only a tiny relevant set lazily;
  // the upload path indexes new files asynchronously.
  for(const row of rows.slice(0,2)){
    if(!['INDEXED','UNSUPPORTED','EMPTY'].includes(String(row.extractionStatus||'').toUpperCase())){
      await ensureKnowledgeDocumentIndexed(row,ctx.user?.UsuarioID||'').catch(()=>{});
    }
  }
  if(rows.some(row=>!String(row.extractionStatus||''))){
    // Refresh statuses without loading binaries.
    const ids=rows.map(row=>row.id);
    const refreshed=await many(
      `SELECT "AdjuntoID" AS id,"ExtractionStatus" AS "extractionStatus","IndexedAt" AS "indexedAt"
         FROM "KnowledgeAttachments" WHERE "__valid"=TRUE AND "AdjuntoID"=ANY($1::text[])`,
      [ids],'ai.knowledgeDocuments.refresh',
    );
    const byId=new Map(refreshed.map(row=>[row.id,row]));
    rows=rows.map(row=>({...row,...(byId.get(row.id)||{})}));
  }

  const items=rows.map(row=>({
    id:row.id,articleId:row.articleId,name:row.name||'Documento',mimeType:row.mimeType||'application/octet-stream',
    size:row.size||'',createdAt:row.createdAt||'',extractionStatus:row.extractionStatus||'PENDING',
    indexedAt:row.indexedAt||'',articleTitle:row.articleTitle||'Artículo',
  }));
  return {
    modelData:{totalShown:items.length,items},
    entities:items.map(item=>entity('knowledge',item.articleId,item.articleTitle,'/conocimiento/'+encodeURIComponent(item.articleId))),
    sources:items.map(item=>source('knowledge_document',item.id,item.name+' · '+item.articleTitle,'/conocimiento/'+encodeURIComponent(item.articleId))),
    context:items.length===1?{
      lastKnowledgeId:items[0].articleId,lastKnowledgeArticleId:items[0].articleId,
      lastKnowledgeDocumentId:items[0].id,lastKnowledgeDocumentName:items[0].name,
    }:{},
  };
}

export async function getKnowledgeDocument(ctx,args={}){
  const row=await visibleKnowledgeDocument(ctx,args.documentId);
  if(!['INDEXED','UNSUPPORTED','EMPTY'].includes(String(row.extractionStatus||'').toUpperCase())){
    await ensureKnowledgeDocumentIndexed(row,ctx.user?.UsuarioID||'').catch(()=>{});
  }
  const attachment=protectedAttachment(ctx,{
    fileId:row.__file,mimeType:row.mimeType,scopeId:'knowledge:'+row.articleId,evidenceId:row.id,
    kind:'knowledge-document',title:row.name||'Documento',subtitle:row.articleTitle||'Base de Conocimiento',
    entityType:'knowledge',entityId:row.articleId,
  });
  const item={
    id:row.id,articleId:row.articleId,name:row.name||'Documento',mimeType:row.mimeType||'application/octet-stream',
    size:row.size||'',createdAt:row.createdAt||'',extractionStatus:row.extractionStatus||'PENDING',
    indexedAt:row.indexedAt||'',articleTitle:row.articleTitle||'Artículo',
  };
  return {
    modelData:item,
    attachments:attachment?[attachment]:[],
    entities:[entity('knowledge',row.articleId,row.articleTitle||'Artículo','/conocimiento/'+encodeURIComponent(row.articleId))],
    sources:[source('knowledge_document',row.id,(row.name||'Documento')+' · '+(row.articleTitle||''),'/conocimiento/'+encodeURIComponent(row.articleId))],
    context:{lastKnowledgeId:row.articleId,lastKnowledgeArticleId:row.articleId,lastKnowledgeDocumentId:row.id,lastKnowledgeDocumentName:row.name||''},
  };
}

export async function searchKnowledgeDocumentChunks(ctx,args={}){
  assertAiCapability(ctx,'knowledge');
  if(!aiConfig.knowledgeDocumentsEnabled) return {modelData:{disabled:true,totalShown:0,items:[]}};
  const q=clean(args.query,1000); if(!q) throw badRequest('Indique el texto o tema a buscar dentro de los documentos.');
  let document=null;
  if(clean(args.documentId)){
    document=await visibleKnowledgeDocument(ctx,args.documentId);
    if(String(document.extractionStatus||'').toUpperCase()!=='INDEXED'){
      await ensureKnowledgeDocumentIndexed(document,ctx.user?.UsuarioID||'').catch(()=>{});
    }
  }
  const params=[]; const visible=appendKnowledgeVisibility(ctx,params,'a');
  const clauses=['k."__valid"=TRUE',active('ka'),active('a'),visible];
  if(document){params.push(document.id);clauses.push(`k."DocumentID"=${params.length}`);}
  else if(clean(args.articleId)){params.push(clean(args.articleId,250));clauses.push(`k."ArticleID"=${params.length}`);}
  params.push(q);const qp='
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
+params.length;
  clauses.push(`(
    to_tsvector('simple',COALESCE(k."SearchText",'')||' '||COALESCE(k."Content",'')) @@ plainto_tsquery('simple',${qp})
    OR k."Content" ILIKE ('%'||${qp}||'%')
    OR k."SectionTitle" ILIKE ('%'||${qp}||'%')
  )`);
  const max=Math.min(aiConfig.knowledgeMaxChunks,pageLimit(args.limit,aiConfig.knowledgeMaxChunks));params.push(max);
  const rows=await many(
    `SELECT k."ChunkID" AS id,k."DocumentID" AS "documentId",k."ArticleID" AS "articleId",
            k."ChunkIndex" AS "chunkIndex",k."PageNumber" AS "pageNumber",k."SectionTitle" AS "sectionTitle",
            k."Content" AS content,ka."Nombre" AS "documentName",ka."MimeType" AS "mimeType",a."Titulo" AS "articleTitle"
       FROM "KnowledgeDocumentChunks" k
       JOIN "KnowledgeAttachments" ka ON ka."AdjuntoID"=k."DocumentID"
       JOIN "KnowledgeArticles" a ON a."TutorialID"=k."ArticleID"
      WHERE ${clauses.join(' AND ')}
      ORDER BY ts_rank(
        to_tsvector('simple',COALESCE(k."SearchText",'')||' '||COALESCE(k."Content",'')),
        plainto_tsquery('simple',${qp})
      ) DESC,k."ChunkIndex" ASC
      LIMIT ${params.length}`,
    params,'ai.knowledgeChunks.search',
  );
  const items=rows.map(row=>({
    id:row.id,documentId:row.documentId,articleId:row.articleId,chunkIndex:Number(row.chunkIndex||0),
    pageNumber:row.pageNumber===null||row.pageNumber===undefined||row.pageNumber===''?null:Number(row.pageNumber),
    sectionTitle:row.sectionTitle||'',content:clean(row.content,aiConfig.knowledgeMaxChunkBytes),
    documentName:row.documentName||'Documento',articleTitle:row.articleTitle||'Artículo',mimeType:row.mimeType||'',
  }));
  return {
    modelData:{totalShown:items.length,query:q,items},
    entities:items.slice(0,1).map(item=>entity('knowledge',item.articleId,item.articleTitle,'/conocimiento/'+encodeURIComponent(item.articleId))),
    sources:items.map(item=>source(
      'knowledge_document_chunk',item.id,
      item.documentName+(item.pageNumber!==null?' · Página '+item.pageNumber:'')+(item.sectionTitle?' · '+item.sectionTitle:''),
      '/conocimiento/'+encodeURIComponent(item.articleId),
    )),
    context:items.length?{
      lastKnowledgeId:items[0].articleId,lastKnowledgeArticleId:items[0].articleId,
      lastKnowledgeDocumentId:items[0].documentId,lastKnowledgeDocumentName:items[0].documentName,
    }:{},
  };
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
