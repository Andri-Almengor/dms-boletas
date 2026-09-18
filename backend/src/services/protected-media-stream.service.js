import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { AppError, badRequest } from '../core/errors.js';
import { googleAuth } from '../infra/google.js';
import { recordDriveCall } from './performance-observability.service.js';

const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_GRANTS = 1_000;
const DRIVE_MEDIA_PREFIX = 'https://www.googleapis.com/drive/v3/files/';
const grants = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function signingKey() {
  return crypto.createHash('sha256')
    .update(`dms-protected-media|${String(env.googlePrivateKey || '')}`)
    .digest();
}

function sign(encoded) {
  return crypto.createHmac('sha256', signingKey()).update(encoded).digest('base64url');
}

function encode(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateFileId(value) {
  const fileId = clean(value);
  if (!/^[A-Za-z0-9_-]{10,220}$/.test(fileId)) {
    throw badRequest('El archivo solicitado no tiene un identificador válido.');
  }
  return fileId;
}

function normalizedMimeType(value) {
  const mimeType = clean(value).toLowerCase();
  return /^[-\w.+]+\/[-\w.+]+$/.test(mimeType) ? mimeType : 'application/octet-stream';
}

function sessionFingerprint(sessionToken) {
  return crypto.createHash('sha256').update(clean(sessionToken)).digest('base64url');
}

function pruneGrants(now = Date.now()) {
  for (const [grantId, grant] of grants) {
    if (Number(grant.exp || 0) <= now) grants.delete(grantId);
  }
  while (grants.size > MAX_ACTIVE_GRANTS) grants.delete(grants.keys().next().value);
}

export function createProtectedMediaStreamUrl({
  fileId,
  mimeType = 'application/octet-stream',
  boletaUid = '',
  evidenceId = '',
  kind = 'evidence',
  userId = '',
  sessionToken = '',
  disposition = 'inline',
  fileName = '',
}) {
  const scopedTicket = clean(boletaUid);
  const scopedUser = clean(userId);
  const scopedSession = clean(sessionToken);
  if (!scopedTicket || !scopedUser || !scopedSession) {
    throw new AppError('MEDIA_SCOPE_MISSING', 'No fue posible crear un enlace seguro para la evidencia.', 500);
  }

  const exp = Date.now() + TOKEN_TTL_MS;
  const grantId = crypto.randomBytes(18).toString('base64url');
  const payload = {
    grantId,
    fileId: validateFileId(fileId),
    mimeType: normalizedMimeType(mimeType),
    boletaUid: scopedTicket,
    evidenceId: clean(evidenceId),
    kind: clean(kind) || 'evidence',
    userId: scopedUser,
    sessionHash: sessionFingerprint(scopedSession),
    disposition: clean(disposition).toLowerCase() === 'attachment' ? 'attachment' : 'inline',
    fileName: clean(fileName).replace(/[\r\n"\\]/g, '_').slice(0, 180),
    exp,
  };

  pruneGrants();
  grants.set(grantId, { ...payload });
  pruneGrants();

  const encoded = encode(payload);
  return `/api/media/stream?token=${encodeURIComponent(`${encoded}.${sign(encoded)}`)}`;
}

function parseToken(token) {
  const [encoded, signature] = clean(token).split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) {
    throw new AppError('MEDIA_TOKEN_INVALID', 'El enlace temporal de la evidencia no es válido.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('MEDIA_TOKEN_INVALID', 'El enlace temporal de la evidencia no se pudo leer.', 401);
  }

  if (Number(payload.exp || 0) <= Date.now()) {
    grants.delete(clean(payload.grantId));
    throw new AppError('MEDIA_TOKEN_EXPIRED', 'El enlace temporal de la evidencia expiró. Reintente la vista previa.', 401);
  }

  const grant = grants.get(clean(payload.grantId));
  const fields = ['fileId', 'mimeType', 'boletaUid', 'evidenceId', 'kind', 'userId', 'sessionHash', 'disposition', 'fileName'];
  if (!grant || fields.some((field) => clean(grant[field]) !== clean(payload[field])) || Number(grant.exp) !== Number(payload.exp)) {
    throw new AppError('MEDIA_GRANT_INVALID', 'La autorización temporal de la evidencia ya no está disponible.', 401);
  }

  return {
    ...payload,
    fileId: validateFileId(payload.fileId),
    mimeType: normalizedMimeType(payload.mimeType),
  };
}

async function accessToken() {
  const result = await googleAuth.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new AppError('DRIVE_AUTH_UNAVAILABLE', 'No fue posible obtener acceso temporal a Google Drive.', 502);
  return token;
}

function copyHeader(upstream, res, name) {
  const value = upstream.headers.get(name);
  if (value) res.setHeader(name, value);
}

function driveMediaError(status) {
  if (status === 404) return new AppError('DRIVE_FILE_NOT_FOUND', 'La evidencia ya no existe en Google Drive.', 404, { googleStatus: 404 });
  if (status === 403) return new AppError('DRIVE_FILE_FORBIDDEN', 'Google Drive no permitió acceder a esta evidencia.', 502, { googleStatus: 403 });
  if (status === 429) return new AppError('DRIVE_RATE_LIMITED', 'Google Drive limitó temporalmente la carga de esta evidencia.', 503, { googleStatus: 429, retryAfterSeconds: 5 });
  if (status >= 500) return new AppError('DRIVE_TEMPORARILY_UNAVAILABLE', 'Google Drive no pudo entregar temporalmente esta evidencia.', 502, { googleStatus: status });
  return new AppError('DRIVE_MEDIA_ERROR', 'Google Drive no pudo entregar esta evidencia.', 502, { googleStatus: status });
}

export async function streamProtectedMedia(req, res, next) {
  let abortController;
  try {
    const media = parseToken(req.query?.token);
    const bearer = await accessToken();
    abortController = new AbortController();
    const range = clean(req.get('range'));
    const url = `${DRIVE_MEDIA_PREFIX}${encodeURIComponent(media.fileId)}?alt=media&supportsAllDrives=true`;
    const driveStartedAt = performance.now();
    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(range ? { Range: range } : {}),
        },
        signal: abortController.signal,
      });
    } finally {
      recordDriveCall({ durationMs: performance.now() - driveStartedAt });
    }

    if (!upstream.ok && upstream.status !== 206) throw driveMediaError(upstream.status);

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || media.mimeType);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    const disposition = media.disposition === 'attachment' ? 'attachment' : 'inline';
    const safeName = clean(media.fileName).replace(/[\r\n"\\]/g, '_').slice(0, 180);
    res.setHeader('Content-Disposition', safeName ? `${disposition}; filename="${safeName}"` : disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    copyHeader(upstream, res, 'content-length');
    copyHeader(upstream, res, 'content-range');
    copyHeader(upstream, res, 'etag');
    copyHeader(upstream, res, 'last-modified');

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body);
    res.once('close', () => abortController?.abort());
    stream.on('error', (error) => {
      if (error?.name === 'AbortError') return;
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    next(error);
  }
}

export function protectedMediaSnapshot() {
  pruneGrants();
  return {
    activeGrants: grants.size,
    maxActiveGrants: MAX_ACTIVE_GRANTS,
    tokenTtlMs: TOKEN_TTL_MS,
  };
}

export const PROTECTED_MEDIA_POLICY = Object.freeze({
  tokenTtlMs: TOKEN_TTL_MS,
  maxActiveGrants: MAX_ACTIVE_GRANTS,
  storesRawSessionToken: false,
  makesDriveFilesPublic: false,
});
