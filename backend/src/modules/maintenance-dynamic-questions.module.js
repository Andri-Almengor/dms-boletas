import { badRequest, forbidden } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import {
  appendRow,
  filterRows,
  findById,
  findRows,
  queryPage,
  readTable,
  readTables,
  softDelete,
  updateRow,
} from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { normalizeMacAddress } from '../services/evidence-media-policy.service.js';
import { assertProjectEvidenceTargetsStillExist } from '../services/maintenance-evidence-policy.service.js';
import { createDynamicMaintenanceSpreadsheetReport } from '../services/maintenance-dynamic-spreadsheet.service.js';
import {
  MAINTENANCE_QUESTION_SHEET,
  assertMaintenanceDeviceType,
  buildMaintenanceQuestionSnapshot,
  cleanMaintenanceQuestionValue,
  ensureMaintenanceQuestionCatalog,
  isActiveMaintenanceQuestion,
  maintenanceQuestionClientView,
  normalizeMaintenanceQuestionMode,
  normalizeMaintenanceQuestionResponseType,
  normalizeMaintenanceQuestionValue,
  parseMaintenanceQuestionConfig,
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

function questionMode(payload, fallback = 'MANTENIMIENTO') {
  return normalizeMaintenanceQuestionMode(pick(payload, ['AplicaModo', 'aplicaModo', 'maintenanceMode'], fallback), fallback);
}

function questionResponseType(payload, fallback = 'SI_NO') {
  return normalizeMaintenanceQuestionResponseType(pick(payload, ['TipoRespuesta', 'tipoRespuesta', 'responseType'], fallback), fallback);
}

function questionRelatedTypeId(payload, fallback = '') {
  return cleanMaintenanceQuestionValue(pick(payload, ['TipoDispositivoRelacionadoID', 'tipoDispositivoRelacionadoId', 'relatedTypeId'], fallback));
}

function questionConfig(payload, fallback = {}) {
  const raw = pick(payload, ['ConfiguracionJSON', 'configuracion', 'config'], fallback);
  return parseMaintenanceQuestionConfig(raw);
}

function cleanStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanMaintenanceQuestionValue(item))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

async function validateQuestionMetadata(payload, before = {}) {
  const mode = questionMode(payload, questionMode(before, 'MANTENIMIENTO'));
  const responseType = questionResponseType(payload, questionResponseType(before, 'SI_NO'));
  const relatedTypeId = questionRelatedTypeId(payload, questionRelatedTypeId(before, ''));
  const rawConfig = questionConfig(payload, questionConfig(before, {}));
  const config = {
    ...rawConfig,
    fields: cleanStringList(rawConfig.fields),
    options: cleanStringList(rawConfig.options),
    required: typeof rawConfig.required === 'boolean'
      ? rawConfig.required
      : responseType !== 'RELACION_DISPOSITIVO',
  };
  if (responseType === 'RELACION_DISPOSITIVO') {
    if (mode === 'MANTENIMIENTO') throw badRequest('Las relaciones con otros dispositivos deben aplicarse a Proyecto o Ambos.');
    if (!relatedTypeId) throw badRequest('Seleccione el tipo de dispositivo que se relacionará.');
    await assertMaintenanceDeviceType(relatedTypeId);
  }
  if (responseType === 'OPCIONES' && !config.options.length) {
    throw badRequest('Agregue al menos una opción para la respuesta configurada.');
  }
  return {
    mode,
    responseType,
    relatedTypeId: responseType === 'RELACION_DISPOSITIVO' ? relatedTypeId : '',
    config: responseType === 'RELACION_DISPOSITIVO'
      ? { ...config, options: [] }
      : responseType === 'OPCIONES'
        ? { ...config, fields: [] }
        : { ...config, fields: [], options: [] },
  };
}


function activeCatalogRow(row = {}) {
  const active = String(row.Activo ?? 'true').trim().toLowerCase();
  return !['false', '0', 'no'].includes(active) && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
}

