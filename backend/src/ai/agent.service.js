import { performance } from 'node:perf_hooks';
import { AppError, badRequest } from '../core/errors.js';
import { withDbRequestMetrics } from '../infra/postgres.js';
import { audit } from '../services/audit.service.js';
import { aiConfig } from './agent.config.js';
import { costaRicaNowIso } from './agent.dates.js';
import { createInteraction, externalSources, functionCalls, outputText, usage } from './agent.gemini.js';
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
  return products.find(([pattern]) => pattern.test(value))?.[1] || clean(previous, 160);
}

function updateTroubleshootingContext(context = {}, message = '') {
  const previous = context.currentTechnicalIssue && typeof context.currentTechnicalIssue === 'object'
    ? context.currentTechnicalIssue
    : {};
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

function imageInputs(raw = []) {
  const items = Array.isArray(raw) ? raw.slice(0, 3) : [];
  return items.map((item) => {
    const mimeType = clean(item?.mimeType, 120).toLowerCase();
    const data = String(item?.data || item?.base64 || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
    if (!/^image\/(?:png|jpe?g|webp|gif|bmp|tiff|heic|heif)$/.test(mimeType)) throw badRequest('El asistente solo admite imágenes en los adjuntos de diagnóstico.');
    if (!data || data.length > 14_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw badRequest('La imagen adjunta no es válida o supera el tamaño seguro para análisis.');
    return { type: 'image', data, mime_type: mimeType, resolution: 'high' };
  });
}

function requiresInternalEvidence(message,context={}){
  const text=String(message||'');
  if(Object.keys(context||{}).some((key)=>/^last(Client|Maintenance|Ticket|Knowledge|Case|User|Device)/.test(key))) return true;
  if(context?.pageContext?.entityId||context?.pageContext?.maintenanceId||context?.pageContext?.ticketId) return true;
  if(context?.pageContext?.route && /\b(esta sección|esta seccion|esta pantalla|aquí|aqui|qué hace|que hace)\b/i.test(text)) return true;
  return /\b(dms|boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|dispositivos|cámara|camara|caso|casos|agenda|pendiente|finalizada|finalizó|finalizo|subió|subio|base de conocimiento)\b/i.test(text);
}

function requiresKnowledgeLookup(message){
  return /\b(axis|onguard|lenel|lenels2|milestone|xprotect|barco|faceme|morphomanager|windows server|sql server|postgresql|odbc|camera station|access control)\b/i.test(String(message||''))
    && /\b(error|falla|problema|solucion|solución|solucionar|resolver|configurar|instalar|procedimiento|manual|diagnosticar|diagnóstico|como|cómo)\b/i.test(String(message||''));
}

function externalRequested(message){
  const text=String(message||'');
  const explicit=/\b(internet|web|google|buscar en internet|busca en internet|búscalo en internet|buscar en la web|busca en la web)\b/i.test(text);
  if(explicit) return true;
  const internal=/\b(dms|boleta|boletas|mantenimiento|mantenimientos|cliente|clientes|técnico|tecnico|supervisor|evidencia|evidencias|dispositivo|dispositivos|cámara|camara|caso|casos|agenda|pendiente|finalizada)\b/i.test(text);
  return !internal && /\b(actual(?:izado|izada|es)?|hoy en día|hoy en dia|latest|reciente)\b/i.test(text);
}
function assertRateLimit(ctx){
  const key=clean(ctx?.user?.UsuarioID||ctx?.sessionToken,250)||'anonymous';
  const now=Date.now();const recent=(REQUESTS.get(key)||[]).filter(ts=>now-ts<60000);
  if(recent.length>=aiConfig.rateLimitPerMinute) throw new AppError('AI_RATE_LIMIT','Ha realizado demasiadas consultas al asistente. Intente nuevamente en un momento.',429);
  recent.push(now);REQUESTS.set(key,recent);
  if(REQUESTS.size>2000){for(const [id,times] of REQUESTS){if(!times.some(ts=>now-ts<60000))REQUESTS.delete(id);}}
}
async function withTimeout(promise,ms,name){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AppError('AI_TOOL_TIMEOUT',`La consulta ${name} tardó demasiado.`,504)),ms);timer.unref?.();})]);}
  finally{clearTimeout(timer);}
}
function mergeUi(target,ui={}){
  target.entities.push(...(ui.entities||[]));target.attachments.push(...(ui.attachments||[]));target.sources.push(...(ui.sources||[]));
  target.context={...target.context,...(ui.context||{})};
}
function functionResult(call,result){
  return {type:'function_result',name:call.name,call_id:call.id,result:[{type:'text',text:JSON.stringify(result)}]};
}

