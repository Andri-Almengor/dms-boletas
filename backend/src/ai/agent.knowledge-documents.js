import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { query, withTransaction } from '../infra/postgres.js';
import { nowIso, uuid } from '../core/utils.js';
import { aiConfig } from './agent.config.js';

const TEXT_MIMES=new Set([
  'text/plain','text/csv','text/tab-separated-values','text/markdown','application/csv',
]);
const DOC_MIMES=new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/rtf',
]);
const SHEET_MIMES=new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
]);
const IMAGE_MIME=/^image\//i;
const MAX_EXTRACTED_TEXT_BYTES=2_000_000;

function clean(value,max=4000){return String(value??'').trim().slice(0,max);}
function normalizeMime(value){return clean(value,180).toLowerCase().split(';')[0];}

async function collectText(stream,maxBytes=MAX_EXTRACTED_TEXT_BYTES){
  let total=0; const chunks=[];
  for await(const part of stream){
    const buffer=Buffer.isBuffer(part)?part:Buffer.from(part);
    if(total>=maxBytes) break;
    const keep=buffer.subarray(0,Math.max(0,maxBytes-total));
    if(keep.length){chunks.push(keep);total+=keep.length;}
  }
  return Buffer.concat(chunks,total).toString('utf8').replace(/\u0000/g,'');
}

async function driveClient(){
  const module=await import('../infra/google.js');
  return module.driveApi;
}

async function sourceStream(fileId,driveApiOverride=null){
  const driveApi=driveApiOverride||await driveClient();
  const response=await driveApi.files.get(
    {fileId,alt:'media',supportsAllDrives:true},
    {responseType:'stream'},
  );
  return response.data;
}

async function sourceParents(fileId,driveApiOverride=null){
  const driveApi=driveApiOverride||await driveClient();
  try{
    const response=await driveApi.files.get({
      fileId,
      fields:'parents',
      supportsAllDrives:true,
    });
    return Array.isArray(response?.data?.parents)
      ? response.data.parents.map(value=>clean(value,300)).filter(Boolean).slice(0,1)
      : [];
  }catch{
    // Descargar el archivo sigue siendo suficiente para intentar la extracción.
    // La ausencia de metadata de parents no debe convertir por sí sola el documento en FAILED.
    return [];
  }
}

async function convertAndExtract({fileId,mimeType,targetMime,exportMime,driveApi:driveApiOverride=null}){
  const driveApi=driveApiOverride||await driveClient();
  let tempId='';
  try{
    const [input,sourceParentIds]=await Promise.all([
      sourceStream(fileId,driveApi),
      sourceParents(fileId,driveApi),
    ]);
    const created=await driveApi.files.create({
      requestBody:{
        name:`dms-ai-extract-${Date.now()}`,
        mimeType:targetMime,
        parents:sourceParentIds.length?sourceParentIds:undefined,
      },
      media:{mimeType,body:input},
      fields:'id',
      supportsAllDrives:true,
    });
    tempId=clean(created?.data?.id,300);
    if(!tempId) throw new Error('Drive no pudo crear el documento temporal de extracción.');
    const exported=await driveApi.files.export({fileId:tempId,mimeType:exportMime},{responseType:'stream'});
    return collectText(exported.data);
  }finally{
    if(tempId) await driveApi.files.update({fileId:tempId,requestBody:{trashed:true},supportsAllDrives:true}).catch(()=>{});
  }
}

export function supportsKnowledgeExtraction(mimeType){
  const mime=normalizeMime(mimeType);
  return TEXT_MIMES.has(mime)||DOC_MIMES.has(mime)||SHEET_MIMES.has(mime)||IMAGE_MIME.test(mime);
}

export async function extractDriveDocumentText({fileId,mimeType,driveApi:driveApiOverride=null}){
  const mime=normalizeMime(mimeType);
  if(!fileId) throw new Error('El documento no tiene referencia de almacenamiento.');
  if(TEXT_MIMES.has(mime)){
    return collectText(await sourceStream(fileId,driveApiOverride));
  }
  if(SHEET_MIMES.has(mime)){
    return convertAndExtract({
      fileId,mimeType:mime,
      targetMime:'application/vnd.google-apps.spreadsheet',
      exportMime:'text/csv',
      driveApi:driveApiOverride,
    });
  }
  if(DOC_MIMES.has(mime)||IMAGE_MIME.test(mime)){
    return convertAndExtract({
      fileId,mimeType:mime,
      targetMime:'application/vnd.google-apps.document',
      exportMime:'text/plain',
      driveApi:driveApiOverride,
    });
  }
  throw new Error('El formato del documento todavía no admite extracción de texto.');
}

