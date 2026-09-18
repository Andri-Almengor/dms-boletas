const INTERNAL_HINT = /\b(dms|boleta|boletas|mantenimiento|mantenimientos|proyecto|proyectos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|imagen|imagenes|imágenes|dispositivo|dispositivos|cámara|camara|zona|zonas|inventario|operatividad|avance|caso|casos|agenda|knowledge|conocimiento|procedimiento interno|manual interno|gu[ií]a interna)\b/i;
const KNOWLEDGE_HINT = /\b(knowledge|conocimiento|base de conocimiento|procedimiento interno|tutorial|documentaci[oó]n interna|nuestro manual|nuestra gu[ií]a)\b/i;
const DOCUMENT_HINT = /\b(manual|manuales|gu[ií]a|gu[ií]as|guide|documento|documentos|pdf|docx|archivo adjunto|adjunto|adjuntos|p[aá]gina|p[aá]ginas|secci[oó]n|secciones|documentaci[oó]n)\b/i;
const TECHNICAL_KNOWLEDGE_HINT = /\b(axis|onguard|lenel|lenels2|milestone|xprotect|barco|faceme|morphomanager|onvif|rtsp|poe|sip|audio manager|camera station|access control|windows server|sql server|postgresql|odbc|cctv|vms|nvr)\b/i;
const TECHNICAL_ACTION_HINT = /\b(error|falla|problema|soluci[oó]n|solucionar|resolver|configurar|configuraci[oó]n|instalar|procedimiento|manual|gu[ií]a|diagnosticar|diagn[oó]stico|integrar|integraci[oó]n|firmware|compatibilidad|puerto|poe|sip|multicast|qu[eé] dice|explica|explicar|buscar|busca|c[oó]mo|no funciona|no responde|no env[ií]a|no transmite|no conecta|sin audio|sin video|sin se[nñ]al)\b/i;
const MODEL_TOKEN = /\b(?:[A-Z]{1,8}[- ]?)?[A-Z]*\d{3,}[A-Z0-9-]*\b/i;
const KNOWLEDGE_FOLLOWUP = /\b(ese|esa|este|esta)\s+(manual|pdf|gu[ií]a|documento|p[aá]gina|secci[oó]n)\b|\b(qu[eé] m[aá]s dice|qu[eé] dice|dice algo|otra secci[oó]n|otra p[aá]gina|sobre poe|sobre audio|sobre integraci[oó]n|sobre configuraci[oó]n|y del c\d+|y sobre)\b/i;
const WEB_HINT = /\b(internet|web|google|buscar en internet|busca en internet|búscalo en internet|buscar en la web|busca en la web|busca online|buscar online)\b/i;
const TICKET_HINT = /\b(boleta|boletas|ticket|tickets|visita anterior|visitas?)\b/i;
const MAINTENANCE_HINT = /\b(mantenimiento|mantenimientos|proyecto|proyectos)\b|\bmantenimiento-[a-z0-9-]{8,}\b/i;
const DEVICE_HINT = /\b(dispositivo|dispositivos|equipo|equipos|cámara|camara|cámaras|camaras|nvr|grabador|servidor|zona|zonas|serie|serial|mac|modelo|fabricante|operatividad)\b/i;
const EVIDENCE_HINT = /\b(foto|fotos|imagen|imagenes|imágenes|evidencia|evidencias|video|videos|firma|archivo|archivos|antes|despu[eé]s|subi[oó]|subió|carg[oó]|cargado|cargada)\b/i;
const CLIENT_HINT = /\b(cliente|clientes|supervisor|supervisores)\b/i;
const USER_HINT = /\b(t[eé]cnico|t[eé]cnicos|usuario|usuarios|qui[eé]n trabaj[oó]|actividad de)\b/i;
const AGENDA_HINT = /\b(agenda|agendas|agendado|cita|visita programada|programaci[oó]n)\b/i;
const CASE_HINT = /\b(caso|casos|soporte cliente)\b/i;
const STATS_HINT = /\b(cu[aá]nt|cantidad|cantidades|total|totales|suma|sumas|estad[ií]stic|ranking|promedio|porcentaje|avance)\b/i;

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
function hasKnowledgeContext(context={}){
  return hasActive(context,'lastKnowledgeArticleId')
    ||hasActive(context,'lastKnowledgeDocumentId')
    ||hasActive(context,'lastKnowledgeDocumentName')
    ||String(context?.pageContext?.entityType||'').toLowerCase()==='knowledge';
}
function hasCompetingInternalDomain(value=''){
  return TICKET_HINT.test(value)||MAINTENANCE_HINT.test(value)||DEVICE_HINT.test(value)||EVIDENCE_HINT.test(value)
    ||CLIENT_HINT.test(value)||USER_HINT.test(value)||AGENDA_HINT.test(value)||CASE_HINT.test(value);
}

