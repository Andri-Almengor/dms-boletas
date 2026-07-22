import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import './services/ticket-visibility.patch.js';
import './services/maintenance-evidence-permissions.patch.js';
import './services/maintenance-ticket-work-time.patch.js';
import './services/metrics-assigned-hours.patch.js';
import { env } from './config/env.js';
import { dispatchAction } from './core/action-router.js';
import { AppError } from './core/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../dist');

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(cors({
  origin: env.frontendOrigin === '*'
    ? true
    : env.frontendOrigin.split(',').map((value) => value.trim()).filter(Boolean),
  credentials: false,
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.text({ type: ['text/plain', 'application/javascript'], limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dms-boletas-backend', time: new Date().toISOString() });
});

app.post('/api/action', async (req, res, next) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requestOrigin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    const data = await dispatchAction({
      route: body.route || body.action,
      payload: body.payload || {},
      sessionToken: body.sessionToken || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '',
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      origin: requestOrigin,
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

if (env.isProduction) {
  app.use(express.static(distPath, {
    maxAge: '1h',
    index: false,
    setHeaders(response, filePath) {
      if (filePath.endsWith('sw.js')) response.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
});

app.use((error, _req, res, _next) => {
  const status = error.status || error.statusCode || (error instanceof AppError ? error.status : 500);
  const isExpected = error instanceof AppError;
  if (status >= 500) console.error(error);
  else console.warn(`[${error.code || 'REQUEST_ERROR'}] ${error.message}`);

  res.status(status).json({
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: isExpected ? error.message : (status >= 500 ? 'Ocurrió un error interno en el servidor.' : error.message),
      details: isExpected ? error.details || null : null,
    },
  });
});
