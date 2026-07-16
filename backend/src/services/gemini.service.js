import { AppError, badRequest } from '../core/errors.js';

const FIELD_KEYS = ['razonVisita', 'descripcion', 'pruebasRealizadas', 'resultado', 'recomendaciones'];
const FIELD_LABELS = {
  razonVisita: 'Razón de visita',
  descripcion: 'Descripción',
  pruebasRealizadas: 'Pruebas realizadas',
  resultado: 'Resultado',
  recomendaciones: 'Recomendaciones',
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(FIELD_KEYS.map((key) => [key, { type: 'string' }])),
  required: FIELD_KEYS,
};

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const CLIENT_CHAT_SUMMARY_MODE = 'CLIENT_CHAT_SUMMARY';

function clean(value, maxLength = 8000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function positiveInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseJson(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  if (!normalized) {
    throw new AppError('GEMINI_EMPTY_RESPONSE', 'Gemini no devolvió texto para procesar.', 502);
  }

  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(normalized.slice(start, end + 1));
      } catch {
        // Se genera un error controlado abajo.
      }
    }
    throw new AppError('GEMINI_INVALID_RESPONSE', 'Gemini devolvió una respuesta que no se pudo interpretar.', 502);
  }
}

function extractInteractionText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;

  const stepTexts = Array.isArray(data.steps)
    ? data.steps.flatMap((step) => {
      if (step?.type !== 'model_output') return [];
      const content = Array.isArray(step.content) ? step.content : [step.content];
      return content
        .filter((item) => item?.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text);
    })
    : [];
  if (stepTexts.length) return stepTexts.join('\n');

  const legacyTexts = Array.isArray(data.outputs)
    ? data.outputs
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
    : [];
  if (legacyTexts.length) return legacyTexts.join('\n');

  const candidateTexts = Array.isArray(data.candidates)
    ? data.candidates.flatMap((candidate) => (candidate?.content?.parts || [])
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text))
    : [];
  if (candidateTexts.length) return candidateTexts.join('\n');

  throw new AppError(
    'GEMINI_EMPTY_RESPONSE',
    'Gemini respondió, pero no incluyó contenido de texto utilizable.',
    502,
    { responseKeys: Object.keys(data || {}) },
  );
}

function buildClientSummaryPrompt(fields) {
  return [
    'Resume para el cliente la información de una o varias boletas de servicio técnico.',
    'Reglas obligatorias:',
    '- Usa únicamente los datos proporcionados. No inventes diagnósticos, trabajos, repuestos, mediciones ni resultados.',
    '- Mantén todos los consecutivos de boleta y distingue cada visita cuando exista más de una.',
    '- Explica de forma comprensible qué se atendió y cuál fue el resultado.',
    '- Usa español profesional, cordial y directo.',
    '- Máximo 700 caracteres y hasta cinco oraciones cortas.',
    '- No incluyas enlaces, Markdown, viñetas, encabezados ni saludos.',
    '- Coloca el resumen solamente en el campo descripcion y devuelve vacíos los otros cuatro campos.',
    '',
    `Información original: ${fields.descripcion}`,
  ].join('\n');
}

function buildPrompt(fields, context) {
  if (context.mode === CLIENT_CHAT_SUMMARY_MODE) return buildClientSummaryPrompt(fields);

  const original = Object.fromEntries(FIELD_KEYS.map((key) => [FIELD_LABELS[key], fields[key]]));
  return [
    'Reescribe los campos de una boleta de servicio técnico en español profesional y claro.',
    'Reglas obligatorias:',
    '- No inventes hechos, pruebas, mediciones, diagnósticos, repuestos ni resultados.',
    '- Conserva marcas, modelos, números de serie, ubicaciones, cantidades y valores técnicos.',
    '- Corrige ortografía, puntuación, concordancia y terminología.',
    '- Usa un tono objetivo de reporte técnico, preciso y comprensible para el cliente.',
    '- Mantén vacío cualquier campo que originalmente esté vacío.',
    '- No uses Markdown, encabezados ni listas con viñetas dentro de los valores.',
    '- Devuelve únicamente los cinco campos solicitados.',
    '',
    `Contexto del servicio: ${JSON.stringify(context)}`,
    `Texto original: ${JSON.stringify(original)}`,
  ].join('\n');
}

function resolveModels() {
  const primary = clean(process.env.GEMINI_MODEL || 'gemini-3.5-flash', 100);
  const configured = clean(process.env.GEMINI_FALLBACK_MODELS, 500)
    .split(',')
    .map((value) => clean(value, 100))
    .filter(Boolean);
  const fallbacks = configured.length ? configured : DEFAULT_FALLBACK_MODELS;
  return [...new Set([primary, ...fallbacks])];
}

function generationConfig(model) {
  if (/^gemini-3(?:\.|-)/i.test(model)) return { thinking_level: 'low' };
  return { temperature: 0.2 };
}

function retryDelay(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  const base = 800 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 350);
  return Math.min(base + jitter, 8_000);
}

