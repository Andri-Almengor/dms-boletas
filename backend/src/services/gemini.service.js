import { AppError, badRequest } from '../core/errors.js';

const FIELD_KEYS = ['razonVisita', 'descripcion', 'pruebasRealizadas', 'resultado', 'recomendaciones'];
const FIELD_LABELS = {
  razonVisita: 'Razón de visita',
  descripcion: 'Descripción',
  pruebasRealizadas: 'Pruebas realizadas',
  resultado: 'Resultado',
  recomendaciones: 'Recomendaciones',
};

function clean(value, maxLength = 8000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseJson(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1));
    throw new AppError('GEMINI_INVALID_RESPONSE', 'Gemini devolvió una respuesta que no se pudo interpretar.', 502);
  }
}

function buildPrompt(fields, context) {
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
    '- Devuelve únicamente un objeto JSON con estas claves exactas: razonVisita, descripcion, pruebasRealizadas, resultado, recomendaciones.',
    '',
    `Contexto del servicio: ${JSON.stringify(context)}`,
    `Texto original: ${JSON.stringify(original)}`,
  ].join('\n');
}

export async function rewriteTechnicalReport(payload = {}) {
  const apiKey = clean(process.env.GEMINI_API_KEY, 500);
  const model = clean(process.env.GEMINI_MODEL || 'gemini-3.5-flash', 100);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;
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
        system_instruction: 'Eres un redactor de informes de mantenimiento y soporte técnico. Debes mejorar la redacción sin agregar información que el técnico no haya proporcionado.',
        input: buildPrompt(fields, context),
        generation_config: {
          temperature: 0.2,
          thinking_level: 'low',
        },
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AppError('GEMINI_TIMEOUT', 'Gemini tardó demasiado en responder. Intente nuevamente.', 504);
    throw new AppError('GEMINI_CONNECTION_ERROR', 'No se pudo conectar con Gemini.', 502);
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || 'Gemini rechazó la solicitud.';
    const status = response.status === 429 ? 429 : 502;
    throw new AppError(response.status === 429 ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED', message, status);
  }

  const parsed = parseJson(data.output_text);
  const improved = Object.fromEntries(FIELD_KEYS.map((key) => [key, fields[key] ? clean(parsed[key] ?? fields[key], 12000) : '']));
  return { fields: improved, model };
}
