const INTERNAL_HINT = /\b(dms|boleta|boletas|ticket|tickets|mantenimiento|mantenimientos|proyecto|proyectos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|dispositivos|equipo|equipos|cámara|camara|foto|fotos|imagen|imagenes|imágenes|zona|zonas|inventario|caso|casos|agenda|knowledge|conocimiento|procedimiento interno|manual interno|gu[ií]a interna)\b/i;
const KNOWLEDGE_HINT = /\b(knowledge|conocimiento|base de conocimiento|procedimiento interno|tutorial|documentaci[oó]n interna|nuestro manual|nuestra gu[ií]a)\b/i;
const DOCUMENT_HINT = /\b(manual|manuales|gu[ií]a|gu[ií]as|guide|documento|documentos|pdf|docx|archivo adjunto|adjunto|adjuntos|p[aá]gina|p[aá]ginas|secci[oó]n|secciones|documentaci[oó]n)\b/i;
const TECHNICAL_KNOWLEDGE_HINT = /\b(axis|onguard|lenel|lenels2|milestone|xprotect|barco|faceme|morphomanager|onvif|rtsp|poe|sip|audio manager|camera station|access control|windows server|sql server|postgresql|odbc|cctv|vms|nvr)\b/i;
const TECHNICAL_ACTION_HINT = /\b(error|falla|problema|soluci[oó]n|solucionar|resolver|configurar|configuraci[oó]n|instalar|procedimiento|manual|gu[ií]a|diagnosticar|diagn[oó]stico|integrar|integraci[oó]n|firmware|compatibilidad|puerto|poe|sip|multicast|qu[eé] dice|explica|explicar|buscar|busca|c[oó]mo|no funciona|no responde|no env[ií]a|no transmite|no conecta|sin audio|sin video|sin se[nñ]al)\b/i;
const MODEL_TOKEN = /\b(?:[A-Z]{1,8}[- ]?)?[A-Z]*\d{3,}[A-Z0-9-]*\b/i;
const KNOWLEDGE_FOLLOWUP = /\b(ese manual|esa gu[ií]a|ese pdf|ese documento|la gu[ií]a|el manual|el pdf|p[aá]gina|p[aá]ginas|secci[oó]n|secciones|qu[eé] m[aá]s dice|qu[eé] dice|dice algo|y del|y sobre)\b/i;
const MAINTENANCE_ID = /\bmantenimiento-[a-z0-9-]{8,}\b/i;
const MAINTENANCE_HINT = /\b(mantenimiento|mantenimientos|proyecto|proyectos)\b/i;
const DEVICE_HINT = /\b(dispositivo|dispositivos|equipo|equipos|c[aá]mara|c[aá]maras|nvr|grabador|servidor|zona|zonas|inventario|activo|activos)\b/i;
const EVIDENCE_HINT = /\b(foto|fotos|imagen|imagenes|im[aá]genes|evidencia|evidencias|video|videos|pdf|firma|archivo|archivos|antes|despu[eé]s)\b/i;
const EVIDENCE_ACTIVITY_HINT = /\b(subi[oó]|carg[oó]|adjunt[oó]|agreg[oó])\b/i;
const COUNT_HINT = /\b(cu[aá]nt|total|suma|cantidad|cantidades|estad[ií]stic|ranking)\b/i;

export const AI_INTENTS = Object.freeze({
  GENERAL:'GENERAL',
  TICKETS:'TICKETS',
  TICKET_EVIDENCE:'TICKET_EVIDENCE',
  MAINTENANCE:'MAINTENANCE',
  MAINTENANCE_DEVICES:'MAINTENANCE_DEVICES',
  MAINTENANCE_EVIDENCE:'MAINTENANCE_EVIDENCE',
  CLIENTS:'CLIENTS',
  USERS:'USERS',
  KNOWLEDGE:'KNOWLEDGE',
  KNOWLEDGE_DOCUMENTS:'KNOWLEDGE_DOCUMENTS',
  AGENDA:'AGENDA',
  CASES:'CASES',
  STATISTICS:'STATISTICS',
  WRITE_MAINTENANCE:'WRITE_MAINTENANCE',
  WEB:'WEB',
  AMBIGUOUS:'AMBIGUOUS',
});

