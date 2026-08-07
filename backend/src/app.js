import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import './services/ticket-visibility.patch.js';
import './services/maintenance-evidence-permissions.patch.js';
import './services/maintenance-ticket-work-time.patch.js';
import './services/maintenance-finalization-resume.patch.js';
import './services/device-media-video-mac.patch.js';
import './services/customer-case-evidence-recovery.patch.js';
import './services/customer-case-test-mode.patch.js';
import './services/customer-case-real-ticket-sequence.patch.js';
import './services/customer-case-initial-email-retry.patch.js';
import './services/customer-case-ticket-finalization.patch.js';
import './services/metrics-assigned-hours.patch.js';
import './services/metrics-dynamic-maintenance-counts.patch.js';
import './services/password-vault-assistant.patch.js';
import './services/password-vault-system-assistant.patch.js';
import './services/integration-gateway-assistant.patch.js';
import { runWithSheetsRouteReadCache } from './services/sheets-route-read-cache.patch.js';
import { env } from './config/env.js';
import { dispatchAction } from './core/action-router.js';
import { AppError } from './core/errors.js';
import {
  dispatchPasswordVaultAction,
  isPasswordVaultRoute,
} from './modules/password-vault.module.js';
import { integrationGatewayRouter } from './routes/integration-gateway.routes.js';
import { runWithActionConcurrency } from './services/action-concurrency.service.js';
import {
  actionEnvelopeMiddleware,
  actionRateLimitMiddleware,
  requestSecurityMiddleware,
} from './middleware/security.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../dist');

function httpError(error) {
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return new AppError('PAYLOAD_TOO_LARGE', 'La solicitud supera el tamaño máximo permitido.', 413);
  }
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 'El cuerpo de la solicitud no contiene JSON válido.', 400);
  }
  return error;
}

export const app = express();
app.set('trust proxy', 1);
app.set('etag', 'strong');
app.disable('x-powered-by');
app.use(requestSecurityMiddleware);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
      workerSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: env.isProduction ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(compression({ threshold: 1_024 }));
app.use(cors({
  origin: env.frontendOrigin === '*'
    ? true
    : env.frontendOrigin.split(',').map((value) => value.trim()).filter(Boolean),
  credentials: false,
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ type: ['text/plain', 'application/javascript'], limit: '25mb' }));

app.use('/api/integration-gateway', integrationGatewayRouter);

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'dms-boletas-backend', time: new Date().toISOString() });
});

app.post('/api/action', actionEnvelopeMiddleware, actionRateLimitMiddleware, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const envelope = req.actionEnvelope;
    const requestOrigin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    const action = isPasswordVaultRoute(envelope.route)
      ? dispatchPasswordVaultAction
      : dispatchAction;
    const data = await runWithSheetsRouteReadCache(envelope.route, () => (
      runWithActionConcurrency(envelope.route, () => action({
        route: envelope.route,
        payload: envelope.payload,
        sessionToken: envelope.sessionToken || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '',
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        origin: requestOrigin,
      }))
    ));
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

if (env.isProduction) {
  app.use(express.static(distPath, {
    maxAge: '1d',
    index: false,
    etag: true,
    setHeaders(response, filePath) {
      const normalized = filePath.replace(/\\/g, '/');
      if (normalized.endsWith('/sw.js')) {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return;
      }
      if (normalized.includes('/assets/')) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (normalized.endsWith('/manifest.webmanifest') || normalized.includes('/icons/')) {
        response.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
});

app.use((rawError, req, res, _next) => {
  const error = httpError(rawError);
  const status = error.status || error.statusCode || (error instanceof AppError ? error.status : 500);
  const isExpected = error instanceof AppError;
  if (status >= 500) console.error(`[${req.requestId || 'sin-id'}]`, error);
  else console.warn(`[${req.requestId || 'sin-id'}][${error.code || 'REQUEST_ERROR'}] ${error.message}`);

  res.setHeader('Cache-Control', 'no-store');
  if (Number(status) === 429) {
    const seconds = Math.max(1, Number(error?.details?.retryAfterSeconds || 60));
    res.setHeader('Retry-After', String(seconds));
  }

  res.status(status).json({
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: isExpected ? error.message : (status >= 500 ? 'Ocurrió un error interno en el servidor.' : 'La solicitud no pudo procesarse.'),
      details: isExpected ? error.details || null : null,
    },
  });
});
