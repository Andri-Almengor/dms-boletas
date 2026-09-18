import crypto from 'node:crypto';
import { AppError, badRequest, forbidden, notFound } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { query } from '../infra/postgres.js';
import { audit } from '../services/audit.service.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { aiConfig } from './agent.config.js';
import { extractDriveDocumentText } from './agent.knowledge-documents.js';

function clean(value,max=4000){return String(value??'').trim().slice(0,max);}
function active(alias){return `${alias}."__valid"=TRUE AND LOWER(COALESCE(${alias}."Activo",'true'))<>'false'`;}
function normalize(value){return clean(value,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function sessionHash(ctx){return crypto.createHash('sha256').update(clean(ctx?.sessionToken,12000)).digest('base64url');}
function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==='object') return Object.keys(value).sort().reduce((out,key)=>{out[key]=stable(value[key]);return out;},{});
  return value;
}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function parseJson(value,fallback){
  if(value===null||value===undefined||value==='') return fallback;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return fallback;}
}
function hasPermission(ctx,code){return Array.isArray(ctx?.permissions)&&ctx.permissions.includes(code);}
function canWriteMaintenance(ctx){
  return hasPermission(ctx,'USUARIOS_GESTIONAR')||[
    'MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR',
  ].some(code=>hasPermission(ctx,code));
}
function assertMaintenanceWrite(ctx){
  if(!aiConfig.writeEnabled||!aiConfig.maintenanceWriteEnabled) throw new AppError('AI_WRITE_DISABLED','Las acciones de escritura del asistente están deshabilitadas.',403);
  if(!canWriteMaintenance(ctx)) throw forbidden('No cuenta con permiso para modificar mantenimientos.');
}
function expiryIso(){
  return new Date(Date.now()+aiConfig.pendingOperationTtlMinutes*60_000).toISOString();
}
function expired(value){const time=Date.parse(String(value||''));return Number.isFinite(time)&&time<=Date.now();}

export function normalizeEvidenceStage(value){
  const normalized=normalize(value);
  if(normalized==='antes'||normalized==='before') return 'ANTES';
  if(normalized==='despues'||normalized==='after') return 'DESPUES';
  return '';
}

export function normalizeDeviceBatch(devices=[],commonZone=''){
  const zone=clean(commonZone,300);
  return (Array.isArray(devices)?devices:[]).map((item,index)=>({
    row:index+1,
    name:clean(item?.name??item?.nombre??item?.NombreDispositivo,300),
    type:clean(item?.type??item?.tipo??item?.TipoDispositivo??item?.Categoria,200),
    zone:clean(item?.zone??item?.zona??item?.Zona??zone,300),
  }));
}

async function maintenanceRow(id){
  const result=await query(
    `SELECT "MantenimientoID" AS id,"TituloMantenimiento" AS title,"ClienteID" AS "clientId","Cliente" AS client,
            "Estado" AS status,"Fecha" AS date
       FROM "Mantenimiento" m WHERE ${active('m')} AND m."MantenimientoID"=$1 LIMIT 1`,
    [clean(id,250)],{label:'ai.operation.maintenance'},
  );
  const row=result.rows[0];
  if(!row) throw notFound('No se encontró el mantenimiento solicitado.');
  return row;
}

