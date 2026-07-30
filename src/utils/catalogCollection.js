function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      const next = value[key];
      if (next !== undefined) result[key] = stableValue(next);
      return result;
    }, {});
}

export function stableCatalogPayload(payload = {}) {
  return JSON.stringify(stableValue(payload));
}

export function mergeCatalogItems(current = [], incoming = [], getId) {
  const keyOf = typeof getId === 'function'
    ? getId
    : (item) => String(item?.id || item?.ID || '');
  const merged = new Map();

  current.forEach((item, index) => {
    const key = String(keyOf(item, index, 'current') || `current-${index}`);
    merged.set(key, item);
  });
  incoming.forEach((item, index) => {
    const key = String(keyOf(item, index, 'incoming') || `incoming-${index}`);
    merged.set(key, item);
  });

  return [...merged.values()];
}

export function includeSelectedCatalogItem(items = [], selectedItem, getId) {
  if (!selectedItem) return items;
  return mergeCatalogItems(items, [selectedItem], getId);
}
