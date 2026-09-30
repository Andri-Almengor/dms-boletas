import { createLocalId } from '../../utils/localId.js';

export const PROJECT_CHECKLIST_RESPONSE_TYPES = Object.freeze({
  YES_NO: 'SI_NO',
  PROGRESS: 'PENDIENTE_REALIZADO',
});

function text(value = '') {
  return String(value ?? '').trim();
}

function normalized(value = '') {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function responseType(value) {
  const current = text(value).toUpperCase();
  return current === PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO
    ? PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO
    : PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS;
}

export function emptyProjectChecklist() {
  return { version: 1, groups: [] };
}

export function emptyProjectProgress() {
  return { version: 1, answers: {} };
}

export function projectChecklistGroupIdentity(input = {}) {
  const typeId = text(input.typeId || input.TipoDispositivoID);
  if (typeId) return `type:${typeId}`;
  const countField = text(input.countField);
  if (countField) return `count:${countField}`;
  return `name:${normalized(input.typeName || input.label || input.key || input.categoria || input.TipoDispositivo)}`;
}

function normalizeQuestion(item = {}, index = 0) {
  const label = text(item.label || item.Pregunta);
  return {
    id: text(item.id || item.questionId) || createLocalId('project-check'),
    label,
    responseType: responseType(item.responseType || item.TipoRespuesta),
    order: Number(item.order ?? item.Orden ?? (index + 1) * 10),
  };
}

function normalizeGroup(item = {}, index = 0) {
  const typeId = text(item.typeId || item.TipoDispositivoID);
  const typeName = text(item.typeName || item.label || item.key || item.TipoDispositivo);
  const countField = text(item.countField);
  const group = {
    id: text(item.id) || projectChecklistGroupIdentity({ typeId, typeName, countField }),
    typeId,
    typeName,
    countField,
    order: Number(item.order ?? index * 10),
    questions: (Array.isArray(item.questions) ? item.questions : [])
      .map(normalizeQuestion)
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es')),
  };
  return group.typeId || group.typeName || group.countField ? group : null;
}

export function normalizeProjectChecklist(value) {
  const parsed = parseObject(value, emptyProjectChecklist());
  return {
    version: 1,
    groups: (Array.isArray(parsed.groups) ? parsed.groups : [])
      .map(normalizeGroup)
      .filter(Boolean),
  };
}

function normalizeProgressValue(value, type) {
  const current = text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (type === PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO) {
    if (['SI', 'YES', 'TRUE', '1'].includes(current)) return 'SI';
    if (['NO', 'FALSE', '0'].includes(current)) return 'NO';
    return '';
  }
  if (['REALIZADO', 'FINALIZADO', 'COMPLETO', 'COMPLETADO', 'DONE'].includes(current)) return 'REALIZADO';
  return 'PENDIENTE';
}

export function normalizeProjectProgress(value) {
  const parsed = parseObject(value, emptyProjectProgress());
  const rawAnswers = parseObject(parsed.answers, {});
  return {
    version: 1,
    answers: Object.fromEntries(Object.entries(rawAnswers).map(([key, answer]) => {
      const current = parseObject(answer, { value: answer });
      return [key, {
        value: text(current.value),
        note: text(current.note),
      }];
    })),
  };
}

export function projectChecklistGroupForCategory(checklist, category = {}) {
  const schema = normalizeProjectChecklist(checklist);
  const target = projectChecklistGroupIdentity(category);
  return schema.groups.find((group) => group.id === target)
    || schema.groups.find((group) => group.typeId && group.typeId === text(category.typeId || category.TipoDispositivoID))
    || schema.groups.find((group) => normalized(group.typeName) === normalized(category.typeName || category.label || category.key))
    || null;
}

export function projectChecklistGroupForDevice(checklist, device = {}) {
  return projectChecklistGroupForCategory(checklist, {
    typeId: device.tipoDispositivoId || device.TipoDispositivoID,
    typeName: device.categoria || device.TipoDispositivo || device.Categoria,
  });
}

export function upsertProjectChecklistGroup(checklist, category, updater) {
  const schema = normalizeProjectChecklist(checklist);
  const id = projectChecklistGroupIdentity(category);
  const existing = projectChecklistGroupForCategory(schema, category) || {
    id,
    typeId: text(category.typeId),
    typeName: text(category.label || category.key || category.typeName),
    countField: text(category.countField),
    order: schema.groups.length * 10,
    questions: [],
  };
  const next = typeof updater === 'function' ? updater(existing) : updater;
  const groups = schema.groups.filter((group) => group.id !== existing.id && group.id !== id);
  if (next && Array.isArray(next.questions) && next.questions.length) groups.push(normalizeGroup({ ...next, id }, groups.length));
  return normalizeProjectChecklist({ version: 1, groups });
}

export function createProjectChecklistQuestion(type = PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS) {
  return {
    id: createLocalId('project-check'),
    label: '',
    responseType: responseType(type),
    order: Date.now(),
  };
}

export function setProjectProgressAnswer(progress, question, value, note) {
  const current = normalizeProjectProgress(progress);
  const type = responseType(question?.responseType);
  const normalizedValue = normalizeProgressValue(value, type);
  const normalizedNote = type === PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS && normalizedValue === 'PENDIENTE'
    ? text(note)
    : '';
  return {
    version: 1,
    answers: {
      ...current.answers,
      [question.id]: { value: normalizedValue, note: normalizedNote },
    },
  };
}

export function projectChecklistProgressForDevice(checklist, device = {}, progress = device.projectProgress || device.ProyectoProgresoJSON) {
  const group = projectChecklistGroupForDevice(checklist, device);
  const current = normalizeProjectProgress(progress);
  const questions = group?.questions || [];
  const items = questions.map((question) => {
    const type = responseType(question.responseType);
    const answer = current.answers[question.id] || {};
    const value = normalizeProgressValue(answer.value, type);
    const completed = type === PROJECT_CHECKLIST_RESPONSE_TYPES.YES_NO
      ? value === 'SI' || value === 'NO'
      : value === 'REALIZADO';
    return {
      ...question,
      value,
      note: type === PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS && value === 'PENDIENTE' ? text(answer.note) : '',
      completed,
      pending: type === PROJECT_CHECKLIST_RESPONSE_TYPES.PROGRESS && value !== 'REALIZADO',
    };
  });
  const completed = items.filter((item) => item.completed).length;
  return {
    group,
    items,
    total: items.length,
    completed,
    pending: Math.max(0, items.length - completed),
    percent: items.length ? Math.round((completed / items.length) * 100) : 100,
    complete: items.length === 0 || completed === items.length,
  };
}

export function projectChecklistOverallProgress(checklist, devices = []) {
  const stats = devices.map((device) => projectChecklistProgressForDevice(checklist, device));
  const total = stats.reduce((sum, item) => sum + item.total, 0);
  const completed = stats.reduce((sum, item) => sum + item.completed, 0);
  return {
    total,
    completed,
    pending: Math.max(0, total - completed),
    percent: total ? Math.round((completed / total) * 100) : 100,
    complete: total === 0 || completed === total,
  };
}
