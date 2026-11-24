function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stateValue(deviceOrState) {
  if (deviceOrState && typeof deviceOrState === 'object') {
    return deviceOrState.estado ?? deviceOrState.Estado ?? '';
  }
  return deviceOrState;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function questionKey(question) {
  if (Array.isArray(question)) return text(question[0]);
  return text(question?.key ?? question?.Clave);
}

function questionConfig(question = {}) {
  const raw = question.config || question.ConfiguracionJSON || {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function activeQuestion(question) {
  return question?.historical !== true
    && question?.activeAtSave !== false
    && question?.Activo !== false;
}

function requiredQuestion(question) {
  const config = questionConfig(question);
  return config.required !== false;
}

function answerHasValue(question, value) {
  const responseType = text(question?.responseType || question?.TipoRespuesta || 'SI_NO').toUpperCase();
  if (responseType === 'RELACION_DISPOSITIVO') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const enabled = value.enabled === true || normalized(value.enabled) === 'true';
    return enabled && Array.isArray(value.items) && value.items.length > 0;
  }
  if (responseType === 'NUMERO' || responseType === 'CANTIDAD') {
    return value !== '' && value !== null && value !== undefined;
  }
  return Boolean(text(value));
}

// Se usa mayúscula exacta para el pendiente manual que bloquea la checklist.
// El pendiente automático conserva el mismo valor visible, pero no bloquea preguntas.
export const MANUAL_PENDING_STATE = 'PENDIENTE';
export const AUTOMATIC_PENDING_STATE = 'Pendiente';

export function isManualChecklistPending(deviceOrState) {
  return text(stateValue(deviceOrState)) === MANUAL_PENDING_STATE;
}

export function parseMaintenanceAnswers(device = {}) {
  const source = device.respuestas ?? device.RespuestasJSON ?? device.answers ?? {};
  const parsed = parseJsonObject(source);
  const metadataQuestions = Array.isArray(parsed.__preguntas) ? parsed.__preguntas : [];
  const { __preguntas: _metadata, ...answers } = parsed;
  return { answers, metadataQuestions };
}

// Solo las respuestas se recuperan del dispositivo. Una pregunta activa debe
// mostrarse con el texto, orden, tipo y configuración actuales del catálogo.
export function activeMaintenanceQuestionView(question, saved) {
  return saved ? { ...question, value: saved.value ?? '' } : question;
}

function resolvedMaintenanceQuestions(device = {}, fallbackQuestions = []) {
  const { metadataQuestions } = parseMaintenanceAnswers(device);
  const explicitQuestions = Array.isArray(device.questionDetails) ? device.questionDetails : [];
  // La definición vigente prevalece sobre los snapshots históricos.
  const questionsByKey = new Map();
  for (const question of [
    ...metadataQuestions,
    ...explicitQuestions,
    ...(Array.isArray(fallbackQuestions) ? fallbackQuestions : []),
  ]) {
    const key = questionKey(question);
    if (!key) continue;
    questionsByKey.delete(key);
    questionsByKey.set(key, question);
  }
  return [...questionsByKey.values()].filter(activeQuestion);
}

// Las preguntas de trabajo (p. ej. limpieza pendiente) no indican por sí mismas
// que un equipo esté averiado. Solo las verificaciones operativas positivas
// y las preguntas configuradas explícitamente como críticas para su salud
// pueden convertir una respuesta negativa en una falla del dispositivo.
function isFunctionalHealthCheck(question) {
  const config = questionConfig(question);
  if (typeof config.affectsDeviceHealth === 'boolean') return config.affectsDeviceHealth;
  const label = normalized(Array.isArray(question) ? question[1] : (question.label ?? question.Pregunta));
  // Una actividad aún no realizada no prueba una avería, incluso cuando
  // la pregunta usa adverbios como "correctamente".
  if (/^¿?\s*se (realiz|complet|ejecut|efectu|registr)/.test(label)) return false;
  return /\b(funciona\w*|correct\w*|satisfactori\w*|activ\w*|operativ\w*|disponible\w*|reportan|visualiza\w*|transmit\w*|graba\w*|responde\w*|firme|alinead\w*|buen estado)\b/.test(label)
    || /\blevanta (?:el )?video\b/.test(label);
}

export function maintenanceChecklistHealthFaults(device = {}, fallbackQuestions = []) {
  const { answers } = parseMaintenanceAnswers(device);
  const failures = [];
  if (normalized(device.funcionamiento ?? device.Funcionamiento) === 'no') {
    failures.push('Funcionamiento');
  }
  for (const question of resolvedMaintenanceQuestions(device, fallbackQuestions)) {
    const key = questionKey(question);
    const type = text(question?.responseType || question?.TipoRespuesta || 'SI_NO').toUpperCase();
    if (type !== 'SI_NO') continue;
    const answer = normalized(answers[key] ?? question.value ?? question.Valor ?? '');
    const config = questionConfig(question);
    const adverse = normalized(config.healthFailureAnswer || '') || 'no';
    const indicatesFault = key === 'reportaAveria'
      ? answer === 'si'
      : isFunctionalHealthCheck(question) && answer === adverse;
    if (indicatesFault) {
      failures.push(text(Array.isArray(question) ? question[1] : (question.label ?? question.Pregunta)) || key);
    }
  }
  return failures;
}

export function maintenanceChecklistCompletion(device = {}, fallbackQuestions = []) {
  const { answers } = parseMaintenanceAnswers(device);
  const requiredQuestions = resolvedMaintenanceQuestions(device, fallbackQuestions)
    .filter(requiredQuestion);
  const requiredKeys = [...new Set(requiredQuestions
    .map(questionKey)
    .filter(Boolean))];
  const requiredByKey = new Map(requiredQuestions.map((question) => [questionKey(question), question]));
  const missing = [];

  if (!text(device.funcionamiento ?? device.Funcionamiento)) missing.push('Funcionamiento');
  if (!text(device.enUso ?? device.EnUso)) missing.push('En uso');

  requiredKeys.forEach((key) => {
    const value = answers[key] ?? device[key] ?? device[`${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    if (!answerHasValue(requiredByKey.get(key), value)) missing.push(key);
  });

  return {
    complete: missing.length === 0,
    missing,
    requiredKeys,
  };
}

export function effectiveMaintenanceDeviceState(device = {}, fallbackQuestions = []) {
  if (isManualChecklistPending(device)) return MANUAL_PENDING_STATE;
  const completion = maintenanceChecklistCompletion(device, fallbackQuestions);
  if (!completion.complete) return AUTOMATIC_PENDING_STATE;

  if (maintenanceChecklistHealthFaults(device, fallbackQuestions).length) return 'Mal estado';

  const current = text(stateValue(device));
  if (!current || normalized(current) === 'pendiente') return 'Correcto';
  return current;
}

export function isMaintenanceChecklistPending(device = {}, fallbackQuestions = []) {
  return normalized(effectiveMaintenanceDeviceState(device, fallbackQuestions)) === 'pendiente';
}
