import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';

const baseChat = assistantDynamicMaintenanceQuestionHandlers.chat;

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function looksLikeMaintenanceCatalogQuestion(question) {
  const key = normalized(question);
  if (/\bmantenimiento(?:s)?\b/.test(key)) return false;
  const catalog = /\b(fabricante(?:s)?|marca(?:s)?|modelo(?:s)?|dispositivo(?:s)?|camara(?:s)?|puerta(?:s)?|gabinete(?:s)?)\b/.test(key);
  const operational = /\b(cliente|tiene|tienen|usan|utilizan|instalad|registrad|inventario|actual|reciente|ultimo|ultima)\b/.test(key);
  return catalog && operational;
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function maintenanceKeywordGuard(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  if (looksLikeMaintenanceCatalogQuestion(question)) {
    const answer = 'Si la consulta corresponde a dispositivos o información de un mantenimiento, incluya la palabra “mantenimiento” en el mensaje. Para cámaras descubiertas o controladas por el agente use la palabra “gateway”.';
    return {
      type: 'clarification',
      answer,
      message: answer,
      facts: {},
      sources: [],
      options: [],
      suggestions: [
        `mantenimiento ${question}`,
        `gateway ${question}`,
      ],
      context: ctx.payload?.context || {},
      resumeQuestion: question,
    };
  }
  return baseChat(ctx);
};
