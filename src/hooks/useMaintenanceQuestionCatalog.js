import { useEffect, useMemo, useState } from 'react';
import { canonicalMaintenanceCategoryName } from '../config/maintenanceCategories.js';
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

export function maintenanceQuestionTypeIdentity(value) {
  return normalized(canonicalMaintenanceCategoryName(value));
}

export function mergeMaintenanceQuestionCandidates(exact = [], equivalent = []) {
  const seen = new Set();
  return [...exact, ...equivalent].filter((question) => {
    const key = clean(question.key || question.questionId || question.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    responseType: clean(row.responseType || row.TipoRespuesta || 'SI_NO'),
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
    responseType: clean(row.responseType || row.TipoRespuesta || 'SI_NO'),
    appliesTo: normalizeMode(row.appliesTo || row.AplicaModo || 'MANTENIMIENTO'),
    relatedTypeId: clean(row.relatedTypeId || row.TipoDispositivoRelacionadoID),
    config: parseConfig(row.config || row.ConfiguracionJSON),
    value: row.value ?? '',
  };
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

  const byTypeId = useMemo(() => {
    const map = new Map();
    questions.forEach((question) => {
      if (!question.typeId) return;
      if (!map.has(question.typeId)) map.set(question.typeId, []);
      map.get(question.typeId).push(question);
    });
    map.forEach((items) => items.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es')));
    return map;
  }, [questions]);

  const byTypeIdentity = useMemo(() => {
    const map = new Map();
    questions.forEach((question) => {
      const identity = maintenanceQuestionTypeIdentity(question.typeName);
      if (!identity) return;
      if (!map.has(identity)) map.set(identity, []);
      map.get(identity).push(question);
    });
    map.forEach((items) => items.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es')));
    return map;
  }, [questions]);

  function forDevice(device = {}, maintenanceMode = 'MANTENIMIENTO') {
    const typeId = clean(device.tipoDispositivoId || device.TipoDispositivoID);
    const category = clean(device.categoria || device.TipoDispositivo || device.Categoria);
    const identity = maintenanceQuestionTypeIdentity(category);
    const requestedMode = normalizeMode(maintenanceMode);
    const exact = typeId && byTypeId.has(typeId) ? byTypeId.get(typeId) : [];
    const equivalent = identity && byTypeIdentity.has(identity) ? byTypeIdentity.get(identity) : [];
    const selected = mergeMaintenanceQuestionCandidates(exact, equivalent)
      .filter((question) => question.appliesTo === 'AMBOS' || question.appliesTo === requestedMode)
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'));
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
