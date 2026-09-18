import { forbidden } from '../core/errors.js';
import { clean, entity, like, many, pageLimit, source } from './agent.repository.shared.js';

function assertAdmin(ctx){
  if(!ctx.permissions?.includes('USUARIOS_GESTIONAR')) throw forbidden('La información de dispositivos integrados requiere permisos administrativos.');
}

export async function searchNetworkDevices(ctx,args={}){
  assertAdmin(ctx);
  const q=clean(args.query,250);
  const params=[];const clauses=['d."__valid"=TRUE',`LOWER(COALESCE(d."Activo",'true'))<>'false'`];
  if(q){
    params.push(like(q));const p='$'+params.length;
    clauses.push(`(
      d."NombreOperativo" ILIKE ${p} ESCAPE '\\'
      OR d."NombreDetectado" ILIKE ${p} ESCAPE '\\'
      OR d."DireccionIP" ILIKE ${p} ESCAPE '\\'
      OR d."DireccionMAC" ILIKE ${p} ESCAPE '\\'
      OR d."Fabricante" ILIKE ${p} ESCAPE '\\'
      OR d."Modelo" ILIKE ${p} ESCAPE '\\'
      OR c."Nombre" ILIKE ${p} ESCAPE '\\'
    )`);
  }
  params.push(pageLimit(args.limit,30));
  const rows=await many(
    `SELECT d."DispositivoIntegracionID" AS id,d."ClienteID" AS "clientId",c."Nombre" AS client,
            d."SourceSystem" AS "sourceSystem",d."Tipo" AS type,
            COALESCE(NULLIF(d."NombreOperativo",''),d."NombreDetectado") AS name,
            d."DireccionIP" AS ip,d."DireccionMAC" AS mac,d."Fabricante" AS manufacturer,
            d."Modelo" AS model,d."EstadoConexion" AS "connectionStatus",d."UltimaConexion" AS "lastConnection",
            d."UbicacionCliente" AS location,d."UbicacionEquipo" AS "equipmentLocation"
       FROM "IntegracionDispositivos" d
       LEFT JOIN "Clientes" c ON c."__valid"=TRUE AND c."ClienteID"=d."ClienteID"
      WHERE ${clauses.join(' AND ')}
      ORDER BY d."UltimaConexion" DESC NULLS LAST,d."NombreOperativo" ASC NULLS LAST
      LIMIT $${params.length}`,
    params,'ai.integrations.devices');
  const items=rows.map(row=>({
    id:row.id,clientId:row.clientId||'',client:row.client||'',sourceSystem:row.sourceSystem||'',type:row.type||'',
    name:row.name||row.ip||'Dispositivo',ip:row.ip||'',mac:row.mac||'',manufacturer:row.manufacturer||'',model:row.model||'',
    connectionStatus:row.connectionStatus||'',lastConnection:row.lastConnection||'',location:row.location||'',equipmentLocation:row.equipmentLocation||'',
  }));
  return {
    modelData:{totalShown:items.length,items},
    entities:items.map(item=>entity('network_device',item.id,item.name,'/clientes')),
    sources:items.slice(0,10).map(item=>source('network_device',item.id,item.name+(item.ip?' · '+item.ip:''),'/clientes')),
  };
}

export const integrationRepositoryTools=Object.freeze({search_network_devices:searchNetworkDevices});
