import { AppError } from '../core/errors.js';
import {
  actionRateLimitPolicy,
  consumeRateLimit,
  pruneRateLimitBuckets,
  resolveRequestId,
  validateActionEnvelope,
} from '../core/request-security.js';
import { env } from '../config/env.js';

const rateLimitBuckets = new Map();
let nextRateLimitSweepAt = 0;

function clientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
}

function setRateLimitHeaders(res, result) {
  res.setHeader('RateLimit-Limit', String(result.limit));
  res.setHeader('RateLimit-Remaining', String(result.remaining));
  res.setHeader('RateLimit-Reset', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
}

function sweepRateLimits(now) {
  if (now < nextRateLimitSweepAt && rateLimitBuckets.size <= env.securityRateLimitMaxBuckets) return;
  pruneRateLimitBuckets(rateLimitBuckets, {
    now,
    maxBuckets: env.securityRateLimitMaxBuckets,
  });
  nextRateLimitSweepAt = now + 60_000;
}

function parsedBody(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new AppError('INVALID_JSON', 'El cuerpo de la solicitud no contiene JSON válido.', 400);
  }
}

export function requestSecurityMiddleware(req, res, next) {
  const requestId = resolveRequestId(req.get('x-request-id'));
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(), payment=(), usb=(), browsing-topics=()');
  next();
}

export function actionEnvelopeMiddleware(req, _res, next) {
  try {
    const envelope = validateActionEnvelope(parsedBody(req.body), {
      maxSessionTokenLength: env.securityMaxSessionTokenLength,
      maxDepth: env.securityPayloadMaxDepth,
      maxKeys: env.securityPayloadMaxKeys,
    });
    req.actionEnvelope = envelope;
    next();
  } catch (error) {
    next(error);
  }
}

export function actionRateLimitMiddleware(req, res, next) {
  const route = req.actionEnvelope?.route || '';
  const policy = actionRateLimitPolicy(route, env);
  const now = Date.now();
  sweepRateLimits(now);

  // El bucket se comparte por familia de política e IP. De esta forma no es
  // posible evitar el límite variando aliases o inventando nombres de ruta.
  const key = `${policy.name}|${clientAddress(req)}`;
  const result = consumeRateLimit(rateLimitBuckets, key, policy, now);
  setRateLimitHeaders(res, result);

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    next(new AppError(
      'RATE_LIMITED',
      'Se realizaron demasiadas solicitudes. Espere unos segundos y vuelva a intentarlo.',
      429,
      { retryAfterSeconds: result.retryAfterSeconds },
    ));
    return;
  }
  next();
}

export function securityRateLimitSnapshot() {
  return { buckets: rateLimitBuckets.size, nextSweepAt: nextRateLimitSweepAt };
}
