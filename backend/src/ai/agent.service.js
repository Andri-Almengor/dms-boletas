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
  const context=sanitizeActiveContext(ctx.payload?.context||{});
  const history=Array.isArray(ctx.payload?.history)?ctx.payload.history:[];
  const systemInstruction=buildAgentSystemPrompt({user:ctx.user,permissions:ctx.permissions,nowIso:costaRicaNowIso()});
  const inputText=buildAgentUserInput({message,history,context});
  const tools=declarationsForUser(ctx,{includeWeb:externalRequested(message)});
  const timeline=[{type:'user_input',content:[{type:'text',text:inputText}]}];
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
      const calls=functionCalls(interaction);
      if(!calls.length){
        const answer=outputText(interaction);
        if(!answer) throw new AppError('AI_EMPTY_RESPONSE','Gemini no devolvió una respuesta utilizable.',502);
        ui.sources.push(...externalSources(interaction));
        const response={
          type:'answer',answer,
          entities:uniqueBy(ui.entities,item=>item.type+':'+item.id).slice(0,50),
          attachments:uniqueBy(ui.attachments,item=>item.url).slice(0,50),
          sources:uniqueBy(ui.sources,item=>(item.type||'')+':'+(item.id||item.url||item.label)).slice(0,20),
          suggestions:[],
          context:sanitizeActiveContext({...context,...ui.context}),
          agent:{model:aiConfig.model,toolCalls:toolNames.length,tools:[...new Set(toolNames)],webSearch:externalSources(interaction).length>0},
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
    const response={type:'answer',answer,entities:uniqueBy(ui.entities,x=>x.type+':'+x.id).slice(0,50),attachments:uniqueBy(ui.attachments,x=>x.url).slice(0,50),sources:uniqueBy(ui.sources,x=>(x.type||'')+':'+(x.id||x.url||x.label)).slice(0,20),suggestions:[],context:sanitizeActiveContext({...context,...ui.context}),agent:{model:aiConfig.model,toolCalls:toolNames.length,tools:[...new Set(toolNames)],webSearch:externalSources(finalInteraction).length>0,limited:true}};
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
