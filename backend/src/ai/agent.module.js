import { aiConfig } from './agent.config.js';
import { runDmsAgent } from './agent.service.js';
import { assistantAgendaHandlers as legacyAssistantHandlers } from '../modules/assistant-agenda.module.js';

async function chat(ctx){
  if(!aiConfig.enabled) return legacyAssistantHandlers.chat(ctx);
  return runDmsAgent(ctx);
}

export const aiAgentHandlers=Object.freeze({chat});
