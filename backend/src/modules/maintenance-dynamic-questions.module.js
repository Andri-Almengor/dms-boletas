import { badRequest, forbidden } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  filterRows,
  findById,
  readTable,
  softDelete,
  updateRow,
} from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { createDynamicMaintenanceSpreadsheetReport } from '../services/maintenance-dynamic-spreadsheet.service.js';
import {
  MAINTENANCE_QUESTION_SHEET,
  assertMaintenanceDeviceType,
  buildMaintenanceQuestionSnapshot,
  cleanMaintenanceQuestionValue,
  ensureMaintenanceQuestionCatalog,
  isActiveMaintenanceQuestion,
  maintenanceQuestionClientView,
  normalizeMaintenanceQuestionValue,
  parseMaintenanceAnswers,
  parseMaintenanceQuestionSnapshot,
  readMaintenanceQuestions,
} from '../services/maintenance-question-catalog.service.js';
import { maintenanceDeviceCountPolicyHandlers } from './maintenance-device-count-policy.module.js';

let questionWriteTail = Promise.resolve();

function withQuestionWriteLock(operation) {
  const current = questionWriteTail.then(operation, operation);
  questionWriteTail = current.catch(() => {});
  return current;
}

function canManageQuestions(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('CATALOGOS_GESTIONAR');
}

function hasOwn(object, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(object || {}, key));
}

function questionText(payload, fallback = '') {
  return cleanMaintenanceQuestionValue(pick(payload, ['Pregunta', 'pregunta', 'label', 'nombre'], fallback));
}

function questionOrder(payload, fallback = 0) {
  const value = Number(pick(payload, ['Orden', 'orden'], fallback));
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : Number(fallback || 0);
}

async function typeNamesMap() {
  const types = await readTable('TiposDispositivo');
  return new Map(types.map((row) => [
    cleanMaintenanceQuestionValue(row.TipoDispositivoID),
    cleanMaintenanceQuestionValue(row.Nombre, 'Tipo de dispositivo'),
  ]));
}

async function list(ctx) {
  await ensureMaintenanceQuestionCatalog(ctx.user?.UsuarioID || 'SYSTEM');
  const includeInactive = Boolean(ctx.payload?.includeInactive) && canManageQuestions(ctx);
  const typeId = cleanMaintenanceQuestionValue(pick(ctx.payload, ['TipoDispositivoID', 'tipoDispositivoId']));
  const names = await typeNamesMap();
  const rows = await readMaintenanceQuestions({ includeInactive, typeId });
  const enriched = rows.map((row) => ({
    ...row,
    TipoDispositivo: names.get(cleanMaintenanceQuestionValue(row.TipoDispositivoID)) || 'Tipo no disponible',
  }));
  return filterRows(enriched, ctx.payload, ['Pregunta', 'Clave', 'TipoDispositivo']);
}

async function nextOrder(typeId) {
  const rows = await readMaintenanceQuestions({ includeInactive: true, typeId });
  return rows.reduce((max, row) => Math.max(max, Number(row.Orden || 0)), 0) + 10;
}

async function assertUniqueQuestion(typeId, text, currentId = '') {
  const rows = await readMaintenanceQuestions({ includeInactive: false, typeId });
  const duplicate = rows.find((row) => (
    cleanMaintenanceQuestionValue(row.PreguntaDispositivoID) !== cleanMaintenanceQuestionValue(currentId)
    && normalizeMaintenanceQuestionValue(row.Pregunta) === normalizeMaintenanceQuestionValue(text)
  ));
  if (duplicate) throw badRequest('Ya existe una pregunta activa con el mismo texto para este tipo de dispositivo.');
}

