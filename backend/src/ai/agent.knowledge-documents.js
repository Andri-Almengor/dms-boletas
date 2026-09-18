import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { driveApi } from '../infra/google.js';
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

async function sourceStream(fileId){
  const response=await driveApi.files.get(
    {fileId,alt:'media',supportsAllDrives:true},
    {responseType:'stream'},
  );
  return response.data;
}

async function convertAndExtract({fileId,mimeType,targetMime,exportMime}){
  let tempId='';
  try{
    const input=await sourceStream(fileId);
    const created=await driveApi.files.create({
      requestBody:{name:`dms-ai-extract-${Date.now()}`,mimeType:targetMime},
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

export async function extractDriveDocumentText({fileId,mimeType}){
  const mime=normalizeMime(mimeType);
  if(!fileId) throw new Error('El documento no tiene referencia de almacenamiento.');
  if(TEXT_MIMES.has(mime)){
    return collectText(await sourceStream(fileId));
  }
  if(SHEET_MIMES.has(mime)){
    return convertAndExtract({
      fileId,mimeType:mime,
      targetMime:'application/vnd.google-apps.spreadsheet',
      exportMime:'text/csv',
    });
  }
  if(DOC_MIMES.has(mime)||IMAGE_MIME.test(mime)){
    return convertAndExtract({
      fileId,mimeType:mime,
      targetMime:'application/vnd.google-apps.document',
      exportMime:'text/plain',
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
    console.warn('[knowledge-document] '+JSON.stringify({event:'index_failed',documentId:id,articleId:article,mimeType:normalizeMime(mimeType),indexingMs:Math.round(performance.now()-startedAt),status:'FAILED'}));
    return {indexed:false,error:clean(error?.message,500)};
  }
}

export async function ensureKnowledgeDocumentIndexed(row,actor=''){
  if(!row||String(row.ExtractionStatus||'').toUpperCase()==='INDEXED') return {indexed:true,existing:true};
  return indexKnowledgeDocument({
    documentId:row.id||row.AdjuntoID,
    articleId:row.articleId||row.TutorialID,
    fileId:row.__file||row.DriveFileID,
    mimeType:row.mimeType||row.MimeType,
    actor,
  });
}

export const KNOWLEDGE_DOCUMENT_POLICY=Object.freeze({
  maxExtractedTextBytes:MAX_EXTRACTED_TEXT_BYTES,
  storesDocumentBinaryInPostgres:false,
  sendsDriveReferenceToModel:false,
});
