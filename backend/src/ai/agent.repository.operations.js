import crypto from 'node:crypto';
import { AppError, badRequest, forbidden, notFound } from '../core/errors.js';
import { nowIso, uuid } from '../core/utils.js';
import { query } from '../infra/postgres.js';
import { appendRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { normalizeMacAddress } from '../services/evidence-media-policy.service.js';
import {
  loadMaintenanceEvidenceContext,
  maintenanceEvidenceMetadata,
  projectMaintenanceComponentsFromAnswers,
} from '../services/maintenance-evidence-policy.service.js';
import {
  normalizeMaintenanceQuestionResponseType,
  parseMaintenanceQuestionConfig,
  readMaintenanceQuestions,
} from '../services/maintenance-question-catalog.service.js';
import { recordClassifiedSyncChange } from '../services/sync-change.service.js';
import { SYNC_MUTATION_CLASS } from '../services/sync-resource-registry.js';
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
  return (Array.isArray(devices)?devices:[]).map((item,index)=>{
    const base={
      row:index+1,
      name:clean(item?.name??item?.nombre??item?.NombreDispositivo,300),
      type:clean(item?.type??item?.tipo??item?.TipoDispositivo??item?.Categoria,200),
      zone:clean(item?.zone??item?.zona??item?.Zona??zone,300),
    };
    const optional={
      locationId:clean(item?.locationId??item?.equipmentLocationId??item?.UbicacionEquipoID,250),
      manufacturer:clean(item?.manufacturer??item?.fabricante??item?.Fabricante,200),
      model:clean(item?.model??item?.modelo??item?.Modelo,200),
      serial:clean(item?.serial??item?.serie??item?.Serie,300),
      mac:clean(item?.mac??item?.macAddress??item?.DireccionMAC,120),
      observation:clean(item?.observation??item?.observacion??item?.Observacion,1200),
    };
    for(const [key,value] of Object.entries(optional)) if(value) base[key]=value;
    if(Array.isArray(item?.answers)) base.answers=item.answers;
    if(Array.isArray(item?.components)) base.components=item.components;
    return base;
  });
}

