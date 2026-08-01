import { getOfflineMeta, setOfflineMeta } from './offlineStore';

const META_KEY = 'offline-id-mappings-v1';

export function replaceOfflineReferences(value, mappings = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => replaceOfflineReferences(item, mappings));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((result, key) => {
      result[key] = replaceOfflineReferences(value[key], mappings);
      return result;
    }, {});
  }
  if (typeof value !== 'string') return value;
  return Object.prototype.hasOwnProperty.call(mappings, value)
    ? mappings[value]
    : value;
}

export async function readOfflineIdMappings() {
  const entry = await getOfflineMeta(META_KEY).catch(() => null);
  const value = entry?.value;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

export async function resolveOfflineReferences(payload) {
  const mappings = await readOfflineIdMappings();
  return replaceOfflineReferences(payload, mappings);
}

export async function saveOfflineIdMapping(localId, serverId) {
  const source = String(localId || '').trim();
  const target = String(serverId || '').trim();
  if (!source || !target || source === target || !source.startsWith('local-')) return false;
  const mappings = await readOfflineIdMappings();
  if (mappings[source] === target) return true;
  await setOfflineMeta(META_KEY, { ...mappings, [source]: target });
  return true;
}
