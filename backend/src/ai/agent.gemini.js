import { AppError } from '../core/errors.js';
import { aiConfig, geminiApiKey } from './agent.config.js';

const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
const TRANSIENT=new Set([408,409,429,500,502,503,504]);

function generationConfig(model,maxOutputTokens){
  const base=/^gemini-3(?:\.|-)/i.test(String(model||''))?{thinking_level:'low'}:{temperature:0.1};
  return {...base,max_output_tokens:Math.max(512,Number(maxOutputTokens||aiConfig.maxOutputTokens))};
}

export function functionCalls(interaction={}){
  return Array.isArray(interaction.steps)?interaction.steps.filter(step=>step?.type==='function_call'&&step?.name):[];
}

export function outputText(interaction={}){
  if(typeof interaction.output_text==='string'&&interaction.output_text.trim()) return interaction.output_text.trim();
  const texts=(interaction.steps||[]).flatMap(step=>{
    if(step?.type!=='model_output') return [];
    return (Array.isArray(step.content)?step.content:[step.content]).filter(x=>x?.type==='text'&&x?.text).map(x=>String(x.text));
  });
  return texts.join('\n').trim();
}

export function externalSources(interaction={}){
  const seen=new Set(); const sources=[];
  for(const step of interaction.steps||[]){
    if(step?.type!=='model_output') continue;
    for(const block of Array.isArray(step.content)?step.content:[]){
      for(const annotation of block?.annotations||[]){
        const url=String(annotation?.url||'').trim();
        if(annotation?.type!=='url_citation'||!/^https:\/\//i.test(url)||seen.has(url)) continue;
        seen.add(url);
        sources.push({type:'external',id:url,label:String(annotation.title||url).slice(0,300),url});
      }
    }
  }
  return sources.slice(0,10);
}

export function usage(interaction={}){
  const raw=interaction.usage||interaction.usage_metadata||{};
  return {
    inputTokens:Number(raw.total_input_tokens||raw.input_tokens||raw.prompt_token_count||raw.inputTokenCount||0)||0,
    outputTokens:Number(raw.total_output_tokens||raw.output_tokens||raw.candidates_token_count||raw.outputTokenCount||0)||0,
    totalTokens:Number(raw.total_tokens||raw.total_token_count||raw.totalTokenCount||0)||0,
  };
}

export function outputTruncated(interaction={}){
  const values=[
    interaction.finish_reason,interaction.finishReason,
    ...(interaction.steps||[]).map(step=>step?.finish_reason||step?.finishReason||step?.status),
  ].filter(Boolean).map(value=>String(value).toUpperCase());
  return values.some(value=>/MAX_(?:OUTPUT_)?TOKENS|LENGTH|TOKEN_LIMIT/.test(value));
}

function geminiErrorCode(status,message=''){
  const text=String(message||'').toLowerCase();
  if(/context.*(?:too large|length)|input.*token|maximum.*input|prompt.*too long/.test(text)) return 'CONTEXT_TOO_LARGE';
  if(/max(?:imum)? output|output token|response.*too long/.test(text)) return 'MAX_OUTPUT_TOKENS';
  if(status===429) return 'MODEL_RATE_LIMIT';
  if(status===404||/model.*(?:not found|unavailable|unsupported)/.test(text)) return 'MODEL_UNAVAILABLE';
  if(status===503||/overload|overloaded|resource exhausted|temporarily unavailable/.test(text)) return 'MODEL_OVERLOADED';
  if(TRANSIENT.has(status)) return 'MODEL_UNAVAILABLE';
  return 'AI_GEMINI_ERROR';
}

export function fallbackCompatible(error){
  return new Set([
    'CONTEXT_TOO_LARGE','MAX_INPUT_TOKENS','MAX_OUTPUT_TOKENS',
    'MODEL_OVERLOADED','MODEL_UNAVAILABLE','MODEL_RATE_LIMIT','AI_GEMINI_TIMEOUT',
  ]).has(String(error?.code||''));
}

export async function createInteraction({
  systemInstruction,input,tools=[],model=aiConfig.primaryModel,
  timeoutMs=aiConfig.requestTimeoutMs,maxOutputTokens=aiConfig.maxOutputTokens,
}){
  const key=geminiApiKey();
  if(!key) throw new AppError('GEMINI_NOT_CONFIGURED','Gemini no está configurado en el servidor.',503);
  if(!String(model||'').trim()) throw new AppError('GEMINI_MODEL_NOT_CONFIGURED','Configure GEMINI_PRIMARY_MODEL o GEMINI_MODEL en el servidor.',503);
  const payload={
    model,store:false,system_instruction:systemInstruction,input,
    ...(tools.length?{tools}:{}),generation_config:generationConfig(model,maxOutputTokens),
  };
  const requestBytes=Buffer.byteLength(JSON.stringify(payload),'utf8');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,Number(timeoutMs)||aiConfig.requestTimeoutMs));timer.unref?.();
  try{
    const response=await fetch(ENDPOINT,{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify(payload),
    });
    const data=await response.json().catch(()=>({}));
    if(response.ok){
      Object.defineProperty(data,'__dmsRequestBytes',{value:requestBytes,enumerable:false});
      return data;
    }
    const message=String(data?.error?.message||'').slice(0,500);
    const code=geminiErrorCode(response.status,message);
    const status=response.status===429?429:(TRANSIENT.has(response.status)?503:502);
    throw new AppError(code,message||`Gemini rechazó la solicitud (${response.status}).`,status,{geminiStatus:response.status});
  }catch(error){
    if(error?.name==='AbortError') throw new AppError('AI_GEMINI_TIMEOUT','Gemini tardó demasiado en responder.',504);
    if(error instanceof AppError) throw error;
    throw new AppError('MODEL_UNAVAILABLE','No se pudo conectar con Gemini.',503);
  }finally{clearTimeout(timer);}
}