async function requestModel({ apiKey, model, prompt, retries }) {
  const timeoutMs = positiveInteger(process.env.GEMINI_TIMEOUT_MS, 30_000, 10_000, 90_000);
  let lastFailure = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let data = {};

    try {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          store: false,
          system_instruction: 'Eres un redactor de informes de mantenimiento y soporte técnico. Debes mejorar o resumir la información sin agregar datos que el técnico no haya proporcionado.',
          input: prompt,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: RESPONSE_SCHEMA,
          },
          generation_config: generationConfig(model),
        }),
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      lastFailure = {
        status: error?.name === 'AbortError' ? 504 : 502,
        code: error?.name === 'AbortError' ? 'GEMINI_TIMEOUT' : 'GEMINI_CONNECTION_ERROR',
        message: error?.name === 'AbortError'
          ? 'Gemini tardó demasiado en responder.'
          : 'No se pudo conectar con Gemini.',
        transient: true,
      };
    } finally {
      clearTimeout(timeout);
    }

    if (response?.ok) return { data, model };

    if (response) {
      const status = response.status;
      lastFailure = {
        status,
        code: status === 429 ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED',
        message: data?.error?.message || `Gemini rechazó la solicitud (${status}).`,
        transient: TRANSIENT_STATUSES.has(status),
      };
    }

    if (!lastFailure?.transient || attempt >= retries) break;
    await sleep(retryDelay(attempt, response));
  }

  return { error: lastFailure || { status: 502, code: 'GEMINI_REQUEST_FAILED', message: 'Gemini rechazó la solicitud.', transient: false }, model };
}

function finalGeminiError(failure, attemptedModels) {
  if (failure?.status === 429) {
    return new AppError(
      'GEMINI_QUOTA_EXCEEDED',
      'Gemini alcanzó temporalmente el límite de solicitudes. Espere unos segundos y vuelva a intentarlo.',
      429,
      { attemptedModels },
    );
  }

  if (failure?.transient) {
    return new AppError(
      'GEMINI_TEMPORARILY_UNAVAILABLE',
      'Gemini está temporalmente saturado. Se intentaron modelos alternativos, pero ninguno respondió. Intente nuevamente en unos minutos.',
      503,
      { attemptedModels },
    );
  }

  return new AppError(
    failure?.code || 'GEMINI_REQUEST_FAILED',
    failure?.message || 'Gemini rechazó la solicitud.',
    failure?.status === 400 ? 400 : 502,
    { attemptedModels },
  );
}

export async function rewriteTechnicalReport(payload = {}) {
  const apiKey = clean(process.env.GEMINI_API_KEY, 500);
  if (!apiKey) {
    throw new AppError(
      'GEMINI_NOT_CONFIGURED',
      'Gemini no está configurado. Agregue GEMINI_API_KEY en las variables del backend.',
      503,
    );
  }

  const fields = Object.fromEntries(FIELD_KEYS.map((key) => [key, clean(payload[key] ?? payload.fields?.[key])]));
  if (!FIELD_KEYS.some((key) => fields[key])) throw badRequest('Escriba al menos uno de los campos antes de mejorarlo con Gemini.');

  const context = {
    mode: clean(payload.mode, 50).toUpperCase(),
    titulo: clean(payload.titulo),
    cliente: clean(payload.cliente),
    ubicacion: clean(payload.ubicacion),
    categoria: clean(payload.categoria),
    tipoFalla: clean(payload.tipoFalla),
    tipoDispositivo: clean(payload.tipoDispositivo),
    fabricante: clean(payload.fabricante),
    modelo: clean(payload.modelo),
    serie: clean(payload.serie),
  };

  const models = resolveModels();
  const primaryRetries = positiveInteger(process.env.GEMINI_MAX_RETRIES, 1, 0, 3);
  const attemptedModels = [];
  let lastFailure = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    attemptedModels.push(model);
    const result = await requestModel({
      apiKey,
      model,
      prompt: buildPrompt(fields, context),
      retries: index === 0 ? primaryRetries : 0,
    });

    if (result.data) {
      if (index > 0) console.warn(`[gemini] Se utilizó el modelo alternativo ${model}.`);
      const parsed = parseJson(extractInteractionText(result.data));
      const improved = Object.fromEntries(FIELD_KEYS.map((key) => [
        key,
        fields[key] ? clean(parsed[key] ?? fields[key], 12000) : '',
      ]));
      if (context.mode === CLIENT_CHAT_SUMMARY_MODE) {
        return { summary: clean(parsed.descripcion ?? improved.descripcion ?? fields.descripcion, 1200), model };
      }
      return { fields: improved, model };
    }

    lastFailure = result.error;
    console.warn(`[gemini] ${model} no respondió correctamente: ${lastFailure?.status || 'sin estado'} ${lastFailure?.message || ''}`);
    if (!lastFailure?.transient) break;
  }

  throw finalGeminiError(lastFailure, attemptedModels);
}

export async function summarizeClientChatFacts(facts) {
  const description = clean(facts, 12000);
  if (!description) return { summary: '', model: '' };
  return rewriteTechnicalReport({
    mode: CLIENT_CHAT_SUMMARY_MODE,
    descripcion: description,
    fields: {
      razonVisita: '',
      descripcion: description,
      pruebasRealizadas: '',
      resultado: '',
      recomendaciones: '',
    },
  });
}
