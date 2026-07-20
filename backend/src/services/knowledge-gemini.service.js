import { AppError, badRequest } from '../core/errors.js';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    problema: { type: 'string' },
    contenidoHtml: { type: 'string' },
  },
  required: ['titulo', 'problema', 'contenidoHtml'],
};

function clean(value, maxLength = 50_000) {
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

  const candidateTexts = Array.isArray(data.candidates)
    ? data.candidates.flatMap((candidate) => (candidate?.content?.parts || [])
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text))
    : [];
  if (candidateTexts.length) return candidateTexts.join('\n');

  throw new AppError('GEMINI_EMPTY_RESPONSE', 'Gemini respondió, pero no incluyó contenido utilizable.', 502);
}

function resolveModels() {
  const primary = clean(process.env.GEMINI_MODEL || 'gemini-3.5-flash', 100);
  const configured = clean(process.env.GEMINI_FALLBACK_MODELS, 500)
    .split(',')
    .map((value) => clean(value, 100))
    .filter(Boolean);
  return [...new Set([primary, ...(configured.length ? configured : DEFAULT_FALLBACK_MODELS)])];
}

function generationConfig(model) {
  if (/^gemini-3(?:\.|-)/i.test(model)) return { thinking_level: 'low' };
  return { temperature: 0.2 };
}

function retryDelay(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  return Math.min((800 * (2 ** attempt)) + Math.floor(Math.random() * 350), 8_000);
}

function buildPrompt({ mode, titulo, problema, contenidoHtml, categorias }) {
  const titleOnly = mode === 'TITLE_ONLY';
  const problemOnly = mode === 'PROBLEM_ONLY';
  const preserveDocument = titleOnly || problemOnly;

  return [
    'Eres un redactor senior de una base de conocimientos de soporte técnico y seguridad electrónica.',
    'Debes mejorar un tutorial escrito por un técnico usando exclusivamente la información suministrada.',
    '',
    'Reglas de exactitud:',
    '- No inventes pasos, requisitos, credenciales, direcciones IP, comandos, marcas, modelos, resultados ni advertencias.',
    '- Conserva exactamente números, direcciones IP, puertos, rutas, nombres de menús, botones, comandos, códigos, enlaces y valores técnicos.',
    '- Corrige ortografía, puntuación, concordancia y frases ambiguas.',
    '- Explica cada acción con lenguaje claro, directo y fácil de seguir para una persona que no realizó el procedimiento antes.',
    '- Usa una secuencia lógica. Cuando corresponda, organiza el procedimiento con encabezados y una lista numerada.',
    '- Mantén las advertencias, notas, bloques de código y enlaces existentes.',
    '- No agregues introducciones extensas, conclusiones genéricas ni información de relleno.',
    '',
    'Reglas del documento HTML:',
    '- Devuelve un fragmento HTML, no Markdown ni un documento HTML completo.',
    '- Utiliza solamente etiquetas simples como h2, h3, p, ol, ul, li, strong, em, u, blockquote, pre, code, a, br y span.',
    '- El procedimiento debe ser entendible, explicativo y práctico.',
    '- Conserva cada marcador con formato [[IMAGEN_N]] exactamente una vez y en el punto del procedimiento donde se encontraba.',
    '- No modifiques las URL de los enlaces ni el contenido de bloques de código.',
    preserveDocument
      ? `- Como el modo es ${mode}, devuelve contenidoHtml exactamente igual al contenido recibido.`
      : '- Reestructura el contenido únicamente cuando ayude a entenderlo mejor; conserva todos los hechos y pasos originales.',
    '',
    'Reglas del título para facilitar búsquedas:',
    '- Basa el título principalmente en el procedimiento y en el problema que resuelve.',
    '- Incluye las palabras técnicas comunes que una persona realmente escribiría en el buscador interno.',
    '- Debe mencionar el objeto o sistema principal y la acción realizada. Ejemplo: "Configurar una IP estática en Windows 11".',
    '- Conserva términos esenciales como IP, IP estática, cámara, lector, servidor, Milestone, OnGuard o Axis cuando estén presentes en el contenido.',
    '- Evita títulos genéricos como "Tutorial", "Procedimiento", "Configuración" o "Paso a paso" sin indicar de qué se trata.',
    '- Usa entre 5 y 16 palabras, máximo 120 caracteres, sin punto final.',
    '- No uses palabras clave que no aparezcan ni se deduzcan con seguridad del contenido.',
    problemOnly
      ? '- Como el modo es PROBLEM_ONLY, devuelve titulo exactamente igual al título recibido.'
      : '- Genera o mejora el título de acuerdo con estas reglas.',
    '',
    'Reglas de la descripción del problema que resuelve:',
    '- Dedúcela principalmente del objetivo y de las acciones descritas en el documento paso a paso.',
    '- Explica qué necesidad, síntoma, error o situación resuelve el procedimiento y en qué sistema, equipo o contexto se aplica.',
    '- Redacta un solo párrafo claro de dos a cuatro oraciones y máximo 700 caracteres.',
    '- No conviertas la descripción en una lista de pasos ni repitas todo el procedimiento.',
    '- No afirmes que el problema quedó solucionado ni agregues causas, fallas o resultados que no estén sustentados en el contenido.',
    '- Utiliza términos comunes y técnicos que ayuden a entender cuándo debe usarse el tutorial.',
    titleOnly
      ? '- Como el modo es TITLE_ONLY, devuelve problema exactamente igual a la descripción recibida.'
      : '- Genera una descripción completa aunque el campo actual esté vacío o sea muy breve.',
    '',
    `Modo: ${mode}`,
    `Título actual: ${titulo || '(vacío)'}`,
    `Categorías seleccionadas: ${categorias.length ? categorias.join(', ') : '(ninguna)'}`,
    `Descripción actual del problema: ${problema || '(vacío)'}`,
    `Documento original: ${contenidoHtml}`,
    '',
    'Devuelve únicamente un objeto JSON con titulo, problema y contenidoHtml.',
  ].join('\n');
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
          system_instruction: 'Mejoras tutoriales técnicos sin inventar información. Produces títulos fáciles de buscar, descripciones claras del problema y documentos HTML ordenados y precisos.',
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
        message: error?.name === 'AbortError' ? 'Gemini tardó demasiado en responder.' : 'No se pudo conectar con Gemini.',
        transient: true,
      };
    } finally {
      clearTimeout(timeout);
    }

    if (response?.ok) return { data, model };

    if (response) {
      lastFailure = {
        status: response.status,
        code: response.status === 429 ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED',
        message: data?.error?.message || `Gemini rechazó la solicitud (${response.status}).`,
        transient: TRANSIENT_STATUSES.has(response.status),
      };
    }

    if (!lastFailure?.transient || attempt >= retries) break;
    await sleep(retryDelay(attempt, response));
  }

  return { error: lastFailure, model };
}

