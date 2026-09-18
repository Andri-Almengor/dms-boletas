import { AppError } from '../core/errors.js';
import { aiConfig, geminiApiKey } from './agent.config.js';

const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
const TRANSIENT=new Set([408,409,429,500,502,503,504]);

function generationConfig(){
  return /^gemini-3(?:\.|-)/i.test(aiConfig.model)?{thinking_level:'low'}:{temperature:0.1};
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

export async function createInteraction({systemInstruction,input,tools=[]}){
  const key=geminiApiKey();
  if(!key) throw new AppError('GEMINI_NOT_CONFIGURED','Gemini no está configurado en el servidor.',503);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),aiConfig.requestTimeoutMs);timer.unref?.();
  try{
    const response=await fetch(ENDPOINT,{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({
        model:aiConfig.model,store:false,system_instruction:systemInstruction,input,
        ...(tools.length?{tools}:{}),generation_config:generationConfig(),
      }),
    });
    const data=await response.json().catch(()=>({}));
    if(response.ok) return data;
    const message=String(data?.error?.message||'').slice(0,500);
    const status=response.status===429?429:(TRANSIENT.has(response.status)?503:502);
    throw new AppError(response.status===429?'AI_RATE_LIMITED':'AI_GEMINI_ERROR',message||`Gemini rechazó la solicitud (${response.status}).`,status);
  }catch(error){
    if(error?.name==='AbortError') throw new AppError('AI_GEMINI_TIMEOUT','Gemini tardó demasiado en responder.',504);
    if(error instanceof AppError) throw error;
    throw new AppError('AI_GEMINI_UNAVAILABLE','No se pudo conectar con Gemini.',503);
  }finally{clearTimeout(timer);}
}
