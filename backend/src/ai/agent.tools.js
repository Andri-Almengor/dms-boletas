import { AppError, badRequest } from '../core/errors.js';
import { aiConfig } from './agent.config.js';
import { aiAccess } from './agent.permissions.js';
import { sanitizeAiToolResult } from './agent.sanitize.js';
import { directoryRepositoryTools } from './agent.repository.directory.js';
import { ticketRepositoryTools } from './agent.repository.tickets.js';
import { maintenanceRepositoryTools } from './agent.repository.maintenance.js';
import { knowledgeRepositoryTools } from './agent.repository.knowledge.js';
import { statisticsRepositoryTools } from './agent.repository.statistics.js';
import { agendaRepositoryTools } from './agent.repository.agenda.js';
import { integrationRepositoryTools } from './agent.repository.integrations.js';
import { helpRepositoryTools } from './agent.repository.help.js';

const TOOL_IMPL=Object.freeze({
  ...directoryRepositoryTools,
  ...ticketRepositoryTools,
  ...maintenanceRepositoryTools,
  ...knowledgeRepositoryTools,
  ...statisticsRepositoryTools,
  ...agendaRepositoryTools,
  ...integrationRepositoryTools,
  ...helpRepositoryTools,
});

const COMMON_DATE_PROPERTIES={
  period:{type:'string',enum:['all','today','yesterday','current_week','previous_week','current_month','previous_month','last_7_days','last_30_days','year_to_date'],description:'Rango relativo. Use all si no hay rango.'},
  month:{type:'string',description:'Mes natural, por ejemplo agosto o agosto de 2026.'},
  dateFrom:{type:'string',description:'Fecha inicial YYYY-MM-DD.'},
  dateTo:{type:'string',description:'Fecha final YYYY-MM-DD.'},
};

function fn(name,description,properties={},required=[]){
  return {type:'function',name,description,parameters:{type:'object',properties,required,additionalProperties:false}};
}

export const TOOL_DECLARATIONS=Object.freeze({
  get_app_help:fn('get_app_help','Explica de forma autoritativa qué hace una sección de DMS a partir de su ruta interna.',{route:{type:'string'},section:{type:'string'}}),
  search_internal:fn('search_internal','Busca entidades internas por texto sin requerir IDs técnicos.',{
    query:{type:'string'},entityTypes:{type:'array',items:{type:'string',enum:['client','maintenance','ticket','user','device','network_device','knowledge','case','agenda']}},limit:{type:'integer',minimum:1,maximum:20},
  },['query']),
  search_clients:fn('search_clients','Busca clientes DMS por nombre, razón social o identificación.',{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:20}}),
  get_client:fn('get_client','Obtiene información autorizada de un cliente y sus supervisores.',{clientId:{type:'string'}},['clientId']),
  search_users:fn('search_users','Resuelve usuarios o técnicos por nombre.',{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:20}},['query']),
  get_technician_activity:fn('get_technician_activity','Cuenta y resume boletas de un técnico en un rango sin descargar todo el histórico.',{technician:{type:'string'},technicianId:{type:'string'},technicianName:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},...COMMON_DATE_PROPERTIES}),
  search_tickets:fn('search_tickets','Busca boletas visibles para el usuario con filtros y paginación.',{query:{type:'string'},status:{type:'string'},clientId:{type:'string'},clientQuery:{type:'string'},technicianId:{type:'string'},technicianName:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0},...COMMON_DATE_PROPERTIES}),
  get_ticket:fn('get_ticket','Obtiene detalle de una boleta visible para el usuario.',{ticketId:{type:'string'},number:{type:'string'}}),
  get_ticket_evidence:fn('get_ticket_evidence','Obtiene metadata de evidencias y attachments seguros de una boleta.',{ticketId:{type:'string'},number:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},includeSignature:{type:'boolean'}}),
  get_ticket_history:fn('get_ticket_history','Obtiene historial de auditoría de una boleta visible.',{ticketId:{type:'string'},number:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}}),
  search_evidence_activity:fn('search_evidence_activity','Busca archivos/evidencias subidos a boletas por técnico, fecha o boleta. Útil para preguntas como "qué subió Francisco ayer". Si el nombre es ambiguo, resuelve primero el usuario.',{uploaderId:{type:'string'},technician:{type:'string'},technicianName:{type:'string'},ticketId:{type:'string'},mimeType:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0},...COMMON_DATE_PROPERTIES}),
  search_maintenances:fn('search_maintenances','Busca mantenimientos por cliente, nombre, ubicación, responsable o descripción.',{query:{type:'string'},clientId:{type:'string'},status:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0},...COMMON_DATE_PROPERTIES}),
  get_maintenance:fn('get_maintenance','Obtiene resumen completo de un mantenimiento, categorías y supervisores.',{maintenanceId:{type:'string'}},['maintenanceId']),
  get_maintenance_devices:fn('get_maintenance_devices','Lista dispositivos de un mantenimiento y puede filtrar por tipo u observaciones.',{maintenanceId:{type:'string'},query:{type:'string'},type:{type:'string'},observationsOnly:{type:'boolean'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0}},['maintenanceId']),
  get_maintenance_evidence:fn('get_maintenance_evidence','Obtiene imágenes, videos o archivos de dispositivos de un mantenimiento como attachments seguros.',{maintenanceId:{type:'string'},deviceIds:{type:'array',items:{type:'string'}},type:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},['maintenanceId']),
  search_devices:fn('search_devices','Busca dispositivos por nombre, tipo, marca, modelo, serie, MAC, zona u observación.',{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},['query']),
  search_knowledge_base:fn('search_knowledge_base','Busca primero procedimientos y conocimiento interno de DMS.',{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:20}},['query']),
  get_knowledge_article:fn('get_knowledge_article','Obtiene el contenido autorizado de un artículo de Knowledge Base.',{articleId:{type:'string'}},['articleId']),
  search_agenda:fn('search_agenda','Consulta agenda DMS. Técnicos solo ven sus propias asignaciones; administradores pueden filtrar por técnico.',{query:{type:'string'},technicianId:{type:'string'},status:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0},...COMMON_DATE_PROPERTIES}),
  search_network_devices:fn('search_network_devices','Busca dispositivos integrados por nombre, IP, MAC, fabricante o modelo. Solo administradores.',{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},['query']),
  search_cases:fn('search_cases','Busca casos internos similares. Disponible solo con permisos administrativos.',{query:{type:'string'},status:{type:'string'},limit:{type:'integer',minimum:1,maximum:30},...COMMON_DATE_PROPERTIES}),
  get_case:fn('get_case','Obtiene detalle de un caso interno autorizado.',{caseId:{type:'string'}},['caseId']),
  get_statistics:fn('get_statistics','Ejecuta agregaciones PostgreSQL eficientes para conteos y rankings.',{
    metric:{type:'string',enum:['ticket_count','tickets_by_technician','tickets_by_client','recent_finished_tickets','maintenance_count','maintenances_by_client','devices_with_observations','devices_by_type']},
    status:{type:'string'},clientId:{type:'string'},limit:{type:'integer',minimum:1,maximum:50},...COMMON_DATE_PROPERTIES,
  },['metric']),
});

