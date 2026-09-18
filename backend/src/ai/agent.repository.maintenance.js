import { badRequest, notFound } from '../core/errors.js';
import { aiAccess, appendTicketVisibility, assertAiCapability } from './agent.permissions.js';
import {
  active, addRange, aliasQuery, clean, entity, like, many, one,
  pageLimit, pageOffset, protectedAttachment, source,
} from './agent.repository.shared.js';

export async function searchMaintenances(ctx, args = {}) {
  assertAiCapability(ctx, 'maintenance');
  const params=[]; const clauses=[active('m')];
  const q=aliasQuery(args.query);
  if(q){
    params.push(like(q)); const p='$'+params.length;
    clauses.push(`(
      m."MantenimientoID" ILIKE ${p} ESCAPE '\\'
      OR m."TituloMantenimiento" ILIKE ${p} ESCAPE '\\'
      OR m."Cliente" ILIKE ${p} ESCAPE '\\'
      OR m."Ubicacion" ILIKE ${p} ESCAPE '\\'
      OR m."DescripcionGeneral" ILIKE ${p} ESCAPE '\\'
      OR m."Responsables" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  if(clean(args.clientId)){params.push(clean(args.clientId,250));clauses.push(`m."ClienteID"=$${params.length}`);}
  if(clean(args.status)){params.push(clean(args.status,50).toUpperCase());clauses.push(`UPPER(COALESCE(m."Estado",''))=$${params.length}`);}
  const range=addRange(clauses,params,'m."Fecha"',args);
  const where=clauses.join(' AND ');
  const counted=await one(`SELECT COUNT(*)::bigint AS total FROM "Mantenimiento" m WHERE ${where}`,params,'ai.maintenance.search.count');
  const queryParams=[...params,pageLimit(args.limit,20),pageOffset(args.offset)];
  const rows=await many(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."Ubicacion" AS location,m."Estado" AS status,
            m."Fecha" AS date,m."FechaFinalizacion" AS "finishedAt",m."Responsables" AS responsible,
            m."DescripcionGeneral" AS description,
            (SELECT COUNT(*) FROM "Evidencia_Mantenimientos" d
             WHERE ${active('d')} AND d."MantenimientoRef"=m."MantenimientoID")::bigint AS "deviceCount"
       FROM "Mantenimiento" m
      WHERE ${where}
      ORDER BY COALESCE(NULLIF(m."FechaFinalizacion",''),m."Fecha",m."FechaCreacion") DESC NULLS LAST
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,'ai.maintenance.search.items');
  const items=rows.map(row=>({
    id:row.id,title:row.title||'Mantenimiento',clientId:row.clientId||'',client:row.client||'',
    location:row.location||'',status:row.status||'',date:row.date||'',finishedAt:row.finishedAt||'',
    responsible:row.responsible||'',description:clean(row.description,2200),deviceCount:Number(row.deviceCount||0),
  }));
  return {
    modelData:{total:Number(counted?.total||0),totalShown:items.length,period:range,items},
    entities:items.map(i=>entity('maintenance',i.id,i.title,'/mantenimientos/'+encodeURIComponent(i.id),{status:i.status})),
    sources:items.slice(0,8).map(i=>source('maintenance',i.id,i.title+' · '+i.client,'/mantenimientos/'+encodeURIComponent(i.id))),
    context:items.length===1?{lastMaintenanceId:items[0].id,lastMaintenanceName:items[0].title,lastClientId:items[0].clientId,lastClientName:items[0].client}:{},
  };
}

async function maintenanceRow(ctx,idValue){
  assertAiCapability(ctx,'maintenance');
  const id=clean(idValue,250); if(!id) throw badRequest('Falta maintenanceId.');
  const row=await one(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."UbicacionID" AS "locationId",m."Ubicacion" AS location,
            m."Estado" AS status,m."Fecha" AS date,m."FechaFinalizacion" AS "finishedAt",
            m."Responsables" AS responsible,m."DescripcionGeneral" AS description,
            m."CantidadesJSON" AS "expectedCounts",m."CreadoPor" AS "createdBy",
            m."FechaCreacion" AS "createdAt",m."ActualizadoPor" AS "updatedBy",
            m."FechaActualizacion" AS "updatedAt"
       FROM "Mantenimiento" m WHERE ${active('m')} AND m."MantenimientoID"=$1 LIMIT 1`,
    [id],'ai.maintenance.get.base');
  if(!row) throw notFound('No se encontró el mantenimiento solicitado.');
  return row;
}

function normalizeText(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

export async function resolveMaintenanceReference(ctx,args={}){
  assertAiCapability(ctx,'maintenance');
  const explicit=clean(args.maintenanceId,250);
  if(explicit){
    const row=await maintenanceRow(ctx,explicit);
    return {
      modelData:{resolved:true,maintenance:row,candidates:[row]},
      entities:[entity('maintenance',row.id,row.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(row.id))],
      context:{lastMaintenanceId:row.id,lastMaintenanceName:row.title||'',lastClientId:row.clientId||'',lastClientName:row.client||''},
    };
  }
  const reference=aliasQuery(args.reference||args.query);
  if(!reference) throw badRequest('Indique el mantenimiento o cliente de referencia.');
  const rows=await many(
    `SELECT m."MantenimientoID" AS id,m."TituloMantenimiento" AS title,m."ClienteID" AS "clientId",
            m."Cliente" AS client,m."Ubicacion" AS location,m."Estado" AS status,m."Fecha" AS date,
            m."FechaFinalizacion" AS "finishedAt"
       FROM "Mantenimiento" m
      WHERE ${active('m')} AND (
        m."MantenimientoID"=$1 OR m."TituloMantenimiento" ILIKE $2 ESCAPE '\\'
        OR m."Cliente" ILIKE $2 ESCAPE '\\' OR m."Ubicacion" ILIKE $2 ESCAPE '\\'
      )
      ORDER BY CASE WHEN LOWER(COALESCE(m."TituloMantenimiento",''))=LOWER($1) THEN 0
                    WHEN LOWER(COALESCE(m."Cliente",''))=LOWER($1) THEN 1 ELSE 2 END,
               COALESCE(NULLIF(m."FechaFinalizacion",''),m."Fecha",m."FechaCreacion") DESC NULLS LAST
      LIMIT 8`,
    [reference,like(reference)],'ai.maintenance.resolve',
  );
  if(!rows.length)return{modelData:{resolved:false,ambiguous:false,candidates:[],message:'No se encontró un mantenimiento coincidente.'}};
  const latest=args.latest===true||/\b(ultimo|último|mas reciente|más reciente|reciente)\b/i.test(String(args.reference||args.query||''));
  const exact=rows.filter(row=>normalizeText(row.title)===normalizeText(reference)||normalizeText(row.id)===normalizeText(reference));
  const chosen=latest?rows[0]:(exact.length===1?exact[0]:(rows.length===1?rows[0]:null));
  const candidates=rows.map(row=>({
    id:row.id,title:row.title||'Mantenimiento',clientId:row.clientId||'',client:row.client||'',
    location:row.location||'',status:row.status||'',date:row.date||'',finishedAt:row.finishedAt||'',
  }));
  if(!chosen)return{
    modelData:{resolved:false,ambiguous:true,candidates,message:'Hay varios mantenimientos que coinciden. Solicite una aclaración.'},
    entities:candidates.map(row=>entity('maintenance',row.id,row.title,'/mantenimientos/'+encodeURIComponent(row.id))),
  };
  const selected=candidates.find(row=>row.id===chosen.id);
  return{
    modelData:{resolved:true,maintenance:selected,candidates},
    entities:[entity('maintenance',chosen.id,chosen.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(chosen.id))],
    context:{lastMaintenanceId:chosen.id,lastMaintenanceName:chosen.title||'',lastClientId:chosen.clientId||'',lastClientName:chosen.client||''},
  };
}

export async function resolveMaintenanceDevice(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const explicit=clean(args.deviceId,250),reference=clean(args.reference||args.query,300);
  if(!explicit&&!reference)throw badRequest('Indique el dispositivo a resolver.');
  const params=[maintenance.id],clauses=[active('d'),'d."MantenimientoRef"=$1'];
  if(explicit){params.push(explicit);clauses.push(`d."EvidenciaMantenimientoID"=${params.length}`);}
  else{
    params.push(like(reference));const p='
  const row=await maintenanceRow(ctx,args.maintenanceId);
  const [categories,supervisors]=await Promise.all([
    many(
      `SELECT COALESCE(NULLIF(d."TipoDispositivo",''),NULLIF(d."Categoria",''),'Sin categoría') AS category,
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE COALESCE(NULLIF(d."Observacion",''),'')<>''
                OR UPPER(COALESCE(d."Estado",'')) LIKE '%FALL%'
                OR UPPER(COALESCE(d."Estado",'')) LIKE '%MAL%')::bigint AS "withObservations"
         FROM "Evidencia_Mantenimientos" d
        WHERE ${active('d')} AND d."MantenimientoRef"=$1
        GROUP BY 1 ORDER BY total DESC,category ASC`,
      [row.id],'ai.maintenance.categories'),
    row.clientId?many(
      `SELECT cc."ContactoID" AS id,cc."Nombre" AS name,cc."Puesto" AS position,
              cc."Correo" AS email,cc."Telefono" AS phone
         FROM "ClienteContactos" cc
        WHERE ${active('cc')} AND cc."ClienteID"=$1
          AND LOWER(COALESCE(cc."EsSupervisor",'false'))='true'
        ORDER BY cc."Nombre" ASC LIMIT 20`,
      [row.clientId],'ai.maintenance.supervisors'):Promise.resolve([]),
  ]);
  let relatedTickets = [];
  let relatedTicketCount = null;
  if (aiAccess(ctx).tickets) {
    const ticketParams = [row.id];
    const visibility = appendTicketVisibility(ctx, ticketParams, 'b');
    const count = await one(
      `SELECT COUNT(*)::bigint AS total FROM "Boletas" b
        WHERE b."__valid"=TRUE
          AND b."OrigenMantenimientoID"=$1
          AND UPPER(COALESCE(b."Estado",''))<>'ANULADA'
          AND ${visibility}`,
      ticketParams,
      'ai.maintenance.relatedTickets.count',
    );
    relatedTicketCount = Number(count?.total || 0);
    const itemParams = [...ticketParams];
    relatedTickets = await many(
      `SELECT b."BoletaUID" AS uid,b."BoletaID" AS number,b."Titulo" AS title,
              b."Estado" AS status,b."Fecha" AS date,b."FinalizadaEn" AS "finishedAt"
         FROM "Boletas" b
        WHERE b."__valid"=TRUE
          AND b."OrigenMantenimientoID"=$1
          AND UPPER(COALESCE(b."Estado",''))<>'ANULADA'
          AND ${visibility}
        ORDER BY COALESCE(NULLIF(b."FinalizadaEn",''),b."Fecha",b."FechaCreacion") DESC NULLS LAST
        LIMIT 20`,
      itemParams,
      'ai.maintenance.relatedTickets.items',
    );
  }

  const item={
    id:row.id,title:row.title||'Mantenimiento',clientId:row.clientId||'',client:row.client||'',
    locationId:row.locationId||'',location:row.location||'',status:row.status||'',date:row.date||'',
    finishedAt:row.finishedAt||'',responsible:row.responsible||'',description:clean(row.description,4200),
    expectedCounts:clean(row.expectedCounts,3200),
    deviceCount:categories.reduce((sum,x)=>sum+Number(x.total||0),0),
    categories:categories.map(x=>({category:x.category,total:Number(x.total||0),withObservations:Number(x.withObservations||0)})),
    supervisors,
    relatedTicketCount,
    relatedTickets:relatedTickets.map((ticket)=>({
      uid:ticket.uid,number:ticket.number||ticket.uid,title:ticket.title||'',status:ticket.status||'',
      date:ticket.date||'',finishedAt:ticket.finishedAt||'',
    })),
    createdBy:row.createdBy||'',createdAt:row.createdAt||'',updatedBy:row.updatedBy||'',updatedAt:row.updatedAt||'',
  };
  return {
    modelData:item,
    entities:[entity('maintenance',item.id,item.title,'/mantenimientos/'+encodeURIComponent(item.id),{status:item.status})],
    sources:[source('maintenance',item.id,item.title+' · '+item.client,'/mantenimientos/'+encodeURIComponent(item.id))],
    context:{lastMaintenanceId:item.id,lastMaintenanceName:item.title,lastClientId:item.clientId,lastClientName:item.client},
  };
}

export async function getMaintenanceDevices(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const params=[maintenance.id]; const clauses=[active('d'),'d."MantenimientoRef"=$1'];
  const q=clean(args.query,250);
  if(q){
    params.push(like(q)); const p='$'+params.length;
    clauses.push(`(
      d."NombreDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."Categoria" ILIKE ${p} ESCAPE '\\'
      OR d."Fabricante" ILIKE ${p} ESCAPE '\\'
      OR d."Modelo" ILIKE ${p} ESCAPE '\\'
      OR d."Serie" ILIKE ${p} ESCAPE '\\'
      OR d."DireccionMAC" ILIKE ${p} ESCAPE '\\'
      OR d."Zona" ILIKE ${p} ESCAPE '\\'
      OR d."Observacion" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  if(clean(args.type)){params.push(like(args.type));const p='$'+params.length;clauses.push(`(d."TipoDispositivo" ILIKE ${p} ESCAPE '\\' OR d."Categoria" ILIKE ${p} ESCAPE '\\')`);}
  if(args.observationsOnly===true){
    clauses.push(`(
      COALESCE(NULLIF(d."Observacion",''),'')<>''
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%FALL%'
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%MAL%'
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%ATEN%'
      OR LOWER(COALESCE(d."Funcionamiento",'')) IN ('no','mal','false')
    )`);
  }
  const where=clauses.join(' AND ');
  const counted=await one(`SELECT COUNT(*)::bigint AS total FROM "Evidencia_Mantenimientos" d WHERE ${where}`,params,'ai.maintenance.devices.count');
  const queryParams=[...params,pageLimit(args.limit,50),pageOffset(args.offset)];
  const rows=await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Categoria" AS category,
            d."Zona" AS zone,d."Fabricante" AS manufacturer,d."Modelo" AS model,d."Serie" AS serial,
            d."DireccionMAC" AS mac,d."Funcionamiento" AS functioning,d."EnUso" AS "inUse",
            d."Estado" AS status,d."Observacion" AS observation,d."FechaTrabajo" AS "workDate",
            d."Tecnicos" AS technicians,
            (SELECT COUNT(*) FROM "Mantenimiento imagenes" mi
             WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID")::bigint AS "evidenceCount"
       FROM "Evidencia_Mantenimientos" d WHERE ${where}
      ORDER BY COALESCE(NULLIF(d."Zona",''),'') ASC,COALESCE(NULLIF(d."NombreDispositivo",''),d."TipoDispositivo") ASC
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,'ai.maintenance.devices.items');
  const items=rows.map(row=>({
    id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',category:row.category||'',
    zone:row.zone||'',manufacturer:row.manufacturer||'',model:row.model||'',serial:row.serial||'',mac:row.mac||'',
    functioning:row.functioning||'',inUse:row.inUse||'',status:row.status||'',observation:clean(row.observation,2200),
    workDate:row.workDate||'',technicians:row.technicians||'',evidenceCount:Number(row.evidenceCount||0),
  }));
  return {
    modelData:{maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},total:Number(counted?.total||0),totalShown:items.length,items},
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id)),...items.slice(0,25).map(i=>entity('device',i.id,i.name,'/mantenimientos/'+encodeURIComponent(maintenance.id)))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · dispositivos','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||''},
  };
}

export async function getMaintenanceEvidence(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const params=[maintenance.id];
  const clauses=[active('mi'),active('d'),'d."MantenimientoRef"=$1','mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"'];
  if(Array.isArray(args.deviceIds)&&args.deviceIds.length){
    params.push(args.deviceIds.map(x=>clean(x,250)).filter(Boolean));
    clauses.push(`d."EvidenciaMantenimientoID"=ANY($${params.length}::text[])`);
  }
  if(clean(args.type)){
    params.push(like(args.type));const p='$'+params.length;
    clauses.push(`(d."TipoDispositivo" ILIKE ${p} ESCAPE '\\' OR d."Categoria" ILIKE ${p} ESCAPE '\\')`);
  }
  if(clean(args.stage)){
    const normalized=normalizeText(args.stage);
    const stage=normalized.includes('desp')?'Despues':normalized.includes('antes')?'Antes':'';
    if(stage){params.push(stage);clauses.push(`LOWER(COALESCE(mi."Tipo",''))=LOWER($${params.length})`);}
  }
  params.push(pageLimit(args.limit,50));
  const rows=await many(
    `SELECT mi."FotoDispositivoID" AS id,mi."Nombre" AS name,mi."Nota" AS note,mi."Tipo" AS stage,
            mi."MimeType" AS "mimeType",mi."TipoMedio" AS "mediaType",mi."FechaCreacion" AS "createdAt",
            mi."CreadoPor" AS "createdBy",COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",mi."CreadoPor") AS "uploadedBy",
            mi."DriveFileID" AS "__file",
            d."EvidenciaMantenimientoID" AS "deviceId",d."NombreDispositivo" AS "deviceName",
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS "deviceType",d."Zona" AS zone
       FROM "Mantenimiento imagenes" mi
       JOIN "Evidencia_Mantenimientos" d
         ON d."__valid"=TRUE AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
       LEFT JOIN "Usuarios" uploader ON uploader."__valid"=TRUE AND uploader."UsuarioID"=mi."CreadoPor"
      WHERE ${clauses.join(' AND ')}
      ORDER BY d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC NULLS LAST,mi."FechaCreacion" ASC NULLS LAST
      LIMIT $${params.length}`,
    params,'ai.maintenance.evidence');
  const items=rows.map(row=>({
    id:row.id,name:row.name||'Evidencia',note:clean(row.note,1600),stage:row.stage||'',
    mimeType:row.mimeType||'application/octet-stream',mediaType:row.mediaType||'',createdAt:row.createdAt||'',
    createdBy:row.createdBy||'',uploadedBy:row.uploadedBy||row.createdBy||'',deviceId:row.deviceId||'',
    deviceName:row.deviceName||row.deviceType||'Dispositivo',deviceType:row.deviceType||'',zone:row.zone||'',
  }));
  const attachments=rows.map(row=>protectedAttachment(ctx,{
    fileId:row.__file,mimeType:row.mimeType,scopeId:'maintenance:'+maintenance.id,evidenceId:row.id,kind:'maintenance-evidence',
    title:row.deviceName||row.name||'Dispositivo',
    subtitle:[row.stage,row.deviceType,row.zone,row.note].filter(Boolean).join(' · '),
    entityType:'maintenance',entityId:maintenance.id,
  })).filter(Boolean);
  const uniqueStages=[...new Set(items.map(item=>normalizeText(item.stage)).filter(Boolean))];
  return {
    modelData:{maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},totalShown:items.length,items},
    attachments,
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · evidencias','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{
      lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',
      lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||'',
      ...(uniqueStages.length===1?{lastEvidenceStage:uniqueStages[0].includes('desp')?'DESPUES':'ANTES'}:{}),
    },
  };
}

export async function searchDevices(ctx,args={}){
  assertAiCapability(ctx,'maintenance');
  const q=clean(args.query,250); if(!q) throw badRequest('Indique el dispositivo, serie, modelo, MAC o término a buscar.');
  const rows=await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Fabricante" AS manufacturer,
            d."Modelo" AS model,d."Serie" AS serial,d."DireccionMAC" AS mac,d."Zona" AS zone,
            d."Estado" AS status,d."Observacion" AS observation,m."MantenimientoID" AS "maintenanceId",
            m."TituloMantenimiento" AS maintenance,m."ClienteID" AS "clientId",m."Cliente" AS client
       FROM "Evidencia_Mantenimientos" d
       JOIN "Mantenimiento" m ON ${active('m')} AND m."MantenimientoID"=d."MantenimientoRef"
      WHERE ${active('d')} AND (
        d."NombreDispositivo" ILIKE $1 ESCAPE '\\' OR d."TipoDispositivo" ILIKE $1 ESCAPE '\\'
        OR d."Categoria" ILIKE $1 ESCAPE '\\' OR d."Fabricante" ILIKE $1 ESCAPE '\\'
        OR d."Modelo" ILIKE $1 ESCAPE '\\' OR d."Serie" ILIKE $1 ESCAPE '\\'
        OR d."DireccionMAC" ILIKE $1 ESCAPE '\\' OR d."Zona" ILIKE $1 ESCAPE '\\'
        OR d."Observacion" ILIKE $1 ESCAPE '\\'
      )
      ORDER BY m."Fecha" DESC NULLS LAST,d."NombreDispositivo" ASC LIMIT $2`,
    [like(q),pageLimit(args.limit,20)],'ai.devices.search');
  const items=rows.map(row=>({
    id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',manufacturer:row.manufacturer||'',model:row.model||'',
    serial:row.serial||'',mac:row.mac||'',zone:row.zone||'',status:row.status||'',observation:clean(row.observation,1600),
    maintenanceId:row.maintenanceId||'',maintenance:row.maintenance||'',clientId:row.clientId||'',client:row.client||'',
  }));
  return {
    modelData:{totalShown:items.length,items},
    entities:items.map(i=>entity('device',i.id,i.name,'/mantenimientos/'+encodeURIComponent(i.maintenanceId))),
    sources:items.slice(0,8).map(i=>source('maintenance',i.maintenanceId,i.maintenance+' · '+i.name,'/mantenimientos/'+encodeURIComponent(i.maintenanceId))),
    context:items.length===1?{lastDeviceId:items[0].id,lastDeviceName:items[0].name,lastMaintenanceId:items[0].maintenanceId,lastMaintenanceName:items[0].maintenance,lastClientId:items[0].clientId,lastClientName:items[0].client}:{},
  };
}


export async function getMaintenanceHistory(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const rows=await many(
    `SELECT a."Accion" AS action,a."UsuarioID" AS "userId",a."UsuarioNombre" AS "userName",a."Fecha" AS date
       FROM "Auditoria" a
      WHERE a."__valid"=TRUE AND a."EntidadID"=$1
      ORDER BY a."Fecha" DESC NULLS LAST
      LIMIT $2`,
    [maintenance.id,pageLimit(args.limit,30)],
    'ai.maintenance.history',
  );
  return {
    modelData:{
      maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},
      createdAt:maintenance.createdAt||'',updatedAt:maintenance.updatedAt||'',finishedAt:maintenance.finishedAt||'',
      events:rows,
    },
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · historial','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||''},
  };
}

export const maintenanceRepositoryTools=Object.freeze({
  resolve_maintenance_reference:resolveMaintenanceReference,
  resolve_maintenance_device:resolveMaintenanceDevice,
  search_maintenances:searchMaintenances,
  get_maintenance:getMaintenance,
  get_maintenance_devices:getMaintenanceDevices,
  get_maintenance_evidence:getMaintenanceEvidence,
  get_maintenance_history:getMaintenanceHistory,
  search_devices:searchDevices,
});
+params.length;
    clauses.push(`(
      d."NombreDispositivo" ILIKE ${p} ESCAPE '\\' OR d."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."Categoria" ILIKE ${p} ESCAPE '\\' OR d."Zona" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  const rows=await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Zona" AS zone,d."Estado" AS status
       FROM "Evidencia_Mantenimientos" d WHERE ${clauses.join(' AND ')}
       ORDER BY d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC LIMIT 12`,
    params,'ai.maintenance.device.resolve',
  );
  if(!rows.length)return{
    modelData:{resolved:false,ambiguous:false,maintenance:{id:maintenance.id,title:maintenance.title},candidates:[],message:'No se encontró el dispositivo dentro del mantenimiento.'},
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||''},
  };
  const exact=rows.filter(row=>normalizeText(row.name)===normalizeText(reference)||row.id===explicit);
  const chosen=exact.length===1?exact[0]:(rows.length===1?rows[0]:null);
  const candidates=rows.map(row=>({id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',zone:row.zone||'',status:row.status||''}));
  if(!chosen)return{
    modelData:{resolved:false,ambiguous:true,maintenance:{id:maintenance.id,title:maintenance.title},candidates,message:'Hay varios dispositivos coincidentes. Solicite una aclaración.'},
    entities:candidates.map(row=>entity('device',row.id,row.name,'/mantenimientos/'+encodeURIComponent(maintenance.id))),
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||''},
  };
  const selected=candidates.find(row=>row.id===chosen.id);
  return{
    modelData:{resolved:true,maintenance:{id:maintenance.id,title:maintenance.title},device:selected,candidates},
    entities:[entity('device',chosen.id,chosen.name||chosen.type||'Dispositivo','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastDeviceId:chosen.id,lastDeviceName:chosen.name||chosen.type||''},
  };
}

export async function getMaintenance(ctx,args={}){
  const row=await maintenanceRow(ctx,args.maintenanceId);
  const [categories,supervisors]=await Promise.all([
    many(
      `SELECT COALESCE(NULLIF(d."TipoDispositivo",''),NULLIF(d."Categoria",''),'Sin categoría') AS category,
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE COALESCE(NULLIF(d."Observacion",''),'')<>''
                OR UPPER(COALESCE(d."Estado",'')) LIKE '%FALL%'
                OR UPPER(COALESCE(d."Estado",'')) LIKE '%MAL%')::bigint AS "withObservations"
         FROM "Evidencia_Mantenimientos" d
        WHERE ${active('d')} AND d."MantenimientoRef"=$1
        GROUP BY 1 ORDER BY total DESC,category ASC`,
      [row.id],'ai.maintenance.categories'),
    row.clientId?many(
      `SELECT cc."ContactoID" AS id,cc."Nombre" AS name,cc."Puesto" AS position,
              cc."Correo" AS email,cc."Telefono" AS phone
         FROM "ClienteContactos" cc
        WHERE ${active('cc')} AND cc."ClienteID"=$1
          AND LOWER(COALESCE(cc."EsSupervisor",'false'))='true'
        ORDER BY cc."Nombre" ASC LIMIT 20`,
      [row.clientId],'ai.maintenance.supervisors'):Promise.resolve([]),
  ]);
  let relatedTickets = [];
  let relatedTicketCount = null;
  if (aiAccess(ctx).tickets) {
    const ticketParams = [row.id];
    const visibility = appendTicketVisibility(ctx, ticketParams, 'b');
    const count = await one(
      `SELECT COUNT(*)::bigint AS total FROM "Boletas" b
        WHERE b."__valid"=TRUE
          AND b."OrigenMantenimientoID"=$1
          AND UPPER(COALESCE(b."Estado",''))<>'ANULADA'
          AND ${visibility}`,
      ticketParams,
      'ai.maintenance.relatedTickets.count',
    );
    relatedTicketCount = Number(count?.total || 0);
    const itemParams = [...ticketParams];
    relatedTickets = await many(
      `SELECT b."BoletaUID" AS uid,b."BoletaID" AS number,b."Titulo" AS title,
              b."Estado" AS status,b."Fecha" AS date,b."FinalizadaEn" AS "finishedAt"
         FROM "Boletas" b
        WHERE b."__valid"=TRUE
          AND b."OrigenMantenimientoID"=$1
          AND UPPER(COALESCE(b."Estado",''))<>'ANULADA'
          AND ${visibility}
        ORDER BY COALESCE(NULLIF(b."FinalizadaEn",''),b."Fecha",b."FechaCreacion") DESC NULLS LAST
        LIMIT 20`,
      itemParams,
      'ai.maintenance.relatedTickets.items',
    );
  }

  const item={
    id:row.id,title:row.title||'Mantenimiento',clientId:row.clientId||'',client:row.client||'',
    locationId:row.locationId||'',location:row.location||'',status:row.status||'',date:row.date||'',
    finishedAt:row.finishedAt||'',responsible:row.responsible||'',description:clean(row.description,4200),
    expectedCounts:clean(row.expectedCounts,3200),
    deviceCount:categories.reduce((sum,x)=>sum+Number(x.total||0),0),
    categories:categories.map(x=>({category:x.category,total:Number(x.total||0),withObservations:Number(x.withObservations||0)})),
    supervisors,
    relatedTicketCount,
    relatedTickets:relatedTickets.map((ticket)=>({
      uid:ticket.uid,number:ticket.number||ticket.uid,title:ticket.title||'',status:ticket.status||'',
      date:ticket.date||'',finishedAt:ticket.finishedAt||'',
    })),
    createdBy:row.createdBy||'',createdAt:row.createdAt||'',updatedBy:row.updatedBy||'',updatedAt:row.updatedAt||'',
  };
  return {
    modelData:item,
    entities:[entity('maintenance',item.id,item.title,'/mantenimientos/'+encodeURIComponent(item.id),{status:item.status})],
    sources:[source('maintenance',item.id,item.title+' · '+item.client,'/mantenimientos/'+encodeURIComponent(item.id))],
    context:{lastMaintenanceId:item.id,lastMaintenanceName:item.title,lastClientId:item.clientId,lastClientName:item.client},
  };
}

export async function getMaintenanceDevices(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const params=[maintenance.id]; const clauses=[active('d'),'d."MantenimientoRef"=$1'];
  const q=clean(args.query,250);
  if(q){
    params.push(like(q)); const p='$'+params.length;
    clauses.push(`(
      d."NombreDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."TipoDispositivo" ILIKE ${p} ESCAPE '\\'
      OR d."Categoria" ILIKE ${p} ESCAPE '\\'
      OR d."Fabricante" ILIKE ${p} ESCAPE '\\'
      OR d."Modelo" ILIKE ${p} ESCAPE '\\'
      OR d."Serie" ILIKE ${p} ESCAPE '\\'
      OR d."DireccionMAC" ILIKE ${p} ESCAPE '\\'
      OR d."Zona" ILIKE ${p} ESCAPE '\\'
      OR d."Observacion" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  if(clean(args.type)){params.push(like(args.type));const p='$'+params.length;clauses.push(`(d."TipoDispositivo" ILIKE ${p} ESCAPE '\\' OR d."Categoria" ILIKE ${p} ESCAPE '\\')`);}
  if(args.observationsOnly===true){
    clauses.push(`(
      COALESCE(NULLIF(d."Observacion",''),'')<>''
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%FALL%'
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%MAL%'
      OR UPPER(COALESCE(d."Estado",'')) LIKE '%ATEN%'
      OR LOWER(COALESCE(d."Funcionamiento",'')) IN ('no','mal','false')
    )`);
  }
  const where=clauses.join(' AND ');
  const counted=await one(`SELECT COUNT(*)::bigint AS total FROM "Evidencia_Mantenimientos" d WHERE ${where}`,params,'ai.maintenance.devices.count');
  const queryParams=[...params,pageLimit(args.limit,50),pageOffset(args.offset)];
  const rows=await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Categoria" AS category,
            d."Zona" AS zone,d."Fabricante" AS manufacturer,d."Modelo" AS model,d."Serie" AS serial,
            d."DireccionMAC" AS mac,d."Funcionamiento" AS functioning,d."EnUso" AS "inUse",
            d."Estado" AS status,d."Observacion" AS observation,d."FechaTrabajo" AS "workDate",
            d."Tecnicos" AS technicians,
            (SELECT COUNT(*) FROM "Mantenimiento imagenes" mi
             WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID")::bigint AS "evidenceCount"
       FROM "Evidencia_Mantenimientos" d WHERE ${where}
      ORDER BY COALESCE(NULLIF(d."Zona",''),'') ASC,COALESCE(NULLIF(d."NombreDispositivo",''),d."TipoDispositivo") ASC
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,'ai.maintenance.devices.items');
  const items=rows.map(row=>({
    id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',category:row.category||'',
    zone:row.zone||'',manufacturer:row.manufacturer||'',model:row.model||'',serial:row.serial||'',mac:row.mac||'',
    functioning:row.functioning||'',inUse:row.inUse||'',status:row.status||'',observation:clean(row.observation,2200),
    workDate:row.workDate||'',technicians:row.technicians||'',evidenceCount:Number(row.evidenceCount||0),
  }));
  return {
    modelData:{maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},total:Number(counted?.total||0),totalShown:items.length,items},
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id)),...items.slice(0,25).map(i=>entity('device',i.id,i.name,'/mantenimientos/'+encodeURIComponent(maintenance.id)))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · dispositivos','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||''},
  };
}

export async function getMaintenanceEvidence(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const params=[maintenance.id];
  const clauses=[active('mi'),active('d'),'d."MantenimientoRef"=$1','mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"'];
  if(Array.isArray(args.deviceIds)&&args.deviceIds.length){
    params.push(args.deviceIds.map(x=>clean(x,250)).filter(Boolean));
    clauses.push(`d."EvidenciaMantenimientoID"=ANY($${params.length}::text[])`);
  }
  if(clean(args.type)){params.push(like(args.type));const p='$'+params.length;clauses.push(`(d."TipoDispositivo" ILIKE ${p} ESCAPE '\\' OR d."Categoria" ILIKE ${p} ESCAPE '\\')`);}
  params.push(pageLimit(args.limit,50));
  const rows=await many(
    `SELECT mi."FotoDispositivoID" AS id,mi."Nombre" AS name,mi."Nota" AS note,
            mi."MimeType" AS "mimeType",mi."TipoMedio" AS "mediaType",mi."FechaCreacion" AS "createdAt",
            mi."CreadoPor" AS "createdBy",COALESCE(NULLIF(uploader."NombreCompleto",''),uploader."NombreUsuario",mi."CreadoPor") AS "uploadedBy",
            mi."DriveFileID" AS "__file",
            d."EvidenciaMantenimientoID" AS "deviceId",d."NombreDispositivo" AS "deviceName",
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS "deviceType",d."Zona" AS zone
       FROM "Mantenimiento imagenes" mi
       JOIN "Evidencia_Mantenimientos" d
         ON d."__valid"=TRUE AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
       LEFT JOIN "Usuarios" uploader ON uploader."__valid"=TRUE AND uploader."UsuarioID"=mi."CreadoPor"
      WHERE ${clauses.join(' AND ')}
      ORDER BY d."Zona" ASC NULLS LAST,d."NombreDispositivo" ASC NULLS LAST,mi."FechaCreacion" ASC NULLS LAST
      LIMIT $${params.length}`,
    params,'ai.maintenance.evidence');
  const items=rows.map(row=>({
    id:row.id,name:row.name||'Evidencia',note:clean(row.note,1600),mimeType:row.mimeType||'application/octet-stream',
    mediaType:row.mediaType||'',createdAt:row.createdAt||'',createdBy:row.createdBy||'',uploadedBy:row.uploadedBy||row.createdBy||'',deviceId:row.deviceId||'',
    deviceName:row.deviceName||row.deviceType||'Dispositivo',deviceType:row.deviceType||'',zone:row.zone||'',
  }));
  const attachments=rows.map(row=>protectedAttachment(ctx,{
    fileId:row.__file,mimeType:row.mimeType,scopeId:'maintenance:'+maintenance.id,evidenceId:row.id,kind:'maintenance-evidence',
    title:row.deviceName||row.name||'Dispositivo',subtitle:[row.deviceType,row.zone,row.note].filter(Boolean).join(' · '),
    entityType:'maintenance',entityId:maintenance.id,
  })).filter(Boolean);
  return {
    modelData:{maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},totalShown:items.length,items},
    attachments,
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · evidencias','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||''},
  };
}

export async function searchDevices(ctx,args={}){
  assertAiCapability(ctx,'maintenance');
  const q=clean(args.query,250); if(!q) throw badRequest('Indique el dispositivo, serie, modelo, MAC o término a buscar.');
  const rows=await many(
    `SELECT d."EvidenciaMantenimientoID" AS id,d."NombreDispositivo" AS name,
            COALESCE(NULLIF(d."TipoDispositivo",''),d."Categoria") AS type,d."Fabricante" AS manufacturer,
            d."Modelo" AS model,d."Serie" AS serial,d."DireccionMAC" AS mac,d."Zona" AS zone,
            d."Estado" AS status,d."Observacion" AS observation,m."MantenimientoID" AS "maintenanceId",
            m."TituloMantenimiento" AS maintenance,m."ClienteID" AS "clientId",m."Cliente" AS client
       FROM "Evidencia_Mantenimientos" d
       JOIN "Mantenimiento" m ON ${active('m')} AND m."MantenimientoID"=d."MantenimientoRef"
      WHERE ${active('d')} AND (
        d."NombreDispositivo" ILIKE $1 ESCAPE '\\' OR d."TipoDispositivo" ILIKE $1 ESCAPE '\\'
        OR d."Categoria" ILIKE $1 ESCAPE '\\' OR d."Fabricante" ILIKE $1 ESCAPE '\\'
        OR d."Modelo" ILIKE $1 ESCAPE '\\' OR d."Serie" ILIKE $1 ESCAPE '\\'
        OR d."DireccionMAC" ILIKE $1 ESCAPE '\\' OR d."Zona" ILIKE $1 ESCAPE '\\'
        OR d."Observacion" ILIKE $1 ESCAPE '\\'
      )
      ORDER BY m."Fecha" DESC NULLS LAST,d."NombreDispositivo" ASC LIMIT $2`,
    [like(q),pageLimit(args.limit,20)],'ai.devices.search');
  const items=rows.map(row=>({
    id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',manufacturer:row.manufacturer||'',model:row.model||'',
    serial:row.serial||'',mac:row.mac||'',zone:row.zone||'',status:row.status||'',observation:clean(row.observation,1600),
    maintenanceId:row.maintenanceId||'',maintenance:row.maintenance||'',clientId:row.clientId||'',client:row.client||'',
  }));
  return {
    modelData:{totalShown:items.length,items},
    entities:items.map(i=>entity('device',i.id,i.name,'/mantenimientos/'+encodeURIComponent(i.maintenanceId))),
    sources:items.slice(0,8).map(i=>source('maintenance',i.maintenanceId,i.maintenance+' · '+i.name,'/mantenimientos/'+encodeURIComponent(i.maintenanceId))),
    context:items.length===1?{lastDeviceId:items[0].id,lastDeviceName:items[0].name,lastMaintenanceId:items[0].maintenanceId,lastMaintenanceName:items[0].maintenance,lastClientId:items[0].clientId,lastClientName:items[0].client}:{},
  };
}


export async function getMaintenanceHistory(ctx,args={}){
  const maintenance=await maintenanceRow(ctx,args.maintenanceId);
  const rows=await many(
    `SELECT a."Accion" AS action,a."UsuarioID" AS "userId",a."UsuarioNombre" AS "userName",a."Fecha" AS date
       FROM "Auditoria" a
      WHERE a."__valid"=TRUE AND a."EntidadID"=$1
      ORDER BY a."Fecha" DESC NULLS LAST
      LIMIT $2`,
    [maintenance.id,pageLimit(args.limit,30)],
    'ai.maintenance.history',
  );
  return {
    modelData:{
      maintenance:{id:maintenance.id,title:maintenance.title||'Mantenimiento',client:maintenance.client||''},
      createdAt:maintenance.createdAt||'',updatedAt:maintenance.updatedAt||'',finishedAt:maintenance.finishedAt||'',
      events:rows,
    },
    entities:[entity('maintenance',maintenance.id,maintenance.title||'Mantenimiento','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    sources:[source('maintenance',maintenance.id,(maintenance.title||'Mantenimiento')+' · historial','/mantenimientos/'+encodeURIComponent(maintenance.id))],
    context:{lastMaintenanceId:maintenance.id,lastMaintenanceName:maintenance.title||'',lastClientId:maintenance.clientId||'',lastClientName:maintenance.client||''},
  };
}

export const maintenanceRepositoryTools=Object.freeze({
  search_maintenances:searchMaintenances,
  get_maintenance:getMaintenance,
  get_maintenance_devices:getMaintenanceDevices,
  get_maintenance_evidence:getMaintenanceEvidence,
  get_maintenance_history:getMaintenanceHistory,
  search_devices:searchDevices,
});
