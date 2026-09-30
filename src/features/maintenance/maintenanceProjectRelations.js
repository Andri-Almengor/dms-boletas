import { createLocalId } from '../../utils/localId.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function projectQuestionConfig(question = {}) {
  const raw = question.config || question.ConfiguracionJSON || {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function projectQuestionRequired(question = {}) {
  const config = projectQuestionConfig(question);
  if (typeof config.required === 'boolean') return config.required;
  return String(question.responseType || question.TipoRespuesta || 'SI_NO').toUpperCase() !== 'RELACION_DISPOSITIVO';
}

export function createProjectRelationItem({
  relatedTypeId = '',
  relatedTypeName = '',
  index = 0,
} = {}) {
  return {
    localId: createLocalId('componente'),
    tipoDispositivoId: clean(relatedTypeId),
    categoria: clean(relatedTypeName),
    fabricanteId: '',
    fabricante: '',
    modeloId: '',
    modelo: '',
    nombre: clean(relatedTypeName) ? `${clean(relatedTypeName)} ${index + 1}` : '',
    serie: '',
    macAddress: '',
    respuestas: {},
    questionDetails: [],
  };
}

export function normalizeProjectRelationValue(value, {
  relatedTypeId = '',
  relatedTypeName = '',
} = {}) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed || '{}'); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  const enabled = parsed.enabled === true || String(parsed.enabled || '').toLowerCase() === 'true';
  const sourceItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = sourceItems.map((item, index) => ({
    ...createProjectRelationItem({ relatedTypeId, relatedTypeName, index }),
    ...(item && typeof item === 'object' ? item : {}),
    localId: clean(item?.localId) || createLocalId('componente'),
    tipoDispositivoId: clean(item?.tipoDispositivoId || item?.TipoDispositivoID || relatedTypeId),
    categoria: clean(item?.categoria || item?.TipoDispositivo || item?.Categoria || relatedTypeName),
    respuestas: item?.respuestas && typeof item.respuestas === 'object' && !Array.isArray(item.respuestas)
      ? { ...item.respuestas }
      : {},
    questionDetails: Array.isArray(item?.questionDetails) ? item.questionDetails.map((entry) => ({ ...entry })) : [],
  }));
  const quantity = Math.max(0, Number(parsed.quantity ?? parsed.cantidad ?? items.length) || 0);
  return {
    enabled,
    relatedTypeId: clean(parsed.relatedTypeId || relatedTypeId),
    relatedTypeName: clean(parsed.relatedTypeName || relatedTypeName),
    quantity: enabled ? Math.max(quantity, items.length || 1) : 0,
    items: enabled ? items : [],
  };
}

export function resizeProjectRelation(value, quantity, options = {}) {
  const normalized = normalizeProjectRelationValue(value, options);
  const target = Math.max(0, Math.min(100, Number(quantity || 0)));
  const next = normalized.items.slice(0, target);
  while (next.length < target) {
    next.push(createProjectRelationItem({
      relatedTypeId: normalized.relatedTypeId || options.relatedTypeId,
      relatedTypeName: normalized.relatedTypeName || options.relatedTypeName,
      index: next.length,
    }));
  }
  return {
    ...normalized,
    enabled: target > 0,
    quantity: target,
    items: next,
  };
}

export function toggleProjectRelation(value, enabled, options = {}) {
  const normalized = normalizeProjectRelationValue(value, options);
  if (!enabled) return { ...normalized, enabled: false, quantity: 0, items: [] };
  return resizeProjectRelation({ ...normalized, enabled: true }, Math.max(1, normalized.quantity || normalized.items.length || 1), options);
}

export function updateProjectRelationItem(value, localId, nextItem, options = {}) {
  const normalized = normalizeProjectRelationValue(value, options);
  return {
    ...normalized,
    items: normalized.items.map((item) => (
      clean(item.localId) === clean(localId)
        ? { ...item, ...nextItem, localId: item.localId }
        : item
    )),
  };
}