export function isKnowledgeDocumentQuery({message='',context={}}={}){
  const value=text(message);
  if(!value) return false;
  const active=hasKnowledgeContext(context);
  if(active&&!hasCompetingInternalDomain(value)&&(KNOWLEDGE_FOLLOWUP.test(value)||DOCUMENT_HINT.test(value))) return true;
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

  const explicitTicket=TICKET_HINT.test(value);
  const explicitMaintenance=MAINTENANCE_HINT.test(value);
  const explicitDevice=DEVICE_HINT.test(value);
  const explicitEvidence=EVIDENCE_HINT.test(value);
  const pageEntity=String(context?.pageContext?.entityType||'').toLowerCase();
  const ticketContext=hasActive(context,'lastTicketId')
    ||hasActive(context?.pageContext,'ticketId')
    ||(pageEntity==='ticket'&&hasActive(context?.pageContext,'entityId'));
  const maintenanceContext=hasActive(context,'lastMaintenanceId')
    ||hasActive(context?.pageContext,'maintenanceId')
    ||(pageEntity==='maintenance'&&hasActive(context?.pageContext,'entityId'));
  const deviceContext=hasActive(context,'lastDeviceId');

  if(wantsWrite&&(explicitMaintenance||maintenanceContext||explicitDevice||deviceContext||hasFiles)) return AI_INTENTS.WRITE_MAINTENANCE;
  if(WEB_HINT.test(value)) return AI_INTENTS.WEB;

  // Explicit operational domains always beat stale Knowledge context.
  if(explicitTicket){
    if(explicitEvidence) return AI_INTENTS.TICKET_EVIDENCE;
    if(STATS_HINT.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.TICKETS;
  }
  if(explicitMaintenance){
    if(explicitEvidence) return AI_INTENTS.MAINTENANCE_EVIDENCE;
    if(explicitDevice) return AI_INTENTS.MAINTENANCE_DEVICES;
    if(STATS_HINT.test(value)&&/\b(mantenimientos?|proyectos?)\b/i.test(value)) return AI_INTENTS.STATISTICS;
    return AI_INTENTS.MAINTENANCE;
  }
  if(explicitDevice&&(maintenanceContext||deviceContext)){
    return explicitEvidence?AI_INTENTS.MAINTENANCE_EVIDENCE:AI_INTENTS.MAINTENANCE_DEVICES;
  }
  if(explicitEvidence&&maintenanceContext) return AI_INTENTS.MAINTENANCE_EVIDENCE;
  if(explicitEvidence&&ticketContext) return AI_INTENTS.TICKET_EVIDENCE;

  if(CLIENT_HINT.test(value)) return AI_INTENTS.CLIENTS;
  if(USER_HINT.test(value)) return AI_INTENTS.USERS;
  if(AGENDA_HINT.test(value)) return AI_INTENTS.AGENDA;
  if(CASE_HINT.test(value)) return AI_INTENTS.CASES;
  if(STATS_HINT.test(value)&&INTERNAL_HINT.test(value)) return AI_INTENTS.STATISTICS;

  // Knowledge wins only when the current message actually points to Knowledge/technical documentation.
  if(isKnowledgeDocumentQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE_DOCUMENTS;
  if(KNOWLEDGE_HINT.test(value)) return AI_INTENTS.KNOWLEDGE;
  if(isTechnicalKnowledgeQuery({message:value,context})) return AI_INTENTS.KNOWLEDGE;

  // Context fallbacks are intentionally after explicit-domain detection.
  if(ticketContext) return explicitEvidence?AI_INTENTS.TICKET_EVIDENCE:AI_INTENTS.TICKETS;
  if(maintenanceContext) {
    if(explicitEvidence) return AI_INTENTS.MAINTENANCE_EVIDENCE;
    if(explicitDevice||deviceContext) return AI_INTENTS.MAINTENANCE_DEVICES;
    return AI_INTENTS.MAINTENANCE;
  }
  if(hasKnowledgeContext(context)&&KNOWLEDGE_FOLLOWUP.test(value)) return AI_INTENTS.KNOWLEDGE_DOCUMENTS;

  if(hasFiles) return AI_INTENTS.AMBIGUOUS;
  if(INTERNAL_HINT.test(value)) return AI_INTENTS.AMBIGUOUS;
  if(!lower) return AI_INTENTS.AMBIGUOUS;
  return AI_INTENTS.GENERAL;
}

const DISCOVERY_TOOLS=Object.freeze(['search_internal']);

export function toolNamesForIntent(intent){
  switch(intent){
    case AI_INTENTS.GENERAL: return [];
    case AI_INTENTS.TICKETS: return ['search_tickets','get_ticket','get_ticket_history','get_ticket_evidence','search_ticket_evidence'];
    case AI_INTENTS.TICKET_EVIDENCE: return ['search_tickets','get_ticket','search_ticket_evidence','get_ticket_evidence','get_ticket_history'];
    case AI_INTENTS.MAINTENANCE: return ['resolve_maintenance_reference','search_maintenances','get_maintenance','get_maintenance_history','get_maintenance_devices','get_maintenance_evidence'];
    case AI_INTENTS.MAINTENANCE_DEVICES: return ['resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices','get_maintenance_evidence','search_maintenance_evidence','search_devices'];
    case AI_INTENTS.MAINTENANCE_EVIDENCE: return ['resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices','get_maintenance_evidence','search_maintenance_evidence'];
    case AI_INTENTS.CLIENTS: return ['search_clients','get_client'];
    case AI_INTENTS.USERS: return ['search_users','get_technician_activity','search_tickets','search_evidence_activity'];
    case AI_INTENTS.KNOWLEDGE: return ['search_knowledge_base','get_knowledge_article','search_knowledge_documents','get_knowledge_document','search_knowledge_document_chunks'];
    case AI_INTENTS.KNOWLEDGE_DOCUMENTS: return ['search_knowledge_base','get_knowledge_article','search_knowledge_documents','get_knowledge_document','search_knowledge_document_chunks'];
    case AI_INTENTS.AGENDA: return ['search_agenda'];
    case AI_INTENTS.CASES: return ['search_cases','get_case'];
    case AI_INTENTS.STATISTICS: return [
      'get_statistics',
      'search_maintenances','resolve_maintenance_reference','get_maintenance','get_maintenance_devices','get_maintenance_evidence','search_maintenance_evidence',
      'search_tickets','get_ticket','get_ticket_evidence','search_ticket_evidence',
      'search_users','get_technician_activity','search_evidence_activity',
    ];
    case AI_INTENTS.WRITE_MAINTENANCE: return [
      'resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices',
      'parse_device_import_file','prepare_maintenance_device_bulk_create','prepare_maintenance_evidence_upload','get_ai_operation_status',
      'read_chat_attachment',
    ];
    case AI_INTENTS.WEB: return [];
    case AI_INTENTS.AMBIGUOUS: return [...DISCOVERY_TOOLS];
    default:return [...DISCOVERY_TOOLS];
  }
}

export function toolNamesForEntityTypes(types=[]){
  const set=new Set((Array.isArray(types)?types:[]).map(value=>text(value).toLowerCase()).filter(Boolean));
  const names=new Set();
  const add=(intent)=>toolNamesForIntent(intent).forEach(name=>names.add(name));
  if(set.has('maintenance')||set.has('device')) add(AI_INTENTS.MAINTENANCE_DEVICES);
  if(set.has('ticket')) add(AI_INTENTS.TICKET_EVIDENCE);
  if(set.has('client')) add(AI_INTENTS.CLIENTS);
  if(set.has('user')) add(AI_INTENTS.USERS);
  if(set.has('knowledge')) add(AI_INTENTS.KNOWLEDGE_DOCUMENTS);
  if(set.has('case')) add(AI_INTENTS.CASES);
  if(set.has('agenda')) add(AI_INTENTS.AGENDA);
  return [...names];
}
