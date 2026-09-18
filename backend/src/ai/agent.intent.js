const INTERNAL_HINT = /\b(dms|boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|dispositivos|cámara|camara|caso|casos|agenda|knowledge|conocimiento|procedimiento interno|manual interno|gu[ií]a interna)\b/i;
const KNOWLEDGE_HINT = /\b(knowledge|conocimiento|base de conocimiento|procedimiento interno|tutorial|documentaci[oó]n interna|nuestro manual|nuestra gu[ií]a)\b/i;
const DOCUMENT_HINT = /\b(manual|manuales|gu[ií]a|gu[ií]as|guide|documento|documentos|pdf|docx|archivo adjunto|adjunto|adjuntos|p[aá]gina|p[aá]ginas|secci[oó]n|secciones|documentaci[oó]n)\b/i;
const TECHNICAL_KNOWLEDGE_HINT = /\b(axis|onguard|lenel|lenels2|milestone|xprotect|barco|faceme|morphomanager|onvif|rtsp|poe|sip|audio manager|camera station|access control|windows server|sql server|postgresql|odbc|cctv|vms|nvr)\b/i;
const TECHNICAL_ACTION_HINT = /\b(error|falla|problema|soluci[oó]n|solucionar|resolver|configurar|configuraci[oó]n|instalar|procedimiento|manual|gu[ií]a|diagnosticar|diagn[oó]stico|integrar|integraci[oó]n|firmware|compatibilidad|puerto|poe|sip|multicast|qu[eé] dice|explica|explicar|buscar|busca|c[oó]mo|qu[eé] es|no funciona|no responde|no env[ií]a|no transmite|no conecta|sin audio|sin video|sin se[nñ]al)\b/i;
const MODEL_TOKEN = /\b(?:[A-Z]{1,8}[- ]?)?[A-Z]*\d{3,}[A-Z0-9-]*\b/i;
const KNOWLEDGE_FOLLOWUP = /\b(ese|esa|este|esta|manual|pdf|gu[ií]a|documento|p[aá]gina|secci[oó]n|qu[eé] m[aá]s|qu[eé] dice|dice algo|sobre|poe|audio|integraci[oó]n|configuraci[oó]n|y del|y sobre)\b/i;

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

function text(value){return String(value||'').trim();}
function hasActive(context={},key){return Boolean(text(context?.[key]));}
function hasKnowledgeContext(context={}){return hasActive(context,'lastKnowledgeArticleId')||hasActive(context,'lastKnowledgeDocumentId')||hasActive(context,'lastKnowledgeDocumentName');}
function hasCompetingInternalDomain(value=''){return /\b(boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|t[eé]cnico|t[eé]cnicos|agenda|caso|casos)\b/i.test(value);}

