import { AppError } from '../core/errors.js';
import { aiConfig, configuredModels } from './agent.config.js';
import { aiMetricsSnapshot } from './agent.metrics.js';
import { actionConcurrencySnapshot } from '../services/action-concurrency.service.js';
import { concurrencySnapshot } from '../middleware/concurrency.middleware.js';
import { createInteraction, fallbackCompatible, outputText } from './agent.gemini.js';
import { audit } from '../services/audit.service.js';
import { aiToolWorkSnapshot, assertRateLimit, modelFallbackChain, runDmsAgent } from './agent.service.js';

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

// Reutiliza la sesión, el carril AI, el limitador y el router de modelos de Gemini
// existentes; no se conservan grabaciones de voz en PostgreSQL, Drive ni logs.
export async function transcribeAssistantAudio(ctx, overrides = {}) {
  if (!aiConfig.enabled) {
    throw new AppError('AI_CHAT_DISABLED', 'El asistente inteligente está deshabilitado temporalmente.', 503);
  }
  if (!ctx?.user?.UsuarioID || !ctx?.sessionToken) {
    throw new AppError('UNAUTHORIZED', 'La sesión no es válida o expiró.', 401);
  }
  const { mimeType, audioBase64 } = ctx.payload || {};
  const incomingMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const allowed = new Set(['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/wav']);
  if (!allowed.has(incomingMime)) {
    throw new AppError('AUDIO_FORMAT_UNSUPPORTED', 'El formato de audio de este navegador no es compatible.', 400);
  }
  const encoded = String(audioBase64 || '');
  const maxBytes = 3 * 1024 * 1024;
  if (!encoded || encoded.length > Math.ceil(maxBytes / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new AppError('AUDIO_INVALID', 'La grabación es inválida o supera 3 MB. Intente con un mensaje más corto.', 400);
  }
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < 200 || raw.length > maxBytes) {
    throw new AppError('AUDIO_INVALID', 'La grabación está vacía o supera 3 MB.', 400);
  }
  assertRateLimit(ctx);

  const interact = overrides.createInteraction || createInteraction;
  const models = overrides.models || modelFallbackChain();
  const instruction = 'Transcribe literalmente el habla de este audio a texto en español. Conserva nombres propios, fechas, horas, números, marcas, responsables, clientes, términos técnicos, separaciones entre boletas y visitas. No redactes boletas ni infieras información. Devuelve únicamente la transcripción, sin explicaciones ni Markdown.';
  let lastError;
  const started = Date.now();
  const transcriptionBudgetMs = 150_000;
  for (const model of models) {
    const remainingMs = transcriptionBudgetMs - (Date.now() - started);
    if (remainingMs <= 1_000) break;
    try {
      const response = await interact({
        model,
        systemInstruction: instruction,
        input: [
          { type: 'text', text: instruction },
          { type: 'audio', data: encoded, mime_type: incomingMime === 'audio/mp4' ? 'audio/m4a' : incomingMime },
        ],
        tools: [],
        maxOutputTokens: 2500,
        timeoutMs: Math.min(aiConfig.requestTimeoutMs, 60_000, remainingMs),
      });
      const transcript = outputText(response).trim().slice(0, 5000);
      if (!transcript) {
        throw new AppError('AUDIO_EMPTY_TRANSCRIPTION', 'No se identificaron palabras en la grabación.', 422);
      }
      await audit(ctx, 'AI_AUDIO_TRANSCRIPCION', 'Assistant', '', null, { bytes: raw.length, transcriptChars: transcript.length, model: response.__dmsModelUsed || model });
      return { transcript };
    } catch (error) {
      lastError = error;
      if (!aiConfig.modelFallbackEnabled || !fallbackCompatible(error)) throw error;
    }
  }
  if (Date.now() - started >= transcriptionBudgetMs - 1_000) {
    throw new AppError('AI_AUDIO_TIMEOUT', 'La transcripción agotó el tiempo de procesamiento. Intente con un audio más corto.', 504);
  }
  throw lastError || new AppError('AUDIO_TRANSCRIPTION_UNAVAILABLE', 'No se pudo transcribir la grabación.', 503);
}

async function health() {
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.primaryModel,
    modelsConfigured: configuredModels().length,
    modelFallbackEnabled: aiConfig.modelFallbackEnabled,
    webSearchEnabled: aiConfig.webSearchEnabled,
    writeEnabled: aiConfig.writeEnabled,
    maintenanceWriteEnabled: aiConfig.maintenanceWriteEnabled,
    knowledgeDocumentsEnabled: aiConfig.knowledgeDocumentsEnabled,
    stateless: true,
    metrics: aiMetricsSnapshot(),
    // Este endpoint ya exige USUARIOS_GESTIONAR en app.js. Solo agrega
    // contadores sin usuarios, preguntas, mensajes ni credenciales.
    queues: {
      httpAssistant: concurrencySnapshot().assistantRequests,
      aiActions: actionConcurrencySnapshot().ai,
      aiTools: aiToolWorkSnapshot(),
    },
  };
}

export const aiAgentHandlers = Object.freeze({ chat, health, transcribe: transcribeAssistantAudio });
