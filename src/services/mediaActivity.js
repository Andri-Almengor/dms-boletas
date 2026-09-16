const DEFAULT_IDLE_GRACE_MS = 1500;

let activeTransfers = 0;
let graceUntil = 0;
let idleTimer = null;

function dispatch(name, detail = {}) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(name, { detail }));
  } catch {
    // La prioridad de sync es una optimización; nunca debe romper una carga.
  }
}

function clearIdleTimer() {
  if (idleTimer) globalThis.clearTimeout?.(idleTimer);
  idleTimer = null;
}

function emitState() {
  dispatch('dms-media-upload-state', {
    active: isMediaUploadActive(),
    transfers: activeTransfers,
    graceUntil,
  });
}

function scheduleIdle(graceMs) {
  clearIdleTimer();
  const delay = Math.max(0, Number(graceMs || DEFAULT_IDLE_GRACE_MS));
  graceUntil = Date.now() + delay;
  idleTimer = globalThis.setTimeout?.(() => {
    idleTimer = null;
    if (activeTransfers > 0) return;
    graceUntil = 0;
    emitState();
    dispatch('dms-media-upload-idle', { active: false });
  }, delay);
}

export function isMediaUploadActive() {
  return activeTransfers > 0 || Date.now() < graceUntil;
}

export function beginMediaUpload({ idleGraceMs = DEFAULT_IDLE_GRACE_MS } = {}) {
  activeTransfers += 1;
  graceUntil = 0;
  clearIdleTimer();
  emitState();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTransfers = Math.max(0, activeTransfers - 1);
    if (activeTransfers === 0) scheduleIdle(idleGraceMs);
    else emitState();
  };
}

export async function withMediaUploadPriority(work, options = {}) {
  const release = beginMediaUpload(options);
  try {
    return await work();
  } finally {
    release();
  }
}

export function mediaActivitySnapshot() {
  return {
    active: isMediaUploadActive(),
    transfers: activeTransfers,
    graceUntil,
  };
}