export function isKnowledgeDocumentQuery({message='',context={}}={}){
  const value=text(message);
  if(!value) return false;
  const active=hasKnowledgeContext(context);
  if(active&&!hasCompetingInternalDomain(value)&&(KNOWLEDGE_FOLLOWUP.test(value)||DOCUMENT_HINT.test(value)||MODEL_TOKEN.test(value)||value.length<=120)) return true;
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
  const maintenanceWord=/\b(mantenimiento|mantenimientos)\b/i.test(value)||hasActive(context,'lastMaintenanceId');
  const deviceWord=/\b(dispositivo|dispositivos|cámara|camara|cámaras|camaras|nvr|grabador|servidor|zona)\b/i.test(value)||hasActive(context,'lastDeviceId');
  const evidenceWord=/\b(foto|fotos|imagen|imagenes|imágenes|evidencia|evidencias|video|videos|pdf|firma|archivo|archivos|antes|despu[eé]s)\b/i.test(value);

  if(wantsWrite && (maintenanceWord||deviceWord||hasFiles)) return AI_INTENTS.WRITE_MAINTENANCE;
  if(/\b(internet|web|google|buscar en internet|busca en internet|buscar en la web|busca en la web)\b/i.test(value)) return AI_INTENTS.WEB;

  if(isKnowledgeDocumentQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE_DOCUMENTS;
  if(KNOWLEDGE_HINT.test(value)) return AI_INTENTS.KNOWLEDGE;
  if(isTechnicalKnowledgeQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE;

  if(/\b(boleta|boletas|visita anterior|visitas?)\b/i.test(value)||hasActive(context,'lastTicketId')){
    if(evidenceWord||/\bsubi[oó]|subió|uploader|archivo\b/i.test(value)) return AI_INTENTS.TICKET_EVIDENCE;
    if(/\b(cu[aá]nt|total|estad[ií]stic|ranking|m[aá]s boletas|menos boletas)\b/i.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.TICKETS;
  }

  if(maintenanceWord){
    if(evidenceWord) return AI_INTENTS.MAINTENANCE_EVIDENCE;
    if(deviceWord) return AI_INTENTS.MAINTENANCE_DEVICES;
    if(/\b(cu[aá]nt|total|estad[ií]stic|ranking)\b/i.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.MAINTENANCE;
  }

  if(/\b(cliente|clientes|supervisor|supervisores)\b/i.test(value)) return AI_INTENTS.CLIENTS;
  if(/\b(t[eé]cnico|t[eé]cnicos|usuario|usuarios|qui[eé]n trabaj[oó])\b/i.test(value)) return AI_INTENTS.USERS;
  if(/\b(agenda|agendado|cita|visita programada)\b/i.test(value)) return AI_INTENTS.AGENDA;
  if(/\b(caso|casos|soporte cliente)\b/i.test(value)) return AI_INTENTS.CASES;
  if(/\b(cu[aá]ntas?|estad[ií]stic|ranking|totales?)\b/i.test(value)&&INTERNAL_HINT.test(value)) return AI_INTENTS.STATISTICS;

  if(hasFiles) return AI_INTENTS.AMBIGUOUS;
  if(INTERNAL_HINT.test(value)) return AI_INTENTS.AMBIGUOUS;
  if(!lower) return AI_INTENTS.AMBIGUOUS;
  return AI_INTENTS.GENERAL;
}

export function toolNamesForIntent(intent){
  switch(intent){
    case AI_INTENTS.GENERAL: return [];
    case AI_INTENTS.TICKETS: return ['search_tickets','get_ticket','get_ticket_history'];
    case AI_INTENTS.TICKET_EVIDENCE: return ['search_tickets','get_ticket','search_ticket_evidence','get_ticket_evidence','get_ticket_history'];
    case AI_INTENTS.MAINTENANCE: return ['resolve_maintenance_reference','search_maintenances','get_maintenance','get_maintenance_history'];
    case AI_INTENTS.MAINTENANCE_DEVICES: return ['resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices','search_devices'];
    case AI_INTENTS.MAINTENANCE_EVIDENCE: return ['resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices','search_maintenance_evidence'];
    case AI_INTENTS.CLIENTS: return ['search_clients','get_client'];
    case AI_INTENTS.USERS: return ['search_users','get_technician_activity','search_tickets'];
    case AI_INTENTS.KNOWLEDGE: return ['search_knowledge_base','get_knowledge_article','search_knowledge_documents','get_knowledge_document','search_knowledge_document_chunks'];
    case AI_INTENTS.KNOWLEDGE_DOCUMENTS: return ['search_knowledge_base','get_knowledge_article','search_knowledge_documents','get_knowledge_document','search_knowledge_document_chunks'];
    case AI_INTENTS.AGENDA: return ['search_agenda'];
    case AI_INTENTS.CASES: return ['search_cases','get_case'];
    case AI_INTENTS.STATISTICS: return ['get_statistics','search_tickets','search_maintenances','get_technician_activity'];
    case AI_INTENTS.WRITE_MAINTENANCE: return [
      'resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices',
      'parse_device_import_file','prepare_maintenance_device_bulk_create','prepare_maintenance_evidence_upload','get_ai_operation_status',
    ];
    case AI_INTENTS.WEB: return [];
    default:return ['search_internal'];
  }
}
