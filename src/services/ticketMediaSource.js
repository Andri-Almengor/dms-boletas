import { MODULE_ROUTES, requestAvailable } from './moduleApi';
import { scheduleMediaPreview } from './mediaPreviewQueue';
import { evidenceMediaKind } from '../utils/evidenceMedia';

const protectedSourceCache = new Map();

function clean(value = '') {
  return String(value || '').trim();
}

export function isProtectedGoogleMediaUrl(value = '') {
  return /(?:drive|docs)\.google\.com|googleusercontent\.com/i.test(clean(value));
}

export function canUseTicketMediaDirectly(value = '') {
  const url = clean(value);
  return Boolean(url) && !isProtectedGoogleMediaUrl(url);
}

export function ticketMediaRequestKey({
  boletaUid,
  evidenceId,
  fileId,
  kind = 'evidence',
  sessionToken = '',
}) {
  return [sessionToken, boletaUid, evidenceId, fileId, kind].map(clean).join(':');
}

export function ticketMediaPreviewSource({
  directUrl,
  fileId,
  mimeType,
  alt,
  kind = 'evidence',
}) {
  if (canUseTicketMediaDirectly(directUrl)) return clean(directUrl);
  const resolvedKind = evidenceMediaKind({ mimeType, name: alt });
  if (resolvedKind !== 'image' || !fileId) return '';
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1200`;
}

export async function requestTicketProtectedSource({
  boletaUid,
  evidenceId,
  fileId,
  kind = 'evidence',
  sessionToken,
}, {
  signal,
  priority = 0,
  force = false,
} = {}) {
  const key = ticketMediaRequestKey({ boletaUid, evidenceId, fileId, kind, sessionToken });
  if (!force && protectedSourceCache.has(key)) return protectedSourceCache.get(key);
  if (force) protectedSourceCache.delete(key);

  const data = await scheduleMediaPreview(
    key,
    (queueSignal) => requestAvailable(MODULE_ROUTES.tickets.mediaGet, {
      boletaUid,
      evidenciaId: evidenceId,
      EvidenciaID: evidenceId,
      fileId,
      kind,
    }, sessionToken, { signal: queueSignal }),
    { signal, priority },
  );

  const resolved = data?.streamUrl || data?.dataUrl || data?.DataURL || data?.url || '';
  if (!resolved) {
    if (data?.missing) throw new Error(data?.message || 'El archivo no está disponible.');
    throw new Error('El backend no devolvió el contenido del archivo.');
  }
  protectedSourceCache.set(key, resolved);
  return resolved;
}

export function clearTicketProtectedSourceCache() {
  protectedSourceCache.clear();
}
