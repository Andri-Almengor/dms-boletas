import { AppError } from '../core/errors.js';
import { aiConfig } from './agent.config.js';
import { aiMetricsSnapshot } from './agent.metrics.js';
import { runDmsAgent } from './agent.service.js';

async function chat(ctx) {
  if (!aiConfig.enabled) {
    throw new AppError(
      'AI_CHAT_DISABLED',
      'El asistente inteligente está deshabilitado temporalmente. El resto de DMS continúa disponible.',
      503,
    );
  }
  return runDmsAgent(ctx);
}

async function health() {
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    webSearchEnabled: aiConfig.webSearchEnabled,
    stateless: true,
    metrics: aiMetricsSnapshot(),
  };
}

export const aiAgentHandlers = Object.freeze({ chat, health });