function paragraphBlocks(raw=''){
  return String(raw||'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .split(/\n{2,}/)
    .map(value=>value.replace(/\s*\n\s*/g,' ').replace(/\s+/g,' ').trim())
    .filter(Boolean);
}

function likelyHeading(value){
  const text=clean(value,240);
  if(!text||text.length>120) return '';
  if(/^\d+(?:\.\d+)*\s+\S+/.test(text)) return text;
  if(/^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 .:()\/_-]{4,}$/.test(text)) return text;
  if(/^(cap[ií]tulo|secci[oó]n|parte|anexo)\b/i.test(text)) return text;
  return '';
}

export function chunkKnowledgeText(raw,{maxBytes=aiConfig.knowledgeMaxChunkBytes}={}){
  const blocks=paragraphBlocks(raw);
  const chunks=[]; let current=[]; let bytes=0; let section='';
  const limit=Math.max(2000,Number(maxBytes)||12000);

  const flush=()=>{
    const content=current.join('\n\n').trim();
    if(content) chunks.push({content,sectionTitle:section||''});
    const overlap=current.length?current.slice(-1):[];
    current=overlap;
    bytes=Buffer.byteLength(overlap.join('\n\n'),'utf8');
  };

  for(const block of blocks){
    const heading=likelyHeading(block);
    if(heading) section=heading;
    const blockBytes=Buffer.byteLength(block,'utf8');
    if(current.length&&bytes+blockBytes+2>limit) flush();
    if(blockBytes>limit){
      const chars=Math.max(1000,Math.floor(limit/2));
      for(let i=0;i<block.length;i+=chars){
        const piece=block.slice(i,i+chars).trim();
        if(piece){
          if(current.length&&Buffer.byteLength(current.join('\n\n')+'\n\n'+piece,'utf8')>limit) flush();
          current.push(piece);bytes=Buffer.byteLength(current.join('\n\n'),'utf8');
        }
      }
    }else{
      current.push(block);bytes+=blockBytes+2;
    }
  }
  if(current.length){
    const content=current.join('\n\n').trim();
    if(content&&!chunks.some(item=>item.content===content)) chunks.push({content,sectionTitle:section||''});
  }
  return chunks.map((item,index)=>({...item,chunkIndex:index,pageNumber:null}));
}

async function updateAttachment(documentId,patch){
  const fields=Object.entries(patch);
  if(!fields.length)return;
  const params=[documentId]; const sets=[];
  for(const [key,value] of fields){params.push(value);sets.push(`"${key}"=$${params.length}`);}
  await query(`UPDATE "KnowledgeAttachments" SET ${sets.join(', ')} WHERE "__valid"=TRUE AND "AdjuntoID"=$1`,params,{label:'ai.knowledgeDocument.update',write:true});
}