function relationAnswer(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasQuestionValue(question = {}, value) {
  const type = normalizeMaintenanceQuestionResponseType(question.responseType || question.TipoRespuesta);
  if (type === 'RELACION_DISPOSITIVO') {
    const relation = relationAnswer(value);
    return relation.enabled === true && Array.isArray(relation.items) && relation.items.length > 0;
  }
  if (type === 'NUMERO' || type === 'CANTIDAD') return value !== '' && value !== null && value !== undefined;
  return cleanMaintenanceQuestionValue(value) !== '';
}

function validateScalarProjectValue(question = {}, rawValue, {
  labelPrefix = '',
} = {}) {
  const key = cleanMaintenanceQuestionValue(question.key || question.Clave);
  const label = cleanMaintenanceQuestionValue(question.label || question.Pregunta || key);
  const displayLabel = labelPrefix ? `${labelPrefix}: ${label}` : label;
  const config = parseMaintenanceQuestionConfig(question.config || question.ConfiguracionJSON);
  const responseType = normalizeMaintenanceQuestionResponseType(question.responseType || question.TipoRespuesta);
  const required = typeof config.required === 'boolean' ? config.required : responseType !== 'RELACION_DISPOSITIVO';

  if (required && !hasQuestionValue(question, rawValue)) {
    throw badRequest(`Complete el campo obligatorio “${displayLabel}”.`);
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';

  if (responseType === 'SI_NO') {
    const value = cleanMaintenanceQuestionValue(rawValue);
    if (!['Sí', 'Si', 'No'].includes(value)) throw badRequest(`La respuesta de “${displayLabel}” no es válida.`);
    return value === 'Si' ? 'Sí' : value;
  }
  if (responseType === 'OPCIONES') {
    const options = cleanStringList(config.options);
    const value = cleanMaintenanceQuestionValue(rawValue);
    if (value && !options.includes(value)) throw badRequest(`La opción seleccionada para “${displayLabel}” ya no está disponible.`);
    return value;
  }
  if (responseType === 'NUMERO' || responseType === 'CANTIDAD') {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || (responseType === 'CANTIDAD' && numeric < 0)) throw badRequest(`El valor de “${displayLabel}” no es válido.`);
    return String(rawValue).trim();
  }
  if (responseType === 'MAC') return normalizeMacAddress(rawValue);
  if (responseType === 'RELACION_DISPOSITIVO') return rawValue;
  return cleanMaintenanceQuestionValue(rawValue);
}

async function validateProjectAnswers(snapshot = [], answers = {}, maintenanceMode = 'MANTENIMIENTO') {
  if (normalizeMaintenanceQuestionMode(maintenanceMode) !== 'PROYECTO') return answers;
  const activeQuestions = snapshot.filter((question) => question.activeAtSave !== false);
  const relationQuestions = activeQuestions.filter((question) => question.responseType === 'RELACION_DISPOSITIVO');
  const [catalogs, childProjectQuestions] = relationQuestions.length
    ? await Promise.all([
      readTables(['TiposDispositivo', 'Fabricantes', 'Modelos', 'TipoDispositivoFabricantes']),
      readMaintenanceQuestions({ includeInactive: false, mode: 'PROYECTO' }),
    ])
    : [{}, []];
  const typesById = new Map((catalogs.TiposDispositivo || []).filter(activeCatalogRow).map((row) => [cleanMaintenanceQuestionValue(row.TipoDispositivoID), row]));
  const manufacturersById = new Map((catalogs.Fabricantes || []).filter(activeCatalogRow).map((row) => [cleanMaintenanceQuestionValue(row.FabricanteID), row]));
  const modelsById = new Map((catalogs.Modelos || []).filter(activeCatalogRow).map((row) => [cleanMaintenanceQuestionValue(row.ModeloID), row]));
  const relationPairs = new Set((catalogs.TipoDispositivoFabricantes || []).filter(activeCatalogRow).map((row) => `${cleanMaintenanceQuestionValue(row.TipoDispositivoID)}|${cleanMaintenanceQuestionValue(row.FabricanteID)}`));
  const relationTypeIds = new Set((catalogs.TipoDispositivoFabricantes || []).filter(activeCatalogRow).map((row) => cleanMaintenanceQuestionValue(row.TipoDispositivoID)));

  const sanitized = { ...answers };
  delete sanitized.__preguntas;

  for (const question of activeQuestions) {
    const key = cleanMaintenanceQuestionValue(question.key || question.Clave);
    if (!key) continue;
    const config = parseMaintenanceQuestionConfig(question.config || question.ConfiguracionJSON);
    const responseType = normalizeMaintenanceQuestionResponseType(question.responseType || question.TipoRespuesta);
    const required = typeof config.required === 'boolean' ? config.required : responseType !== 'RELACION_DISPOSITIVO';
    const rawValue = sanitized[key];

    if (required && !hasQuestionValue(question, rawValue)) {
      throw badRequest(`Complete el campo obligatorio “${cleanMaintenanceQuestionValue(question.label || question.Pregunta || key)}”.`);
    }
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    if (responseType !== 'RELACION_DISPOSITIVO') {
      sanitized[key] = validateScalarProjectValue(question, rawValue);
      continue;
    }

    const relation = relationAnswer(rawValue);
    const relatedTypeId = cleanMaintenanceQuestionValue(question.relatedTypeId || question.TipoDispositivoRelacionadoID);
    const relatedType = typesById.get(relatedTypeId);
    if (!relatedType) throw badRequest(`El tipo relacionado configurado para “${question.label || key}” ya no está disponible.`);

    const enabled = relation.enabled === true || String(relation.enabled || '').toLowerCase() === 'true';
    if (!enabled) {
      sanitized[key] = {
        enabled: false,
        relatedTypeId,
        relatedTypeName: cleanMaintenanceQuestionValue(relatedType.Nombre),
        quantity: 0,
        items: [],
      };
      continue;
    }

    const items = Array.isArray(relation.items) ? relation.items : [];
    if (!items.length || items.length > 100) throw badRequest(`La relación “${question.label || key}” debe contener entre 1 y 100 dispositivos.`);

    const sanitizedItems = items.map((item, index) => {
      const typeId = cleanMaintenanceQuestionValue(item?.tipoDispositivoId || item?.TipoDispositivoID || relatedTypeId);
      if (typeId !== relatedTypeId) throw badRequest(`El componente ${index + 1} de “${question.label || key}” no corresponde al tipo configurado.`);

      const manufacturerId = cleanMaintenanceQuestionValue(item?.fabricanteId || item?.FabricanteID);
      const manufacturer = manufacturerId ? manufacturersById.get(manufacturerId) : null;
      if (manufacturerId && !manufacturer) throw badRequest(`El fabricante del componente ${index + 1} ya no existe o está inactivo.`);
      if (manufacturerId && relationTypeIds.has(typeId) && !relationPairs.has(`${typeId}|${manufacturerId}`)) {
        throw badRequest(`El fabricante del componente ${index + 1} no está relacionado con el tipo ${cleanMaintenanceQuestionValue(relatedType.Nombre)}.`);
      }

      const modelId = cleanMaintenanceQuestionValue(item?.modeloId || item?.ModeloID);
      const model = modelId ? modelsById.get(modelId) : null;
      if (modelId && !model) throw badRequest(`El modelo del componente ${index + 1} ya no existe o está inactivo.`);
      if (model && cleanMaintenanceQuestionValue(model.TipoDispositivoID) && cleanMaintenanceQuestionValue(model.TipoDispositivoID) !== typeId) {
        throw badRequest(`El modelo del componente ${index + 1} no corresponde al tipo configurado.`);
      }
      if (model && manufacturerId && cleanMaintenanceQuestionValue(model.FabricanteID) && cleanMaintenanceQuestionValue(model.FabricanteID) !== manufacturerId) {
        throw badRequest(`El modelo del componente ${index + 1} no corresponde al fabricante seleccionado.`);
      }

      const itemAnswers = item?.respuestas && typeof item.respuestas === 'object' && !Array.isArray(item.respuestas)
        ? item.respuestas
        : {};
      const activeChildQuestions = childProjectQuestions
        .filter((childQuestion) => cleanMaintenanceQuestionValue(childQuestion.TipoDispositivoID) === typeId)
        .filter((childQuestion) => normalizeMaintenanceQuestionResponseType(childQuestion.TipoRespuesta) !== 'RELACION_DISPOSITIVO')
        .sort((left, right) => Number(left.Orden || 0) - Number(right.Orden || 0));
      const sanitizedChildAnswers = {};
      const childSnapshot = activeChildQuestions.map((childQuestion) => {
        const childKey = cleanMaintenanceQuestionValue(childQuestion.Clave);
        const value = validateScalarProjectValue(childQuestion, itemAnswers[childKey], {
          labelPrefix: `${cleanMaintenanceQuestionValue(relatedType.Nombre)} ${index + 1}`,
        });
        if (value !== '') sanitizedChildAnswers[childKey] = value;
        return {
          questionId: cleanMaintenanceQuestionValue(childQuestion.PreguntaDispositivoID),
          typeId,
          key: childKey,
          label: cleanMaintenanceQuestionValue(childQuestion.Pregunta || childKey),
          order: Number(childQuestion.Orden || 0),
          responseType: normalizeMaintenanceQuestionResponseType(childQuestion.TipoRespuesta),
          appliesTo: normalizeMaintenanceQuestionMode(childQuestion.AplicaModo, 'PROYECTO'),
          relatedTypeId: cleanMaintenanceQuestionValue(childQuestion.TipoDispositivoRelacionadoID),
          config: parseMaintenanceQuestionConfig(childQuestion.ConfiguracionJSON),
          value,
          activeAtSave: true,
        };
      });

      return {
        localId: cleanMaintenanceQuestionValue(item?.localId || item?.id || `componente-${index + 1}`),
        tipoDispositivoId: typeId,
        categoria: cleanMaintenanceQuestionValue(relatedType.Nombre),
        fabricanteId: manufacturerId,
        fabricante: manufacturer ? cleanMaintenanceQuestionValue(manufacturer.Nombre) : '',
        modeloId: modelId,
        modelo: model ? cleanMaintenanceQuestionValue(model.Nombre) : '',
        nombre: cleanMaintenanceQuestionValue(item?.nombre || item?.NombreDispositivo),
        serie: cleanMaintenanceQuestionValue(item?.serie || item?.Serie),
        macAddress: item?.macAddress ? normalizeMacAddress(item.macAddress) : '',
        respuestas: sanitizedChildAnswers,
        questionDetails: childSnapshot,
      };
    });

    sanitized[key] = {
      enabled: true,
      relatedTypeId,
      relatedTypeName: cleanMaintenanceQuestionValue(relatedType.Nombre),
      quantity: sanitizedItems.length,
      items: sanitizedItems,
    };
  }
  return sanitized;
}

async function typeNamesMap(typeIds = []) {
  const requested = [...new Set((typeIds || []).map(cleanMaintenanceQuestionValue).filter(Boolean))];
  const types = requested.length
    ? await findRows('TiposDispositivo', { TipoDispositivoID: requested }, { limit: Math.max(1, requested.length) })
    : await readTable('TiposDispositivo');
  return new Map(types.map((row) => [
    cleanMaintenanceQuestionValue(row.TipoDispositivoID),
    cleanMaintenanceQuestionValue(row.Nombre, 'Tipo de dispositivo'),
  ]));
}

async function list(ctx) {
  await ensureMaintenanceQuestionCatalog(ctx.user?.UsuarioID || 'SYSTEM');
  const includeInactive = Boolean(ctx.payload?.includeInactive) && canManageQuestions(ctx);
  const typeId = cleanMaintenanceQuestionValue(pick(ctx.payload, ['TipoDispositivoID', 'tipoDispositivoId']));
  const search = cleanMaintenanceQuestionValue(pick(ctx.payload, ['search', 'q']));

  // La búsqueda histórica también permite encontrar por nombre del tipo.
  // Se conserva ese camino únicamente cuando hay texto; la carga normal usa
  // paginación SQL y evita materializar el catálogo completo.
  if (search) {
    const names = await typeNamesMap();
    const rows = await readMaintenanceQuestions({ includeInactive, typeId });
    const enriched = rows.map((row) => ({
      ...row,
      TipoDispositivo: names.get(cleanMaintenanceQuestionValue(row.TipoDispositivoID)) || 'Tipo no disponible',
    }));
    return filterRows(enriched, ctx.payload, ['Pregunta', 'Clave', 'TipoDispositivo']);
  }

  const page = await queryPage(
    MAINTENANCE_QUESTION_SHEET,
    {
      ...ctx.payload,
      ...(typeId ? { tipoDispositivoId: typeId } : {}),
    },
    {
      searchFields: ['Pregunta', 'Clave'],
      excludeInactive: !includeInactive,
      excludeInactiveState: !includeInactive,
      defaultOrder: [['Orden', 'ASC', true], ['Pregunta', 'ASC']],
    },
  );
  const names = ctx.payload?.includeTypeName === false
    ? new Map()
    : await typeNamesMap(page.items.map((row) => row.TipoDispositivoID));
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      ...(ctx.payload?.includeTypeName === false ? {} : {
        TipoDispositivo: names.get(cleanMaintenanceQuestionValue(row.TipoDispositivoID)) || 'Tipo no disponible',
      }),
    })),
  };
}

