import express from 'express';
import { AppError, forbidden } from '../core/errors.js';
import { authenticate } from '../services/auth.service.js';
import { audit } from '../services/audit.service.js';
import {
  authenticateIntegrationGateway,
  completeIntegrationCommand,
  createIntegrationCommand,
  integrationGatewayOverview,
  pollIntegrationCommands,
  provisionIntegrationGateway,
  recordIntegrationGatewayHeartbeat,
  revokeIntegrationGateway,
  syncIntegrationInventory,
} from '../services/integration-gateway.service.js';

const AGENT_RATE_LIMIT = 300;
const AGENT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2_000;
const rateBuckets = new Map();

function bearerToken(req) {
  return String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function requestContext(req, auth) {
  return {
    user: auth?.user,
    permissions: auth?.permissions || [],
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

function pruneRateBuckets(now) {
  for (const [key, bucket] of rateBuckets.entries()) {
    if (now - bucket.startedAt >= AGENT_RATE_WINDOW_MS) rateBuckets.delete(key);
  }
  if (rateBuckets.size <= MAX_RATE_BUCKETS) return;
  [...rateBuckets.entries()]
    .sort((a, b) => a[1].startedAt - b[1].startedAt)
    .slice(0, rateBuckets.size - MAX_RATE_BUCKETS)
    .forEach(([key]) => rateBuckets.delete(key));
}

function agentRateLimit(req, _res, next) {
  const now = Date.now();
  const gatewayId = String(req.get('x-dms-gateway-id') || '').trim();
  const key = `${req.ip}|${gatewayId || 'unknown'}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= AGENT_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > AGENT_RATE_LIMIT) {
    next(new AppError(
      'INTEGRATION_GATEWAY_RATE_LIMIT',
      'El gateway está enviando demasiadas solicitudes. Espere unos segundos.',
      429,
      { retryAfterSeconds: Math.max(1, Math.ceil((AGENT_RATE_WINDOW_MS - (now - bucket.startedAt)) / 1_000)) },
    ));
    return;
  }
  if (rateBuckets.size > MAX_RATE_BUCKETS) pruneRateBuckets(now);
  next();
}

async function requireAdmin(req) {
  const auth = await authenticate(bearerToken(req));
  if (!auth.permissions.includes('USUARIOS_GESTIONAR')) throw forbidden();
  return auth;
}

async function requireGateway(req) {
  return authenticateIntegrationGateway({
    gatewayId: req.get('x-dms-gateway-id'),
    token: bearerToken(req),
  });
}

function route(handler) {
  return async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const data = await handler(req, res);
      if (!res.headersSent) res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  };
}

export const integrationGatewayRouter = express.Router();

integrationGatewayRouter.get('/admin/overview', route(async (req) => {
  await requireAdmin(req);
  return integrationGatewayOverview();
}));

integrationGatewayRouter.post('/admin/provision', route(async (req) => {
  const auth = await requireAdmin(req);
  const result = await provisionIntegrationGateway({
    name: req.body?.name,
    clientId: req.body?.clientId,
    clientName: req.body?.clientName,
    actor: auth.user.UsuarioID,
  });
  await audit(
    requestContext(req, auth),
    'PROVISIONAR_GATEWAY_INTEGRACION',
    'IntegracionGateways',
    result.gateway.GatewayID,
    null,
    result.gateway,
  );
  return result;
}));

integrationGatewayRouter.post('/admin/revoke', route(async (req) => {
  const auth = await requireAdmin(req);
  const result = await revokeIntegrationGateway(req.body?.gatewayId, auth.user.UsuarioID);
  await audit(
    requestContext(req, auth),
    'REVOCAR_GATEWAY_INTEGRACION',
    'IntegracionGateways',
    result.GatewayID,
    null,
    result,
  );
  return result;
}));

integrationGatewayRouter.post('/admin/commands', route(async (req) => {
  const auth = await requireAdmin(req);
  const result = await createIntegrationCommand({
    gatewayId: req.body?.gatewayId,
    type: req.body?.type,
    payload: req.body?.payload,
    actor: auth.user.UsuarioID,
  });
  await audit(
    requestContext(req, auth),
    'CREAR_COMANDO_GATEWAY',
    'IntegracionComandos',
    result.ComandoID,
    null,
    {
      GatewayID: result.GatewayID,
      Tipo: result.Tipo,
      Estado: result.Estado,
    },
  );
  return result;
}));

integrationGatewayRouter.use(agentRateLimit);

integrationGatewayRouter.post('/heartbeat', route(async (req) => {
  const gateway = await requireGateway(req);
  return recordIntegrationGatewayHeartbeat(gateway, req.body || {});
}));

integrationGatewayRouter.post('/inventory', route(async (req) => {
  const gateway = await requireGateway(req);
  return syncIntegrationInventory(gateway, req.body?.items || []);
}));

integrationGatewayRouter.post('/commands/poll', route(async (req) => {
  const gateway = await requireGateway(req);
  return pollIntegrationCommands(gateway);
}));

integrationGatewayRouter.post('/commands/result', route(async (req) => {
  const gateway = await requireGateway(req);
  return completeIntegrationCommand(gateway, req.body || {});
}));
