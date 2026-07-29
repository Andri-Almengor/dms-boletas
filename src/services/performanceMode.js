const LOW_RESOURCE_CLASS = 'dms-low-resource-device';
const DATA_SAVER_CLASS = 'dms-data-saver';

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function performanceSnapshot() {
  const memory = numeric(navigator.deviceMemory);
  const cores = numeric(navigator.hardwareConcurrency);
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(connection?.saveData);
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const constrainedNetwork = saveData || effectiveType === 'slow-2g' || effectiveType === '2g';
  const lowResource = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
  return { memory, cores, saveData, effectiveType, constrainedNetwork, lowResource };
}

export function initializePerformanceMode() {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return null;
  const root = document.documentElement;
  const apply = () => {
    const snapshot = performanceSnapshot();
    root.classList.toggle(LOW_RESOURCE_CLASS, snapshot.lowResource);
    root.classList.toggle(DATA_SAVER_CLASS, snapshot.constrainedNetwork);
    globalThis.__dmsPerformanceMode = snapshot;
    globalThis.dispatchEvent?.(new CustomEvent('dms-performance-mode-change', { detail: snapshot }));
    return snapshot;
  };

  const snapshot = apply();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', apply);
  return snapshot;
}

export function currentPerformanceMode() {
  return globalThis.__dmsPerformanceMode || performanceSnapshot();
}