function finalError(failure, attemptedModels) {
  if (failure?.status === 429) {
    return new AppError('GEMINI_QUOTA_EXCEEDED', 'Gemini alcanzó temporalmente el límite de solicitudes. Espere unos segundos y vuelva a intentarlo.', 429, { attemptedModels });
  }
  if (failure?.transient) {
    return new AppError('GEMINI_TEMPORARILY_UNAVAILABLE', 'Gemini está temporalmente saturado. Se intentaron modelos alternativos sin éxito.', 503, { attemptedModels });
  }
  return new AppError(failure?.code || 'GEMINI_REQUEST_FAILED', failure?.message || 'Gemini rechazó la solicitud.', failure?.status === 400 ? 400 : 502, { attemptedModels });
}

function keepImageTokens(originalHtml, improvedHtml) {
  const tokens = [...new Set(String(originalHtml).match(/\[\[IMAGEN_\d+\]\]/g) || [])];
  let result = String(improvedHtml || '');

  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = result.match(new RegExp(escaped, 'g')) || [];
    if (!occurrences.length) {
      result += `<p>${token}</p>`;
      continue;
    }
    if (occurrences.length > 1) {
      let first = true;
      result = result.replace(new RegExp(escaped, 'g'), () => {
        if (first) {
          first = false;
          return token;
        }
        return '';
      });
    }
  }
  return result;
}

export async function rewriteKnowledgeTutorial(payload = {}) {
  const apiKey = clean(process.env.GEMINI_API_KEY, 500);
  if (!apiKey) {
    throw new AppError('GEMINI_NOT_CONFIGURED', 'Gemini no está configurado. Agregue GEMINI_API_KEY en las variables del backend.', 503);
  }

  const requestedMode = clean(payload.mode, 30).toUpperCase();
  const mode = ['TITLE_ONLY', 'PROBLEM_ONLY', 'FULL'].includes(requestedMode) ? requestedMode : 'FULL';
  const titulo = clean(payload.titulo ?? payload.title, 160);
  const problema = clean(payload.problema ?? payload.problem, 12_000);
  const contenidoHtml = clean(payload.contenidoHtml ?? payload.contentHtml ?? payload.content, 50_000);
  const categorias = (Array.isArray(payload.categorias) ? payload.categorias : [])
    .map((value) => clean(value, 120))
    .filter(Boolean)
    .slice(0, 20);

  const visibleText = contenidoHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!visibleText) throw badRequest('Escriba el documento paso a paso antes de mejorarlo con Gemini.');

  const models = resolveModels();
  const retries = positiveInteger(process.env.GEMINI_MAX_RETRIES, 1, 0, 3);
  const attemptedModels = [];
  let lastFailure = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    attemptedModels.push(model);
    const result = await requestModel({
      apiKey,
      model,
      prompt: buildPrompt({ mode, titulo, problema, contenidoHtml, categorias }),
      retries: index === 0 ? retries : 0,
    });

    if (result.data) {
      const parsed = parseJson(extractInteractionText(result.data));
      const improvedTitle = mode === 'PROBLEM_ONLY'
        ? titulo
        : clean(parsed.titulo || titulo, 120);
      const improvedProblem = mode === 'TITLE_ONLY'
        ? problema
        : clean(parsed.problema || problema, 1200);
      const rawContent = mode === 'FULL'
        ? clean(parsed.contenidoHtml || contenidoHtml, 60_000)
        : contenidoHtml;

      if (mode !== 'TITLE_ONLY' && !improvedProblem) {
        throw new AppError('GEMINI_EMPTY_PROBLEM_DESCRIPTION', 'Gemini no pudo generar la descripción del problema a partir del procedimiento.', 502);
      }

      return {
        titulo: improvedTitle || titulo,
        problema: improvedProblem || problema,
        contenidoHtml: keepImageTokens(contenidoHtml, rawContent),
        model,
      };
    }

    lastFailure = result.error;
    if (!lastFailure?.transient) break;
  }

  throw finalError(lastFailure, attemptedModels);
}