async function deviceRow(maintenanceId,deviceId){
  const result=await query(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."MantenimientoRef" AS "maintenanceId",
            d."NombreDispositivo" AS name,COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,
            d."Zona" AS zone
       FROM "Evidencia_Mantenimientos" d
      WHERE ${active('d')} AND d."EvidenciaMantenimientoID"=$1 AND d."MantenimientoRef"=$2 LIMIT 1`,
    [clean(deviceId,250),clean(maintenanceId,250)],{label:'ai.operation.device'},
  );
  const row=result.rows[0];
  if(!row) throw notFound('No se encontró el dispositivo dentro de ese mantenimiento.');
  return row;
}

async function deviceTypes(){
  const result=await query(
    `SELECT "TipoDispositivoID" AS id,"Nombre" AS name FROM "TiposDispositivo" t
      WHERE ${active('t')} ORDER BY "Nombre" ASC`,[],{label:'ai.operation.deviceTypes'},
  );
  return result.rows;
}

async function existingDeviceNames(maintenanceId){
  const result=await query(
    `SELECT "EvidenciaMantenimientoID" AS id,"NombreDispositivo" AS name,
            COALESCE(NULLIF("TipoDispositivo",''),"Categoria") AS type,"Zona" AS zone
       FROM "Evidencia_Mantenimientos" d
      WHERE ${active('d')} AND d."MantenimientoRef"=$1`,
    [maintenanceId],{label:'ai.operation.existingDevices'},
  );
  return result.rows;
}

function operationPreview(op){
  return parseJson(op.PreviewJSON||op.previewJson,{});
}
function operationResult(op){
  return parseJson(op.ResultJSON||op.resultJson,null);
}
function publicOperation(op){
  if(!op)return null;
  return {
    operationId:op.OperationID||op.operationId,
    action:op.Action||op.action,
    status:op.Status||op.status,
    expiresAt:op.ExpiresAt||op.expiresAt,
    preview:operationPreview(op),
    result:operationResult(op),
  };
}
async function findOperation(ctx,operationId){
  const result=await query(
    `SELECT * FROM "AiPendingOperations"
      WHERE "__valid"=TRUE AND "OperationID"=$1 AND "UserID"=$2 AND "SessionHash"=$3 LIMIT 1`,
    [clean(operationId,250),clean(ctx?.user?.UsuarioID,250),sessionHash(ctx)],
    {label:'ai.operation.get'},
  );
  const row=result.rows[0];
  if(!row) throw notFound('La operación ya no existe o pertenece a otra sesión.');
  return row;
}

async function createOperation(ctx,{action,args={},files=[],preview={}}){
  assertMaintenanceWrite(ctx);
  const userId=clean(ctx?.user?.UsuarioID,250);
  const fingerprint=sessionHash(ctx);
  const key=hash({userId,fingerprint,action,args,files});
  const existing=await query(
    `SELECT * FROM "AiPendingOperations"
      WHERE "__valid"=TRUE AND "IdempotencyKey"=$1
      ORDER BY "__db_id" DESC LIMIT 1`,
    [key],{label:'ai.operation.idempotency'},
  );
  const previous=existing.rows[0];
  if(previous&&!expired(previous.ExpiresAt)&&!['CANCELLED','FAILED'].includes(String(previous.Status||''))){
    return previous;
  }
  const operationId=uuid(); const now=nowIso(); const expiresAt=expiryIso();
  const inserted=await query(
    `INSERT INTO "AiPendingOperations"
      ("OperationID","UserID","SessionHash","Action","ArgumentsJSON","FilesJSON","PreviewJSON","Status",
       "IdempotencyKey","ExpiresAt","CreatedAt","UpdatedAt","__valid")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'PENDING',$8,$9,$10,$10,TRUE)
     RETURNING *`,
    [operationId,userId,fingerprint,action,JSON.stringify(args),JSON.stringify(files),JSON.stringify(preview),key,expiresAt,now],
    {label:'ai.operation.create',write:true},
  );
  return inserted.rows[0];
}

function confirmation(op,title,summary,items=[]){
  return {
    operationId:op.OperationID,
    action:op.Action,
    status:op.Status,
    title:clean(title,300),
    summary:clean(summary,1200),
    items:Array.isArray(items)?items.slice(0,aiConfig.maxDeviceCreateBatch):[],
    expiresAt:op.ExpiresAt,
    confirmLabel:'Confirmar',
    cancelLabel:'Cancelar',
  };
}

export async function prepareMaintenanceDeviceBulkCreate(ctx,args={}){
  assertMaintenanceWrite(ctx);
  const maintenanceId=clean(args.maintenanceId,250);
  if(!maintenanceId) throw badRequest('Falta el mantenimiento para crear los dispositivos.');
  const maintenance=await maintenanceRow(maintenanceId);
  if(String(maintenance.status||'').toUpperCase()==='FINALIZADO') throw badRequest('No se pueden agregar dispositivos a un mantenimiento finalizado.');

  const rows=normalizeDeviceBatch(args.devices,args.commonZone);
  if(!rows.length) throw badRequest('Indique al menos un dispositivo.');
  if(rows.length>aiConfig.maxDeviceCreateBatch) throw badRequest(`El lote supera el máximo de ${aiConfig.maxDeviceCreateBatch} dispositivos.`);

  const [types,existing]=await Promise.all([deviceTypes(),existingDeviceNames(maintenanceId)]);
  const typeMap=new Map(types.map(type=>[normalize(type.name),type]));
  const existingMap=new Map(existing.map(item=>[normalize(item.name),item]));
  const seen=new Map(); const valid=[]; const invalid=[]; const duplicates=[];

  for(const row of rows){
    const missing=[];
    if(!row.name)missing.push('Nombre');
    if(!row.type)missing.push('Tipo');
    if(!row.zone)missing.push('Zona');
    const catalogType=row.type?typeMap.get(normalize(row.type)):null;
    if(row.type&&!catalogType) missing.push('Tipo no existe en el catálogo');
    if(missing.length){invalid.push({...row,missing});continue;}
    const key=normalize(row.name);
    if(seen.has(key)){duplicates.push({...row,reason:`Duplicado dentro del lote (fila ${seen.get(key)}).`});continue;}
    seen.set(key,row.row);
    const current=existingMap.get(key);
    if(current){duplicates.push({...row,reason:'Ya existe en el mantenimiento.',existingId:current.id});continue;}
    valid.push({...row,type:catalogType.name,typeId:catalogType.id,deviceId:uuid()});
  }

  if(invalid.length){
    return {
      modelData:{
        ready:false,needsInput:true,maintenance,
        validCount:valid.length,invalidCount:invalid.length,duplicateCount:duplicates.length,
        invalid,duplicates,
        message:invalid.some(item=>item.missing.includes('Zona'))
          ? 'Falta Zona en uno o más dispositivos. Solicite la zona antes de preparar la creación.'
          : 'Hay filas incompletas o tipos que no pertenecen al catálogo real.',
      },
      entities:[],confirmations:[],context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||''},
    };
  }
  if(!valid.length){
    return {
      modelData:{ready:false,maintenance,validCount:0,duplicateCount:duplicates.length,duplicates,message:'No hay dispositivos nuevos para crear.'},
      confirmations:[],context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||''},
    };
  }

  const argsStored={maintenanceId,devices:valid.map(({name,type,typeId,zone,deviceId})=>({name,type,typeId,zone,deviceId}))};
  const preview={
    maintenance:{id:maintenance.id,title:maintenance.title,client:maintenance.client,status:maintenance.status},
    newDevices:valid.map(({name,type,zone})=>({name,type,zone})),
    existingOrDuplicated:duplicates.map(({name,type,zone,reason})=>({name,type,zone,reason})),
    initialBehavior:'Se usa exactamente el flujo maintenance.devices.create; no se fuerza un campo Estado adicional.',
  };
  const op=await createOperation(ctx,{action:'MAINTENANCE_DEVICE_BULK_CREATE',args:argsStored,preview});
  return {
    modelData:{ready:true,operationId:op.OperationID,maintenance:preview.maintenance,newCount:valid.length,duplicateCount:duplicates.length,duplicates,preview},
    confirmations:[confirmation(op,`Crear ${valid.length} dispositivo${valid.length===1?'':'s'}`,`${maintenance.title||'Mantenimiento'} · ${maintenance.client||''}`,preview.newDevices)],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',pendingOperationId:op.OperationID},
  };
}

async function chatUpload(ctx,uploadId){
  const result=await query(
    `SELECT "UploadID" AS id,"NombreArchivo" AS name,"MimeType" AS "mimeType","SizeBytes" AS size,
            "DriveFileID" AS "__file","DriveURL" AS "__url","Status" AS status,"ExpiresAt" AS "expiresAt"
       FROM "AiChatUploads"
      WHERE "__valid"=TRUE AND "UploadID"=$1 AND "UserID"=$2 AND "SessionHash"=$3 LIMIT 1`,
    [clean(uploadId,250),clean(ctx?.user?.UsuarioID,250),sessionHash(ctx)],{label:'ai.upload.get'},
  );
  const row=result.rows[0];
  if(!row||expired(row.expiresAt)||!['AVAILABLE','CONSUMED'].includes(String(row.status||''))) throw notFound('El archivo adjunto ya no está disponible en esta sesión.');
  return row;
}

export async function prepareMaintenanceEvidenceUpload(ctx,args={}){
  assertMaintenanceWrite(ctx);
  const maintenanceId=clean(args.maintenanceId,250),deviceId=clean(args.deviceId,250);
  const stage=normalizeEvidenceStage(args.stage);
  if(!maintenanceId||!deviceId) throw badRequest('Falta mantenimiento o dispositivo.');
  if(!stage) return {modelData:{ready:false,needsInput:true,missing:['stage'],message:'Indique si las imágenes son ANTES o DESPUÉS.'},confirmations:[]};
  const maintenance=await maintenanceRow(maintenanceId);
  const device=await deviceRow(maintenanceId,deviceId);
  const uploadIds=(Array.isArray(args.uploadIds)?args.uploadIds:[]).map(value=>clean(value,250)).filter(Boolean);
  if(!uploadIds.length) throw badRequest('Adjunte al menos una imagen al chat.');
  if(uploadIds.length>aiConfig.maxEvidenceUploadBatch) throw badRequest(`El lote supera el máximo de ${aiConfig.maxEvidenceUploadBatch} archivos.`);

  const uploads=[];
  for(const uploadId of [...new Set(uploadIds)]){
    const upload=await chatUpload(ctx,uploadId);
    if(!String(upload.mimeType||'').toLowerCase().startsWith('image/')) throw badRequest(`${upload.name} no es una imagen válida para evidencia de mantenimiento.`);
    uploads.push(upload);
  }
  const files=uploads.map(upload=>({uploadId:upload.id,imageId:uuid()}));
  const storedArgs={maintenanceId,deviceId,stage};
  const preview={
    maintenance:{id:maintenance.id,title:maintenance.title,client:maintenance.client},
    device:{id:device.id,name:device.name,type:device.type,zone:device.zone},
    stage,
    files:uploads.map(upload=>({uploadId:upload.id,name:upload.name,mimeType:upload.mimeType,size:upload.size})),
  };
  const op=await createOperation(ctx,{action:'MAINTENANCE_EVIDENCE_UPLOAD',args:storedArgs,files,preview});
  return {
    modelData:{ready:true,operationId:op.OperationID,maintenance:preview.maintenance,device:preview.device,stage,fileCount:uploads.length},
    confirmations:[confirmation(op,`Cargar ${uploads.length} imagen${uploads.length===1?'':'es'} como ${stage}`,`${device.name} · Zona ${device.zone||'sin zona'}`,preview.files)],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||'',lastEvidenceStage:stage,pendingOperationId:op.OperationID},
  };
}

function csvRows(text){
  const first=String(text||'').split(/\r?\n/,1)[0]||'';
  const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':first.includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<String(text||'').length;i+=1){
    const ch=String(text||'')[i];
    if(ch==='"'){
      if(quoted&&String(text||'')[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;
    }else if(ch===delimiter&&!quoted){row.push(cell.trim());cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&String(text||'')[i+1]==='\n')i+=1;
      row.push(cell.trim());cell='';
      if(row.some(Boolean))rows.push(row);row=[];
    }else cell+=ch;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
function headerKey(value){
  const v=normalize(value).replace(/[^a-z0-9]+/g,'');
  if(['nombre','nombredispositivo','equipo','dispositivo'].includes(v))return'name';
  if(['tipo','tipodispositivo','categoria','categoría'].includes(v))return'type';
  if(['zona','ubicacion','ubicación','area','área'].includes(v))return'zone';
  return'';
}
export async function parseDeviceImportFile(ctx,args={}){
  assertMaintenanceWrite(ctx);
  const upload=await chatUpload(ctx,args.uploadId);
  const mime=String(upload.mimeType||'').toLowerCase();
  if(!(mime.includes('spreadsheet')||mime.includes('excel')||mime.includes('csv')||mime.startsWith('text/'))){
    throw badRequest('Use XLSX, CSV o TXT para importar dispositivos.');
  }
  const extracted=await extractDriveDocumentText({fileId:upload.__file,mimeType:upload.mimeType});
  const rows=csvRows(extracted);
  if(!rows.length)return{modelData:{uploadId:upload.id,validCount:0,invalidCount:0,items:[]}};
  const mapped=rows[0].map(headerKey);const hasHeader=mapped.some(Boolean);
  const indexes={
    name:hasHeader?mapped.indexOf('name'):0,
    type:hasHeader?mapped.indexOf('type'):1,
    zone:hasHeader?mapped.indexOf('zone'):2,
  };
  const data=rows.slice(hasHeader?1:0).slice(0,aiConfig.maxDeviceCreateBatch);
  const items=data.map((cols,index)=>{
    const item={row:index+(hasHeader?2:1),name:clean(cols[indexes.name],300),type:clean(cols[indexes.type],200),zone:clean(cols[indexes.zone],300)};
    const missing=[];if(!item.name)missing.push('Nombre');if(!item.type)missing.push('Tipo');if(!item.zone)missing.push('Zona');
    return{...item,valid:!missing.length,missing};
  });
  return {
    modelData:{
      uploadId:upload.id,fileName:upload.name,total:items.length,
      validCount:items.filter(item=>item.valid).length,
      invalidCount:items.filter(item=>!item.valid).length,
      items,
      message:items.some(item=>item.missing.includes('Zona'))?'Hay dispositivos que requieren Zona antes de poder crearse.':'Archivo interpretado.',
    },
  };
}

async function claimOperation(ctx,operationId,allowedStatuses=['PENDING','PARTIAL']){
  const result=await query(
    `UPDATE "AiPendingOperations" SET "Status"='COMMITTING',"UpdatedAt"=$4
      WHERE "__valid"=TRUE AND "OperationID"=$1 AND "UserID"=$2 AND "SessionHash"=$3
        AND "Status"=ANY($5::text[])
      RETURNING *`,
    [operationId,clean(ctx?.user?.UsuarioID,250),sessionHash(ctx),nowIso(),allowedStatuses],
    {label:'ai.operation.claim',write:true},
  );
  if(result.rows[0])return result.rows[0];
  return findOperation(ctx,operationId);
}
async function finishOperation(operationId,status,result,error=null){
  const now=nowIso();
  await query(
    `UPDATE "AiPendingOperations"
        SET "Status"=$2,"ResultJSON"=$3::jsonb,"ErrorJSON"=$4::jsonb,"UpdatedAt"=$5,
            "CommittedAt"=CASE WHEN $2 IN ('COMMITTED','PARTIAL') THEN COALESCE("CommittedAt",$5) ELSE "CommittedAt" END
      WHERE "OperationID"=$1 AND "__valid"=TRUE`,
    [operationId,status,JSON.stringify(result||{}),JSON.stringify(error||null),now],
    {label:'ai.operation.finish',write:true},
  );
}
async function deviceExists(deviceId){
  const r=await query(`SELECT 1 FROM "Evidencia_Mantenimientos" WHERE "__valid"=TRUE AND "EvidenciaMantenimientoID"=$1 LIMIT 1`,[deviceId],{label:'ai.operation.deviceExists'});
  return Boolean(r.rowCount);
}
async function imageExists(imageId){
  const r=await query(`SELECT 1 FROM "Mantenimiento imagenes" WHERE "__valid"=TRUE AND "FotoDispositivoID"=$1 LIMIT 1`,[imageId],{label:'ai.operation.imageExists'});
  return Boolean(r.rowCount);
}

async function commitDeviceBulk(ctx,op){
  const args=parseJson(op.ArgumentsJSON,{});
  await maintenanceRow(args.maintenanceId);
  const success=[],failed=[];
  for(const item of Array.isArray(args.devices)?args.devices:[]){
    try{
      if(!await deviceExists(item.deviceId)){
        await maintenanceProgressChatHandlers.deviceCreate({
          ...ctx,
          payload:{
            maintenanceId:args.maintenanceId,
            deviceId:item.deviceId,
            NombreDispositivo:item.name,
            TipoDispositivoID:item.typeId,
            TipoDispositivo:item.type,
            Categoria:item.type,
            Zona:item.zone,
          },
        });
      }
      success.push({deviceId:item.deviceId,name:item.name,type:item.type,zone:item.zone});
    }catch(error){
      failed.push({deviceId:item.deviceId,name:item.name,message:clean(error?.message||'No se pudo crear el dispositivo.',400)});
    }
  }
  const result={created:success,failed,createdCount:success.length,failedCount:failed.length,total:(args.devices||[]).length};
  await finishOperation(op.OperationID,failed.length?'PARTIAL':'COMMITTED',result,failed.length?{message:'Uno o más dispositivos quedaron pendientes de reintento.'}:null);
  await audit(ctx,'AI_MAINTENANCE_DEVICE_BULK_CREATE','Mantenimiento',args.maintenanceId,null,{OperationID:op.OperationID,Created:success.length,Failed:failed.length}).catch(()=>{});
  return result;
}

async function commitEvidence(ctx,op){
  const args=parseJson(op.ArgumentsJSON,{}),files=parseJson(op.FilesJSON,[]);
  const maintenance=await maintenanceRow(args.maintenanceId);
  const device=await deviceRow(args.maintenanceId,args.deviceId);
  const success=[],failed=[];
  for(const item of files){
    try{
      if(await imageExists(item.imageId)){
        success.push({imageId:item.imageId,uploadId:item.uploadId,alreadyCommitted:true});continue;
      }
      const upload=await chatUpload(ctx,item.uploadId);
      const timestamp=nowIso();
      await query(
        `INSERT INTO "Mantenimiento imagenes"
          ("FotoDispositivoID","DispositivoMantenimientoRef","Tipo","Nombre","MimeType","Size","DriveFileID","DriveURL",
           "Activo","CreadoPor","FechaCreacion","ActualizadoPor","FechaActualizacion","TipoMedio","__valid")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'true',$9,$10,$9,$10,'IMAGE',TRUE)`,
        [item.imageId,args.deviceId,args.stage==='DESPUES'?'Despues':'Antes',upload.name,upload.mimeType,String(upload.size||''),upload.__file,upload.__url||'',clean(ctx.user?.UsuarioID,250),timestamp],
        {label:'ai.operation.evidence.insert',write:true},
      );
      await query(
        `UPDATE "AiChatUploads" SET "Status"='CONSUMED',"ConsumedAt"=$2,"OperationID"=$3
          WHERE "UploadID"=$1 AND "__valid"=TRUE`,
        [item.uploadId,timestamp,op.OperationID],{label:'ai.upload.consume',write:true},
      );
      success.push({imageId:item.imageId,uploadId:item.uploadId,name:upload.name});
    }catch(error){
      failed.push({imageId:item.imageId,uploadId:item.uploadId,message:clean(error?.message||'No se pudo registrar la imagen.',400)});
    }
  }
  const result={
    maintenance:{id:maintenance.id,title:maintenance.title},
    device:{id:device.id,name:device.name,zone:device.zone},
    stage:args.stage,uploaded:success,failed,uploadedCount:success.length,failedCount:failed.length,total:files.length,
  };
  await finishOperation(op.OperationID,failed.length?'PARTIAL':'COMMITTED',result,failed.length?{message:'Una o más imágenes quedaron pendientes de reintento.'}:null);
  await audit(ctx,'AI_MAINTENANCE_EVIDENCE_UPLOAD','Mantenimiento',args.maintenanceId,null,{OperationID:op.OperationID,DeviceID:args.deviceId,Stage:args.stage,Uploaded:success.length,Failed:failed.length}).catch(()=>{});
  return result;
}

export async function decideAiOperation(ctx,args={}){
  assertMaintenanceWrite(ctx);
  const operationId=clean(args.operationId,250),decision=normalize(args.decision);
  if(!operationId)throw badRequest('Falta operationId.');
  let op=await findOperation(ctx,operationId);
  if(expired(op.ExpiresAt)&&!['COMMITTED','CANCELLED'].includes(String(op.Status||''))){
    await finishOperation(operationId,'EXPIRED',operationResult(op)||{},null);
    throw new AppError('AI_OPERATION_EXPIRED','La confirmación expiró. Prepare la operación nuevamente.',409);
  }
  if(decision==='cancelar'||decision==='cancel'){
    if(!['COMMITTED','COMMITTING'].includes(String(op.Status||''))){
      await finishOperation(operationId,'CANCELLED',operationResult(op)||{},null);
      op=await findOperation(ctx,operationId);
    }
    return publicOperation(op);
  }
  if(!['confirmar','confirm','retry','reintentar'].includes(decision))throw badRequest('La decisión debe ser confirm o cancel.');
  if(op.Status==='COMMITTED')return publicOperation(op);
  if(op.Status==='COMMITTING')return publicOperation(op);
  op=await claimOperation(ctx,operationId);
  if(op.Status!=='COMMITTING')return publicOperation(op);

  let result;
  if(op.Action==='MAINTENANCE_DEVICE_BULK_CREATE') result=await commitDeviceBulk(ctx,op);
  else if(op.Action==='MAINTENANCE_EVIDENCE_UPLOAD') result=await commitEvidence(ctx,op);
  else{
    await finishOperation(operationId,'FAILED',{}, {message:'Acción no compatible.'});
    throw badRequest('La operación no es compatible con esta versión del agente.');
  }
  const current=await findOperation(ctx,operationId);
  return {...publicOperation(current),result};
}

export async function getAiOperationStatus(ctx,args={}){
  const op=await findOperation(ctx,args.operationId);
  return {modelData:publicOperation(op),context:{pendingOperationId:op.OperationID}};
}

export const operationRepositoryTools=Object.freeze({
  parse_device_import_file:parseDeviceImportFile,
  prepare_maintenance_device_bulk_create:prepareMaintenanceDeviceBulkCreate,
  prepare_maintenance_evidence_upload:prepareMaintenanceEvidenceUpload,
  get_ai_operation_status:getAiOperationStatus,
});

export const AI_OPERATION_POLICY=Object.freeze({
  modelCanCommit:false,
  frontendCommitArguments:['operationId','decision'],
  idempotentCommit:true,
  requiresNameTypeZone:true,
  requiresEvidenceStage:true,
});
