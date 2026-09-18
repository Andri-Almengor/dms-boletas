import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AppError, badRequest } from '../core/errors.js';
import { query, withDbRequestMetrics } from '../infra/postgres.js';
import { audit } from '../services/audit.service.js';
import { aiConfig, configuredModels } from './agent.config.js';
import { costaRicaNowIso } from './agent.dates.js';
import {
  createInteraction, externalSources, fallbackCompatible, functionCalls, outputText, outputTruncated, usage,
} from './agent.gemini.js';
import { AI_INTENTS, classifyAiIntent, isKnowledgeDocumentQuery, isTechnicalKnowledgeQuery, toolNamesForEntityTypes, toolNamesForIntent } from './agent.intent.js';
import { recordAiMetrics } from './agent.metrics.js';
import { buildAgentSystemPrompt, buildAgentUserInput } from './agent.prompt.js';
import { sanitizeActiveContext } from './agent.sanitize.js';
import { declarationsForUser, executeAiTool } from './agent.tools.js';

const REQUESTS=new Map();

function clean(value,max=4000){return String(value??'').trim().slice(0,max);}
function uniqueBy(items,key){const seen=new Set();return items.filter(item=>{const value=key(item);if(!value||seen.has(value))return false;seen.add(value);return true;});}

function uniqueStrings(values = [], limit = 24) {
  return [...new Set(values.map((value) => clean(value, 300)).filter(Boolean))].slice(-limit);
}
function detectTechnicalProduct(message = '', previous = '') {
  const value = String(message || '');
  const products = [
    [/\bOnGuard\b/i, 'OnGuard'],
    [/\bLenelS2\b|\bLenel\b/i, 'LenelS2'],
    [/\bXProtect\b/i, 'Milestone XProtect'],
    [/\bMilestone\b/i, 'Milestone'],
    [/\bAxis\b/i, 'Axis'],
    [/\bBarco(?:\s+CTRL)?\b/i, 'Barco CTRL'],
    [/\bFaceMe\b/i, 'FaceMe'],
    [/\bWindows\s+Server\b/i, 'Windows Server'],
    [/\bSQL\s+Server\b/i, 'SQL Server'],
    [/\bPostgreSQL\b/i, 'PostgreSQL'],
    [/\bODBC\b/i, 'ODBC'],
    [/\bCamera\s+Station\b/i, 'Camera Station'],
    [/\bAccess\s+Control\b/i, 'Access Control'],
  ];
  const matched = products.find(([pattern]) => pattern.test(value))?.[1] || '';
  const prior = clean(previous, 160);
  const followUpResult = /\b(ya|prob[eé]|revis[eé]|reinici[eé]|verifiqu[eé]|comprob[eé]|descart[eé]|funciona|funcion[oó]|fall[óo]|est[aá] iniciado|respond[ií]o)\b/i.test(value);
  const explicitNewIssue = /\b(nuevo|otro|ahora)\b.{0,50}\b(error|falla|problema|no responde|no funciona)\b/i.test(value);
  if (prior && matched && matched !== prior && followUpResult && !explicitNewIssue) return prior;
  return matched || prior;
}
function updateTroubleshootingContext(context = {}, message = '') {
  const previous = context.currentTechnicalIssue && typeof context.currentTechnicalIssue === 'object'
    ? context.currentTechnicalIssue : {};
  const product = detectTechnicalProduct(message, previous.product || context.lastTechnicalProduct);
  const technical = Boolean(product) || /\b(error|falla|problema|no responde|no funciona|troubleshoot|diagn[oó]stic)\b/i.test(message);
  if (!technical && !Object.keys(previous).length) return context;
  const sentences = String(message || '').split(/(?:\r?\n|(?<=[.!?])\s+)/).map((item) => clean(item, 300)).filter(Boolean);
  const attempted = sentences.filter((item) => /\b(ya|prob[eé]|revis[eé]|reinici[eé]|verifiqu[eé]|comprob[eé]|intent[eé]|descart[eé]|funciona|fall[óo]|no funciona|est[aá] iniciado|respond[ií]o)\b/i.test(item));
  const successful = attempted.filter((item) => /\b(funciona|funcion[oó]|correcto|correctamente|respond[ií]o|est[aá] iniciado|est[aá] activo|conexi[oó]n.*bien)\b/i.test(item) && !/\b(no funciona|fall[óo]|error)\b/i.test(item));
  const failed = attempted.filter((item) => /\b(no funciona|no funcion[oó]|fall[óo]|sigue|mismo error|sin respuesta)\b/i.test(item));
  const issueSentence = sentences.find((item) => /\b(error|falla|problema|no responde|no funciona)\b/i.test(item));
  const errorCodes = String(message || '').match(/\b(?:0x[0-9a-f]+|ERR(?:OR)?[_ -]?[A-Z0-9-]{2,}|E[0-9]{3,})\b/gi) || [];
  const issue = {
    product,
    problem: clean(previous.problem || issueSentence || context.lastTechnicalIssue, 500),
    errorCodes: uniqueStrings([...(previous.errorCodes || []), ...errorCodes]),
    confirmedFacts: uniqueStrings([...(previous.confirmedFacts || []), ...successful]),
    attemptedSteps: uniqueStrings([...(previous.attemptedSteps || []), ...attempted]),
    ruledOutCauses: uniqueStrings([...(previous.ruledOutCauses || []), ...successful]),
    successfulTests: uniqueStrings([...(previous.successfulTests || []), ...successful]),
    failedTests: uniqueStrings([...(previous.failedTests || []), ...failed]),
  };
  return {
    ...context,
    currentTechnicalIssue: issue,
    ...(product ? { lastTechnicalProduct: product } : {}),
    ...(issue.problem ? { lastTechnicalIssue: issue.problem } : {}),
  };
}