async function nextOrder(typeId, existingRows = null) {
  const rows = existingRows || await readMaintenanceQuestions({ includeInactive: true, typeId });
  return rows.reduce((max, row) => Math.max(max, Number(row.Orden || 0)), 0) + 10;
}

async function assertUniqueQuestion(typeId, text, currentId = '', existingRows = null) {
  const rows = existingRows || await readMaintenanceQuestions({ includeInactive: false, typeId });
  const duplicate = rows.find((row) => (
    isActiveMaintenanceQuestion(row)
    && cleanMaintenanceQuestionValue(row.PreguntaDispositivoID) !== cleanMaintenanceQuestionValue(currentId)
    && normalizeMaintenanceQuestionValue(row.Pregunta) === normalizeMaintenanceQuestionValue(text)
  ));
  if (duplicate) throw badRequest('Ya existe una pregunta activa con el mismo texto para este tipo de dispositivo.');
}

async function create(ctx) {
  if (!canManageQuestions(ctx)) throw forbidden('No cuenta con permiso para administrar preguntas de mantenimiento.');
  return withQuestionWriteLock(async () => {
    await ensureMaintenanceQuestionCatalog(ctx.user.UsuarioID);
    const typeId = cleanMaintenanceQuestionValue(pick(ctx.payload, ['TipoDispositivoID', 'tipoDispositivoId']));
    const deviceType = await assertMaintenanceDeviceType(typeId);
    const text = questionText(ctx.payload);
    if (!text) throw badRequest('Escriba la pregunta o campo que se mostrará para este tipo de dispositivo.');
    const existingQuestions = await readMaintenanceQuestions({ includeInactive: true, typeId });
    await assertUniqueQuestion(typeId, text, '', existingQuestions);
    const metadata = await validateQuestionMetadata(ctx.payload);
    const timestamp = nowIso();
    const row = {
      PreguntaDispositivoID: uuid(),
      TipoDispositivoID: typeId,
      Clave: `q_${uuid().replace(/-/g, '')}`,
      Pregunta: text,
      Orden: hasOwn(ctx.payload, ['Orden', 'orden']) ? questionOrder(ctx.payload) : await nextOrder(typeId, existingQuestions),
      TipoRespuesta: metadata.responseType,
      AplicaModo: metadata.mode,
      TipoDispositivoRelacionadoID: metadata.relatedTypeId,
      ConfiguracionJSON: JSON.stringify(metadata.config),
      Activo: true,
      Estado: 'ACTIVO',
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    await appendRow(MAINTENANCE_QUESTION_SHEET, row);
    await audit(ctx, 'CREAR_PREGUNTA_MANTENIMIENTO', MAINTENANCE_QUESTION_SHEET, row.PreguntaDispositivoID, null, row);
    return { ...row, TipoDispositivo: cleanMaintenanceQuestionValue(deviceType.Nombre) };
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
    if (hasOwn(ctx.payload, ['TipoRespuesta', 'tipoRespuesta', 'responseType', 'AplicaModo', 'aplicaModo', 'maintenanceMode', 'TipoDispositivoRelacionadoID', 'tipoDispositivoRelacionadoId', 'relatedTypeId', 'ConfiguracionJSON', 'configuracion', 'config'])) {
      const metadata = await validateQuestionMetadata(ctx.payload, before);
      patch.TipoRespuesta = metadata.responseType;
      patch.AplicaModo = metadata.mode;
      patch.TipoDispositivoRelacionadoID = metadata.relatedTypeId;
      patch.ConfiguracionJSON = JSON.stringify(metadata.config);
    }
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
    const deviceType = await findById('TiposDispositivo', typeId).catch(() => null);
    return { ...after, TipoDispositivo: cleanMaintenanceQuestionValue(deviceType?.Nombre) };
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
    questionCatalogVersion: 2,
  };
}

function preserveHistoricalQuestionText(generated, previous) {
  const previousByKey = new Map(previous
    .map((item) => [cleanMaintenanceQuestionValue(item.key || item.Clave), item])
    .filter(([key]) => key));
  return generated.map((item) => {
    const saved = previousByKey.get(cleanMaintenanceQuestionValue(item.key));
    if (!saved) return item;
    return {
      ...item,
      questionId: cleanMaintenanceQuestionValue(saved.questionId || saved.PreguntaDispositivoID, item.questionId),
      typeId: cleanMaintenanceQuestionValue(saved.typeId || saved.TipoDispositivoID, item.typeId),
      label: cleanMaintenanceQuestionValue(saved.label || saved.Pregunta, item.label),
      order: Number(saved.order ?? saved.Orden ?? item.order),
      responseType: cleanMaintenanceQuestionValue(saved.responseType || saved.TipoRespuesta, item.responseType),
      appliesTo: cleanMaintenanceQuestionValue(saved.appliesTo || saved.AplicaModo, item.appliesTo),
      relatedTypeId: cleanMaintenanceQuestionValue(saved.relatedTypeId || saved.TipoDispositivoRelacionadoID, item.relatedTypeId),
      config: parseMaintenanceQuestionConfig(saved.config || saved.ConfiguracionJSON || item.config),
    };
  });
}

async function resolveMaintenanceModeForDevice(ctx, before = {}) {
  const maintenanceId = cleanMaintenanceQuestionValue(pick(
    ctx.payload,
    ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'],
    before.MantenimientoRef,
  ));
  if (!maintenanceId) return 'MANTENIMIENTO';
  const maintenance = await findById('Mantenimiento', maintenanceId).catch(() => null);
  return normalizeMaintenanceQuestionMode(maintenance?.TipoMantenimiento, 'MANTENIMIENTO');
}

async function contextWithQuestionSnapshot(ctx, before = {}) {
  await ensureMaintenanceQuestionCatalog(ctx.user?.UsuarioID || 'SYSTEM');
  const maintenanceMode = await resolveMaintenanceModeForDevice(ctx, before);
  const answers = parseMaintenanceAnswers(
    ctx.payload.respuestas
      || ctx.payload.answers
      || ctx.payload.RespuestasJSON
      || before.RespuestasJSON,
  );
  const nestedSnapshot = parseMaintenanceQuestionSnapshot(answers.__preguntas);
  const suppliedSnapshot = parseMaintenanceQuestionSnapshot(
    ctx.payload.questionDetails
      || ctx.payload.respuestasDetalle
      || nestedSnapshot,
  );
  const generatedSnapshot = await buildMaintenanceQuestionSnapshot({
    ...ctx.payload,
    TipoMantenimiento: maintenanceMode,
    tipoMantenimiento: maintenanceMode,
    questionDetails: suppliedSnapshot,
  }, before);
  const snapshot = preserveHistoricalQuestionText(generatedSnapshot, suppliedSnapshot);
  const validatedAnswers = await validateProjectAnswers(snapshot, answers, maintenanceMode);
  const persistedAnswers = {
    ...validatedAnswers,
    __preguntas: snapshot.map((item) => ({
      ...item,
      value: validatedAnswers[item.key] ?? item.value,
    })),
  };
  return {
    ...ctx,
    payload: {
      ...ctx.payload,
      TipoMantenimiento: maintenanceMode,
      tipoMantenimiento: maintenanceMode,
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
  const prepared = await contextWithQuestionSnapshot(ctx, before);
  if (
    prepared.payload.TipoMantenimiento === 'PROYECTO'
    && String(before.RespuestasJSON || '') !== String(prepared.payload.RespuestasJSON || '')
  ) {
    await assertProjectEvidenceTargetsStillExist({
      deviceId: id,
      answers: prepared.payload.RespuestasJSON,
      maintenanceType: prepared.payload.TipoMantenimiento,
    });
  }
  return maintenanceDeviceCountPolicyHandlers.deviceUpdate(prepared);
}

async function deviceAutosave(ctx) {
  const id = cleanMaintenanceQuestionValue(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
  const before = await findById('Evidencia_Mantenimientos', id);
  const prepared = await contextWithQuestionSnapshot(ctx, before);
  if (
    prepared.payload.TipoMantenimiento === 'PROYECTO'
    && String(before.RespuestasJSON || '') !== String(prepared.payload.RespuestasJSON || '')
  ) {
    await assertProjectEvidenceTargetsStillExist({
      deviceId: id,
      answers: prepared.payload.RespuestasJSON,
      maintenanceType: prepared.payload.TipoMantenimiento,
    });
  }
  return maintenanceDeviceCountPolicyHandlers.deviceAutosave(prepared);
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