async function create(ctx) {
  if (!canManageQuestions(ctx)) throw forbidden('No cuenta con permiso para administrar preguntas de mantenimiento.');
  return withQuestionWriteLock(async () => {
    await ensureMaintenanceQuestionCatalog(ctx.user.UsuarioID);
    const typeId = cleanMaintenanceQuestionValue(pick(ctx.payload, ['TipoDispositivoID', 'tipoDispositivoId']));
    await assertMaintenanceDeviceType(typeId);
    const text = questionText(ctx.payload);
    if (!text) throw badRequest('Escriba la pregunta que deberá responderse con Sí o No.');
    await assertUniqueQuestion(typeId, text);
    const timestamp = nowIso();
    const row = {
      PreguntaDispositivoID: uuid(),
      TipoDispositivoID: typeId,
      Clave: `q_${uuid().replace(/-/g, '')}`,
      Pregunta: text,
      Orden: hasOwn(ctx.payload, ['Orden', 'orden']) ? questionOrder(ctx.payload) : await nextOrder(typeId),
      TipoRespuesta: 'SI_NO',
      Activo: true,
      Estado: 'ACTIVO',
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    await appendRow(MAINTENANCE_QUESTION_SHEET, row);
    await audit(ctx, 'CREAR_PREGUNTA_MANTENIMIENTO', MAINTENANCE_QUESTION_SHEET, row.PreguntaDispositivoID, null, row);
    const names = await typeNamesMap();
    return { ...row, TipoDispositivo: names.get(typeId) || '' };
  });
}

async function update(ctx) {
  if (!canManageQuestions(ctx)) throw forbidden('No cuenta con permiso para administrar preguntas de mantenimiento.');
  return withQuestionWriteLock(async () => {
    await ensureMaintenanceQuestionCatalog(ctx.user.UsuarioID);
    const id = cleanMaintenanceQuestionValue(pick(ctx.payload, ['PreguntaDispositivoID', 'preguntaDispositivoId', 'questionId', 'id']));
    if (!id) throw badRequest('Falta el identificador de la pregunta.');
    const before = await findById(MAINTENANCE_QUESTION_SHEET, id);
    const typeId = cleanMaintenanceQuestionValue(before.TipoDispositivoID);
    const patch = {};

    if (hasOwn(ctx.payload, ['Pregunta', 'pregunta', 'label', 'nombre'])) {
      const text = questionText(ctx.payload);
      if (!text) throw badRequest('La pregunta no puede quedar vacía.');
      await assertUniqueQuestion(typeId, text, id);
      patch.Pregunta = text;
    }
    if (hasOwn(ctx.payload, ['Orden', 'orden'])) patch.Orden = questionOrder(ctx.payload, before.Orden);
    if (hasOwn(ctx.payload, ['Activo', 'activo', 'Estado', 'estado'])) {
      const requestedActive = ctx.payload.Activo ?? ctx.payload.activo;
      const requestedStatus = cleanMaintenanceQuestionValue(pick(ctx.payload, ['Estado', 'estado'], before.Estado || 'ACTIVO')).toUpperCase();
      const active = requestedActive === undefined
        ? requestedStatus !== 'INACTIVO'
        : !['false', '0', 'no'].includes(String(requestedActive).trim().toLowerCase());
      patch.Activo = active;
      patch.Estado = active ? 'ACTIVO' : 'INACTIVO';
    }

    if (!Object.keys(patch).length) return before;
    patch.ActualizadoPor = ctx.user.UsuarioID;
    patch.FechaActualizacion = nowIso();
    const after = await updateRow(MAINTENANCE_QUESTION_SHEET, id, patch);
    await audit(ctx, 'EDITAR_PREGUNTA_MANTENIMIENTO', MAINTENANCE_QUESTION_SHEET, id, before, after);
    const names = await typeNamesMap();
    return { ...after, TipoDispositivo: names.get(typeId) || '' };
  });
}

async function remove(ctx) {
  if (!canManageQuestions(ctx)) throw forbidden('No cuenta con permiso para administrar preguntas de mantenimiento.');
  return withQuestionWriteLock(async () => {
    await ensureMaintenanceQuestionCatalog(ctx.user.UsuarioID);
    const id = cleanMaintenanceQuestionValue(pick(ctx.payload, ['PreguntaDispositivoID', 'preguntaDispositivoId', 'questionId', 'id']));
    if (!id) throw badRequest('Falta el identificador de la pregunta.');
    const before = await findById(MAINTENANCE_QUESTION_SHEET, id);
    const after = await softDelete(MAINTENANCE_QUESTION_SHEET, id, ctx.user.UsuarioID);
    await audit(ctx, 'ELIMINAR_PREGUNTA_MANTENIMIENTO', MAINTENANCE_QUESTION_SHEET, id, before, after);
    return after;
  });
}

async function config(ctx) {
  const base = await maintenanceDeviceCountPolicyHandlers.config(ctx);
  await ensureMaintenanceQuestionCatalog(ctx.user?.UsuarioID || 'SYSTEM');
  const [rows, types] = await Promise.all([
    readMaintenanceQuestions({ includeInactive: false }),
    readTable('TiposDispositivo'),
  ]);
  const names = new Map(types.map((row) => [
    cleanMaintenanceQuestionValue(row.TipoDispositivoID),
    cleanMaintenanceQuestionValue(row.Nombre),
  ]));
  return {
    ...base,
    questions: rows
      .filter(isActiveMaintenanceQuestion)
      .map((row) => maintenanceQuestionClientView(row, names.get(cleanMaintenanceQuestionValue(row.TipoDispositivoID))))
      .sort((left, right) => left.typeName.localeCompare(right.typeName, 'es') || left.order - right.order),
    questionCatalogVersion: 1,
  };
}

async function contextWithQuestionSnapshot(ctx, before = {}) {
  await ensureMaintenanceQuestionCatalog(ctx.user?.UsuarioID || 'SYSTEM');
  const answers = parseMaintenanceAnswers(
    ctx.payload.respuestas
      || ctx.payload.answers
      || ctx.payload.RespuestasJSON
      || before.RespuestasJSON,
  );
  const nestedSnapshot = parseMaintenanceQuestionSnapshot(answers.__preguntas);
  const snapshot = await buildMaintenanceQuestionSnapshot({
    ...ctx.payload,
    questionDetails: ctx.payload.questionDetails
      || ctx.payload.respuestasDetalle
      || nestedSnapshot,
  }, before);
  const persistedAnswers = {
    ...answers,
    __preguntas: snapshot,
  };
  return {
    ...ctx,
    payload: {
      ...ctx.payload,
      respuestas: persistedAnswers,
      answers: persistedAnswers,
      RespuestasJSON: JSON.stringify(persistedAnswers),
      questionDetails: snapshot,
    },
  };
}

async function deviceCreate(ctx) {
  return maintenanceDeviceCountPolicyHandlers.deviceCreate(await contextWithQuestionSnapshot(ctx));
}

async function deviceUpdate(ctx) {
  const id = cleanMaintenanceQuestionValue(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  return maintenanceDeviceCountPolicyHandlers.deviceUpdate(await contextWithQuestionSnapshot(ctx, before));
}

async function deviceAutosave(ctx) {
  const id = cleanMaintenanceQuestionValue(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  return maintenanceDeviceCountPolicyHandlers.deviceAutosave(await contextWithQuestionSnapshot(ctx, before));
}

export const maintenanceQuestionHandlers = {
  list,
  create,
  update,
  delete: remove,
};

export const maintenanceDynamicQuestionHandlers = {
  ...maintenanceDeviceCountPolicyHandlers,
  config,
  deviceCreate,
  deviceUpdate,
  deviceAutosave,
  spreadsheetReport: createDynamicMaintenanceSpreadsheetReport,
};
