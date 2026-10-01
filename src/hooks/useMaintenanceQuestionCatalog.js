import { useEffect, useState } from 'react';
import { canonicalMaintenanceCategoryName } from '../config/maintenanceCategories';
import { requestAvailable } from '../services/moduleApi';

const CONFIG_ROUTES = ['maintenance.config', 'mantenimientos.config'];

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedDeviceTypeName(value) {
  return normalized(canonicalMaintenanceCategoryName(value));
}

function normalizeMode(value = 'MANTENIMIENTO') {
  const mode = clean(value || 'MANTENIMIENTO').toUpperCase();
  return ['MANTENIMIENTO', 'PROYECTO', 'AMBOS'].includes(mode) ? mode : 'MANTENIMIENTO';
}

function parseConfig(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function questionView(row = {}) {
  return {
    id: clean(row.id || row.questionId || row.PreguntaDispositivoID),
    questionId: clean(row.questionId || row.id || row.PreguntaDispositivoID),
    typeId: clean(row.typeId || row.TipoDispositivoID),
    typeName: clean(row.typeName || row.TipoDispositivo),
    key: clean(row.key || row.Clave),
    label: clean(row.label || row.Pregunta),
    order: Number(row.order ?? row.Orden ?? 0),
    responseType: clean(row.responseType || row.TipoRespuesta || 'SI_NO').toUpperCase(),
    appliesTo: normalizeMode(row.appliesTo || row.AplicaModo || 'MANTENIMIENTO'),
    relatedTypeId: clean(row.relatedTypeId || row.TipoDispositivoRelacionadoID),
    config: parseConfig(row.config || row.ConfiguracionJSON),
    active: row.active !== false && row.Activo !== false && clean(row.status || row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO',
    historical: Boolean(row.historical),
  };
}

function savedQuestionView(row = {}) {
  return {
    questionId: clean(row.questionId || row.id || row.PreguntaDispositivoID),
    typeId: clean(row.typeId || row.TipoDispositivoID),
    key: clean(row.key || row.Clave),
    label: clean(row.label || row.Pregunta),
    order: Number(row.order ?? row.Orden ?? 0),
    responseType: clean(row.responseType || row.TipoRespuesta || 'SI_NO').toUpperCase(),
    appliesTo: normalizeMode(row.appliesTo || row.AplicaModo || 'MANTENIMIENTO'),
    relatedTypeId: clean(row.relatedTypeId || row.TipoDispositivoRelacionadoID),
    config: parseConfig(row.config || row.ConfiguracionJSON),
    value: row.value ?? '',
  };
}

export function selectMaintenanceQuestionsForDevice(questions = [], device = {}, maintenanceMode = 'MANTENIMIENTO') {
  const typeId = clean(device.tipoDispositivoId || device.TipoDispositivoID);
  const category = normalizedDeviceTypeName(device.categoria || device.TipoDispositivo || device.Categoria);
  const requestedMode = normalizeMode(maintenanceMode);
  const applies = (question) => question.appliesTo === 'AMBOS' || question.appliesTo === requestedMode;
  const applicable = questions.filter(applies);
  const exact = typeId
    ? applicable.filter((question) => question.typeId === typeId)
    : [];
  const compatible = category
    ? applicable.filter((question) => normalizedDeviceTypeName(question.typeName) === category)
    : [];

  // El ID exacto conserva prioridad, pero una variante histórica equivalente
  // (Puerta/Puertas, Cámara/Cámaras, etc.) puede aportar campos que falten.
  // Esto evita que un duplicado/alias de catálogo oculte relaciones válidas.
  const selected = [];
  const seenKeys = new Set();
  const seenSignatures = new Set();
  for (const question of [...exact, ...compatible]) {
    const key = clean(question.key || question.questionId);
    const signature = [
      normalized(question.label),
      clean(question.responseType).toUpperCase(),
      clean(question.relatedTypeId),
    ].join('|');
    if ((key && seenKeys.has(key)) || (signature !== '||' && seenSignatures.has(signature))) continue;
    if (key) seenKeys.add(key);
    if (signature !== '||') seenSignatures.add(signature);
    selected.push(question);
  }

  return selected.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'));
}

export default function useMaintenanceQuestionCatalog(sessionToken) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionToken));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionToken) {
      setQuestions([]);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');
    requestAvailable(CONFIG_ROUTES, {}, sessionToken)
      .then((data) => {
        if (!active) return;
        setQuestions((Array.isArray(data?.questions) ? data.questions : [])
          .map(questionView)
          .filter((item) => item.key && item.label && item.active));
      })
      .catch((requestError) => {
        if (!active) return;
        setQuestions([]);
        setError(requestError?.message || 'No se pudieron cargar las preguntas del mantenimiento.');
      })
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [sessionToken]);

  function forDevice(device = {}, maintenanceMode = 'MANTENIMIENTO') {
    const typeId = clean(device.tipoDispositivoId || device.TipoDispositivoID);
    const selected = selectMaintenanceQuestionsForDevice(questions, device, maintenanceMode);
    const savedByKey = new Map((device.questionDetails || [])
      .map(savedQuestionView)
      .filter((item) => item.key && (!item.typeId || !typeId || item.typeId === typeId))
      .map((item) => [item.key, item]));

    return selected.map((question) => {
      const saved = savedByKey.get(question.key);
      if (!saved) return question;
      return {
        ...question,
        questionId: saved.questionId || question.questionId,
        label: saved.label || question.label,
        order: saved.order || question.order,
        responseType: saved.responseType || question.responseType,
        appliesTo: saved.appliesTo || question.appliesTo,
        relatedTypeId: saved.relatedTypeId || question.relatedTypeId,
        config: saved.config || question.config,
        value: saved.value,
      };
    });
  }

  return { questions, forDevice, loading, error };
}