const TICKET_READ_TOOLS = Object.freeze([
  'search_tickets','get_ticket','get_ticket_history','search_ticket_evidence','get_ticket_evidence',
  'search_evidence_activity','search_users','get_technician_activity','get_statistics',
]);
const MAINTENANCE_READ_TOOLS = Object.freeze([
  'resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance',
  'get_maintenance_devices','get_maintenance_evidence','search_maintenance_evidence',
  'get_maintenance_history','search_devices','search_clients','get_client','get_statistics',
]);
const KNOWLEDGE_READ_TOOLS = Object.freeze([
  'search_knowledge_base','get_knowledge_article','search_knowledge_documents',
  'get_knowledge_document','search_knowledge_document_chunks',
]);
const INTEGRAL_READ_TOOLS = Object.freeze([
  'search_internal',
  'search_clients','get_client',
  'search_users','get_technician_activity',
  ...TICKET_READ_TOOLS,
  ...MAINTENANCE_READ_TOOLS,
  'search_agenda',
  ...KNOWLEDGE_READ_TOOLS,
  'search_cases','get_case','search_network_devices',
]);

function text(value){return String(value||'').trim();}
function hasActive(context={},key){return Boolean(text(context?.[key]));}
function hasKnowledgeContext(context={}){return hasActive(context,'lastKnowledgeArticleId')||hasActive(context,'lastKnowledgeDocumentId')||hasActive(context,'lastKnowledgeDocumentName');}
function hasCompetingInternalDomain(value=''){
  return /\b(boleta|boletas|ticket|tickets|mantenimiento|mantenimientos|proyecto|proyectos|cliente|clientes|t[eé]cnico|t[eé]cnicos|agenda|caso|casos|dispositivo|dispositivos|equipo|equipos|c[aá]mara|c[aá]maras|evidencia|evidencias|foto|fotos|imagen|im[aá]genes|inventario|zona|zonas|avance|operatividad)\b/i.test(value)
    || MAINTENANCE_ID.test(value);
}

export function isKnowledgeDocumentQuery({message='',context={}}={}){
  const value=text(message);
  if(!value) return false;
  const active=hasKnowledgeContext(context);
  if(active&&!hasCompetingInternalDomain(value)&&KNOWLEDGE_FOLLOWUP.test(value)) return true;
  return DOCUMENT_HINT.test(value)&&(KNOWLEDGE_HINT.test(value)||TECHNICAL_KNOWLEDGE_HINT.test(value)||MODEL_TOKEN.test(value)||active);
}

export function isTechnicalKnowledgeQuery({message='',context={}}={}){
  const value=text(message);
  if(!value) return false;
  if(isKnowledgeDocumentQuery({message:value,context})) return true;
  if(KNOWLEDGE_HINT.test(value)) return true;
  return (TECHNICAL_KNOWLEDGE_HINT.test(value)||MODEL_TOKEN.test(value))&&TECHNICAL_ACTION_HINT.test(value);
}

