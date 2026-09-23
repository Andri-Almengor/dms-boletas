import { safeError } from './core/runtime-diagnostics.js';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import './services/ticket-visibility.patch.js';
import './services/maintenance-evidence-permissions.patch.js';
import './services/maintenance-device-delete-permissions.patch.js';
import './services/ticket-delete-audit.patch.js';
import './services/maintenance-ticket-work-time.patch.js';
import './services/maintenance-finalization-resume.patch.js';
import './services/maintenance-finalization-schedule.patch.js';
import './services/device-media-video-mac.patch.js';
import './services/protected-media-stream.patch.js';
import './services/ticket-detail-read-optimization.patch.js';
import './services/customer-case-evidence-recovery.patch.js';
import './services/customer-case-test-mode.patch.js';
import './services/customer-case-real-ticket-sequence.patch.js';
import './services/customer-case-initial-email-retry.patch.js';
import './services/customer-case-ticket-finalization.patch.js';
import './services/customer-case-query-optimization.patch.js';
import './services/metrics-assigned-hours.patch.js';
import './services/metrics-dynamic-maintenance-counts.patch.js';
import './services/knowledge-long-content.patch.js';
import './services/agenda-query-optimization.patch.js';
import './services/password-vault-assistant.patch.js';
import './services/password-vault-system-assistant.patch.js';
import './services/assistant-maintenance-keyword.patch.js';
import { runWithSheetsRouteReadCache } from './services/sheets-route-read-cache.patch.js';
import { streamProtectedMedia } from './services/protected-media-stream.service.js';
import { dispatchActionWithIncrementalSync } from './services/incremental-sync-dispatch.service.js';
import { env } from './config/env.js';
import { dispatchAction } from './core/action-router.js';
import { AppError } from './core/errors.js';
import { authenticate } from './services/auth.service.js';
import { aiAgentHandlers } from './ai/agent.module.js';
import {
  dispatchPasswordVaultAction,
  isPasswordVaultRoute,
} from './modules/password-vault.module.js';
import { maintenanceFinalizationWorkerRouter } from './routes/maintenance-finalization-worker.routes.js';
import { maintenanceProgressWorkerRouter } from './routes/maintenance-progress-worker.routes.js';
import { runWithActionConcurrency } from './services/action-concurrency.service.js';
import { runWithActionSingleFlight } from './services/action-single-flight.service.js';
import { startRouteObservation } from './services/performance-observability.service.js';
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
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: ['text/plain', 'application/javascript'], limit: '50mb' }));

app.use('/api/maintenance-finalization', maintenanceFinalizationWorkerRouter);
app.use('/api/maintenance-progress', maintenanceProgressWorkerRouter);

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'dms-boletas-backend', time: new Date().toISOString() });
});

app.get('/api/ai/health', async (req, res, next) => {
  try {
    const sessionToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const auth = await authenticate(sessionToken);
    if (!auth.permissions.includes('USUARIOS_GESTIONAR')) {
      throw new AppError('FORBIDDEN', 'No cuenta con permiso para consultar el diagnóstico del asistente.', 403);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data: await aiAgentHandlers.health() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/stream', async (req, res, next) => {
  const observation = startRouteObservation('ticket.media.stream', { requestId: req.requestId });
  const finishObservation = () => {
    const header = res.getHeader('content-length');
    const responseSize = typeof header === 'string' || typeof header === 'number' ? Number(header) || 0 : 0;
    observation.finish({ statusCode: res.statusCode, responseSize });
  };
  res.once('finish', finishObservation);
  res.once('close', finishObservation);
  const handlerStartedAt = performance.now();
  try {
    await observation.run(() => streamProtectedMedia(req, res, next));
  } finally {
    observation.markHandlerDuration(performance.now() - handlerStartedAt);
  }
});

app.post('/api/action', actionEnvelopeMiddleware, actionRateLimitMiddleware, async (req, res, next) => {
  req.dmsActionRunning = true;
  let envelope = null;
  let sessionToken = '';
  const observation = startRouteObservation(req.actionEnvelope?.route, { requestId: req.requestId });
  const finishObservation = () => {
    const header = res.getHeader('content-length');
    const responseSize = typeof header === 'string' || typeof header === 'number' ? Number(header) || 0 : 0;
    observation.finish({ statusCode: res.statusCode, responseSize });
  };
  res.once('finish', finishObservation);
  res.once('close', finishObservation);

  try {
    res.setHeader('Cache-Control', 'no-store');
    envelope = req.actionEnvelope;
    const requestOrigin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    sessionToken = envelope.sessionToken || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const action = isPasswordVaultRoute(envelope.route)
      ? dispatchPasswordVaultAction
      : dispatchActionWithIncrementalSync;
    const execute = () => runWithSheetsRouteReadCache(envelope.route, () => {
      const queuedAt = performance.now();
      return runWithActionConcurrency(envelope.route, async () => {
        const handlerStartedAt = performance.now();
        observation.markQueueWait(handlerStartedAt - queuedAt);
        try {
          return await action({
            route: envelope.route,
            payload: envelope.payload,
            sessionToken,
            ip: req.ip,
            userAgent: req.get('user-agent') || '',
            origin: requestOrigin,
          });
        } finally {
          observation.markHandlerDuration(performance.now() - handlerStartedAt);
        }
      });
    });
    const data = await observation.run(() => runWithActionSingleFlight({
      route: envelope.route,
      payload: envelope.payload,
      sessionToken,
    }, execute));

    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  } finally {
    req.dmsActionRunning = false;
    req.emit('dms-action-settled');
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
    if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) return next();
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
  const action = req.actionEnvelope?.route || (req.path === '/api/media/stream' ? 'ticket.media.stream' : 'http');
  if (status >= 500) {
    console.error(JSON.stringify({
      event: 'backend_error',
      ...safeError(error, {
        requestId: req.requestId,
        action,
        phase: error?.phase || error?.details?.phase || (req.path === '/api/media/stream' ? 'media' : 'handler'),
      }),
    }));
  } else console.warn(`[${req.requestId || 'sin-id'}][${error.code || 'REQUEST_ERROR'}] ${error.message}`);

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