async function maintenanceRow(id){
  const result=await query(
    `SELECT "MantenimientoID" AS id,"TituloMantenimiento" AS title,"ClienteID" AS "clientId","Cliente" AS client,
            COALESCE(NULLIF("TipoMantenimiento",''),'MANTENIMIENTO') AS "maintenanceType",
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
            d."TipoDispositivoID" AS "typeId",d."UbicacionEquipoID" AS "locationId",d."Zona" AS zone,
            d."FabricanteID" AS "manufacturerId",d."Fabricante" AS manufacturer,
            d."ModeloID" AS "modelId",d."Modelo" AS model,d."Serie" AS serial,d."DireccionMAC" AS mac,
            d."Observacion" AS observation,d."RespuestasJSON" AS "answersJson",
            d."FechaTrabajo" AS "workDate",d."TecnicoIDsJSON" AS "technicianIdsJson",
            d."FechaActualizacion" AS "updatedAt"
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


function isProjectMaintenanceRow(maintenance={}){
  return String(maintenance.maintenanceType||maintenance.TipoMantenimiento||'MANTENIMIENTO').toUpperCase()==='PROYECTO';
}

function deviceFingerprint(device={}){
  return hash({
    id:device.id,name:device.name,typeId:device.typeId,locationId:device.locationId,
    manufacturerId:device.manufacturerId,modelId:device.modelId,serial:device.serial,mac:device.mac,
    observation:device.observation,answersJson:device.answersJson,workDate:device.workDate,
    technicianIdsJson:device.technicianIdsJson,updatedAt:device.updatedAt,
  });
}

async function loadDeviceCatalogs(){
  const [manufacturers,models,relations]=await Promise.all([
    query(`SELECT "FabricanteID" AS id,"Nombre" AS name FROM "Fabricantes" f WHERE ${active('f')} ORDER BY "Nombre" ASC`,[],{label:'ai.operation.manufacturers'}),
    query(`SELECT "ModeloID" AS id,"Nombre" AS name,"TipoDispositivoID" AS "typeId","FabricanteID" AS "manufacturerId"
             FROM "Modelos" m WHERE ${active('m')} ORDER BY "Nombre" ASC`,[],{label:'ai.operation.models'}),
    query(`SELECT "TipoDispositivoID" AS "typeId","FabricanteID" AS "manufacturerId"
             FROM "TipoDispositivoFabricantes" r WHERE ${active('r')}`,[],{label:'ai.operation.deviceManufacturerRelations'}),
  ]);
  return {
    manufacturers:manufacturers.rows,
    models:models.rows,
    relations:relations.rows,
  };
}

async function maintenanceLocationOptions(ctx,maintenanceId){
  const detail=await maintenanceProgressChatHandlers.get({...ctx,payload:{maintenanceId}});
  return Array.isArray(detail?.equipmentLocations)?detail.equipmentLocations:Array.isArray(detail?.ubicacionesEquipo)?detail.ubicacionesEquipo:[];
}

function resolveLocationOption(locations=[],{locationId='',zone=''}={}){
  const id=clean(locationId,250),name=clean(zone,300);
  if(id){
    const exact=locations.find(item=>clean(item?.id,250)===id);
    if(!exact) throw badRequest('La ubicación indicada no pertenece al mantenimiento o ya no está disponible.');
    return {id:clean(exact.id,250),name:clean(exact.name,300)};
  }
  if(!name) return null;
  const matches=locations.filter(item=>normalize(item?.name)===normalize(name));
  if(matches.length===1) return {id:clean(matches[0].id,250),name:clean(matches[0].name,300)};
  if(matches.length>1) throw badRequest(`La ubicación “${name}” es ambigua. Use su identificador.`);
  throw badRequest(`La ubicación “${name}” no está seleccionada en este mantenimiento.`);
}

function questionMeta(row={}){
  return {
    id:clean(row.PreguntaDispositivoID,250),
    typeId:clean(row.TipoDispositivoID,250),
    key:clean(row.Clave,250),
    label:clean(row.Pregunta,500),
    responseType:normalizeMaintenanceQuestionResponseType(row.TipoRespuesta,'SI_NO'),
    relatedTypeId:clean(row.TipoDispositivoRelacionadoID,250),
    config:parseMaintenanceQuestionConfig(row.ConfiguracionJSON),
  };
}

function findQuestion(questions=[],reference='',{relationOnly=false}={}){
  const ref=normalize(reference);
  if(!ref) return null;
  const matches=questions
    .map(questionMeta)
    .filter(item=>!relationOnly||item.responseType==='RELACION_DISPOSITIVO')
    .filter(item=>normalize(item.key)===ref||normalize(item.label)===ref);
  if(matches.length>1) throw badRequest(`La pregunta “${reference}” es ambigua dentro del tipo de dispositivo.`);
  return matches[0]||null;
}

function canonicalQuestionValue(question,value){
  const type=question.responseType;
  if(type==='SI_NO'){
    const normalized=normalize(value);
    if(['si','sí','yes','true','1'].includes(normalized)) return 'Sí';
    if(['no','false','0'].includes(normalized)) return 'No';
    throw badRequest(`La respuesta para “${question.label}” debe ser Sí o No.`);
  }
  if(type==='OPCIONES'){
    const options=Array.isArray(question.config?.options)?question.config.options.map(item=>clean(item,300)).filter(Boolean):[];
    const match=options.find(item=>normalize(item)===normalize(value));
    if(!match) throw badRequest(`La respuesta para “${question.label}” no pertenece a las opciones configuradas.`);
    return match;
  }
  if(type==='NUMERO'||type==='CANTIDAD'){
    const number=Number(value);
    if(!Number.isFinite(number)||(type==='CANTIDAD'&&number<0)) throw badRequest(`El valor de “${question.label}” no es válido.`);
    return String(value).trim();
  }
  if(type==='MAC') return normalizeMacAddress(value);
  if(type==='RELACION_DISPOSITIVO') throw badRequest(`La relación “${question.label}” debe modificarse mediante components.`);
  return clean(value,1200);
}

function applyQuestionPatches(baseAnswers={},patches=[],questions=[]){
  const answers={...(baseAnswers&&typeof baseAnswers==='object'?baseAnswers:{})};
  for(const patch of Array.isArray(patches)?patches:[]){
    const reference=clean(patch?.question??patch?.key??patch?.label,500);
    const question=findQuestion(questions,reference);
    if(!question) throw badRequest(`No existe la pregunta “${reference}” para este tipo de dispositivo.`);
    answers[question.key]=canonicalQuestionValue(question,patch?.value);
  }
  return answers;
}

function requiredQuestionMissing(question,answers={}){
  const required=typeof question.config?.required==='boolean'
    ? question.config.required
    : question.responseType!=='RELACION_DISPOSITIVO';
  if(!required) return false;
  const value=answers[question.key];
  if(question.responseType==='RELACION_DISPOSITIVO'){
    return !value||typeof value!=='object'||value.enabled!==true||!Array.isArray(value.items)||value.items.length===0;
  }
  return value===undefined||value===null||String(value).trim()==='';
}

function resolveManufacturerModel(typeId,input={},catalogs={},current={}){
  const requestedManufacturer=clean(input.manufacturer??input.fabricante??'',200);
  const requestedModel=clean(input.model??input.modelo??'',200);
  let manufacturerId=clean(current.fabricanteId??current.manufacturerId??'',250);
  let manufacturer=clean(current.fabricante??current.manufacturer??'',200);
  let modelId=clean(current.modeloId??current.modelId??'',250);
  let model=clean(current.modelo??current.model??'',200);

  if(requestedManufacturer){
    const matches=(catalogs.manufacturers||[]).filter(item=>item.id===requestedManufacturer||normalize(item.name)===normalize(requestedManufacturer));
    if(matches.length!==1) throw badRequest(matches.length?'El fabricante indicado es ambiguo.':'El fabricante indicado no existe en el catálogo.');
    manufacturerId=matches[0].id;manufacturer=matches[0].name;
    modelId='';model='';
  }

  if(requestedModel){
    let matches=(catalogs.models||[]).filter(item=>clean(item.typeId,250)===clean(typeId,250)&&(item.id===requestedModel||normalize(item.name)===normalize(requestedModel)));
    if(manufacturerId) matches=matches.filter(item=>!item.manufacturerId||clean(item.manufacturerId,250)===manufacturerId);
    if(matches.length!==1) throw badRequest(matches.length?'El modelo indicado es ambiguo para ese tipo/fabricante.':'El modelo indicado no existe para ese tipo/fabricante.');
    modelId=matches[0].id;model=matches[0].name;
    if(matches[0].manufacturerId&&!manufacturerId){
      const found=(catalogs.manufacturers||[]).find(item=>item.id===matches[0].manufacturerId);
      manufacturerId=clean(matches[0].manufacturerId,250);
      manufacturer=clean(found?.name,200);
    }
  }

  if(manufacturerId){
    const typeRelations=(catalogs.relations||[]).filter(item=>clean(item.typeId,250)===clean(typeId,250));
    if(typeRelations.length&&!typeRelations.some(item=>clean(item.manufacturerId,250)===manufacturerId)){
      throw badRequest('El fabricante seleccionado no está relacionado con este tipo de dispositivo.');
    }
  }
  return {manufacturerId,manufacturer,modelId,model};
}

function componentRef(item={}){
  return clean(item.localId??item.id,250);
}

function applyComponentMutations({
  baseAnswers={},mutations=[],parentQuestions=[],allProjectQuestions=[],typesById=new Map(),catalogs={},
}={}){
  const answers={...(baseAnswers&&typeof baseAnswers==='object'?baseAnswers:{})};
  const summaries=[];
  for(const mutation of Array.isArray(mutations)?mutations:[]){
    const relation=findQuestion(parentQuestions,clean(mutation?.relation??mutation?.question,500),{relationOnly:true});
    if(!relation) throw badRequest(`No existe la relación “${clean(mutation?.relation??mutation?.question,500)}” para este dispositivo.`);
    const relatedType=typesById.get(relation.relatedTypeId);
    if(!relatedType) throw badRequest(`El tipo relacionado de “${relation.label}” ya no está disponible.`);
    const current=answers[relation.key]&&typeof answers[relation.key]==='object'?answers[relation.key]:{};
    const items=Array.isArray(current.items)?current.items.map(item=>({...item,respuestas:{...(item.respuestas||{})}})):[];
    const action=clean(mutation?.action,40).toUpperCase()||'UPSERT';
    const requestedId=clean(mutation?.componentId??mutation?.localId,250);
    let index=requestedId?items.findIndex(item=>componentRef(item)===requestedId):-1;
    if(index<0&&clean(mutation?.name,300)){
      const matches=items.map((item,itemIndex)=>({item,itemIndex})).filter(entry=>normalize(entry.item?.nombre)===normalize(mutation.name));
      if(matches.length===1) index=matches[0].itemIndex;
      else if(matches.length>1) throw badRequest(`Hay más de un componente llamado “${clean(mutation.name,300)}”. Indique componentId.`);
    }

    if((action==='UPDATE'||requestedId)&&index<0){
      throw badRequest('No se encontró el componente indicado. Vuelva a consultar el dispositivo antes de preparar la edición.');
    }
    if(action==='ADD'&&index>=0){
      throw badRequest('Ya existe un componente con esa referencia o nombre dentro de la relación.');
    }

    if(action==='DELETE'){
      if(index<0) throw badRequest('No se encontró el componente que desea eliminar.');
      const removed=items.splice(index,1)[0];
      summaries.push({action:'DELETE',relation:relation.label,componentId:componentRef(removed),name:clean(removed.nombre,300)||clean(removed.categoria,200)});
    }else{
      const existing=index>=0?items[index]:{};
      const catalog=resolveManufacturerModel(relation.relatedTypeId,mutation,catalogs,existing);
      const childQuestions=allProjectQuestions.filter(row=>clean(row.TipoDispositivoID,250)===relation.relatedTypeId&&normalizeMaintenanceQuestionResponseType(row.TipoRespuesta,'SI_NO')!=='RELACION_DISPOSITIVO');
      const childAnswers=applyQuestionPatches(existing.respuestas||{},mutation?.answers,childQuestions);
      const localId=index>=0?componentRef(existing):uuid();
      const next={
        ...existing,
        localId,
        tipoDispositivoId:relation.relatedTypeId,
        categoria:clean(relatedType.name,200),
        fabricanteId:catalog.manufacturerId,
        fabricante:catalog.manufacturer,
        modeloId:catalog.modelId,
        modelo:catalog.model,
        nombre:clean(mutation?.name??existing.nombre,300),
        serie:clean(mutation?.serial??mutation?.serie??existing.serie,300),
        macAddress:clean(mutation?.mac??mutation?.macAddress??existing.macAddress,120)
          ? normalizeMacAddress(mutation?.mac??mutation?.macAddress??existing.macAddress)
          : '',
        respuestas:childAnswers,
      };
      const missing=childQuestions.map(questionMeta).filter(question=>requiredQuestionMissing(question,childAnswers)).map(question=>question.label);
      if(missing.length) throw badRequest(`${next.nombre||relatedType.name}: faltan ${missing.join(', ')}.`);
      if(index>=0) items[index]=next; else items.push(next);
      summaries.push({action:index>=0?'UPDATE':'ADD',relation:relation.label,componentId:localId,name:next.nombre||relatedType.name,type:relatedType.name,manufacturer:next.fabricante,model:next.modelo,serial:next.serie});
    }
    answers[relation.key]={
      enabled:items.length>0,
      relatedTypeId:relation.relatedTypeId,
      relatedTypeName:clean(relatedType.name,200),
      quantity:items.length,
      items,
    };
  }
  return {answers,summaries};
}

async function prepareProjectAnswerStructure({
  typeId,baseAnswers={},answerPatches=[],componentMutations=[],allProjectQuestions=[],types=[],catalogs={},
}={}){
  const parentQuestions=allProjectQuestions.filter(row=>clean(row.TipoDispositivoID,250)===clean(typeId,250));
  let answers=applyQuestionPatches(baseAnswers,answerPatches,parentQuestions);
  const typesById=new Map(types.map(item=>[clean(item.id,250),item]));
  const componentResult=applyComponentMutations({
    baseAnswers:answers,mutations:componentMutations,parentQuestions,allProjectQuestions,typesById,catalogs,
  });
  answers=componentResult.answers;
  const missing=parentQuestions.map(questionMeta).filter(question=>requiredQuestionMissing(question,answers)).map(question=>question.label);
  return {answers,missing,componentSummaries:componentResult.summaries};
}

async function recordMaintenanceSync(ctx,maintenanceId,action,operationId){
  if(!maintenanceId) return;
  await recordClassifiedSyncChange({
    classification:SYNC_MUTATION_CLASS.SYNC_RESOURCE,
    resource:'maintenance',
    entityId:maintenanceId,
    operation:'UPSERT',
    metadata:{action,source:'AI_AGENT'},
  },{
    ...ctx,
    route:'ai.operation.commit',
    payload:{mutationId:operationId},
  });
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

  const projectMode=isProjectMaintenanceRow(maintenance);
  const needsCatalogs=projectMode||rows.some(row=>row.manufacturer||row.model);
  const [types,existing,locations,catalogs,projectQuestions]=await Promise.all([
    deviceTypes(),
    existingDeviceNames(maintenanceId),
    maintenanceLocationOptions(ctx,maintenanceId),
    needsCatalogs?loadDeviceCatalogs():Promise.resolve({manufacturers:[],models:[],relations:[]}),
    projectMode?readMaintenanceQuestions({includeInactive:false,mode:'PROYECTO'}):Promise.resolve([]),
  ]);
  const typeMap=new Map(types.map(type=>[normalize(type.name),type]));
  const existingMap=new Map(existing.map(item=>[normalize(item.name),item]));
  const seen=new Map(); const valid=[]; const invalid=[]; const duplicates=[];

  for(const row of rows){
    try{
      const missing=[];
      if(!row.name)missing.push('Nombre');
      if(!row.type)missing.push('Tipo');
      if(!row.locationId&&!row.zone)missing.push('Zona');
      const catalogType=row.type
        ? (types.find(type=>type.id===row.type)||typeMap.get(normalize(row.type)))
        : null;
      if(row.type&&!catalogType) missing.push('Tipo no existe en el catálogo');
      if(missing.length){invalid.push({...row,missing});continue;}

      const key=normalize(row.name);
      if(seen.has(key)){duplicates.push({...row,reason:`Duplicado dentro del lote (fila ${seen.get(key)}).`});continue;}
      seen.set(key,row.row);
      const current=existingMap.get(key);
      if(current){duplicates.push({...row,reason:'Ya existe en el mantenimiento.',existingId:current.id});continue;}

      const location=resolveLocationOption(locations,{locationId:row.locationId,zone:row.zone});
      const catalog=resolveManufacturerModel(catalogType.id,row,catalogs,{});
      let answers={}; let componentSummaries=[];
      if(projectMode){
        const prepared=await prepareProjectAnswerStructure({
          typeId:catalogType.id,
          baseAnswers:{},
          answerPatches:row.answers,
          componentMutations:row.components,
          allProjectQuestions:projectQuestions,
          types,
          catalogs,
        });
        if(prepared.missing.length){
          invalid.push({...row,missing:prepared.missing.map(label=>`Pregunta obligatoria: ${label}`)});
          continue;
        }
        answers=prepared.answers;
        componentSummaries=prepared.componentSummaries;
      }

      valid.push({
        ...row,
        type:catalogType.name,typeId:catalogType.id,deviceId:uuid(),
        locationId:location.id,zone:location.name,
        manufacturerId:catalog.manufacturerId,manufacturer:catalog.manufacturer,
        modelId:catalog.modelId,model:catalog.model,
        mac:row.mac?normalizeMacAddress(row.mac):'',
        answers,componentSummaries,
      });
    }catch(error){
      invalid.push({...row,missing:[clean(error?.message||'No se pudo validar el dispositivo.',500)]});
    }
  }

  if(invalid.length){
    return {
      modelData:{
        ready:false,needsInput:true,maintenance,
        validCount:valid.length,invalidCount:invalid.length,duplicateCount:duplicates.length,
        invalid,duplicates,
        message:invalid.some(item=>item.missing.some(value=>/zona|ubicaci/i.test(value)))
          ? 'Falta o no se pudo resolver la ubicación de uno o más dispositivos.'
          : projectMode
            ? 'Hay datos incompletos o ambiguos en la estructura del Proyecto. Complete únicamente lo indicado antes de preparar la creación.'
            : 'Hay filas incompletas o valores que no pertenecen a los catálogos reales.',
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

  const argsStored={
    maintenanceId,
    maintenanceType:projectMode?'PROYECTO':'MANTENIMIENTO',
    devices:valid.map(item=>({
      name:item.name,type:item.type,typeId:item.typeId,deviceId:item.deviceId,
      locationId:item.locationId,zone:item.zone,
      manufacturerId:item.manufacturerId,manufacturer:item.manufacturer,
      modelId:item.modelId,model:item.model,serial:item.serial||'',mac:item.mac||'',
      observation:item.observation||'',answers:item.answers||{},
    })),
  };
  const preview={
    maintenance:{id:maintenance.id,title:maintenance.title,client:maintenance.client,status:maintenance.status,maintenanceType:projectMode?'PROYECTO':'MANTENIMIENTO'},
    newDevices:valid.map(item=>({
      name:item.name,type:item.type,zone:item.zone,manufacturer:item.manufacturer||'',model:item.model||'',serial:item.serial||'',
      components:item.componentSummaries||[],
    })),
    existingOrDuplicated:duplicates.map(({name,type,zone,reason})=>({name,type,zone,reason})),
    initialBehavior:'COMMIT reutiliza maintenance.devices.create y sus validaciones autoritativas.',
  };
  const op=await createOperation(ctx,{action:'MAINTENANCE_DEVICE_BULK_CREATE',args:argsStored,preview});
  return {
    modelData:{ready:true,operationId:op.OperationID,maintenance:preview.maintenance,newCount:valid.length,duplicateCount:duplicates.length,duplicates,preview},
    confirmations:[confirmation(op,`Crear ${valid.length} dispositivo${valid.length===1?'':'s'}`,`${maintenance.title||'Mantenimiento'} · ${maintenance.client||''}`,preview.newDevices)],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',pendingOperationId:op.OperationID},
  };
}


export async function prepareMaintenanceProjectDeviceUpdate(ctx,args={}){
  assertMaintenanceWrite(ctx);
  const maintenanceId=clean(args.maintenanceId,250),deviceId=clean(args.deviceId,250);
  if(!maintenanceId||!deviceId) throw badRequest('Falta el Proyecto o el dispositivo que desea modificar.');
  const maintenance=await maintenanceRow(maintenanceId);
  if(!isProjectMaintenanceRow(maintenance)) throw badRequest('La edición estructurada de componentes desde Gemini solo está habilitada para registros tipo Proyecto.');
  if(String(maintenance.status||'').toUpperCase()==='FINALIZADO') throw badRequest('No se puede modificar un Proyecto finalizado.');

  const [device,types,locations,catalogs,projectQuestions]=await Promise.all([
    deviceRow(maintenanceId,deviceId),
    deviceTypes(),
    maintenanceLocationOptions(ctx,maintenanceId),
    loadDeviceCatalogs(),
    readMaintenanceQuestions({includeInactive:false,mode:'PROYECTO'}),
  ]);
  const type=types.find(item=>clean(item.id,250)===clean(device.typeId,250));
  if(!type) throw badRequest('El tipo actual del dispositivo ya no existe en el catálogo.');

  let location={id:device.locationId,name:device.zone};
  if(args.locationId!==undefined||args.zone!==undefined){
    location=resolveLocationOption(locations,{locationId:args.locationId,zone:args.zone});
  }
  const catalog=resolveManufacturerModel(type.id,{
    manufacturer:args.manufacturer,
    model:args.model,
  },catalogs,{
    manufacturerId:device.manufacturerId,manufacturer:device.manufacturer,
    modelId:device.modelId,model:device.model,
  });
  const baseAnswers=parseJson(device.answersJson,{});
  const prepared=await prepareProjectAnswerStructure({
    typeId:type.id,
    baseAnswers,
    answerPatches:args.answers,
    componentMutations:args.components,
    allProjectQuestions:projectQuestions,
    types,
    catalogs,
  });
  if(prepared.missing.length){
    return {
      modelData:{ready:false,needsInput:true,maintenance,device,missing:prepared.missing,message:'Faltan respuestas obligatorias para poder preparar la edición.'},
      confirmations:[],
      context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||''},
    };
  }

  const deletedIds=prepared.componentSummaries.filter(item=>item.action==='DELETE').map(item=>item.componentId).filter(Boolean);
  if(deletedIds.length){
    const evidence=await query(
      `SELECT "ProyectoComponenteLocalID" AS id,COUNT(*)::int AS total
         FROM "Mantenimiento imagenes" mi
        WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=$1
          AND mi."ProyectoComponenteLocalID"=ANY($2::text[])
        GROUP BY "ProyectoComponenteLocalID"`,
      [deviceId,deletedIds],{label:'ai.operation.projectComponentEvidence'},
    );
    if(evidence.rows.length){
      return {
        modelData:{
          ready:false,needsInput:true,maintenance,device,
          blockedComponents:evidence.rows,
          message:'Uno o más componentes tienen evidencias relacionadas. Reasigne o elimine esas evidencias antes de retirar el componente.',
        },
        confirmations:[],
        context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||''},
      };
    }
  }

  const has=(key)=>Object.prototype.hasOwnProperty.call(args,key);
  const next={
    name:has('name')?clean(args.name,300):device.name,
    locationId:location.id,zone:location.name,
    manufacturerId:catalog.manufacturerId,manufacturer:catalog.manufacturer,
    modelId:catalog.modelId,model:catalog.model,
    serial:has('serial')?clean(args.serial,300):clean(device.serial,300),
    mac:has('mac')&&clean(args.mac,120)?normalizeMacAddress(args.mac):(has('mac')?'':clean(device.mac,120)),
    observation:has('observation')?clean(args.observation,1200):clean(device.observation,1200),
    answers:prepared.answers,
  };
  if(!next.name) throw badRequest('El dispositivo debe conservar un nombre.');

  const changes=[];
  const compare=[
    ['Nombre',device.name,next.name],['Ubicación',device.zone,next.zone],['Fabricante',device.manufacturer,next.manufacturer],
    ['Modelo',device.model,next.model],['Serie',device.serial,next.serial],['MAC',device.mac,next.mac],['Observación',device.observation,next.observation],
  ];
  compare.forEach(([field,before,after])=>{if(String(before||'')!==String(after||''))changes.push({field,before:clean(before,500),after:clean(after,500)});});
  changes.push(...prepared.componentSummaries.map(item=>({field:'Componente',...item})));
  if(JSON.stringify(baseAnswers)!==JSON.stringify(prepared.answers)&&!prepared.componentSummaries.length){
    changes.push({field:'Preguntas configurables',after:'Se actualizarán las respuestas indicadas.'});
  }
  if(!changes.length){
    return {
      modelData:{ready:false,maintenance,device,message:'La solicitud no produce cambios en el dispositivo.'},
      confirmations:[],
      context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||''},
    };
  }

  const storedArgs={
    maintenanceId,deviceId,baseHash:deviceFingerprint(device),
    payload:{
      NombreDispositivo:next.name,
      UbicacionEquipoID:next.locationId,
      Zona:next.zone,
      FabricanteID:next.manufacturerId,Fabricante:next.manufacturer,
      ModeloID:next.modelId,Modelo:next.model,
      Serie:next.serial,DireccionMAC:next.mac,Observacion:next.observation,
      respuestas:next.answers,
    },
  };
  const preview={
    maintenance:{id:maintenance.id,title:maintenance.title,client:maintenance.client,maintenanceType:'PROYECTO'},
    device:{id:device.id,name:device.name,type:device.type,zone:device.zone},
    changes,
  };
  const op=await createOperation(ctx,{action:'MAINTENANCE_PROJECT_DEVICE_UPDATE',args:storedArgs,preview});
  return {
    modelData:{ready:true,operationId:op.OperationID,maintenance:preview.maintenance,device:preview.device,changes},
    confirmations:[confirmation(op,'Actualizar dispositivo del Proyecto',`${device.name} · ${maintenance.title||'Proyecto'}`,changes)],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||'',pendingOperationId:op.OperationID},
  };
}

async function chatUpload(ctx,uploadId){
  const result=await query(
    `SELECT "UploadID" AS id,"NombreArchivo" AS name,"MimeType" AS "mimeType","SizeBytes" AS size,
            "DriveFileID" AS "__file","DriveURL" AS "__url","Status" AS status,"ExpiresAt" AS "expiresAt",
            "CreatedAt" AS "capturedAt"
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
  if(!maintenanceId||!deviceId) throw badRequest('Falta mantenimiento o dispositivo.');
  const maintenance=await maintenanceRow(maintenanceId);
  const device=await deviceRow(maintenanceId,deviceId);
  const projectMode=isProjectMaintenanceRow(maintenance);
  const stage=normalizeEvidenceStage(args.stage);
  if(projectMode&&stage) throw badRequest('Los Proyectos no usan ANTES/DESPUÉS. Indique el dispositivo o componente al que corresponde la evidencia.');
  if(!projectMode&&!stage){
    return {modelData:{ready:false,needsInput:true,missing:['stage'],message:'Indique si las imágenes son ANTES o DESPUÉS.'},confirmations:[]};
  }

  let target={
    targetType:'DISPOSITIVO',
    relationKey:'',
    componentLocalId:'',
    componentTypeId:'',
    componentName:'',
    label:device.name||device.type||'Dispositivo',
  };
  const componentRequested=projectMode&&(
    clean(args.projectTargetType,40).toUpperCase()==='COMPONENTE'
    || clean(args.componentId,250)
    || clean(args.componentName,300)
    || clean(args.componentType,200)
    || clean(args.componentManufacturer,200)
    || clean(args.componentModel,200)
    || clean(args.relation,500)
  );
  if(componentRequested){
    const components=projectMaintenanceComponentsFromAnswers(device.answersJson);
    const matches=components.filter(component=>{
      if(clean(args.componentId,250)&&component.localId!==clean(args.componentId,250)) return false;
      if(clean(args.componentName,300)&&normalize(component.name)!==normalize(args.componentName)) return false;
      if(clean(args.componentType,200)&&normalize(component.type)!==normalize(args.componentType)) return false;
      if(clean(args.componentManufacturer,200)&&normalize(component.manufacturer)!==normalize(args.componentManufacturer)) return false;
      if(clean(args.componentModel,200)&&normalize(component.model)!==normalize(args.componentModel)) return false;
      if(clean(args.relation,500)&&normalize(component.relationKey)!==normalize(args.relation)&&normalize(component.relationLabel)!==normalize(args.relation)) return false;
      return true;
    });
    if(matches.length!==1){
      return {
        modelData:{
          ready:false,needsInput:true,maintenance,device,
          candidates:matches.slice(0,20).map(item=>({
            componentId:item.localId,name:item.name,type:item.type,manufacturer:item.manufacturer,model:item.model,relation:item.relationLabel,
          })),
          message:matches.length
            ? 'La referencia del componente es ambigua. Indique cuál componente recibirá las evidencias.'
            : 'No se encontró un componente relacionado que coincida con la referencia indicada.',
        },
        confirmations:[],
        context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||''},
      };
    }
    const component=matches[0];
    target={
      targetType:'COMPONENTE',
      relationKey:component.relationKey,
      componentLocalId:component.localId,
      componentTypeId:component.typeId,
      componentName:component.name,
      label:`${component.type} · ${component.name}`,
    };
  }

  const uploadIds=(Array.isArray(args.uploadIds)?args.uploadIds:[]).map(value=>clean(value,250)).filter(Boolean);
  if(!uploadIds.length) throw badRequest('Adjunte al menos una imagen al chat.');
  if(uploadIds.length>aiConfig.maxEvidenceUploadBatch) throw badRequest(`El lote supera el máximo de ${aiConfig.maxEvidenceUploadBatch} archivos.`);

  const uploads=[];
  for(const uploadId of [...new Set(uploadIds)]){
    const upload=await chatUpload(ctx,uploadId);
    if(!String(upload.mimeType||'').toLowerCase().startsWith('image/')) throw badRequest(`${upload.name} no es una imagen válida para evidencia de mantenimiento.`);
    uploads.push(upload);
  }
  const files=uploads.map(upload=>({uploadId:upload.id,imageId:uuid(),capturedAt:upload.capturedAt||nowIso()}));
  const storedArgs={
    maintenanceId,deviceId,stage:projectMode?'':stage,
    note:clean(args.note,1200),
    projectTargetType:projectMode?target.targetType:'',
    projectRelationKey:projectMode?target.relationKey:'',
    projectComponentLocalId:projectMode?target.componentLocalId:'',
  };
  const preview={
    maintenance:{id:maintenance.id,title:maintenance.title,client:maintenance.client,maintenanceType:projectMode?'PROYECTO':'MANTENIMIENTO'},
    device:{id:device.id,name:device.name,type:device.type,zone:device.zone},
    stage:projectMode?'':stage,
    target:projectMode?target:null,
    note:clean(args.note,1200),
    files:uploads.map(upload=>({uploadId:upload.id,name:upload.name,mimeType:upload.mimeType,size:upload.size})),
  };
  const op=await createOperation(ctx,{action:'MAINTENANCE_EVIDENCE_UPLOAD',args:storedArgs,files,preview});
  const title=projectMode
    ? `Cargar ${uploads.length} imagen${uploads.length===1?'':'es'} a ${target.label}`
    : `Cargar ${uploads.length} imagen${uploads.length===1?'':'es'} como ${stage}`;
  return {
    modelData:{ready:true,operationId:op.OperationID,maintenance:preview.maintenance,device:preview.device,stage:preview.stage,target:preview.target,fileCount:uploads.length},
    confirmations:[confirmation(op,title,`${device.name} · ${maintenance.title||'Mantenimiento'}`,preview.files)],
    context:{
      lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:device.id,lastDeviceName:device.name||'',
      ...(projectMode?{}:{lastEvidenceStage:stage}),pendingOperationId:op.OperationID,
    },
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
  const maintenance=await maintenanceRow(args.maintenanceId);
  const projectMode=isProjectMaintenanceRow(maintenance);
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
            UbicacionEquipoID:item.locationId,
            Zona:item.zone,
            FabricanteID:item.manufacturerId||'',
            Fabricante:item.manufacturer||'',
            ModeloID:item.modelId||'',
            Modelo:item.model||'',
            Serie:item.serial||'',
            DireccionMAC:item.mac||'',
            Observacion:item.observation||'',
            respuestas:item.answers||{},
            ...(projectMode?{Funcionamiento:'No aplica',EnUso:'No aplica'}:{}),
          },
        });
      }
      success.push({deviceId:item.deviceId,name:item.name,type:item.type,zone:item.zone});
    }catch(error){
      failed.push({deviceId:item.deviceId,name:item.name,message:clean(error?.message||'No se pudo crear el dispositivo.',400)});
    }
  }
  const result={
    maintenance:{id:maintenance.id,title:maintenance.title,maintenanceType:projectMode?'PROYECTO':'MANTENIMIENTO'},
    created:success,failed,createdCount:success.length,failedCount:failed.length,total:(args.devices||[]).length,
  };
  await finishOperation(op.OperationID,failed.length?'PARTIAL':'COMMITTED',result,failed.length?{message:'Uno o más dispositivos quedaron pendientes de reintento.'}:null);
  if(success.length) await recordMaintenanceSync(ctx,args.maintenanceId,'AI_MAINTENANCE_DEVICE_BULK_CREATE',op.OperationID);
  await audit(ctx,'AI_MAINTENANCE_DEVICE_BULK_CREATE','Mantenimiento',args.maintenanceId,null,{OperationID:op.OperationID,Created:success.length,Failed:failed.length,MaintenanceType:result.maintenance.maintenanceType}).catch(()=>{});
  return result;
}

