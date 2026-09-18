import { performance } from 'node:perf_hooks';
import { syncUnloggedRevision } from '../core/sync-write-observer.js';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { query, withTransaction } from '../infra/postgres.js';
import { mutationIdFrom, SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

export const SYNC_SHEET = 'SyncChanges';
export const SYNC_SCHEMA_VERSION = Math.max(2, Number(env.syncSchemaVersion || 2));
export const SYNC_CHANGE_HEADERS = Object.freeze(['ChangeID','Resource','EntityID','Operation','ParentID','ChangedAt','ActorUserID','SourceRoute','MutationID','SchemaVersion','Metadata']);
const MAX_METADATA_CHARS = 1200;
let cachedDescriptor = null;
let unsafeReason = '';

function clean(value,maxLength=240){return String(value??'').trim().slice(0,maxLength);}
export function sanitizeSyncMetadata(metadata=null){
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return '';
  const blocked=/(password|token|secret|base64|blob|file|image|video|firma|signature|webhook|private)/i; const sanitized={};
  for(const [key,value] of Object.entries(metadata)){if(blocked.test(String(key)))continue;if(value===null||['string','number','boolean'].includes(typeof value))sanitized[clean(key,80)]=typeof value==='string'?clean(value,240):value;}
  const serialized=JSON.stringify(sanitized); return serialized.length<=MAX_METADATA_CHARS?serialized:JSON.stringify({truncated:true});
}

export async function ensureSyncInfrastructure(){
  if(!env.incrementalSyncEnabled)return {enabled:false};
  await query(`INSERT INTO sync_state(singleton,generation,schema_version,unsafe,unsafe_reason) VALUES(TRUE,$1,$2,FALSE,'') ON CONFLICT(singleton) DO NOTHING`,[uuid(),SYNC_SCHEMA_VERSION],{label:'sync.ensure',write:true});
  const state=await query('SELECT generation,schema_version,unsafe,unsafe_reason FROM sync_state WHERE singleton=TRUE',[],{label:'sync.state'});
  const row=state.rows[0];
  if(!row)throw new AppError('SYNC_STATE_MISSING','No se pudo inicializar la sincronización incremental.',503);
  if(Number(row.schema_version)!==SYNC_SCHEMA_VERSION){
    await query('UPDATE sync_state SET generation=$1,schema_version=$2,unsafe=FALSE,unsafe_reason=\'\',updated_at=NOW() WHERE singleton=TRUE',[uuid(),SYNC_SCHEMA_VERSION],{label:'sync.schema.rotate',write:true});
  }
  return {enabled:true};
}

function descriptorWithWriteRevision(descriptor){return {...descriptor,generation:`${descriptor.generation}:r${syncUnloggedRevision()}`};}
export async function getSyncDescriptor({force=false}={}){
  if(!env.incrementalSyncEnabled)return {enabled:false,generation:'',schemaVersion:SYNC_SCHEMA_VERSION,unsafe:false,unsafeReason:''};
  if(!force&&cachedDescriptor)return descriptorWithWriteRevision({...cachedDescriptor,unsafe:Boolean(unsafeReason),unsafeReason});
  await ensureSyncInfrastructure();
  const result=await query('SELECT generation,schema_version,unsafe,unsafe_reason FROM sync_state WHERE singleton=TRUE',[],{label:'sync.descriptor'});
  const row=result.rows[0]; unsafeReason=clean(row?.unsafe_reason,600);
  cachedDescriptor={enabled:true,generation:clean(row?.generation,200),schemaVersion:Number(row?.schema_version||SYNC_SCHEMA_VERSION),unsafe:Boolean(row?.unsafe),unsafeReason};
  return descriptorWithWriteRevision(cachedDescriptor);
}

export async function getSyncCursor(){
  if(!env.incrementalSyncEnabled)return 0;
  const result=await query('SELECT COALESCE(MAX(cursor),0)::bigint AS cursor FROM "SyncChanges" WHERE "__valid"=TRUE',[],{label:'sync.cursor'});
  return Number(result.rows[0]?.cursor||0);
}

function dbRowToChange(row){
  let metadata={}; if(row.Metadata){try{metadata=JSON.parse(String(row.Metadata));}catch{metadata={};}}
  return {ChangeID:row.ChangeID,Resource:row.Resource,EntityID:row.EntityID,Operation:row.Operation,ParentID:row.ParentID||'',ChangedAt:row.ChangedAt,ActorUserID:row.ActorUserID||'',SourceRoute:row.SourceRoute||'',MutationID:row.MutationID||'',SchemaVersion:Number(row.SchemaVersion||0),Metadata:metadata,cursor:Number(row.cursor)};
}
export async function readSyncChangesAfter(fromCursor,{limit=env.syncDeltaMaxEvents}={}){
  await ensureSyncInfrastructure(); const tail=await getSyncCursor(); const cursor=Number(fromCursor||0); const maxEvents=Math.max(1,Math.min(Number(limit||env.syncDeltaMaxEvents),env.syncDeltaMaxEvents));
  if(!Number.isInteger(cursor)||cursor<0||cursor>tail)return {invalidCursor:true,fromCursor:cursor,cursor:tail,hasMore:false,events:[],eventsScanned:0};
  if(cursor===tail)return {invalidCursor:false,fromCursor:cursor,cursor,hasMore:false,events:[],eventsScanned:0};
  const result=await query('SELECT "ChangeID","Resource","EntityID","Operation","ParentID","ChangedAt","ActorUserID","SourceRoute","MutationID","SchemaVersion","Metadata",cursor FROM "SyncChanges" WHERE "__valid"=TRUE AND cursor>$1 ORDER BY cursor ASC LIMIT $2',[cursor,maxEvents],{label:'sync.delta'});
  const events=result.rows.map(dbRowToChange); const end=events.length?events[events.length-1].cursor:cursor;
  return {invalidCursor:false,fromCursor:cursor,cursor:end,hasMore:end<tail,events,eventsScanned:events.length};
}

function buildEvent({resource,entityId,operation='UPSERT',parentId='',actorUserId='',sourceRoute='',mutationId='',metadata=null}={}){
  const normalizedResource=clean(resource,80); const normalizedEntity=clean(entityId,180);
  if(!normalizedResource||!normalizedEntity)throw new AppError('SYNC_EVENT_INVALID','No se pudo identificar el recurso modificado para sincronización.',500);
  return {ChangeID:uuid(),Resource:normalizedResource,EntityID:normalizedEntity,Operation:['UPSERT','DELETE','INVALIDATE'].includes(operation)?operation:'UPSERT',ParentID:clean(parentId,180),ChangedAt:nowIso(),ActorUserID:clean(actorUserId,180),SourceRoute:clean(sourceRoute,160),MutationID:clean(mutationId,160),SchemaVersion:SYNC_SCHEMA_VERSION,Metadata:sanitizeSyncMetadata(metadata)};
}
export async function appendSyncChanges(changes=[]){
  if(!env.incrementalSyncEnabled||!Array.isArray(changes)||!changes.length)return [];
  return withTransaction(async()=>{
    const output=[];
    for(const change of changes){const event=buildEvent(change); const payload={...event,Metadata:event.Metadata}; const result=await query(`INSERT INTO "SyncChanges" ("ChangeID","Resource","EntityID","Operation","ParentID","ChangedAt","ActorUserID","SourceRoute","MutationID","SchemaVersion","Metadata","__payload") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING cursor`,[event.ChangeID,event.Resource,event.EntityID,event.Operation,event.ParentID,event.ChangedAt,event.ActorUserID,event.SourceRoute,event.MutationID,String(event.SchemaVersion),event.Metadata,JSON.stringify(payload)],{label:'sync.append',write:true}); output.push({...event,cursor:Number(result.rows[0].cursor)});}
    return output;
  });
}
export async function appendSyncChange(change={}){return (await appendSyncChanges([change]))[0]||null;}

export async function markSyncUnsafe(reason='changelog_write_failed'){
  unsafeReason=clean(reason,600)||'changelog_write_failed'; const generation=uuid();
  await query('UPDATE sync_state SET generation=$1,schema_version=$2,unsafe=TRUE,unsafe_reason=$3,updated_at=NOW() WHERE singleton=TRUE',[generation,SYNC_SCHEMA_VERSION,unsafeReason],{label:'sync.unsafe',write:true});
  cachedDescriptor={enabled:true,generation,schemaVersion:SYNC_SCHEMA_VERSION,unsafe:true,unsafeReason}; return cachedDescriptor;
}
export async function clearSyncUnsafeAfterReconciliation(){unsafeReason='';await query("UPDATE sync_state SET unsafe=FALSE,unsafe_reason='',updated_at=NOW() WHERE singleton=TRUE",[],{label:'sync.clearUnsafe',write:true});if(cachedDescriptor)cachedDescriptor={...cachedDescriptor,unsafe:false,unsafeReason:''};return true;}

export async function recordClassifiedSyncChanges(classifications=[],ctx={}){
  if(!env.incrementalSyncEnabled)return null; const startedAt=performance.now(); const changes=new Map();
  for(const classification of classifications){if(!classification||classification.classification===SYNC_MUTATION_CLASS.NO_SYNC_REQUIRED)continue; const entityIds=(classification.entityIds?.length?classification.entityIds:[classification.entityId]).map((value)=>clean(value,180)).filter(Boolean); for(const entityId of entityIds.length?entityIds:['*']){const change={resource:classification.resource,entityId,operation:entityId==='*'?'INVALIDATE':classification.operation,parentId:classification.parentId,actorUserId:ctx.user?.UsuarioID||'',sourceRoute:ctx.route||'',mutationId:mutationIdFrom(ctx.payload),metadata:classification.metadata};changes.set(`${change.resource}:${entityId}`,change);}}
  if(!changes.size)return null;
  try{return await appendSyncChanges([...changes.values()]);}catch(error){await markSyncUnsafe(`${ctx.route||'unknown'}:${error?.code||error?.message||'sync_change_failed'}`);console.warn(`[sync-change][${ctx.route||'unknown'}] negocio confirmado; changelog marcado para reconciliación code=${clean(error?.code||'DATABASE_ERROR',80)}`);return {unsafe:true,reconcileRequired:true,handlerMs:Math.round((performance.now()-startedAt)*100)/100};}
}
export function recordClassifiedSyncChange(classification,ctx={}){return recordClassifiedSyncChanges([classification],ctx);}
export function syncChangeServiceSnapshot(){return {enabled:Boolean(env.incrementalSyncEnabled),schemaVersion:SYNC_SCHEMA_VERSION,unsafe:Boolean(unsafeReason),unsafeReason};}
