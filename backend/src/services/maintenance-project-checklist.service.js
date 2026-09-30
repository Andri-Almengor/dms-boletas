import { badRequest } from '../core/errors.js';
import { pick } from '../core/utils.js';

const RESPONSE_TYPES = new Set(['SI_NO', 'PENDIENTE_REALIZADO']);

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalized(value = '') {
  return clean(value)
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
  const current = clean(value, 80).toUpperCase();
  return RESPONSE_TYPES.has(current) ? current : 'PENDIENTE_REALIZADO';
}

function groupId(input = {}) {
  const typeId = clean(input.typeId || input.TipoDispositivoID, 250);
  if (typeId) return `type:${typeId}`;
  const countField = clean(input.countField, 250);
  if (countField) return `count:${countField}`;
  return `name:${normalized(input.typeName || input.label || input.key || input.TipoDispositivo)}`;
}

export function normalizeProjectChecklistDefinition(value) {
  const parsed = parseObject(value, { version: 1, groups: [] });
  const groups = [];
  const groupIds = new Set();
  for (const [groupIndex, rawGroup] of (Array.isArray(parsed.groups) ? parsed.groups : []).slice(0, 100).entries()) {
    const typeId = clean(rawGroup?.typeId || rawGroup?.TipoDispositivoID, 250);
    const typeName = clean(rawGroup?.typeName || rawGroup?.label || rawGroup?.key || rawGroup?.TipoDispositivo, 250);
    const countField = clean(rawGroup?.countField, 250);
    const id = clean(rawGroup?.id, 300) || groupId({ typeId, typeName, countField });
    if ((!typeId && !typeName && !countField) || groupIds.has(id)) continue;
    groupIds.add(id);
    const questions = [];
    const questionIds = new Set();
    for (const [questionIndex, rawQuestion] of (Array.isArray(rawGroup?.questions) ? rawGroup.questions : []).slice(0, 100).entries()) {
      const label = clean(rawQuestion?.label || rawQuestion?.Pregunta, 500);
      const questionId = clean(rawQuestion?.id || rawQuestion?.questionId, 300);
      if (!label || !questionId) throw badRequest('Cada pregunta del checklist de Proyecto debe tener identificador y texto.');
      if (questionIds.has(questionId)) throw badRequest(`La pregunta “${label}” está duplicada en el checklist de Proyecto.`);
      questionIds.add(questionId);
      questions.push({
        id: questionId,
        label,
        responseType: responseType(rawQuestion?.responseType || rawQuestion?.TipoRespuesta),
        order: Number(rawQuestion?.order ?? rawQuestion?.Orden ?? (questionIndex + 1) * 10),
      });
    }
    if (questions.length) {
      groups.push({
        id,
        typeId,
        typeName,
        countField,
        order: Number(rawGroup?.order ?? groupIndex * 10),
        questions: questions.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es')),
      });
    }
  }
  return { version: 1, groups };
}

export function projectChecklistJson(value) {
  return JSON.stringify(normalizeProjectChecklistDefinition(value));
}

export function parseProjectProgress(value) {
  const parsed = parseObject(value, { version: 1, answers: {} });
  return {
    version: 1,
    answers: parseObject(parsed.answers, {}),
  };
}

function groupForDevice(checklist, payload = {}, before = {}) {
  const typeId = clean(pick(payload, ['TipoDispositivoID', 'tipoDispositivoId'], before.TipoDispositivoID), 250);
  const typeName = clean(pick(payload, ['TipoDispositivo', 'Categoria', 'categoria'], before.TipoDispositivo || before.Categoria), 250);
  return checklist.groups.find((group) => group.typeId && group.typeId === typeId)
    || checklist.groups.find((group) => normalized(group.typeName) === normalized(typeName))
    || null;
}

function answerValue(value, type) {
  const current = clean(value, 80).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (type === 'SI_NO') {
    if (['SI', 'YES', 'TRUE', '1'].includes(current)) return 'SI';
    if (['NO', 'FALSE', '0'].includes(current)) return 'NO';
    return '';
  }
  if (['REALIZADO', 'FINALIZADO', 'COMPLETO', 'COMPLETADO', 'DONE'].includes(current)) return 'REALIZADO';
  return 'PENDIENTE';
}

export function validateProjectDeviceProgress({ maintenance = {}, payload = {}, before = {} } = {}) {
  const mode = clean(maintenance.TipoMantenimiento || 'MANTENIMIENTO', 40).toUpperCase();
  if (mode !== 'PROYECTO') return clean(before.ProyectoProgresoJSON, 200000);

  const checklist = normalizeProjectChecklistDefinition(maintenance.ProyectoChecklistJSON);
  const group = groupForDevice(checklist, payload, before);
  if (!group?.questions?.length) return JSON.stringify({ version: 1, answers: {} });

  const incoming = parseProjectProgress(
    payload.projectProgress
      || payload.proyectoProgreso
      || payload.ProyectoProgresoJSON
      || before.ProyectoProgresoJSON,
  );
  const answers = {};
  for (const question of group.questions) {
    const raw = parseObject(incoming.answers?.[question.id], { value: incoming.answers?.[question.id] });
    const value = answerValue(raw.value, question.responseType);
    const note = question.responseType === 'PENDIENTE_REALIZADO' && value === 'PENDIENTE'
      ? clean(raw.note, 2000)
      : '';
    answers[question.id] = { value, note };
  }
  return JSON.stringify({ version: 1, answers });
}

export function sameProjectChecklist(left, right) {
  return projectChecklistJson(left) === projectChecklistJson(right);
}