export function projectAnswerHasValue(question = {}, value) {
  const type = String(question.responseType || question.TipoRespuesta || 'SI_NO').toUpperCase();
  if (type === 'RELACION_DISPOSITIVO') {
    const relation = normalizeProjectRelationValue(value, {
      relatedTypeId: question.relatedTypeId || question.TipoDispositivoRelacionadoID,
      relatedTypeName: question.relatedTypeName || '',
    });
    return relation.enabled && relation.items.length > 0;
  }
  if (type === 'CANTIDAD' || type === 'NUMERO') return value !== '' && value !== null && value !== undefined;
  return clean(value) !== '';
}

export function projectQuestionMissing(question = {}, value) {
  return projectQuestionRequired(question) && !projectAnswerHasValue(question, value);
}


function parseDeviceAnswers(device = {}) {
  const source = device.respuestas ?? device.RespuestasJSON ?? {};
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  try {
    const parsed = JSON.parse(source || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function projectQuestionLabels(device = {}, answers = {}) {
  const details = [
    ...(Array.isArray(answers.__preguntas) ? answers.__preguntas : []),
    ...(Array.isArray(device.questionDetails) ? device.questionDetails : []),
  ];
  return new Map(details.map((question) => [
    clean(question.key || question.Clave),
    clean(question.label || question.Pregunta || question.key || question.Clave),
  ]).filter(([key]) => key));
}

export function projectEvidenceTargets(device = {}) {
  const answers = parseDeviceAnswers(device);
  const labels = projectQuestionLabels(device, answers);
  const deviceName = clean(device.nombre || device.NombreDispositivo || device.name || 'Dispositivo');
  const category = clean(device.categoria || device.Categoria || device.TipoDispositivo || 'Dispositivo');
  const targets = [{
    value: 'DISPOSITIVO',
    targetType: 'DISPOSITIVO',
    relationKey: '',
    componentLocalId: '',
    componentTypeId: clean(device.tipoDispositivoId || device.TipoDispositivoID),
    componentName: deviceName,
    label: `${category} · ${deviceName}`,
    main: true,
  }];

  Object.entries(answers)
    .filter(([key]) => key !== '__preguntas')
    .forEach(([key, rawRelation]) => {
      const relation = normalizeProjectRelationValue(rawRelation);
      if (!relation.enabled || !relation.items.length) return;
      relation.items.forEach((item, index) => {
        const localId = clean(item.localId || item.id);
        if (!localId) return;
        const itemCategory = clean(item.categoria || item.TipoDispositivo || relation.relatedTypeName || 'Componente');
        const itemName = clean(item.nombre || item.NombreDispositivo || item.modelo || item.Modelo || `${itemCategory} ${index + 1}`);
        const relationLabel = labels.get(key);
        targets.push({
          value: `COMPONENTE:${key}:${localId}`,
          targetType: 'COMPONENTE',
          relationKey: key,
          componentLocalId: localId,
          componentTypeId: clean(item.tipoDispositivoId || item.TipoDispositivoID || relation.relatedTypeId),
          componentName: itemName,
          label: relationLabel ? `${itemCategory} · ${itemName} · ${relationLabel}` : `${itemCategory} · ${itemName}`,
          main: false,
        });
      });
    });

  return targets;
}

export function projectEvidenceTargetValue(image = {}) {
  const targetType = clean(image.ProyectoDestinoTipo || image.projectTargetType || image.targetType).toUpperCase();
  if (targetType !== 'COMPONENTE') return 'DISPOSITIVO';
  const relationKey = clean(image.ProyectoRelacionClave || image.projectRelationKey || image.relationKey);
  const componentLocalId = clean(image.ProyectoComponenteLocalID || image.projectComponentLocalId || image.componentLocalId);
  return relationKey && componentLocalId
    ? `COMPONENTE:${relationKey}:${componentLocalId}`
    : 'DISPOSITIVO';
}

export function projectEvidenceTargetPatch(target = {}) {
  return {
    projectTargetType: target.targetType || 'DISPOSITIVO',
    projectRelationKey: target.relationKey || '',
    projectComponentLocalId: target.componentLocalId || '',
    projectComponentTypeId: target.componentTypeId || '',
    projectComponentName: target.componentName || '',
  };
}
