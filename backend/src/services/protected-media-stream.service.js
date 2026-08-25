import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { AppError, badRequest } from '../core/errors.js';
import { googleAuth } from '../infra/google.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const DRIVE_MEDIA_PREFIX = 'https://www.googleapis.com/drive/v3/files/';

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

export function createProtectedMediaStreamUrl({ fileId, mimeType = 'application/octet-stream' }) {
  const encoded = encode({
    fileId: validateFileId(fileId),
    mimeType: normalizedMimeType(mimeType),
    exp: Date.now() + TOKEN_TTL_MS,
  });
  return `/api/media/stream?token=${encodeURIComponent(`${encoded}.${sign(encoded)}`)}`;
}

function parseToken(token) {
  const [encoded, signature] = clean(token).split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) {
    throw new AppError('MEDIA_TOKEN_INVALID', 'El enlace temporal del video no es válido.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('MEDIA_TOKEN_INVALID', 'El enlace temporal del video no se pudo leer.', 401);
  }

  if (Number(payload.exp || 0) <= Date.now()) {
    throw new AppError('MEDIA_TOKEN_EXPIRED', 'El enlace temporal del video expiró. Recargue la boleta.', 401);
  }

  return {
    fileId: validateFileId(payload.fileId),
    mimeType: normalizedMimeType(payload.mimeType),
  };
}

async function accessToken() {
  const result = await googleAuth.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('No fue posible obtener acceso temporal a Google Drive.');
  return token;
}

function copyHeader(upstream, res, name) {
  const value = upstream.headers.get(name);
  if (value) res.setHeader(name, value);
}

export async function streamProtectedMedia(req, res, next) {
  let abortController;
  try {
    const media = parseToken(req.query?.token);
    const bearer = await accessToken();
    abortController = new AbortController();
    const range = clean(req.get('range'));
    const url = `${DRIVE_MEDIA_PREFIX}${encodeURIComponent(media.fileId)}?alt=media&supportsAllDrives=true`;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(range ? { Range: range } : {}),
      },
      signal: abortController.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream.text().catch(() => '');
      throw new AppError(
        'DRIVE_MEDIA_ERROR',
        upstream.status === 404 ? 'El video ya no existe en Google Drive.' : 'Google Drive no pudo entregar el video.',
        upstream.status === 404 ? 404 : 502,
        { googleStatus: upstream.status, response: body.slice(0, 200) },
      );
    }

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || media.mimeType);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    copyHeader(upstream, res, 'content-length');
    copyHeader(upstream, res, 'content-range');
    copyHeader(upstream, res, 'etag');
    copyHeader(upstream, res, 'last-modified');

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body);
    req.once('close', () => abortController?.abort());
    stream.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    next(error);
  }
}