async function commitProjectDeviceUpdate(ctx,op){
  const args=parseJson(op.ArgumentsJSON,{});
  const maintenance=await maintenanceRow(args.maintenanceId);
  if(!isProjectMaintenanceRow(maintenance)) throw badRequest('La operación preparada ya no corresponde a un Proyecto.');
  const current=await deviceRow(args.maintenanceId,args.deviceId);
  if(deviceFingerprint(current)!==clean(args.baseHash,200)){
    throw new AppError('AI_OPERATION_CONFLICT','El dispositivo cambió después del PREPARE. Revise los cambios actuales y prepare la edición nuevamente.',409);
  }
  const payload=args.payload&&typeof args.payload==='object'?args.payload:{};
  const result=await maintenanceProgressChatHandlers.deviceUpdate({
    ...ctx,
    payload:{
      maintenanceId:args.maintenanceId,
      deviceId:args.deviceId,
      ...payload,
    },
  });
  const saved=await deviceRow(args.maintenanceId,args.deviceId);
  const publicResult={
    maintenance:{id:maintenance.id,title:maintenance.title,maintenanceType:'PROYECTO'},
    device:{id:saved.id,name:saved.name,type:saved.type,zone:saved.zone},
    updated:true,
  };
  await finishOperation(op.OperationID,'COMMITTED',publicResult,null);
  await recordMaintenanceSync(ctx,args.maintenanceId,'AI_MAINTENANCE_PROJECT_DEVICE_UPDATE',op.OperationID);
  await audit(ctx,'AI_MAINTENANCE_PROJECT_DEVICE_UPDATE','Mantenimiento',args.maintenanceId,
    {DeviceID:current.id,DeviceHash:clean(args.baseHash,200)},
    {OperationID:op.OperationID,DeviceID:saved.id,Updated:true}).catch(()=>{});
  return {...publicResult,handlerResult:result?.EvidenciaMantenimientoID?{deviceId:result.EvidenciaMantenimientoID}:undefined};
}

