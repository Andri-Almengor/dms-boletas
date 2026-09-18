import { badRequest, notFound } from '../core/errors.js';
import { buildMaintenanceProgress } from '../core/maintenance-progress.js';
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
            m."CantidadesJSON" AS "expectedCounts",
            m."CantCámaras",m."CantPuertas",m."CantServidores",m."CantGrabadores",m."CantBocinas",
            m."CantSensoresPerimetrales",m."CantSensoresMovimiento",m."CantSensorRuptura",
            m."CantImpresora",m."CantGabinetes",m."CantVideoWall",
            m."CreadoPor" AS "createdBy",
            m."FechaCreacion" AS "createdAt",m."ActualizadoPor" AS "updatedBy",
            m."FechaActualizacion" AS "updatedAt"
       FROM "Mantenimiento" m WHERE ${active('m')} AND m."MantenimientoID"=$1 LIMIT 1`,
    [id],'ai.maintenance.get.base');
  if(!row) throw notFound('No se encontró el mantenimiento solicitado.');
  return row;
}

export async function getMaintenance(ctx,args={}){
  const row=await maintenanceRow(ctx,args.maintenanceId);
  const [categories,supervisors,progressDevices,deviceTypes,zones,evidenceSummaryRow]=await Promise.all([
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
    many(
      `SELECT d."TipoDispositivoID",d."TipoDispositivo",d."Categoria",d."Activo"
         FROM "Evidencia_Mantenimientos" d
        WHERE d."__valid"=TRUE AND d."MantenimientoRef"=$1`,
      [row.id],'ai.maintenance.progressDevices'),
    many(
      `SELECT td."TipoDispositivoID",td."Nombre"
         FROM "TiposDispositivo" td
        WHERE ${active('td')}
        ORDER BY td."Nombre" ASC`,
      [],'ai.maintenance.deviceTypes'),
    many(
      `SELECT COALESCE(NULLIF(d."Zona",''),'Sin zona') AS zone,
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (
                WHERE COALESCE(NULLIF(d."Observacion",''),'')<>''
                   OR UPPER(COALESCE(d."Estado",'')) LIKE '%FALL%'
                   OR UPPER(COALESCE(d."Estado",'')) LIKE '%MAL%'
                   OR UPPER(COALESCE(d."Estado",'')) LIKE '%ATEN%'
                   OR LOWER(COALESCE(d."Funcionamiento",'')) IN ('no','mal','false')
              )::bigint AS "withAttention"
         FROM "Evidencia_Mantenimientos" d
        WHERE ${active('d')} AND d."MantenimientoRef"=$1
        GROUP BY 1 ORDER BY zone ASC`,
      [row.id],'ai.maintenance.zones'),
    one(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."MimeType",'')) LIKE 'image/%')::bigint AS images,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."MimeType",'')) LIKE 'video/%')::bigint AS videos,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."Tipo",''))='antes')::bigint AS before,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(mi."Tipo",'')) IN ('despues','después'))::bigint AS after
         FROM "Mantenimiento imagenes" mi
         JOIN "Evidencia_Mantenimientos" d
           ON d."__valid"=TRUE AND LOWER(COALESCE(d."Activo",'true'))<>'false'
          AND d."EvidenciaMantenimientoID"=mi."DispositivoMantenimientoRef"
        WHERE ${active('mi')} AND d."MantenimientoRef"=$1`,
      [row.id],'ai.maintenance.evidenceSummary'),
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

  const progress=buildMaintenanceProgress({
    maintenance:{...row,CantidadesJSON:row.expectedCounts},
    devices:progressDevices,
    deviceTypes,
  });
  const evidenceSummary={
    total:Number(evidenceSummaryRow?.total||0),
    images:Number(evidenceSummaryRow?.images||0),
    videos:Number(evidenceSummaryRow?.videos||0),
    before:Number(evidenceSummaryRow?.before||0),
    after:Number(evidenceSummaryRow?.after||0),
  };
  const item={
    id:row.id,title:row.title||'Mantenimiento',clientId:row.clientId||'',client:row.client||'',
    locationId:row.locationId||'',location:row.location||'',status:row.status||'',date:row.date||'',
    finishedAt:row.finishedAt||'',responsible:row.responsible||'',description:clean(row.description,4200),
    expectedCounts:clean(row.expectedCounts,3200),
    deviceCount:categories.reduce((sum,x)=>sum+Number(x.total||0),0),
    categories:categories.map(x=>({category:x.category,total:Number(x.total||0),withObservations:Number(x.withObservations||0)})),
    zones:zones.map(x=>({zone:x.zone,total:Number(x.total||0),withAttention:Number(x.withAttention||0)})),
    progress,
    evidenceSummary,
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
            d."Tecnicos" AS technicians,d."CreadoPor" AS "createdBy",d."FechaCreacion" AS "createdAt",
            d."ActualizadoPor" AS "updatedBy",d."FechaActualizacion" AS "updatedAt",
            (SELECT COUNT(*) FROM "Mantenimiento imagenes" mi
             WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID")::bigint AS "evidenceCount",
            (SELECT COUNT(*) FROM "Mantenimiento imagenes" mi
             WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
               AND LOWER(COALESCE(mi."Tipo",''))='antes')::bigint AS "beforeEvidenceCount",
            (SELECT COUNT(*) FROM "Mantenimiento imagenes" mi
             WHERE ${active('mi')} AND mi."DispositivoMantenimientoRef"=d."EvidenciaMantenimientoID"
               AND LOWER(COALESCE(mi."Tipo",'')) IN ('despues','después'))::bigint AS "afterEvidenceCount"
       FROM "Evidencia_Mantenimientos" d WHERE ${where}
      ORDER BY COALESCE(NULLIF(d."Zona",''),'') ASC,COALESCE(NULLIF(d."NombreDispositivo",''),d."TipoDispositivo") ASC
      LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}`,
    queryParams,'ai.maintenance.devices.items');
  const items=rows.map(row=>({
    id:row.id,name:row.name||row.type||'Dispositivo',type:row.type||'',category:row.category||'',
    zone:row.zone||'',manufacturer:row.manufacturer||'',model:row.model||'',serial:row.serial||'',mac:row.mac||'',
    functioning:row.functioning||'',inUse:row.inUse||'',status:row.status||'',observation:clean(row.observation,2200),
    workDate:row.workDate||'',technicians:row.technicians||'',
    createdBy:row.createdBy||'',createdAt:row.createdAt||'',updatedBy:row.updatedBy||'',updatedAt:row.updatedAt||'',
    evidenceCount:Number(row.evidenceCount||0),
    beforeEvidenceCount:Number(row.beforeEvidenceCount||0),
    afterEvidenceCount:Number(row.afterEvidenceCount||0),
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
