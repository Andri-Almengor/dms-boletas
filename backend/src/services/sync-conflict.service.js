import { AppError } from '../core/errors.js';

const KEEP_LOCAL = 'KEEP_LOCAL';
const CONTROL_KEYS = new Set([
  '__syncBase',
  '__conflictResolution',
  'maintenanceId',
  'MantenimientoID',
  'MantenimientoRef',
  'deviceId',
  'EvidenciaMantenimientoID',
  'imageId',
  'FotoDispositivoID',
  'DispositivoMantenimientoRef',
  'id',
]);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeJsonString(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function stable(value) {
  const normalized = normalizeJsonString(value);
  if (Array.isArray(normalized)) return normalized.map(stable);
  if (normalized && typeof normalized === 'object') {
    return Object.keys(normalized).sort().reduce((result, key) => {
      result[key] = stable(normalized[key]);
      return result;
    }, {});
  }
  return normalized;
}

function sameValue(left, right) {
  if ((typeof left === 'number' || typeof right === 'number')
    && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return Number(left) === Number(right);
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return String(left).toLowerCase() === String(right).toLowerCase();
  }
  return JSON.stringify(stable(left ?? '')) === JSON.stringify(stable(right ?? ''));
}

function aliasesFor(field, configured) {
  return [...new Set([field, ...(configured || [])])];
}

function readValue(record, aliases) {
  for (const key of aliases) {
    if (own(record, key)) return record[key];
  }
  return undefined;
}

function hasAny(record, aliases) {
  return aliases.some((key) => own(record, key));
}

function syncMetadata(payload = {}) {
  const raw = payload.__syncBase;
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {};
  return {
    entityType: clean(raw.entityType),
    entityId: clean(raw.entityId),
    maintenanceId: clean(raw.maintenanceId),
    updatedAt: clean(raw.updatedAt || snapshot.FechaActualizacion),
    snapshot,
  };
}

function projectedRecord(record, fieldAliases) {
  const projected = {};
  for (const [field, configured] of Object.entries(fieldAliases)) {
    const aliases = aliasesFor(field, configured);
    const value = readValue(record, aliases);
    if (value !== undefined) projected[field] = value;
  }
  for (const key of ['MantenimientoID', 'EvidenciaMantenimientoID', 'FotoDispositivoID', 'MantenimientoRef', 'DispositivoMantenimientoRef', 'FechaActualizacion', 'ActualizadoPor']) {
    if (own(record, key)) projected[key] = record[key];
  }
  return projected;
}

function localRecord(payload, base, fieldAliases) {
  const projected = { ...projectedRecord(base, fieldAliases) };
  for (const [field, configured] of Object.entries(fieldAliases)) {
    const aliases = aliasesFor(field, configured);
    if (hasAny(payload, aliases)) projected[field] = readValue(payload, aliases);
  }
  return projected;
}

function safePayload(payload, localChangedFields, fieldAliases) {
  const next = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (CONTROL_KEYS.has(key)) next[key] = value;
  }
  for (const field of localChangedFields) {
    const aliases = aliasesFor(field, fieldAliases[field]);
    for (const key of aliases) {
      if (own(payload, key)) next[key] = payload[key];
    }
  }
  if (localChangedFields.includes('RespuestasJSON')) {
    for (const key of ['questionDetails', 'respuestasDetalle']) {
      if (own(payload, key)) next[key] = payload[key];
    }
  }
  return next;
}

export function resolveConflictAwarePayload({
  payload = {},
  before = {},
  fieldAliases = {},
  entityType = '',
  entityId = '',
  maintenanceId = '',
}) {
  const metadata = syncMetadata(payload);
  if (!metadata) return payload;

  const requestedEntityType = clean(entityType);
  const requestedEntityId = clean(entityId);
  if ((metadata.entityType && requestedEntityType && metadata.entityType !== requestedEntityType)
    || (metadata.entityId && requestedEntityId && metadata.entityId !== requestedEntityId)) {
    throw new AppError(
      'INVALID_SYNC_BASE',
      'La versión local no corresponde al registro que se intenta actualizar.',
      400,
      {
        expectedEntityType: requestedEntityType,
        receivedEntityType: metadata.entityType,
        expectedEntityId: requestedEntityId,
        receivedEntityId: metadata.entityId,
      },
    );
  }

  const currentUpdatedAt = clean(before.FechaActualizacion || before.FechaCreacion);
  const expectedUpdatedAt = clean(metadata.updatedAt);
  if (expectedUpdatedAt && currentUpdatedAt === expectedUpdatedAt) return payload;

  const base = metadata.snapshot || {};
  const hasSnapshot = Object.keys(base).length > 0;
  const localChangedFields = [];
  const remoteChangedFields = [];

  for (const [field, configured] of Object.entries(fieldAliases)) {
    const aliases = aliasesFor(field, configured);
    const baseValue = readValue(base, aliases);
    const currentValue = readValue(before, aliases);
    const localProvided = hasAny(payload, aliases);
    const localValue = localProvided ? readValue(payload, aliases) : baseValue;
    if (localProvided && !sameValue(localValue, baseValue)) localChangedFields.push(field);
    if (!sameValue(currentValue, baseValue)) remoteChangedFields.push(field);
  }

  const conflictFields = hasSnapshot
    ? localChangedFields.filter((field) => remoteChangedFields.includes(field))
    : ['*'];
  const forced = clean(payload.__conflictResolution).toUpperCase() === KEEP_LOCAL;

  if (!hasSnapshot && forced) return payload;

  if (conflictFields.length && !forced) {
    throw new AppError(
      'SYNC_CONFLICT',
      'Otro técnico modificó este registro mientras usted trabajaba sin conexión. Revise ambas versiones antes de continuar.',
      409,
      {
        entityType: entityType || metadata.entityType,
        entityId: clean(entityId || metadata.entityId),
        maintenanceId: clean(maintenanceId || metadata.maintenanceId),
        expectedUpdatedAt,
        currentUpdatedAt,
        localChangedFields,
        remoteChangedFields,
        conflictFields,
        baseRecord: projectedRecord(base, fieldAliases),
        localRecord: localRecord(payload, base, fieldAliases),
        serverRecord: projectedRecord(before, fieldAliases),
        canKeepLocal: true,
        canUseServer: true,
      },
    );
  }

  // Cuando la versión remota cambió, solo se reenvían los campos que el usuario
  // modificó respecto a su copia base. Así se conservan automáticamente los
  // cambios remotos que no chocan con los locales.
  return safePayload(payload, localChangedFields, fieldAliases);
}

export const SYNC_CONFLICT_RESOLUTION = Object.freeze({ KEEP_LOCAL });