export function classifyAiIntent({message='',context={},attachments=[]}={}){
  const value=text(message);
  const lower=value.toLowerCase();
  const hasFiles=Array.isArray(attachments)&&attachments.length>0;

  const wantsWrite=/\b(crea|crear|agrega|agregar|añade|anade|sube|subir|carga|cargar|pon(?:las|los)?|importa|importar)\b/i.test(value);
  const maintenanceWord=MAINTENANCE_HINT.test(value)||MAINTENANCE_ID.test(value)||hasActive(context,'lastMaintenanceId');
  const deviceWord=DEVICE_HINT.test(value)||hasActive(context,'lastDeviceId');
  const evidenceWord=EVIDENCE_HINT.test(value);

  if(wantsWrite && (maintenanceWord||deviceWord||hasFiles)) return AI_INTENTS.WRITE_MAINTENANCE;
  if(/\b(internet|web|google|buscar en internet|busca en internet|buscar en la web|busca en la web|en l[ií]nea|online)\b/i.test(value)) return AI_INTENTS.WEB;

  if(isKnowledgeDocumentQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE_DOCUMENTS;
  if(KNOWLEDGE_HINT.test(value)) return AI_INTENTS.KNOWLEDGE;
  if(isTechnicalKnowledgeQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE;

  if(/\b(boleta|boletas|ticket|tickets|visita anterior|visitas?)\b/i.test(value)||hasActive(context,'lastTicketId')){
    if(evidenceWord||EVIDENCE_ACTIVITY_HINT.test(value)) return AI_INTENTS.TICKET_EVIDENCE;
    if(COUNT_HINT.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.TICKETS;
  }

  if(maintenanceWord){
    if(evidenceWord) return AI_INTENTS.MAINTENANCE_EVIDENCE;
    if(deviceWord) return AI_INTENTS.MAINTENANCE_DEVICES;
    if(COUNT_HINT.test(value)&&!hasActive(context,'lastMaintenanceId')&&!MAINTENANCE_ID.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.MAINTENANCE;
  }

  if(EVIDENCE_ACTIVITY_HINT.test(value) && /\b(hoy|ayer|fecha|semana|mes|t[eé]cnico|usuario|qui[eé]n)\b/i.test(value)) return AI_INTENTS.TICKET_EVIDENCE;
  if(deviceWord||evidenceWord) return AI_INTENTS.AMBIGUOUS;
  if(/\b(cliente|clientes|supervisor|supervisores)\b/i.test(value)) return AI_INTENTS.CLIENTS;
  if(/\b(t[eé]cnico|t[eé]cnicos|usuario|usuarios|qui[eé]n trabaj[oó])\b/i.test(value)) return AI_INTENTS.USERS;
  if(/\b(agenda|agendado|cita|visita programada)\b/i.test(value)) return AI_INTENTS.AGENDA;
  if(/\b(caso|casos|soporte cliente)\b/i.test(value)) return AI_INTENTS.CASES;
  if(COUNT_HINT.test(value)&&INTERNAL_HINT.test(value)) return AI_INTENTS.STATISTICS;

  if(hasFiles) return AI_INTENTS.AMBIGUOUS;
  if(INTERNAL_HINT.test(value)) return AI_INTENTS.AMBIGUOUS;
  if(!lower) return AI_INTENTS.AMBIGUOUS;
  return AI_INTENTS.GENERAL;
}

export function toolNamesForIntent(intent){
  switch(intent){
    case AI_INTENTS.GENERAL: return [];
    case AI_INTENTS.TICKETS: return [...TICKET_READ_TOOLS];
    case AI_INTENTS.TICKET_EVIDENCE: return [...TICKET_READ_TOOLS];
    case AI_INTENTS.MAINTENANCE: return [...MAINTENANCE_READ_TOOLS];
    case AI_INTENTS.MAINTENANCE_DEVICES: return [...MAINTENANCE_READ_TOOLS];
    case AI_INTENTS.MAINTENANCE_EVIDENCE: return [...MAINTENANCE_READ_TOOLS];
    case AI_INTENTS.CLIENTS: return ['search_clients','get_client','search_tickets','search_maintenances','get_statistics'];
    case AI_INTENTS.USERS: return ['search_users','get_technician_activity','search_evidence_activity','search_tickets','get_statistics'];
    case AI_INTENTS.KNOWLEDGE: return [...KNOWLEDGE_READ_TOOLS];
    case AI_INTENTS.KNOWLEDGE_DOCUMENTS: return [...KNOWLEDGE_READ_TOOLS];
    case AI_INTENTS.AGENDA: return ['search_agenda','search_users'];
    case AI_INTENTS.CASES: return ['search_cases','get_case','search_clients'];
    case AI_INTENTS.STATISTICS: return ['get_statistics','search_tickets','search_maintenances','get_technician_activity','get_maintenance'];
    case AI_INTENTS.WRITE_MAINTENANCE: return [
      ...MAINTENANCE_READ_TOOLS,
      'parse_device_import_file','prepare_maintenance_device_bulk_create','prepare_maintenance_evidence_upload','get_ai_operation_status',
    ];
    case AI_INTENTS.WEB: return [];
    case AI_INTENTS.AMBIGUOUS: return [...INTEGRAL_READ_TOOLS];
    default:return [...INTEGRAL_READ_TOOLS];
  }
}
