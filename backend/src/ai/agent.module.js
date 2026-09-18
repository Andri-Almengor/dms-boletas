import { aiConfig } from './agent.config.js';
import { runDmsAgent } from './agent.service.js';
import { assistantAgendaHandlers as legacyAssistantHandlers } from '../modules/assistant-agenda.module.js';
import { aiMetricsSnapshot } from './agent.metrics.js';

async function chat(ctx){
  if(!aiConfig.enabled) return legacyAssistantHandlers.chat(ctx);
  return runDmsAgent(ctx);
}

async function health(){
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    webSearchEnabled: aiConfig.webSearchEnabled,
    stateless: true,
    metrics: aiMetricsSnapshot(),
  };
}

export const aiAgentHandlers=Object.freeze({chat,health});
