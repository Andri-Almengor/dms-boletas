import crypto from 'node:crypto';
import { AppError } from './errors.js';

const ROUTE_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,159}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const PUBLIC_WRITE_ROUTES = new Set([
  'survey.public.submit',
  'encuesta.publica.submit',
  'customercases.public.submit',
  'casos.cliente.public.submit',
  'ticket.signature.public.submit',
  'boletas.firma.publica.guardar',
  'maintenance.signature.public.submit',
  'mantenimientos.firma.publica.guardar',
]);

const PUBLIC_READ_ROUTES = new Set([
  'survey.public.get',
  'encuesta.publica.get',
  'customercases.public.get',
  'casos.cliente.public.get',
  'ticket.signature.public.get',
  'boletas.firma.publica.get',
  'maintenance.signature.public.get',
  'mantenimientos.firma.publica.get',
]);

function objectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inspectObject(value, state, depth = 0) {
  if (!objectRecord(value) && !Array.isArray(value)) return;
  if (depth > state.maxDepth) {
    throw new AppError('PAYLOAD_TOO_DEEP', 'La solicitud contiene demasiados niveles de datos.', 400);
  }

  for (const [key, child] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > state.maxKeys) {
      throw new AppError('PAYLOAD_TOO_COMPLEX', 'La solicitud contiene demasiados campos.', 400);
    }
    if (BLOCKED_KEYS.has(key)) {
      throw new AppError('UNSAFE_PAYLOAD_KEY', 'La solicitud contiene un campo no permitido.', 400);
    }
    inspectObject(child, state, depth + 1);
  }
}

export function validateActionEnvelope(body, options = {}) {
  if (!objectRecord(body)) {
    throw new AppError('INVALID_REQUEST_BODY', 'El cuerpo de la solicitud debe ser un objeto JSON.', 400);
  }

  const route = String(body.route || body.action || '').trim();
  if (!ROUTE_PATTERN.test(route)) {
    throw new AppError('INVALID_ACTION_ROUTE', 'La acción solicitada no tiene un formato válido.', 400);
  }

  const payload = body.payload === undefined ? {} : body.payload;
  if (!objectRecord(payload)) {
    throw new AppError('INVALID_ACTION_PAYLOAD', 'Los datos de la acción deben ser un objeto.', 400);
  }

  const sessionToken = String(body.sessionToken || '').trim();
  const maxSessionTokenLength = Math.max(128, Number(options.maxSessionTokenLength || 1024));
  if (sessionToken.length > maxSessionTokenLength) {
    throw new AppError('INVALID_SESSION_TOKEN', 'El token de sesión no tiene un formato válido.', 400);
  }

  inspectObject(payload, {
    keys: 0,
    maxDepth: Math.max(5, Number(options.maxDepth || 24)),
    maxKeys: Math.max(100, Number(options.maxKeys || 50_000)),
  });

  return { route, payload, sessionToken };
}

export function resolveRequestId(value = '') {
  const requested = String(value || '').trim();
  return REQUEST_ID_PATTERN.test(requested) ? requested : crypto.randomUUID();
}

export function actionRateLimitPolicy(route, config) {
  const normalized = String(route || '').trim().toLowerCase();
  if (normalized === 'auth.login') {
    return {
      name: 'login',
      limit: Math.max(1, Number(config.securityLoginRateLimitMax || 30)),
      windowMs: Math.max(1_000, Number(config.securityLoginRateLimitWindowMs || 15 * 60_000)),
    };
  }
  if (PUBLIC_WRITE_ROUTES.has(normalized)) {
    return {
      name: 'public-write',
      limit: Math.max(1, Number(config.securityPublicWriteRateLimitMax || 60)),
      windowMs: Math.max(1_000, Number(config.securityPublicWriteRateLimitWindowMs || 15 * 60_000)),
    };
  }
  if (PUBLIC_READ_ROUTES.has(normalized)) {
    return {
      name: 'public-read',
      limit: Math.max(1, Number(config.securityPublicReadRateLimitMax || 300)),
      windowMs: Math.max(1_000, Number(config.securityPublicReadRateLimitWindowMs || 5 * 60_000)),
    };
  }
  return {
    name: 'action',
    limit: Math.max(1, Number(config.securityActionRateLimitMax || 900)),
    windowMs: Math.max(1_000, Number(config.securityActionRateLimitWindowMs || 60_000)),
  };
}

export function consumeRateLimit(buckets, key, policy, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || Number(bucket.resetAt || 0) <= now) {
    bucket = { count: 0, resetAt: now + policy.windowMs, lastSeen: now };
    buckets.set(key, bucket);
  }

  bucket.lastSeen = now;
  const allowed = bucket.count < policy.limit;
  if (allowed) bucket.count += 1;
  const remaining = Math.max(0, policy.limit - bucket.count);
  return {
    allowed,
    limit: policy.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function pruneRateLimitBuckets(buckets, options = {}) {
  const now = Number(options.now || Date.now());
  const maxBuckets = Math.max(100, Number(options.maxBuckets || 10_000));
  for (const [key, bucket] of buckets.entries()) {
    if (Number(bucket.resetAt || 0) <= now) buckets.delete(key);
  }
  if (buckets.size <= maxBuckets) return;
  const oldest = [...buckets.entries()]
    .sort((left, right) => Number(left[1].lastSeen || 0) - Number(right[1].lastSeen || 0));
  oldest.slice(0, buckets.size - maxBuckets).forEach(([key]) => buckets.delete(key));
}
