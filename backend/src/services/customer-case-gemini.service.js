const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
});

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function configuredModels() {
  const primary = clean(process.env.GEMINI_MODEL || FALLBACK_MODELS[0], 100);
  const configured = clean(process.env.GEMINI_FALLBACK_MODELS, 400)
    .split(',')
    .map((value) => clean(value, 100))
    .filter(Boolean);
  return [...new Set([primary, ...(configured.length ? configured : FALLBACK_MODELS.slice(1))])];
}

function parseResponse(text) {
  const normalized = clean(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1));
    throw new Error('Gemini no devolvió JSON válido.');
  }
}

function interactionText(data = {}) {
  if (typeof data.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const stepText = steps.flatMap((step) => {
    const content = Array.isArray(step?.content) ? step.content : [step?.content];
    return content.filter((item) => item?.type === 'text').map((item) => item.text);
  }).filter(Boolean);
  if (stepText.length) return stepText.join('\n');
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidateText = candidates.flatMap((candidate) => (candidate?.content?.parts || [])
    .map((part) => part?.text)
    .filter(Boolean));
  if (candidateText.length) return candidateText.join('\n');
  throw new Error('Gemini no devolvió texto utilizable.');
}

function generationConfig(model) {
  return /^gemini-3(?:\.|-)/i.test(model)
    ? { thinking_level: 'low' }
    : { temperature: 0.2 };
}

async function requestModel(model, prompt) {
  const apiKey = clean(process.env.GEMINI_API_KEY, 500);
  if (!apiKey) throw new Error('GEMINI_NOT_CONFIGURED');
  const timeoutMs = Math.max(10_000, Math.min(90_000, Number(process.env.GEMINI_TIMEOUT_MS || 30_000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        store: false,
        system_instruction: 'Eres un coordinador profesional de mesa de ayuda para Digital Management Systems. Redactas correos operativos claros, concretos y cordiales usando únicamente los datos proporcionados. No inventas diagnósticos, fechas, compromisos ni trabajos.',
        input: prompt,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: RESPONSE_SCHEMA,
        },
        generation_config: generationConfig(model),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Gemini respondió ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return parseResponse(interactionText(data));
  } finally {
    clearTimeout(timeout);
  }
}

function initialFallback(caseData) {
  const caseNumber = clean(caseData.CasoNumero || caseData.CasoID, 80);
  const reason = clean(caseData.RazonVisita, 180) || 'Solicitud de asistencia técnica';
  return {
    subject: `[${caseNumber}] ${reason}`.slice(0, 140),
    body: [
      'Buenos días,',
      '',
      `Se recibió una nueva solicitud del cliente ${clean(caseData.Cliente, 200)}.`,
      `Caso: ${caseNumber}`,
      `Generado por: ${clean(caseData.NombreSolicitante, 200)} (${clean(caseData.CorreoSolicitante, 250)})`,
      `Razón de la visita: ${reason}`,
      `Problema reportado: ${clean(caseData.Problema, 4000)}`,
      `Evidencias aportadas: ${Number(caseData.EvidenciaCount || 0)}`,
      '',
      'El caso ya fue creado en el APP de boletas y se encuentra en espera de revisión y asignación.',
      '',
      'Saludos,',
      'DMS Boletas',
    ].join('\n'),
  };
}

function assignmentFallback(caseData, context = {}) {
  const caseNumber = clean(caseData.CasoNumero || caseData.CasoID, 80);
  const ticketNumber = clean(context.ticketNumber || context.ticketId, 80);
  const technicians = (context.technicians || []).map((item) => clean(item.Nombre || item.NombreCompleto || item.NombreUsuario, 150)).filter(Boolean).join(', ');
  return {
    subject: `[${caseNumber}] Visita asignada: ${clean(caseData.RazonVisita, 120)}`.slice(0, 140),
    body: [
      'Buenos días,',
      '',
      `Se les asignó el caso ${caseNumber} del cliente ${clean(caseData.Cliente, 200)}.`,
      `Técnicos asignados: ${technicians || 'Equipo técnico asignado'}`,
      `Fecha programada: ${clean(context.visitDate, 40) || 'Pendiente de confirmar'}${context.visitTime ? ` a las ${clean(context.visitTime, 20)}` : ''}`,
      `Razón de la visita: ${clean(caseData.RazonVisita, 800)}`,
      `Problema reportado: ${clean(caseData.Problema, 4000)}`,
      context.adminMessage ? `Mensaje del administrador: ${clean(context.adminMessage, 3000)}` : '',
      `Evidencias disponibles: ${Number(caseData.EvidenciaCount || 0)}`,
      ticketNumber ? `Boleta: #${ticketNumber}` : '',
      context.ticketUrl ? `Abrir boleta en DMS: ${clean(context.ticketUrl, 1000)}` : '',
      '',
      'Revise la boleta y las evidencias antes de realizar la visita.',
      '',
      'Saludos,',
      'DMS Boletas',
    ].filter(Boolean).join('\n'),
  };
}

function promptForInitial(caseData) {
  return [
    'Redacta el correo interno que notifica la creación de un caso de soporte.',
    'El asunto debe describir claramente el problema en máximo 120 caracteres e incluir el número de caso.',
    'El cuerpo debe ser profesional, fácil de escanear y contener cliente, número de caso, persona y correo que lo envía, razón de visita, problema y cantidad de evidencias.',
    'Debe incluir literalmente la idea: "El caso ya fue creado en el APP de boletas".',
    'No inventes un diagnóstico, solución, prioridad ni fecha de atención.',
    'No uses Markdown ni HTML. Devuelve JSON con subject y body.',
    '',
    `Datos: ${JSON.stringify({
      caso: caseData.CasoNumero,
      cliente: caseData.Cliente,
      solicitante: caseData.NombreSolicitante,
      correo: caseData.CorreoSolicitante,
      razonVisita: caseData.RazonVisita,
      problema: caseData.Problema,
      evidencias: Number(caseData.EvidenciaCount || 0),
    })}`,
  ].join('\n');
}

function promptForAssignment(caseData, context) {
  return [
    'Redacta un correo operativo para los técnicos asignados a una visita.',
    'El asunto debe identificar el caso, el cliente y la tarea principal en máximo 120 caracteres.',
    'El cuerpo debe explicar exactamente qué reportó el cliente, cuándo está programada la visita, quiénes están asignados, el mensaje adicional del administrador, la cantidad de evidencias y el enlace de la boleta.',
    'Indica que deben revisar la boleta y las evidencias antes de la visita.',
    'No inventes diagnóstico, pruebas, repuestos, resultados, duración ni instrucciones que no estén en los datos.',
    'No uses Markdown ni HTML. Devuelve JSON con subject y body.',
    '',
    `Datos: ${JSON.stringify({
      caso: caseData.CasoNumero,
      cliente: caseData.Cliente,
      razonVisita: caseData.RazonVisita,
      problema: caseData.Problema,
      tecnicos: (context.technicians || []).map((item) => item.Nombre || item.NombreCompleto || item.NombreUsuario),
      fecha: context.visitDate,
      hora: context.visitTime,
      mensajeAdministrador: context.adminMessage,
      evidencias: Number(caseData.EvidenciaCount || 0),
      boleta: context.ticketNumber || context.ticketId,
      enlaceBoleta: context.ticketUrl,
    })}`,
  ].join('\n');
}

async function generate(prompt, fallback) {
  const models = configuredModels();
  let lastError = null;
  for (const model of models) {
    try {
      const result = await requestModel(model, prompt);
      const subject = clean(result.subject, 140);
      const body = clean(result.body, 12000);
      if (!subject || !body) throw new Error('Gemini devolvió un correo incompleto.');
      return { subject, body, model, generatedByGemini: true, warning: '' };
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_STATUSES.has(Number(error?.status || 0)) && error?.message !== 'GEMINI_NOT_CONFIGURED') break;
    }
  }
  return {
    ...fallback,
    model: '',
    generatedByGemini: false,
    warning: clean(lastError?.message || 'Gemini no estuvo disponible; se utilizó la plantilla segura.', 500),
  };
}

export function generateInitialCaseEmail(caseData) {
  return generate(promptForInitial(caseData), initialFallback(caseData));
}

export function generateAssignedCaseEmail(caseData, context = {}) {
  return generate(promptForAssignment(caseData, context), assignmentFallback(caseData, context));
}