async function commitEvidence(ctx,op){
  const args=parseJson(op.ArgumentsJSON,{}),files=parseJson(op.FilesJSON,[]);
  const maintenance=await maintenanceRow(args.maintenanceId);
  const device=await deviceRow(args.maintenanceId,args.deviceId);
  const context=await loadMaintenanceEvidenceContext({deviceId:args.deviceId,maintenanceId:args.maintenanceId});
  const success=[],failed=[];
  for(const item of files){
    try{
      if(await imageExists(item.imageId)){
        success.push({imageId:item.imageId,uploadId:item.uploadId,alreadyCommitted:true});continue;
      }
      const upload=await chatUpload(ctx,item.uploadId);
      const timestamp=nowIso();
      const metadata=maintenanceEvidenceMetadata({
        Tipo:isProjectMaintenanceRow(maintenance)?'Proyecto':args.stage,
        Nota:args.note||'',
        FechaCaptura:item.capturedAt||upload.capturedAt||timestamp,
        ProyectoDestinoTipo:args.projectTargetType,
        ProyectoRelacionClave:args.projectRelationKey,
        ProyectoComponenteLocalID:args.projectComponentLocalId,
      },context);
      await appendRow('Mantenimiento imagenes',{
        FotoDispositivoID:item.imageId,
        DispositivoMantenimientoRef:args.deviceId,
        ...metadata,
        Nombre:upload.name,
        Nota:args.note||'',
        MimeType:upload.mimeType,
        Size:String(upload.size||''),
        TipoMedio:'IMAGE',
        DuracionSegundos:'',
        DriveFileID:upload.__file,
        DriveURL:upload.__url||'',
        Activo:true,
        CreadoPor:clean(ctx.user?.UsuarioID,250),
        FechaCreacion:timestamp,
        ActualizadoPor:clean(ctx.user?.UsuarioID,250),
        FechaActualizacion:timestamp,
      });
      await query(
        `UPDATE "AiChatUploads" SET "Status"='CONSUMED',"ConsumedAt"=$2,"OperationID"=$3
          WHERE "UploadID"=$1 AND "__valid"=TRUE`,
        [item.uploadId,timestamp,op.OperationID],{label:'ai.upload.consume',write:true},
      );
      success.push({imageId:item.imageId,uploadId:item.uploadId,name:upload.name,capturedAt:metadata.FechaCaptura,targetType:metadata.ProyectoDestinoTipo||''});
    }catch(error){
      failed.push({imageId:item.imageId,uploadId:item.uploadId,message:clean(error?.message||'No se pudo registrar la imagen.',400)});
    }
  }
  const result={
    maintenance:{id:maintenance.id,title:maintenance.title,maintenanceType:isProjectMaintenanceRow(maintenance)?'PROYECTO':'MANTENIMIENTO'},
    device:{id:device.id,name:device.name,zone:device.zone},
    stage:isProjectMaintenanceRow(maintenance)?'':args.stage,
    target:isProjectMaintenanceRow(maintenance)?{
      targetType:args.projectTargetType||'DISPOSITIVO',
      relationKey:args.projectRelationKey||'',
      componentLocalId:args.projectComponentLocalId||'',
    }:null,
    uploaded:success,failed,uploadedCount:success.length,failedCount:failed.length,total:files.length,
  };
  await finishOperation(op.OperationID,failed.length?'PARTIAL':'COMMITTED',result,failed.length?{message:'Una o más imágenes quedaron pendientes de reintento.'}:null);
  if(success.length) await recordMaintenanceSync(ctx,args.maintenanceId,'AI_MAINTENANCE_EVIDENCE_UPLOAD',op.OperationID);
  await audit(ctx,'AI_MAINTENANCE_EVIDENCE_UPLOAD','Mantenimiento',args.maintenanceId,null,{
    OperationID:op.OperationID,DeviceID:args.deviceId,Stage:result.stage,
    ProjectTargetType:result.target?.targetType||'',ProjectComponentLocalID:result.target?.componentLocalId||'',
    Uploaded:success.length,Failed:failed.length,
  }).catch(()=>{});
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
  try{
    if(op.Action==='MAINTENANCE_DEVICE_BULK_CREATE') result=await commitDeviceBulk(ctx,op);
    else if(op.Action==='MAINTENANCE_PROJECT_DEVICE_UPDATE') result=await commitProjectDeviceUpdate(ctx,op);
    else if(op.Action==='MAINTENANCE_EVIDENCE_UPLOAD') result=await commitEvidence(ctx,op);
    else throw badRequest('La operación no es compatible con esta versión del agente.');
  }catch(error){
    await finishOperation(operationId,'FAILED',operationResult(op)||{}, {
      code:clean(error?.code||'AI_OPERATION_FAILED',80),
      message:clean(error?.message||'No se pudo completar la operación.',600),
    }).catch(()=>{});
    throw error;
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
  prepare_maintenance_project_device_update:prepareMaintenanceProjectDeviceUpdate,
  prepare_maintenance_evidence_upload:prepareMaintenanceEvidenceUpload,
  get_ai_operation_status:getAiOperationStatus,
});

export const AI_OPERATION_POLICY=Object.freeze({
  modelCanCommit:false,
  frontendCommitArguments:['operationId','decision'],
  idempotentCommit:true,
  requiresNameTypeLocation:true,
  maintenanceEvidenceRequiresStage:true,
  projectEvidenceRequiresStage:false,
  projectDeviceUpdateConcurrencyCheck:true,
});
