const INTERNAL_HINT = /\b(dms|boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|dispositivos|cámara|camara|caso|casos|agenda|knowledge|conocimiento|procedimiento interno|manual interno)\b/i;

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

  if(/\b(manual|manuales|documento|documentos|pdf|docx|archivo adjunto|adjunto|adjuntos|página|pagina|diagrama)\b/i.test(value)
    && (/\b(knowledge|conocimiento|base de conocimiento)\b/i.test(value)||hasActive(context,'lastKnowledgeArticleId')||hasActive(context,'lastKnowledgeDocumentId'))) {
    return AI_INTENTS.KNOWLEDGE_DOCUMENTS;
  }
  if(/\b(knowledge|conocimiento|base de conocimiento|procedimiento interno|tutorial)\b/i.test(value)) return AI_INTENTS.KNOWLEDGE;

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
    case AI_INTENTS.MAINTENANCE_EVIDENCE: return ['resolve_maintenance_reference','resolve_maintenance_device','search_maintenances','get_maintenance','get_maintenance_devices','get_maintenance_evidence'];
    case AI_INTENTS.CLIENTS: return ['search_clients','get_client'];
    case AI_INTENTS.USERS: return ['search_users','get_technician_activity','search_tickets'];
    case AI_INTENTS.KNOWLEDGE: return ['search_knowledge_base','get_knowledge_article','search_knowledge_documents','search_knowledge_document_chunks'];
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
