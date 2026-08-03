import { collectOfflineLocalReferences } from './offlineCatalogDomain';

const IDENTITY_STABLE_PREFIXES = Object.freeze([
  { prefix: 'mantenimiento-', entityType: 'maintenance' },
  { prefix: 'dispositivo-', entityType: 'maintenanceDevice' },
  { prefix: 'foto-', entityType: 'maintenanceImage' },
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function offlineIdentityEntityType(value) {
  const id = clean(value).toLowerCase();
  return IDENTITY_STABLE_PREFIXES.find((entry) => id.startsWith(entry.prefix))?.entityType || '';
}

export function isIdentityStableOfflineId(value) {
  return Boolean(offlineIdentityEntityType(value));
}

function mappingLocalId(mapping = {}) {
  return clean(mapping.localId || mapping.LocalID || mapping.id);
}

export function collectOfflineIdentityRepairs(operations = [], mappings = []) {
  const alreadyMapped = new Set((mappings || []).map(mappingLocalId).filter(Boolean));
  const candidates = new Set();

  for (const operation of operations || []) {
    for (const dependency of operation?.dependsOnLocalIds || []) {
      const id = clean(dependency);
      if (isIdentityStableOfflineId(id)) candidates.add(id);
    }

    for (const reference of collectOfflineLocalReferences(operation?.payload || {})) {
      const id = clean(reference);
      if (isIdentityStableOfflineId(id)) candidates.add(id);
    }
  }

  return [...candidates]
    .filter((localId) => !alreadyMapped.has(localId))
    .sort()
    .map((localId) => ({
      localId,
      serverId: localId,
      entityType: offlineIdentityEntityType(localId),
    }));
}

export async function repairOfflineIdentityMappings({
  operations = [],
  mappings = [],
  saveMapping,
} = {}) {
  if (typeof saveMapping !== 'function') return [];
  const repairs = collectOfflineIdentityRepairs(operations, mappings);
  const completed = [];

  for (const repair of repairs) {
    await saveMapping(repair.localId, repair.serverId, repair.entityType);
    completed.push(repair);
  }

  return completed;
}
