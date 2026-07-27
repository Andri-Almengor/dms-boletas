import { ensureMaintenanceQuestionsReady } from '../services/maintenance-question-bootstrap.service.js';
import {
  maintenanceDynamicQuestionHandlers as baseMaintenanceHandlers,
  maintenanceQuestionHandlers as baseQuestionHandlers,
} from './maintenance-dynamic-questions.module.js';

function wrap(handler) {
  if (typeof handler !== 'function') return handler;
  return async (ctx) => {
    await ensureMaintenanceQuestionsReady(ctx.user?.UsuarioID || 'SYSTEM');
    return handler(ctx);
  };
}

function wrapHandlers(handlers) {
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, wrap(handler)]));
}

export const maintenanceQuestionHandlers = wrapHandlers(baseQuestionHandlers);
export const maintenanceDynamicQuestionHandlers = wrapHandlers(baseMaintenanceHandlers);
