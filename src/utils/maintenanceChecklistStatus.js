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
    && question?.active !== false
    && !['false', '0', 'no'].includes(normalized(question?.Activo ?? true))
    && normalized(question?.Estado ?? 'ACTIVO') !== 'inactivo';
}

function requiredQuestion(question) {
  const config = questionConfig(question);
  return config.required !== false;
}

export function normalizeMaintenanceBinaryAnswer(value) {
  const answer = normalized(value);
  if (['si', 'true', '1'].includes(answer)) return 'Sí';
  if (['no', 'false', '0'].includes(answer)) return 'No';
  return '';
}

function resolvedQuestionAnswer(device, answers, question) {
  const key = questionKey(question);
  const column = key.charAt(0).toUpperCase() + key.slice(1);
  // Una respuesta vaciada explícitamente no se recupera de un snapshot viejo.
  return answers[key] ?? device[key] ?? device[column] ?? question?.value ?? question?.Valor ?? '';
}

function answerHasValue(question, value) {
  const responseType = text(question?.responseType || question?.TipoRespuesta || 'SI_NO').toUpperCase();
  if (responseType === 'SI_NO') return Boolean(normalizeMaintenanceBinaryAnswer(value));
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
  const fallback = Array.isArray(fallbackQuestions) ? fallbackQuestions : [];
  // Los arreglos [clave, etiqueta] son solo el catálogo legado. No pueden
  // resucitar preguntas eliminadas ni sobrescribir la política del snapshot.
  const legacyFallback = fallback.length > 0 && fallback.every(Array.isArray);
  const definitions = legacyFallback && (metadataQuestions.length || explicitQuestions.length)
    ? [] : fallback;
  for (const question of [
    ...metadataQuestions,
    ...explicitQuestions,
    ...definitions,
  ]) {
    const key = questionKey(question);
    if (!key) continue;
    questionsByKey.delete(key);
    questionsByKey.set(key, question);
  }
  return [...questionsByKey.values()].filter(activeQuestion);
}

// Regla conservadora para preguntas binarias sin configuración explícita:
// una respuesta negativa es una falla, salvo tareas de ejecución (limpieza,
// mediciones, etc.) o preguntas inequívocamente formuladas en sentido inverso.
// El administrador puede fijar la polaridad o excluir preguntas informativas.
export function maintenanceQuestionFailureAnswer(question) {
  const key = questionKey(question);
  const type = text(question?.responseType || question?.TipoRespuesta || 'SI_NO').toUpperCase();
  if (type !== 'SI_NO') return '';
  if (key === 'reportaAveria') return 'Sí';
  const config = questionConfig(question);
  if (config.affectsDeviceHealth === false) return '';
  const configured = normalizeMaintenanceBinaryAnswer(config.healthFailureAnswer);
  if (configured) return configured;
  if (config.affectsDeviceHealth === true) return 'No';
  const label = normalized(Array.isArray(question) ? question[1] : (question.label ?? question.Pregunta));
  if (/^¿?\s*se (realiz|complet|ejecut|efectu|registr)/.test(label)) return '';
  if (/\b(presenta\w*|tiene|hay|existe\w*|reporta\w*|detecta\w*)\b[^?]*(?:\bfalla\w*|\baveria\w*|\bdano\w*|\bdefecto\w*|\bproblema\w*)/.test(label)
      && !/\b(sin|ningun\w*|libre de|ausencia de)\b/.test(label)) return 'Sí';
  return 'No';
}

export function maintenanceChecklistHealthFaults(device = {}, fallbackQuestions = []) {
  const { answers } = parseMaintenanceAnswers(device);
  const failures = [];
  if (normalizeMaintenanceBinaryAnswer(device.funcionamiento ?? device.Funcionamiento) === 'No') {
    failures.push('Funcionamiento');
  }
  const questions = resolvedMaintenanceQuestions(device, fallbackQuestions);
  for (const question of questions) {
    const adverse = maintenanceQuestionFailureAnswer(question);
    const answer = normalizeMaintenanceBinaryAnswer(resolvedQuestionAnswer(device, answers, question));
    if (adverse && answer === adverse) {
      failures.push(text(Array.isArray(question) ? question[1] : (question.label ?? question.Pregunta)) || questionKey(question));
    }
  }
  // La pregunta global es obligatoriamente interpretada como avería si se
  // contestó Sí, aun en borradores legados que no traen su definición.
  if (!questions.some((question) => questionKey(question) === 'reportaAveria')
    && normalizeMaintenanceBinaryAnswer(answers.reportaAveria ?? device.reportaAveria ?? device.ReportaAveria) === 'Sí') {
    failures.push('¿Se reporta avería en este equipo?');
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

  if (!normalizeMaintenanceBinaryAnswer(device.funcionamiento ?? device.Funcionamiento)) missing.push('Funcionamiento');
  if (!text(device.enUso ?? device.EnUso)) missing.push('En uso');

  requiredKeys.forEach((key) => {
    const value = resolvedQuestionAnswer(device, answers, requiredByKey.get(key));
    if (!answerHasValue(requiredByKey.get(key), value)) missing.push(key);
  });

  return {
    complete: missing.length === 0,
    missing,
    requiredKeys,
  };
}

export function effectiveMaintenanceDeviceState(device = {}, fallbackQuestions = [], { preserveRecordedFault = false } = {}) {
  if (normalized(device.maintenanceType ?? device.TipoMantenimiento ?? device.tipoMantenimiento) === 'proyecto') {
    return text(stateValue(device)) || AUTOMATIC_PENDING_STATE;
  }
  if (isManualChecklistPending(device)) return MANUAL_PENDING_STATE;
  const completion = maintenanceChecklistCompletion(device, fallbackQuestions);
  if (!completion.complete) return AUTOMATIC_PENDING_STATE;

  if (maintenanceChecklistHealthFaults(device, fallbackQuestions).length) return 'Mal estado';

  // Solo una lectura de un registro histórico puede conservar su diagnóstico
  // anterior sin reinterpretarlo. En edición/guardado el estado se deriva.
  if (preserveRecordedFault && normalized(stateValue(device)) === 'mal estado') return 'Mal estado';
  return 'Correcto';
}

export function isMaintenanceChecklistPending(device = {}, fallbackQuestions = []) {
  return normalized(effectiveMaintenanceDeviceState(device, fallbackQuestions)) === 'pendiente';
}