export async function runDmsAgent(ctx){
  assertRateLimit(ctx);
  const started=performance.now();
  const message=clean(ctx.payload?.message||ctx.payload?.question,aiConfig.maxMessageChars);
  if(!message) throw badRequest('Escriba una pregunta para el asistente.');
  let context=sanitizeActiveContext(ctx.payload?.context||{});
  context=updateTroubleshootingContext(context,message);
  const images=imageInputs(ctx.payload?.attachments||ctx.payload?.images||[]);
  const history=Array.isArray(ctx.payload?.history)?ctx.payload.history:[];
  const systemInstruction=buildAgentSystemPrompt({user:ctx.user,permissions:ctx.permissions,nowIso:costaRicaNowIso()});
  const inputText=buildAgentUserInput({message,history,context});
  const internalEvidenceRequired=requiresInternalEvidence(message,context);
  const knowledgeLookupRequired=requiresKnowledgeLookup(message)||images.length>0;
  let webEnabledForTurn=externalRequested(message);
  let tools=declarationsForUser(ctx,{includeWeb:webEnabledForTurn});
  const timeline=[{type:'user_input',content:[...images,{type:'text',text:inputText}]}];
  const ui={entities:[],attachments:[],sources:[],context:{...context}};
  const toolNames=[];let modelMs=0,toolMs=0,lastInteraction=null,totalInput=0,totalOutput=0;
  let dbQueries=0,dbQueryMs=0,errorFlag=false;
  try{
    for(let round=0;round<aiConfig.maxToolRounds;round+=1){
      const modelStarted=performance.now();
      const interaction=await createInteraction({systemInstruction,input:timeline,tools});
      modelMs+=performance.now()-modelStarted;lastInteraction=interaction;
      const u=usage(interaction);totalInput+=u.inputTokens;totalOutput+=u.outputTokens;
      timeline.push(...(interaction.steps||[]));
      ui.sources.push(...externalSources(interaction));
      const calls=functionCalls(interaction);
      if(!calls.length){
        const hasInternalTool=toolNames.length>0;
        const hasKnowledgeTool=toolNames.includes('search_knowledge_document_chunks')||toolNames.includes('search_knowledge_documents');
        if(round<aiConfig.maxToolRounds-1
          && ((internalEvidenceRequired&&!hasInternalTool)||(knowledgeLookupRequired&&!hasKnowledgeTool))){
          timeline.push({
            type:'user_input',
            content:[{type:'text',text:knowledgeLookupRequired&&!hasKnowledgeTool
              ? 'Antes de responder, consulta Knowledge y la documentación interna: usa search_knowledge_base y search_knowledge_documents; recupera chunks relevantes si encuentras manuales. No inventes una solución interna.'
              : 'Antes de responder esta pregunta sobre DMS, consulta una o más herramientas internas apropiadas. No respondas datos internos desde conocimiento general.'}],
          });
          continue;
        }
        if(internalEvidenceRequired&&!hasInternalTool){
          throw new AppError('AI_INTERNAL_SOURCE_REQUIRED','No fue posible verificar la información interna solicitada. Intente nuevamente.',502);
        }
        const answer=outputText(interaction);
        if(!answer) throw new AppError('AI_EMPTY_RESPONSE','Gemini no devolvió una respuesta utilizable.',502);
        const response={
          type:'answer',answer,
          entities:uniqueBy(ui.entities,item=>item.type+':'+item.id).slice(0,50),
          attachments:uniqueBy(ui.attachments,item=>item.url).slice(0,50),
          sources:uniqueBy(ui.sources,item=>(item.type||'')+':'+(item.id||item.url||item.label)).slice(0,20),
          suggestions:[],
          context:sanitizeActiveContext({...context,...ui.context}),
          agent:{model:aiConfig.model,toolCalls:toolNames.length,tools:[...new Set(toolNames)],webSearch:ui.sources.some((item)=>item.type==='external')},
        };
        const durationMs=Math.round(performance.now()-started);
        const responseBytes=Buffer.byteLength(JSON.stringify(response),'utf8');
        recordAiMetrics({durationMs,modelDurationMs:modelMs,toolCalls:toolNames.length,toolDurationMs:toolMs,dbQueries,dbQueryMs,inputTokens:totalInput,outputTokens:totalOutput,responseBytes});
        await audit(ctx,'AI_CHAT','Asistente',clean(ctx.payload?.conversationId,250)||'chat',null,{Modelo:aiConfig.model,Herramientas:[...new Set(toolNames)],DuracionMs:durationMs,BusquedaWeb:response.agent.webSearch}).catch(()=>{});
        return response;
      }

      const batches=[];
      for(let i=0;i<calls.length;i+=aiConfig.maxParallelTools)batches.push(calls.slice(i,i+aiConfig.maxParallelTools));
      for(const batch of batches){
        const executions=await Promise.all(batch.map(async(call)=>{
          toolNames.push(call.name);
          const toolStarted=performance.now();
          try{
            const measured=await withTimeout(withDbRequestMetrics(()=>executeAiTool(ctx,call.name,call.arguments||{})),aiConfig.toolTimeoutMs,call.name);
            dbQueries+=Number(measured.metrics?.queries||0);dbQueryMs+=Number(measured.metrics?.queryMs||0);
            mergeUi(ui,measured.result.ui);
            if (['search_knowledge_base','search_knowledge_documents','search_knowledge_document_chunks'].includes(call.name)
              && Number(measured.result.modelData?.totalShown || 0) === 0
              && aiConfig.webSearchEnabled
              && !webEnabledForTurn) {
              webEnabledForTurn = true;
              tools = declarationsForUser(ctx, { includeWeb: true });
            }
            if (/^(search_|get_statistics$|get_technician_activity$)/.test(call.name)) {
              ui.context = {
                ...ui.context,
                lastSearchTool: call.name,
                lastSearchQuery: clean(call.arguments?.query || call.arguments?.technician || call.arguments?.technicianName, 300),
                lastSearchOffset: String(Number(call.arguments?.offset || 0)),
                lastSearchLimit: String(Number(call.arguments?.limit || aiConfig.maxToolResultRows)),
                lastSearchStatus: clean(call.arguments?.status, 80),
                lastSearchPeriod: clean(call.arguments?.period || call.arguments?.month || '', 80),
              };
            }
            return functionResult(call,{ok:true,data:measured.result.modelData});
          }catch(error){
            return functionResult(call,{ok:false,error:{code:clean(error?.code||'AI_TOOL_ERROR',80),message:clean(error?.status===403?'No autorizado para consultar esa información.':error?.message||'No se pudo completar la consulta.',400)}});
          }finally{toolMs+=performance.now()-toolStarted;}
        }));
        timeline.push(...executions);
      }
    }

    const finalStarted=performance.now();
    const finalInteraction=await createInteraction({
      systemInstruction,
      input:[...timeline,{type:'user_input',content:[{type:'text',text:'Con los resultados ya obtenidos, responde ahora sin solicitar más herramientas. Si falta un dato interno, indícalo claramente.'}]}],
      tools:[],
    });
    modelMs+=performance.now()-finalStarted;lastInteraction=finalInteraction;
    const u=usage(finalInteraction);totalInput+=u.inputTokens;totalOutput+=u.outputTokens;
    const answer=outputText(finalInteraction);
    if(!answer) throw new AppError('AI_TOOL_LOOP_LIMIT','El asistente alcanzó el límite de consultas sin poder completar la respuesta.',502);
    ui.sources.push(...externalSources(finalInteraction));
    const response={type:'answer',answer,entities:uniqueBy(ui.entities,x=>x.type+':'+x.id).slice(0,50),attachments:uniqueBy(ui.attachments,x=>x.url).slice(0,50),sources:uniqueBy(ui.sources,x=>(x.type||'')+':'+(x.id||x.url||x.label)).slice(0,20),suggestions:[],context:sanitizeActiveContext({...context,...ui.context}),agent:{model:aiConfig.model,toolCalls:toolNames.length,tools:[...new Set(toolNames)],webSearch:ui.sources.some((item)=>item.type==='external'),limited:true}};
    const durationMs=Math.round(performance.now()-started);recordAiMetrics({durationMs,modelDurationMs:modelMs,toolCalls:toolNames.length,toolDurationMs:toolMs,dbQueries,dbQueryMs,inputTokens:totalInput,outputTokens:totalOutput,responseBytes:Buffer.byteLength(JSON.stringify(response),'utf8')});
    return response;
  }catch(error){
    errorFlag=true;
    recordAiMetrics({error:true,durationMs:Math.round(performance.now()-started),modelDurationMs:modelMs,toolCalls:toolNames.length,toolDurationMs:toolMs,dbQueries,dbQueryMs,inputTokens:totalInput,outputTokens:totalOutput});
    console.error(`[ai-agent] user=${clean(ctx?.user?.UsuarioID,100)} model=${aiConfig.model} tools=${toolNames.length} error=${clean(error?.code||error?.message,160)}`);
    throw error;
  }finally{void lastInteraction;void errorFlag;}
}

export function _resetAiRateLimitForTests(){REQUESTS.clear();}
