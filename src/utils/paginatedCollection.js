export function mergePaginatedItems(current = [], incoming = [], getKey) {
  if (typeof getKey !== 'function') throw new TypeError('mergePaginatedItems requiere una función getKey.');

  const map = new Map();
  current.forEach((item, index) => {
    map.set(String(getKey(item, index, 'current')), item);
  });
  incoming.forEach((item, index) => {
    map.set(String(getKey(item, index, 'incoming')), item);
  });
  return [...map.values()];
}

export function paginationMeta(response, {
  loadedCount = 0,
  incomingCount = 0,
  pageSize = 0,
} = {}) {
  const serverTotal = Number(response?.total);
  const hasServerTotal = Number.isFinite(serverTotal) && serverTotal >= 0;
  const normalizedLoaded = Math.max(0, Number(loadedCount) || 0);
  const normalizedIncoming = Math.max(0, Number(incomingCount) || 0);
  const normalizedPageSize = Math.max(0, Number(pageSize) || 0);
  const total = hasServerTotal ? serverTotal : normalizedLoaded;

  return {
    total,
    hasMore: hasServerTotal
      ? normalizedLoaded < total
      : normalizedPageSize > 0 && normalizedIncoming >= normalizedPageSize,
    hasServerTotal,
  };
}
