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

function activeQuestion(question) {
  return question?.historical !== true
    && question?.activeAtSave !== false
    && question?.Activo !== false;
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

export function maintenanceChecklistCompletion(device = {}, fallbackQuestions = []) {
  const { answers, metadataQuestions } = parseMaintenanceAnswers(device);
  const explicitQuestions = Array.isArray(device.questionDetails) ? device.questionDetails : [];
  const questionSource = [
    ...(Array.isArray(fallbackQuestions) ? fallbackQuestions : []),
    ...metadataQuestions,
    ...explicitQuestions,
  ];
  const requiredKeys = [...new Set(questionSource
    .filter(activeQuestion)
    .map(questionKey)
    .filter(Boolean))];
  const missing = [];

  if (!text(device.funcionamiento ?? device.Funcionamiento)) missing.push('Funcionamiento');
  if (!text(device.enUso ?? device.EnUso)) missing.push('En uso');

  requiredKeys.forEach((key) => {
    if (!text(answers[key] ?? device[key] ?? device[`${key.charAt(0).toUpperCase()}${key.slice(1)}`])) {
      missing.push(key);
    }
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

  const current = text(stateValue(device));
  if (!current || normalized(current) === 'pendiente') return 'Correcto';
  return current;
}

export function isMaintenanceChecklistPending(device = {}, fallbackQuestions = []) {
  return normalized(effectiveMaintenanceDeviceState(device, fallbackQuestions)) === 'pendiente';
}
