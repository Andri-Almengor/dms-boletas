import { badRequest } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById } from '../infra/sheets.repository.js';

function clean(value) {
  return String(value ?? '').trim();
}

function truthy(value) {
  if (value === true) return true;
  return ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeMaintenanceType(value) {
  return clean(value).toUpperCase() === 'PROYECTO' ? 'PROYECTO' : 'MANTENIMIENTO';
}

function normalizeEvidenceType(value) {
  return clean(value).toLowerCase().includes('desp') ? 'Despues' : 'Antes';
}

function normalizeCaptureTimestamp(payload = {}, existing = null) {
  if (existing?.FechaCaptura) return clean(existing.FechaCaptura);
  const raw = clean(pick(payload, ['FechaCaptura', 'fechaCaptura', 'capturedAt', 'captureDate']));
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  const now = Date.now();
  const futureLimit = now + (15 * 60 * 1000);
  return new Date(Math.min(parsed.getTime(), futureLimit)).toISOString();
}

function componentIdentity(item = {}, relation = {}) {
  return {
    typeId: clean(item.tipoDispositivoId || item.TipoDispositivoID || relation.relatedTypeId),
    name: clean(
      item.nombre
      || item.NombreDispositivo
      || item.modelo
      || item.Modelo
      || item.categoria
      || item.Categoria
      || relation.relatedTypeName
      || 'Componente relacionado',
    ),
  };
}

function relationEntries(answers = {}) {
  return Object.entries(answers)
    .filter(([key]) => key !== '__preguntas')
    .map(([key, value]) => [key, parseObject(value)])
    .filter(([, value]) => Array.isArray(value.items));
}

function resolveProjectTarget(payload = {}, device = {}, existing = null) {
  const requestedType = clean(pick(
    payload,
    ['ProyectoDestinoTipo', 'proyectoDestinoTipo', 'projectTargetType', 'targetType'],
    existing?.ProyectoDestinoTipo || 'DISPOSITIVO',
  )).toUpperCase();
  const targetType = requestedType === 'COMPONENTE' ? 'COMPONENTE' : 'DISPOSITIVO';
  if (targetType === 'DISPOSITIVO') {
    return {
      ProyectoDestinoTipo: 'DISPOSITIVO',
      ProyectoRelacionClave: '',
      ProyectoComponenteLocalID: '',
      ProyectoComponenteTipoDispositivoID: '',
      ProyectoComponenteNombre: '',
    };
  }

  const answers = parseObject(device.RespuestasJSON);
  const requestedRelationKey = clean(pick(
    payload,
    ['ProyectoRelacionClave', 'proyectoRelacionClave', 'projectRelationKey', 'relationKey'],
    existing?.ProyectoRelacionClave,
  ));
  const componentId = clean(pick(
    payload,
    ['ProyectoComponenteLocalID', 'proyectoComponenteLocalId', 'projectComponentLocalId', 'componentLocalId'],
    existing?.ProyectoComponenteLocalID,
  ));
  if (!componentId) throw badRequest('Seleccione el componente relacionado al que corresponde la evidencia.');

  let matches = relationEntries(answers)
    .filter(([key]) => !requestedRelationKey || key === requestedRelationKey)
    .flatMap(([key, relation]) => {
      if (!truthy(relation.enabled)) return [];
      const item = relation.items.find((candidate) => clean(candidate?.localId || candidate?.id) === componentId);
      return item ? [{ key, relation, item }] : [];
    });

  if (!matches.length && requestedRelationKey) {
    matches = relationEntries(answers)
      .flatMap(([key, relation]) => {
        if (!truthy(relation.enabled)) return [];
        const item = relation.items.find((candidate) => clean(candidate?.localId || candidate?.id) === componentId);
        return item ? [{ key, relation, item }] : [];
      });
  }

  if (!matches.length) {
    throw badRequest('El componente relacionado seleccionado ya no existe dentro de este dispositivo.');
  }
  if (matches.length > 1 && !requestedRelationKey) {
    throw badRequest('La referencia del componente es ambigua. Seleccione nuevamente el destino de la evidencia.');
  }

  const selected = matches[0];
  const identity = componentIdentity(selected.item, selected.relation);
  return {
    ProyectoDestinoTipo: 'COMPONENTE',
    ProyectoRelacionClave: selected.key,
    ProyectoComponenteLocalID: componentId,
    ProyectoComponenteTipoDispositivoID: identity.typeId,
    ProyectoComponenteNombre: identity.name,
  };
}

export async function loadMaintenanceEvidenceContext({
  deviceId,
  maintenanceId = '',
} = {}) {
  const normalizedDeviceId = clean(deviceId);
  if (!normalizedDeviceId) throw badRequest('No se indicó el dispositivo de la evidencia.');
  const device = await findById('Evidencia_Mantenimientos', normalizedDeviceId);
  const resolvedMaintenanceId = clean(device.MantenimientoRef);
  if (!resolvedMaintenanceId) throw badRequest('El dispositivo no tiene un mantenimiento relacionado.');
  if (clean(maintenanceId) && clean(maintenanceId) !== resolvedMaintenanceId) {
    throw badRequest('El dispositivo no pertenece al mantenimiento indicado.');
  }
  const maintenance = await findById('Mantenimiento', resolvedMaintenanceId);
  const maintenanceType = normalizeMaintenanceType(maintenance.TipoMantenimiento);
  return {
    device,
    maintenance,
    maintenanceId: resolvedMaintenanceId,
    maintenanceType,
    projectMode: maintenanceType === 'PROYECTO',
  };
}

export function maintenanceEvidenceMetadata(payload = {}, context = {}, {
  existing = null,
} = {}) {
  const capture = normalizeCaptureTimestamp(payload, existing);
  if (!context.projectMode) {
    return {
      ContextoEvidencia: 'MANTENIMIENTO',
      Tipo: normalizeEvidenceType(pick(payload, ['Tipo', 'tipo', 'type'], existing?.Tipo || 'Antes')),
      FechaCaptura: capture,
      ProyectoDestinoTipo: '',
      ProyectoRelacionClave: '',
      ProyectoComponenteLocalID: '',
      ProyectoComponenteTipoDispositivoID: '',
      ProyectoComponenteNombre: '',
    };
  }

  return {
    ContextoEvidencia: 'PROYECTO',
    Tipo: 'Proyecto',
    FechaCaptura: capture,
    ...resolveProjectTarget(payload, context.device, existing),
  };
}

export function maintenanceEvidenceCapturedAt(row = {}) {
  return clean(row.FechaCaptura || row.FechaCreacion || row.FechaActualizacion);
}

export function sortMaintenanceEvidenceNewestFirst(rows = []) {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(maintenanceEvidenceCapturedAt(left)) || 0;
    const rightTime = Date.parse(maintenanceEvidenceCapturedAt(right)) || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return clean(right.FotoDispositivoID).localeCompare(clean(left.FotoDispositivoID), 'es');
  });
}

export const MAINTENANCE_PROJECT_EVIDENCE_COLUMNS = Object.freeze([
  'ContextoEvidencia',
  'FechaCaptura',
  'ProyectoDestinoTipo',
  'ProyectoRelacionClave',
  'ProyectoComponenteLocalID',
  'ProyectoComponenteTipoDispositivoID',
  'ProyectoComponenteNombre',
]);