function allowedNames(ctx){
  const access=aiAccess(ctx); const names=['search_internal','search_agenda','get_app_help'];
  if(access.clients) names.push('search_clients','get_client');
  if(access.users) names.push('search_users');
  if(access.tickets) names.push('search_tickets','get_ticket','get_ticket_evidence','get_ticket_history','get_technician_activity','search_evidence_activity');
  if(access.maintenance) names.push('search_maintenances','get_maintenance','get_maintenance_devices','get_maintenance_evidence','search_devices');
  if(access.knowledge) names.push('search_knowledge_base','get_knowledge_article');
  if(access.cases) names.push('search_cases','get_case');
  if(access.admin) names.push('search_network_devices');
  if(access.statistics) names.push('get_statistics');
  return names;
}

export function declarationsForUser(ctx,{includeWeb=false}={}){
  const tools=allowedNames(ctx).map(name=>TOOL_DECLARATIONS[name]).filter(Boolean);
  if(includeWeb&&aiConfig.webSearchEnabled) tools.push({type:'google_search'});
  return tools;
}

async function runBatched(tasks,size){
  const out=[];
  for(let i=0;i<tasks.length;i+=size) out.push(...await Promise.all(tasks.slice(i,i+size).map(task=>task())));
  return out;
}

async function searchInternal(ctx,args={}){
  const query=String(args.query||'').trim(); if(!query) throw badRequest('Indique qué desea buscar.');
  const access=aiAccess(ctx);
  const requested=new Set(Array.isArray(args.entityTypes)?args.entityTypes.map(x=>String(x).toLowerCase()):[]);
  const wants=(name)=>!requested.size||requested.has(name)||requested.has(name+'s');
  const jobs=[];
  const add=(type,name)=>jobs.push(async()=>{
    try{const result=await TOOL_IMPL[name](ctx,{query,limit:Math.min(5,Number(args.limit||5))});return{type,result};}
    catch(error){return{type,result:{modelData:{error:error?.status===403?'FORBIDDEN':'UNAVAILABLE'}}};}
  });
  if(access.clients&&wants('client')) add('client','search_clients');
  if(access.maintenance&&wants('maintenance')) add('maintenance','search_maintenances');
  if(access.tickets&&wants('ticket')) add('ticket','search_tickets');
  if(access.users&&wants('user')) add('user','search_users');
  if(access.maintenance&&wants('device')) add('device','search_devices');
  if(access.knowledge&&wants('knowledge')) add('knowledge','search_knowledge_base');
  if(wants('agenda')) add('agenda','search_agenda');
  if(access.cases&&wants('case')) add('case','search_cases');
  if(access.admin&&wants('network_device')) add('network_device','search_network_devices');
  const results=await runBatched(jobs,aiConfig.maxParallelTools);
  const matches=[],entities=[],sources=[];
  for(const {type,result} of results){
    for(const item of result?.modelData?.items||[]) matches.push({type,...item});
    entities.push(...(result?.entities||[]));sources.push(...(result?.sources||[]));
  }
  return {modelData:{query,matches:matches.slice(0,aiConfig.maxToolResultRows)},entities:entities.slice(0,50),sources:sources.slice(0,20)};
}

export async function executeAiTool(ctx,name,args={}){
  const allowed=new Set(allowedNames(ctx));
  if(name==='search_internal') return sanitizeAiToolResult(name,await searchInternal(ctx,args));
  if(!allowed.has(name)||!TOOL_IMPL[name]) throw new AppError('AI_TOOL_NOT_ALLOWED','La herramienta solicitada no está disponible para este usuario.',403);
  return sanitizeAiToolResult(name,await TOOL_IMPL[name](ctx,args));
}