const MAX_DIAGNOSTIC_IMAGE_BYTES = 10 * 1024 * 1024;
const DIAGNOSTIC_IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif)$/i;
async function loadDiagnosticImageInputs(attachments = []) {
  const candidates = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => DIAGNOSTIC_IMAGE_MIME.test(String(item?.mimeType || '')))
    .slice(0, 3);
  if (!candidates.length) return [];
  const { driveApi } = await import('../infra/google.js');
  const output = [];
  for (const item of candidates) {
    const size = Number(item?.size || 0);
    if (!item?.__file || !Number.isFinite(size) || size <= 0 || size > MAX_DIAGNOSTIC_IMAGE_BYTES) continue;
    try {
      const response = await driveApi.files.get(
        { fileId: item.__file, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      const buffer = Buffer.from(response.data);
      if (!buffer.length || buffer.length > MAX_DIAGNOSTIC_IMAGE_BYTES) continue;
      output.push({
        type: 'image',
        data: buffer.toString('base64'),
        mime_type: String(item.mimeType || 'image/jpeg').toLowerCase(),
        resolution: 'high',
      });
    } catch {
      // El archivo sigue disponible por metadata; una falla visual no expone Drive ni rompe toda la conversación.
    }
  }
  return output;
}

function sessionFingerprint(sessionToken){return crypto.createHash('sha256').update(clean(sessionToken,12000)).digest('base64url');}
function requiresInternalEvidence(message,context={}){
  const text=String(message||'');
  const refersToContext=/\b(ese|esa|este|esta|mismo|misma|anterior|anteriores|último|ultimo|última|ultima|las demás|los demás|ahí|ahi)\b/i.test(text);
  if(refersToContext&&Object.keys(context||{}).some(key=>/^last(Client|Maintenance|Ticket|Knowledge|Case|User|Device)/.test(key))) return true;
  if(context?.pageContext?.route&&/\b(esta sección|esta seccion|esta pantalla|aquí|aqui|qué hace|que hace)\b/i.test(text)) return true;
  return /\b(dms|boleta|boletas|mantenimiento|mantenimientos|proyecto|proyectos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|foto|fotos|imagen|imagenes|imágenes|dispositivo|dispositivos|equipo|equipos|cámara|camara|zona|zonas|inventario|operatividad|avance|caso|casos|agenda|pendiente|finalizada|finalizó|finalizo|subió|subio|base de conocimiento|knowledge)\b/i.test(text);
}
function requiresKnowledgeLookup(message,context={}){
  return isTechnicalKnowledgeQuery({message,context});
}
function knowledgeToolName(name=''){return /^search_knowledge_|^get_knowledge_/.test(String(name||''));}
function hashAiUser(ctx){
  const value=clean(ctx?.user?.UsuarioID||'',250);
  return value?crypto.createHash('sha256').update(value).digest('hex').slice(0,16):'';
}
function toolsetNames(toolset=[]){
  return toolset.filter((item)=>item?.type==='function'&&item?.name).map((item)=>item.name);
}
function externalRequested(message){
  const text=String(message||'');
  const explicit=/\b(internet|web|google|buscar en internet|busca en internet|búscalo en internet|buscar en la web|busca en la web)\b/i.test(text);
  if(explicit)return true;
  const internal=/\b(dms|boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|caso|agenda|knowledge|conocimiento)\b/i.test(text);
  return !internal&&/\b(actual(?:izado|izada|es)?|hoy en día|hoy en dia|latest|reciente)\b/i.test(text);
}
function assertRateLimit(ctx){
  const key=clean(ctx?.user?.UsuarioID||ctx?.sessionToken,250)||'anonymous';
  const now=Date.now(),recent=(REQUESTS.get(key)||[]).filter(ts=>now-ts<60000);
  if(recent.length>=aiConfig.rateLimitPerMinute)throw new AppError('AI_RATE_LIMIT','Ha realizado demasiadas consultas al asistente. Intente nuevamente en un momento.',429);
  recent.push(now);REQUESTS.set(key,recent);
  if(REQUESTS.size>2000){for(const [id,times] of REQUESTS){if(!times.some(ts=>now-ts<60000))REQUESTS.delete(id);}}
}
async function withTimeout(promise,ms,name){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AppError('AI_TOOL_TIMEOUT',`La consulta ${name} tardó demasiado.`,504)),Math.max(1,ms));timer.unref?.();})]);}
  finally{clearTimeout(timer);}
}
function mergeUi(target,ui={}){
  target.entities.push(...(ui.entities||[]));
  target.attachments.push(...(ui.attachments||[]));
  target.sources.push(...(ui.sources||[]));
  target.confirmations.push(...(ui.confirmations||[]));
  target.context={...target.context,...(ui.context||{})};
}
function functionResult(call,result){return{type:'function_result',name:call.name,call_id:call.id,result:[{type:'text',text:JSON.stringify(result)}]};}
function conversationParts(history=[]){
  const rows=Array.isArray(history)?history:[];
  const recent=rows.slice(-aiConfig.maxHistoryMessages);
  const older=rows.slice(Math.max(0,rows.length-aiConfig.maxHistoryMessages*2),Math.max(0,rows.length-aiConfig.maxHistoryMessages));
  const summary=older.map(item=>`${item?.role==='assistant'?'Asistente':'Usuario'}: ${clean(item?.text,600)}`).join('\n').slice(-4000);
  return{recent,summary};
}
function compactTimeline(timeline=[]){
  if(timeline.length<=14)return timeline;
  const first=timeline[0];
  const tail=timeline.slice(-12);
  return [first,...tail.filter(item=>item!==first)];
}
function outputBudget(intent,message){
  const long=/\b(detall|completo|explica|resume|informe|reporte|manual|procedimiento)\b/i.test(String(message||''));
  if(long||[AI_INTENTS.KNOWLEDGE,AI_INTENTS.KNOWLEDGE_DOCUMENTS].includes(intent))return aiConfig.maxOutputTokens;
  return Math.max(1024,Math.min(aiConfig.maxOutputTokens,4096));
}
function safeTelemetry(value){return clean(value,160).replace(/[\r\n]/g,' ');}

