const removedDraftFiles = typeof WeakSet === 'function' ? new WeakSet() : null;
const releasedPreviewUrls = new Set();

export function currentDraftRoute() {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search || ''}`;
}

export function createObjectPreview(file) {
  if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  return String(file.type || '').startsWith('image/') ? URL.createObjectURL(file) : '';
}

export function releasePreviewUrl(previewUrl) {
  const url = String(previewUrl || '');
  if (!url.startsWith('blob:') || releasedPreviewUrls.has(url)) return false;
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return false;
  URL.revokeObjectURL(url);
  releasedPreviewUrls.add(url);
  return true;
}

export function notifyDraftFileRemoved(file, route = currentDraftRoute()) {
  if (!file || typeof window === 'undefined' || !route) return false;
  if (removedDraftFiles?.has(file)) return false;
  removedDraftFiles?.add(file);
  window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
    detail: { route, file },
  }));
  return true;
}

export function releaseLocalFile(item, {
  removeDraftFile = true,
  route = currentDraftRoute(),
} = {}) {
  if (!item) return { previewReleased: false, draftFileRemoved: false };
  const previewReleased = releasePreviewUrl(item.previewUrl);
  const draftFileRemoved = removeDraftFile ? notifyDraftFileRemoved(item.file, route) : false;
  return { previewReleased, draftFileRemoved };
}

export function releaseLocalFiles(items = [], options = {}) {
  return (items || []).map((item) => releaseLocalFile(item, options));
}
