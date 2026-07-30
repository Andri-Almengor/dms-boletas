import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  actionRateLimitPolicy,
  consumeRateLimit,
  pruneRateLimitBuckets,
  resolveRequestId,
  validateActionEnvelope,
} from '../../backend/src/core/request-security.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const SECURITY_CONFIG = {
  securityLoginRateLimitMax: 2,
  securityLoginRateLimitWindowMs: 60_000,
  securityPublicWriteRateLimitMax: 3,
  securityPublicWriteRateLimitWindowMs: 120_000,
  securityPublicReadRateLimitMax: 4,
  securityPublicReadRateLimitWindowMs: 180_000,
  securityActionRateLimitMax: 5,
  securityActionRateLimitWindowMs: 240_000,
};

test('valida el sobre de acciones sin modificar payloads compatibles', () => {
  const payload = { boletaUid: 'B-1', evidencias: [{ localId: 'E-1' }] };
  const result = validateActionEnvelope({
    route: 'boletas.update',
    payload,
    sessionToken: 'token-seguro',
  });

  assert.equal(result.route, 'boletas.update');
  assert.equal(result.payload, payload);
  assert.equal(result.sessionToken, 'token-seguro');
});

test('rechaza rutas, payloads y claves peligrosas antes del router', () => {
  assert.throws(
    () => validateActionEnvelope({ route: '<script>', payload: {} }),
    (error) => error.code === 'INVALID_ACTION_ROUTE' && error.status === 400,
  );
  assert.throws(
    () => validateActionEnvelope({ route: 'boletas.update', payload: [] }),
    (error) => error.code === 'INVALID_ACTION_PAYLOAD',
  );
  const polluted = JSON.parse('{"constructor":{"prototype":{"admin":true}}}');
  assert.throws(
    () => validateActionEnvelope({ route: 'boletas.update', payload: polluted }),
    (error) => error.code === 'UNSAFE_PAYLOAD_KEY',
  );
});

test('aplica políticas distintas a login, escrituras públicas y acciones privadas', () => {
  assert.deepEqual(actionRateLimitPolicy('auth.login', SECURITY_CONFIG), {
    name: 'login', limit: 2, windowMs: 60_000,
  });
  assert.deepEqual(actionRateLimitPolicy('survey.public.submit', SECURITY_CONFIG), {
    name: 'public-write', limit: 3, windowMs: 120_000,
  });
  assert.deepEqual(actionRateLimitPolicy('ticket.signature.public.get', SECURITY_CONFIG), {
    name: 'public-read', limit: 4, windowMs: 180_000,
  });
  assert.deepEqual(actionRateLimitPolicy('boletas.list', SECURITY_CONFIG), {
    name: 'action', limit: 5, windowMs: 240_000,
  });
});

test('el limitador conserva ventana, retry-after y limpieza acotada', () => {
  const buckets = new Map();
  const policy = { limit: 2, windowMs: 10_000 };
  assert.equal(consumeRateLimit(buckets, 'login|ip', policy, 1_000).allowed, true);
  assert.equal(consumeRateLimit(buckets, 'login|ip', policy, 1_001).allowed, true);
  const blocked = consumeRateLimit(buckets, 'login|ip', policy, 1_002);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 10);

  assert.equal(consumeRateLimit(buckets, 'login|ip', policy, 11_001).allowed, true);
  buckets.set('expired', { count: 1, resetAt: 1, lastSeen: 1 });
  pruneRateLimitBuckets(buckets, { now: 20_000, maxBuckets: 100 });
  assert.equal(buckets.has('expired'), false);
});

test('acepta request IDs seguros y reemplaza valores manipulados', () => {
  assert.equal(resolveRequestId('req-12345678'), 'req-12345678');
  assert.match(resolveRequestId('<script>'), /^[0-9a-f-]{36}$/i);
});

test('la aplicación activa CSP, validación, rate limit y errores sin filtrar detalles internos', () => {
  const app = source('backend/src/app.js');
  const server = source('backend/src/server.js');
  const middleware = source('backend/src/middleware/security.middleware.js');
  const workflow = source('.github/workflows/validate.yml');
  const packageJson = source('package.json');
  const backendPackage = source('backend/package.json');

  assert.match(app, /contentSecurityPolicy/);
  assert.match(app, /objectSrc: \["'none'"\]/);
  assert.match(app, /actionEnvelopeMiddleware, actionRateLimitMiddleware/);
  assert.match(app, /PAYLOAD_TOO_LARGE/);
  assert.match(app, /INVALID_JSON/);
  assert.match(app, /res\.json\(\{ ok: true, data \}\)/);
  assert.doesNotMatch(app, /res\.json\(\{ ok: true, data, requestId/);

  assert.match(middleware, /RateLimit-Limit/);
  assert.match(middleware, /X-Request-ID/);
  assert.match(middleware, /const key = `\$\{policy\.name\}\|\$\{clientAddress\(req\)\}`/);
  assert.doesNotMatch(middleware, /clientAddress\(req\).*route\.toLowerCase/);
  assert.match(server, /env\.healthDetailsPublic/);
  assert.match(server, /requestPath === '\/api\/health'/);
  assert.match(server, /FRONTEND_ORIGIN permite cualquier origen/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /git push origin/);
  assert.match(workflow, /Audit production dependencies/);
  assert.match(workflow, /Collect final metrics and CSS audit/);
  assert.match(packageJson, /"react-router-dom": "6\.30\.4"/);
  assert.match(packageJson, /"audit:security"/);
  assert.match(packageJson, /"report:final"/);
  assert.match(backendPackage, /"nodemailer": "9\.0\.3"/);
});