async function loadChatAttachments(ctx,ids=[]){
  const requested=[...new Set((Array.isArray(ids)?ids:[]).map(value=>clean(value,250)).filter(Boolean))].slice(0,aiConfig.maxEvidenceUploadBatch);
  if(!requested.length)return[];
  const result=await query(
    `SELECT "UploadID" AS "uploadId","NombreArchivo" AS name,"MimeType" AS "mimeType","SizeBytes" AS size,
            "DriveFileID" AS "__file","Status" AS status,"ExpiresAt" AS "expiresAt"
       FROM "AiChatUploads"
      WHERE "__valid"=TRUE AND "UploadID"=ANY($1::text[]) AND "UserID"=$2 AND "SessionHash"=$3
        AND "Status" IN ('AVAILABLE','CONSUMED')`,
    [requested,clean(ctx?.user?.UsuarioID,250),sessionFingerprint(ctx.sessionToken)],
    {label:'ai.attachments.metadata'},
  );
  const byId=new Map(result.rows.map(row=>[row.uploadId,row]));
  const ordered=requested.map(id=>byId.get(id)).filter(Boolean);
  if(ordered.length!==requested.length)throw badRequest('Uno o más adjuntos ya no están disponibles o pertenecen a otra sesión.');
  return ordered.map(row=>({
    uploadId:row.uploadId,
    name:row.name||'Archivo',
    mimeType:row.mimeType||'application/octet-stream',
    size:Number(row.size||0),
    status:row.status||'AVAILABLE',
    __file:clean(row.__file,300),
  }));
}

export function modelFallbackChain(){
  const models=configuredModels();
  return aiConfig.modelFallbackEnabled?models.slice(0,1+aiConfig.maxModelFallbacks):models.slice(0,1);
}