export async function indexKnowledgeDocument(input = {}, actorOverride = '') {
  if(!aiConfig.knowledgeDocumentsEnabled) return {indexed:false,disabled:true};
  const documentId=input.documentId||input.AdjuntoID||input.id;
  const articleId=input.articleId||input.TutorialID;
  const fileId=input.fileId||input.DriveFileID||input.__file;
  const mimeType=input.mimeType||input.MimeType;
  const actor=input.actor||actorOverride||input.ActualizadoPor||input.CreadoPor||'';
  const startedAt=performance.now();
  const id=clean(documentId,250); const article=clean(articleId,250);
  if(!id||!article||!fileId) return {indexed:false,skipped:true};
  if(!supportsKnowledgeExtraction(mimeType)){
    await updateAttachment(id,{ExtractionStatus:'UNSUPPORTED',Status:'UNSUPPORTED',ExtractionError:'Formato sin extracción de texto.',FechaActualizacion:nowIso(),ActualizadoPor:actor});
    return {indexed:false,unsupported:true};
  }
  await updateAttachment(id,{ExtractionStatus:'PROCESSING',Status:'PROCESSING',ExtractionError:'',FechaActualizacion:nowIso(),ActualizadoPor:actor});
  try{
    const extractionStartedAt=performance.now();
    const raw=await extractDriveDocumentText({fileId,mimeType});
    const extractionMs=Math.round(performance.now()-extractionStartedAt);
    const normalized=String(raw||'').replace(/\s+/g,' ').trim();
    const chunks=chunkKnowledgeText(raw);
    const indexedAt=nowIso();
    await withTransaction(async()=>{
      await query('UPDATE "KnowledgeDocumentChunks" SET "__valid"=FALSE WHERE "DocumentID"=$1 AND "__valid"=TRUE',[id],{label:'ai.knowledgeChunks.deactivate',write:true});
      for(const chunk of chunks){
        await query(
          `INSERT INTO "KnowledgeDocumentChunks"
            ("ChunkID","DocumentID","ArticleID","ChunkIndex","PageNumber","SectionTitle","Content","SearchText","CreatedAt","__valid")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
          [uuid(),id,article,chunk.chunkIndex,chunk.pageNumber,chunk.sectionTitle,chunk.content,chunk.content,indexedAt],
          {label:'ai.knowledgeChunks.insert',write:true},
        );
      }
      await updateAttachment(id,{
        ExtractionStatus:chunks.length?'INDEXED':'EMPTY',
        Status:chunks.length?'READY':'READY',
        IndexedAt:indexedAt,
        ExtractionError:'',
        SearchText:clean(normalized,120000),
        FechaActualizacion:indexedAt,
        ActualizadoPor:actor,
      });
    });
    console.info('[knowledge-document] '+JSON.stringify({event:'indexed',documentId:id,articleId:article,mimeType:normalizeMime(mimeType),extractionMs,indexingMs:Math.max(0,Math.round(performance.now()-startedAt)-extractionMs),chunkCount:chunks.length,status:chunks.length?'READY':'READY'}));
    return {indexed:true,chunks:chunks.length,indexedAt,extractionMs};
  }catch(error){
    await updateAttachment(id,{
      ExtractionStatus:'FAILED',
      Status:'FAILED',
      ExtractionError:clean(error?.message||'No se pudo extraer el documento.',800),
      FechaActualizacion:nowIso(),
      ActualizadoPor:actor,
    }).catch(()=>{});
    const errorStatus=Number(error?.response?.status||error?.status||0)||undefined;
    const errorCode=clean(error?.response?.data?.error?.status||error?.code||error?.name||'EXTRACTION_ERROR',80);
    const errorReason=clean(error?.message||'No se pudo extraer el documento.',240)
      .replace(/[A-Za-z0-9_-]{20,}/g,'[redacted]');
    console.warn('[knowledge-document] '+JSON.stringify({
      event:'index_failed',
      documentId:id,
      articleId:article,
      mimeType:normalizeMime(mimeType),
      indexingMs:Math.round(performance.now()-startedAt),
      status:'FAILED',
      errorStatus,
      errorCode,
      errorReason,
    }));
    return {indexed:false,error:clean(error?.message,500)};
  }
}

const KNOWLEDGE_INDEX_QUEUE=[];
const KNOWLEDGE_INDEX_QUEUED=new Set();
const KNOWLEDGE_FAILED_RETRY_ATTEMPTED=new Set();
let knowledgeIndexQueueRunning=false;
let knowledgeRecoveryTimer=null;

function indexingPayload(row={},actor=''){
  return {
    documentId:clean(row.id||row.AdjuntoID,250),
    articleId:clean(row.articleId||row.TutorialID,250),
    fileId:row.__file||row.DriveFileID||'',
    mimeType:row.mimeType||row.MimeType||'',
    actor:actor||row.actor||row.ActualizadoPor||row.CreadoPor||'',
  };
}

async function drainKnowledgeIndexQueue(){
  if(knowledgeIndexQueueRunning)return;
  knowledgeIndexQueueRunning=true;
  try{
    while(KNOWLEDGE_INDEX_QUEUE.length){
      const task=KNOWLEDGE_INDEX_QUEUE.shift();
      try{
        await indexKnowledgeDocument(task.payload);
      }catch(error){
        console.warn('[ai-knowledge] '+JSON.stringify({
          event:'knowledge_document_search_failed',
          documentId:task.payload.documentId,
          articleId:task.payload.articleId,
          reason:clean(error?.code||error?.name||'INDEX_ERROR',80),
        }));
      }finally{
        KNOWLEDGE_INDEX_QUEUED.delete(task.payload.documentId);
      }
    }
  }finally{
    knowledgeIndexQueueRunning=false;
  }
}

export function queueKnowledgeDocumentIndexing(row,actor='',options={}){
  if(!aiConfig.knowledgeDocumentsEnabled||!row)return false;
  const status=String(row.ExtractionStatus||row.extractionStatus||'').toUpperCase();
  const payload=indexingPayload(row,actor);
  if(!payload.documentId||!payload.articleId||!payload.fileId)return false;
  if(['INDEXED','UNSUPPORTED','EMPTY'].includes(status))return false;
  if(status==='FAILED'){
    if(!options.retryFailed||KNOWLEDGE_FAILED_RETRY_ATTEMPTED.has(payload.documentId))return false;
    KNOWLEDGE_FAILED_RETRY_ATTEMPTED.add(payload.documentId);
  }
  if(KNOWLEDGE_INDEX_QUEUED.has(payload.documentId))return true;
  KNOWLEDGE_INDEX_QUEUED.add(payload.documentId);
  KNOWLEDGE_INDEX_QUEUE.push({payload});
  queueMicrotask(()=>{void drainKnowledgeIndexQueue();});
  return true;
}

export async function recoverKnowledgeDocumentIndexing({limit=aiConfig.knowledgeRecoveryBatch}={}){
  if(!aiConfig.knowledgeDocumentsEnabled)return {queued:0,disabled:true};
  const safeLimit=Math.min(5,Math.max(1,Number(limit)||2));
  const result=await query(
    `SELECT "AdjuntoID","TutorialID","DriveFileID","MimeType","ExtractionStatus","ActualizadoPor","CreadoPor"
       FROM "KnowledgeAttachments"
      WHERE "__valid"=TRUE
        AND LOWER(COALESCE("Activo",'true')) <> 'false'
        AND UPPER(COALESCE("ExtractionStatus",'UPLOADED')) IN ('UPLOADED','PROCESSING','FAILED')
      ORDER BY CASE WHEN UPPER(COALESCE("ExtractionStatus",'UPLOADED'))='FAILED' THEN 1 ELSE 0 END,
               "FechaActualizacion" ASC NULLS FIRST,"FechaCreacion" ASC NULLS FIRST
      LIMIT $1`,
    [safeLimit],
    {label:'ai.knowledgeDocuments.recover'},
  );
  let queued=0;
  for(const row of result.rows){
    const status=String(row.ExtractionStatus||'').toUpperCase();
    if(queueKnowledgeDocumentIndexing(
      row,
      row.ActualizadoPor||row.CreadoPor||'',
      {retryFailed:status==='FAILED'},
    ))queued+=1;
  }
  if(result.rows.length){
    console.info('[ai-knowledge] '+JSON.stringify({
      event:'knowledge_document_recovery_scan',
      candidates:result.rows.length,
      queued,
    }));
  }
  return {queued,candidates:result.rows.length};
}

export function startKnowledgeDocumentRecoveryScheduler(){
  if(knowledgeRecoveryTimer||!aiConfig.knowledgeDocumentsEnabled)return;
  const run=()=>recoverKnowledgeDocumentIndexing().catch((error)=>{
    console.warn('[ai-knowledge] '+JSON.stringify({
      event:'knowledge_document_recovery_failed',
      reason:clean(error?.code||error?.name||'RECOVERY_ERROR',80),
    }));
  });
  const first=setTimeout(run,2_000);first.unref?.();
  knowledgeRecoveryTimer=setInterval(run,aiConfig.knowledgeRecoveryIntervalMs);
  knowledgeRecoveryTimer.unref?.();
}

export function stopKnowledgeDocumentRecoveryScheduler(){
  if(knowledgeRecoveryTimer)clearInterval(knowledgeRecoveryTimer);
  knowledgeRecoveryTimer=null;
}

export async function ensureKnowledgeDocumentIndexed(row,actor=''){
  if(!row||String(row.ExtractionStatus||row.extractionStatus||'').toUpperCase()==='INDEXED') return {indexed:true,existing:true};
  return indexKnowledgeDocument(indexingPayload(row,actor));
}

export const KNOWLEDGE_DOCUMENT_POLICY=Object.freeze({
  maxExtractedTextBytes:MAX_EXTRACTED_TEXT_BYTES,
  storesDocumentBinaryInPostgres:false,
  sendsDriveReferenceToModel:false,
});