export async function runDmsAgent(ctx, overrides = {}){
  assertRateLimit(ctx);
  const createInteractionFn=overrides.createInteraction||createInteraction;
  const executeAiToolFn=overrides.executeAiTool||executeAiTool;
  const auditFn=overrides.audit||audit;
  const started=performance.now(),deadline=started+aiConfig.totalTimeoutMs;
  const message=clean(ctx.payload?.message||ctx.payload?.question,aiConfig.maxMessageChars);
  if(!message)throw badRequest('Escriba una pregunta para el asistente.');

  let context=sanitizeActiveContext(ctx.payload?.context||{});
  context=updateTroubleshootingContext(context,message);
  const payloadAttachmentIds=Array.isArray(ctx.payload?.attachmentIds)?ctx.payload.attachmentIds:[];
  const contextualIds=Array.isArray(context.pendingUploadIds)?context.pendingUploadIds:[];
  const attachmentIds=payloadAttachmentIds.length?payloadAttachmentIds:contextualIds;
  const chatAttachments=await loadChatAttachments(ctx,attachmentIds);
  const diagnosticImages=await loadDiagnosticImageInputs(chatAttachments);
  if(payloadAttachmentIds.length)context=sanitizeActiveContext({...context,pendingUploadIds:chatAttachments.map(item=>item.uploadId)});

  const history=conversationParts(ctx.payload?.history||[]);
  const knowledgeDocumentRequired=isKnowledgeDocumentQuery({message,context})||diagnosticImages.length>0;
  const knowledgeRequired=requiresKnowledgeLookup(message)||diagnosticImages.length>0||knowledgeDocumentRequired;
  let intent=classifyAiIntent({message,context,attachments:chatAttachments});
  if(knowledgeRequired&&[AI_INTENTS.GENERAL,AI_INTENTS.AMBIGUOUS].includes(intent)){
    intent=knowledgeDocumentRequired?AI_INTENTS.KNOWLEDGE_DOCUMENTS:AI_INTENTS.KNOWLEDGE;
  }
  const internalEvidenceRequired=requiresInternalEvidence(message,context)||intent!==AI_INTENTS.GENERAL&&intent!==AI_INTENTS.WEB;
  let selectedNames=toolNamesForIntent(intent);
  if(chatAttachments.length) selectedNames=[...new Set([...selectedNames,'read_chat_attachment'])];
  if(context?.pageContext?.route&&/\b(esta sección|esta seccion|esta pantalla|qué hace|que hace)\b/i.test(message)){
    selectedNames=[...new Set([...selectedNames,'get_app_help'])];
  }

  let webEnabledForTurn=aiConfig.webSearchEnabled&&(intent===AI_INTENTS.WEB||(externalRequested(message)&&!knowledgeRequired));
  let tools=declarationsForUser(ctx,{includeWeb:webEnabledForTurn,intent,selectedNames});
  const exposedKnowledgeTools=toolsetNames(tools).filter(knowledgeToolName);
  if(knowledgeRequired&&!exposedKnowledgeTools.length){
    console.warn('[ai-knowledge] '+JSON.stringify({
      event:'knowledge_tool_not_exposed',
      domainEvent:'ai_knowledge_error',
      requestId:clean(ctx.requestId,120),
      userIdHash:hashAiUser(ctx),
      intent,
    }));
  }
  const systemInstruction=buildAgentSystemPrompt({user:ctx.user,permissions:ctx.permissions,nowIso:costaRicaNowIso()});
  const inputText=buildAgentUserInput({message,history:history.recent,context,attachments:chatAttachments,conversationSummary:history.summary});
  let timeline=[{type:'user_input',content:[...diagnosticImages,{type:'text',text:inputText}]}];
  const ui={entities:[],attachments:[],sources:[],confirmations:[],context:{...context}};
  const toolNames=[];let modelMs=0,toolMs=0,totalInput=0,totalOutput=0,dbQueries=0,dbQueryMs=0,requestBytes=0;
  const knowledgeFlow={articleSearches:0,articleResults:0,documentSearches:0,documentsFound:0,readyDocuments:0,chunkSearches:0,chunksFound:0,errors:0};
  let knowledgeChunks=0,initialModel='',finalModel='',fallbackCount=0,fallbackReason='',modelIndex=0,compacted=false;
  const models=Array.isArray(overrides.models)&&overrides.models.length?[...overrides.models]:modelFallbackChain();
  if(!models.length)throw new AppError('GEMINI_MODEL_NOT_CONFIGURED','Configure GEMINI_PRIMARY_MODEL o GEMINI_MODEL en el servidor.',503);
  initialModel=models[0];finalModel=models[0];
  const maxOutputTokens=outputBudget(intent,message);

  const remaining=()=>Math.max(0,deadline-performance.now());
  const assertTime=(needed=1)=>{
    if(remaining()<needed)throw new AppError('AI_AGENT_TOTAL_TIMEOUT','El asistente alcanzó el tiempo máximo total de procesamiento.',504);
  };

  const callModel=async({input,toolset=tools,noTools=false})=>{
    let localInput=input;
    for(;;){
      assertTime(250);
      const model=models[Math.min(modelIndex,models.length-1)];
      finalModel=model;
      const timeoutMs=Math.max(250,Math.min(aiConfig.requestTimeoutMs,Math.floor(remaining())));
      const modelStarted=performance.now();
      try{
        const interaction=await createInteractionFn({
          systemInstruction,input:localInput,tools:noTools?[]:toolset,model,timeoutMs,maxOutputTokens,
        });
        modelMs+=performance.now()-modelStarted;
        const u=usage(interaction);totalInput+=u.inputTokens;totalOutput+=u.outputTokens;
        requestBytes+=Number(interaction.__dmsRequestBytes||0);
        return interaction;
      }catch(error){
        modelMs+=performance.now()-modelStarted;
        const code=String(error?.code||'');
        if(code==='CONTEXT_TOO_LARGE'&&!compacted){
          localInput=compactTimeline(localInput);
          timeline=localInput;
          compacted=true;
          continue;
        }
        const canFallback=fallbackCompatible(error)&&aiConfig.modelFallbackEnabled
          && fallbackCount<aiConfig.maxModelFallbacks&&modelIndex+1<models.length&&remaining()>1000;
        if(!canFallback)throw error;
        fallbackReason=code||'MODEL_FAILURE';
        fallbackCount+=1;modelIndex+=1;compacted=false;
      }
    }
  };

  const finishResponse=async(answer,{limited=false}={})=>{
    const response={
      type:'answer',answer,
      entities:uniqueBy(ui.entities,item=>item.type+':'+item.id).slice(0,50),
      attachments:uniqueBy(ui.attachments,item=>item.url).slice(0,50),
      confirmations:uniqueBy(ui.confirmations,item=>item.operationId).slice(0,10),
      sources:uniqueBy(ui.sources,item=>(item.type||'')+':'+(item.id||item.url||item.label)).slice(0,30),
      suggestions:[],
      context:sanitizeActiveContext({...context,...ui.context,lastIntent:intent}),
      agent:{
        modelInitial:initialModel,modelFinal:finalModel,fallbackCount,fallbackReason,
        toolCalls:toolNames.length,tools:[...new Set(toolNames)],toolDefinitionsCount:tools.length,
        webSearch:ui.sources.some(item=>item.type==='external'),intent,limited,compacted,
      },
    };
    const durationMs=Math.round(performance.now()-started),responseBytes=Buffer.byteLength(JSON.stringify(response),'utf8');
    recordAiMetrics({
      durationMs,modelDurationMs:modelMs,toolCalls:toolNames.length,toolDurationMs:toolMs,dbQueries,dbQueryMs,
      inputTokens:totalInput,outputTokens:totalOutput,responseBytes,requestBytes,fallbackCount,
      toolDefinitionsCount:tools.length,knowledgeChunks,attachments:response.attachments.length,
    });
    const telemetry={
      requestId:clean(ctx.requestId,120),conversationId:clean(ctx.payload?.conversationId,120),
      modelInitial:initialModel,modelFinal:finalModel,fallbackCount,fallbackReason:safeTelemetry(fallbackReason),
      intent,durationMs,geminiMs:Math.round(modelMs),toolMs:Math.round(toolMs),dbMs:Math.round(dbQueryMs),
      toolDefinitionsCount:tools.length,toolCalls:toolNames.length,inputTokens:totalInput,outputTokens:totalOutput,
      requestBytes,responseBytes,knowledgeChunks,attachments:response.attachments.length,status:'ok',
    };
    console.info('[ai-agent] '+JSON.stringify(telemetry));
    await auditFn(ctx,'AI_CHAT','Asistente',clean(ctx.payload?.conversationId,250)||'chat',null,{
      ModelInitial:initialModel,ModelFinal:finalModel,FallbackCount:fallbackCount,FallbackReason:fallbackReason,
      Intent:intent,Herramientas:[...new Set(toolNames)],DuracionMs:durationMs,BusquedaWeb:response.agent.webSearch,
    }).catch(()=>{});
    return response;
  };

  try{
    for(let round=0;round<aiConfig.maxToolRounds;round+=1){
      const interaction=await callModel({input:timeline,toolset:tools});
      timeline.push(...(interaction.steps||[]));
      ui.sources.push(...externalSources(interaction));
      const calls=functionCalls(interaction);
      if(!calls.length){
        const hasInternalTool=toolNames.length>0;
        const hasKnowledgeTool=toolNames.some(knowledgeToolName);
        const exposed=new Set(toolsetNames(tools));
        const needFirstKnowledgeCall=knowledgeRequired&&exposedKnowledgeTools.length&&!hasKnowledgeTool;
        const needArticleSearch=knowledgeDocumentRequired&&exposed.has('search_knowledge_base')&&knowledgeFlow.articleSearches===0;
        const needDocumentSearch=knowledgeRequired&&exposed.has('search_knowledge_documents')&&knowledgeFlow.documentSearches===0;
        const needChunkSearch=knowledgeFlow.documentsFound>0&&knowledgeFlow.readyDocuments>0
          &&exposed.has('search_knowledge_document_chunks')&&knowledgeFlow.chunkSearches===0;
        const retryChunkSearch=knowledgeFlow.documentsFound>0&&knowledgeFlow.readyDocuments>0
          &&knowledgeFlow.chunkSearches>0&&knowledgeFlow.chunksFound===0&&knowledgeFlow.chunkSearches<2
          &&exposed.has('search_knowledge_document_chunks');
        const internalKnowledgeExhausted=knowledgeFlow.documentSearches>0&&(
          knowledgeFlow.documentsFound===0
          ||(knowledgeFlow.readyDocuments>0&&knowledgeFlow.chunkSearches>0&&knowledgeFlow.chunksFound===0&&!retryChunkSearch)
        );
        if(round<aiConfig.maxToolRounds-1&&aiConfig.webSearchEnabled&&!webEnabledForTurn
          &&knowledgeRequired&&externalRequested(message)&&internalKnowledgeExhausted){
          webEnabledForTurn=true;
          tools=declarationsForUser(ctx,{includeWeb:true,intent,selectedNames});
          timeline.push({
            type:'user_input',
            content:[{type:'text',text:'La recuperación interna razonable ya fue agotada y no cubrió este punto. Ahora puedes consultar web si resulta necesario; prioriza documentación oficial del fabricante y separa claramente web de Knowledge.'}],
          });
          continue;
        }
        if(round<aiConfig.maxToolRounds-1&&(needFirstKnowledgeCall||needArticleSearch||needDocumentSearch||needChunkSearch||retryChunkSearch
          ||(internalEvidenceRequired&&tools.length&&!hasInternalTool))){
          let instruction='Antes de responder esta pregunta sobre DMS, consulta una de las herramientas internas disponibles. No respondas datos internos desde conocimiento general.';
          if(needFirstKnowledgeCall||needArticleSearch){
            instruction='Antes de responder, consulta search_knowledge_base con los términos técnicos significativos. Después continúa a documentos si existe documentación relacionada.';
          }else if(needDocumentSearch){
            instruction='La consulta interna todavía no está completa. Usa search_knowledge_documents aunque el artículo tenga ContenidoHTML vacío; busca por producto, modelo, categoría y nombre del documento.';
          }else if(needChunkSearch){
            instruction='Encontraste un documento interno indexado. Antes de decir qué contiene, usa search_knowledge_document_chunks sobre el documento relevante y recupera solo fragmentos pertinentes.';
          }else if(retryChunkSearch){
            instruction='La primera búsqueda dentro del documento no encontró fragmentos. Reformula una vez la búsqueda con términos equivalentes técnicos del mismo tema y vuelve a usar search_knowledge_document_chunks. No cargues el documento completo.';
          }
          timeline.push({type:'user_input',content:[{type:'text',text:instruction}]});
          continue;
        }
        if(internalEvidenceRequired&&tools.length&&!hasInternalTool)throw new AppError('AI_INTERNAL_SOURCE_REQUIRED','No fue posible verificar la información interna solicitada. Intente nuevamente.',502);
        let answer=outputText(interaction);
        if(!answer)throw new AppError('AI_EMPTY_RESPONSE','Gemini no devolvió una respuesta utilizable.',502);
        if(outputTruncated(interaction)&&remaining()>1500){
          const continuation=await callModel({
            input:[...timeline,{type:'user_input',content:[{type:'text',text:'Continúa exactamente desde donde quedó truncada la respuesta anterior. No repitas el contenido ya escrito y no solicites herramientas.'}]}],
            noTools:true,
          });
          const extra=outputText(continuation);
          if(extra)answer+=`\n\n${extra}`;
        }
        return finishResponse(answer);
      }

      const batches=[];for(let i=0;i<calls.length;i+=aiConfig.maxParallelTools)batches.push(calls.slice(i,i+aiConfig.maxParallelTools));
      for(const batch of batches){
        assertTime(100);
        const executions=await Promise.all(batch.map(async call=>{
          toolNames.push(call.name);
          const toolStarted=performance.now();
          const knowledgeCall=knowledgeToolName(call.name);
          if(knowledgeCall){
            if(call.name==='search_knowledge_base')knowledgeFlow.articleSearches+=1;
            if(call.name==='search_knowledge_documents')knowledgeFlow.documentSearches+=1;
            if(call.name==='search_knowledge_document_chunks')knowledgeFlow.chunkSearches+=1;
            console.info('[ai-knowledge] '+JSON.stringify({
              event:'knowledge_tool_called',domainEvent:'ai_knowledge_search_started',
              requestId:clean(ctx.requestId,120),userIdHash:hashAiUser(ctx),toolName:call.name,
              queryLength:clean(call.arguments?.query,2000).length,
              articleId:clean(call.arguments?.articleId,250)||undefined,
              documentId:clean(call.arguments?.documentId,250)||undefined,
              toolRound:round+1,
            }));
          }
          try{
            const measured=await withTimeout(
              withDbRequestMetrics(()=>executeAiToolFn(ctx,call.name,call.arguments||{})),
              Math.max(1,Math.min(aiConfig.toolTimeoutMs,Math.floor(remaining()))),call.name,
            );
            dbQueries+=Number(measured.metrics?.queries||0);dbQueryMs+=Number(measured.metrics?.queryMs||0);
            mergeUi(ui,measured.result.ui);
            if(call.name==='search_internal'){
              const discoveredTypes=[...new Set((measured.result.modelData?.matches||[])
                .map(item=>String(item?.type||'').toLowerCase()).filter(Boolean))];
              const discoveredTools=toolNamesForEntityTypes(discoveredTypes);
              const expanded=[...new Set([...selectedNames,...discoveredTools])];
              if(expanded.length!==selectedNames.length){
                selectedNames=expanded;
                tools=declarationsForUser(ctx,{includeWeb:webEnabledForTurn,intent,selectedNames});
                console.info('[ai-agent] '+JSON.stringify({
                  event:'ai_internal_toolset_expanded',
                  requestId:clean(ctx.requestId,120),
                  intent,
                  discoveredTypes,
                  toolDefinitionsCount:tools.length,
                }));
              }
            }
            if(knowledgeCall){
              const modelData=measured.result.modelData||{};
              const totalShown=Number(modelData.totalShown||0);
              const items=Array.isArray(modelData.items)?modelData.items:[];
              if(call.name==='search_knowledge_base')knowledgeFlow.articleResults+=totalShown;
              if(call.name==='search_knowledge_documents'){
                knowledgeFlow.documentsFound+=totalShown;
                knowledgeFlow.readyDocuments+=items.filter((item)=>['READY','INDEXED'].includes(String(item?.state||item?.extractionStatus||'').toUpperCase())).length;
              }
              if(call.name==='search_knowledge_document_chunks'){
                knowledgeFlow.chunksFound+=totalShown;knowledgeChunks+=totalShown;
              }
              const state=clean(modelData.state,80)|| (totalShown?'OK':'NO_RESULTS');
              const extractionStatus=clean(modelData.document?.extractionStatus||items[0]?.extractionStatus,80);
              let event=totalShown?'knowledge_tool_result':'knowledge_tool_empty';
              let domainEvent=totalShown?'ai_knowledge_search_result':'ai_knowledge_empty';
              if(call.name==='search_knowledge_documents'&&totalShown){event='knowledge_tool_result';domainEvent='ai_knowledge_document_found';}
              if(call.name==='search_knowledge_document_chunks'&&totalShown){event='knowledge_tool_result';domainEvent='ai_knowledge_chunks_found';}
              if(['PROCESSING','UPLOADED','PENDING'].includes(String(state||extractionStatus).toUpperCase())){event='knowledge_document_not_indexed';domainEvent='ai_knowledge_not_indexed';}
              if(state==='EXTRACTION_FAILED'||String(extractionStatus).toUpperCase()==='FAILED'){event='knowledge_document_not_indexed';domainEvent='ai_knowledge_error';}
              console.info('[ai-knowledge] '+JSON.stringify({
                event,domainEvent,requestId:clean(ctx.requestId,120),userIdHash:hashAiUser(ctx),
                toolName:call.name,queryLength:clean(call.arguments?.query,2000).length,
                articleId:clean(call.arguments?.articleId||modelData.document?.articleId||items[0]?.articleId,250)||undefined,
                documentId:clean(call.arguments?.documentId||modelData.document?.id||items[0]?.documentId||items[0]?.id,250)||undefined,
                searchMs:Math.round(performance.now()-toolStarted),chunksReturned:call.name==='search_knowledge_document_chunks'?totalShown:undefined,
                extractionStatus:extractionStatus||undefined,sourceType:call.name==='search_knowledge_document_chunks'?'knowledge_document_chunk':call.name==='search_knowledge_documents'?'knowledge_document':'knowledge',
                state,toolRound:round+1,
              }));
            }
            if(/^(search_|get_statistics$|get_technician_activity$)/.test(call.name)){
              ui.context={
                ...ui.context,lastSearchTool:call.name,
                lastSearchQuery:clean(call.arguments?.query||call.arguments?.technician||call.arguments?.technicianName,300),
                lastSearchOffset:String(Number(call.arguments?.offset||0)),
                lastSearchLimit:String(Number(call.arguments?.limit||aiConfig.maxToolResultRows)),
                lastSearchStatus:clean(call.arguments?.status,80),
                lastSearchPeriod:clean(call.arguments?.period||call.arguments?.month||'',80),
              };
            }
            return functionResult(call,{ok:true,data:measured.result.modelData});
          }catch(error){
            if(knowledgeCall){
              knowledgeFlow.errors+=1;
              console.warn('[ai-knowledge] '+JSON.stringify({
                event:error?.status===403?'knowledge_tool_permission_denied':'knowledge_document_search_failed',
                domainEvent:'ai_knowledge_error',requestId:clean(ctx.requestId,120),userIdHash:hashAiUser(ctx),
                toolName:call.name,queryLength:clean(call.arguments?.query,2000).length,
                articleId:clean(call.arguments?.articleId,250)||undefined,documentId:clean(call.arguments?.documentId,250)||undefined,
                searchMs:Math.round(performance.now()-toolStarted),toolRound:round+1,
                reason:clean(error?.code||error?.name||'AI_TOOL_ERROR',80),
              }));
            }
            return functionResult(call,{ok:false,error:{
              code:clean(error?.code||'AI_TOOL_ERROR',80),
              message:clean(error?.status===403?'No autorizado para consultar esa información.':error?.message||'No se pudo completar la consulta.',400),
            }});
          }finally{toolMs+=performance.now()-toolStarted;}
        }));
        timeline.push(...executions);
      }
    }

    const finalInteraction=await callModel({
      input:[...timeline,{type:'user_input',content:[{type:'text',text:'Con los resultados ya obtenidos, responde ahora sin solicitar más herramientas. Si falta un dato interno, indícalo claramente.'}]}],
      noTools:true,
    });
    let answer=outputText(finalInteraction);
    if(!answer)throw new AppError('AI_TOOL_LOOP_LIMIT','El asistente alcanzó el límite de consultas sin poder completar la respuesta.',502);
    ui.sources.push(...externalSources(finalInteraction));
    return finishResponse(answer,{limited:true});
  }catch(error){
    const durationMs=Math.round(performance.now()-started);
    recordAiMetrics({
      error:true,durationMs,modelDurationMs:modelMs,toolCalls:toolNames.length,toolDurationMs:toolMs,
      dbQueries,dbQueryMs,inputTokens:totalInput,outputTokens:totalOutput,requestBytes,fallbackCount,
      toolDefinitionsCount:tools.length,knowledgeChunks,attachments:ui.attachments.length,
    });
    console.error('[ai-agent] '+JSON.stringify({
      requestId:clean(ctx.requestId,120),conversationId:clean(ctx.payload?.conversationId,120),
      modelInitial:initialModel,modelFinal:finalModel,fallbackCount,fallbackReason:safeTelemetry(fallbackReason),
      intent,durationMs,geminiMs:Math.round(modelMs),toolMs:Math.round(toolMs),dbMs:Math.round(dbQueryMs),
      toolDefinitionsCount:tools.length,toolCalls:toolNames.length,inputTokens:totalInput,outputTokens:totalOutput,
      requestBytes,knowledgeChunks,attachments:ui.attachments.length,status:'error',errorCode:safeTelemetry(error?.code||'AI_ERROR'),
    }));
    throw error;
  }
}

export function _resetAiRateLimitForTests(){REQUESTS.clear();}
