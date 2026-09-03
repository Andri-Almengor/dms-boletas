import express from 'express';
import { dispatchAction } from '../core/action-router.js';
import { AppError, badRequest } from '../core/errors.js';
import { actionRateLimitMiddleware } from '../middleware/security.middleware.js';
import { recordApiActivityFromToken } from '../services/activity-log.service.js';
import { runWithActionConcurrency } from '../services/action-concurrency.service.js';
import { runWithActionSingleFlight } from '../services/action-single-flight.service.js';
import { runWithSheetsRouteReadCache } from '../services/sheets-route-read-cache.patch.js';

const MAX_METADATA_HEADER_CHARS = 24_000;
const BINARY_BODY_LIMIT = '32mb';

const ALLOWED_BINARY_ROUTES = new Set([
  'boletas.evidence.upload',
  'tickets.evidence.upload',
  'maintenance.images.upload',
  'mantenimientos.imagenes.upload',
  'boletas.evidence.large.chunk',
  'tickets.evidence.large.chunk',
  'maintenance.images.large.chunk',
  'mantenimientos.imagenes.grande.bloque',
]);

const BASE64_ONLY_ROUTES = new Set([
  'boletas.evidence.large.chunk',
  'tickets.evidence.large.chunk',
  'maintenance.images.large.chunk',
  'mantenimientos.imagenes.grande.bloque',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function parseMetadataHeader(value) {
  const encoded = clean(value);
  if (!encoded) return {};
  if (encoded.length > MAX_METADATA_HEADER_CHARS) {
    throw badRequest('Los metadatos de la carga binaria son demasiado grandes.');
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('metadata-not-object');
    }
    return parsed;
  } catch {
    throw badRequest('Los metadatos de la carga binaria no son válidos.');
  }
}

function prepareBinaryEnvelope(req, _res, next) {
  try {
    const route = clean(req.get('x-dms-route'));
    if (!ALLOWED_BINARY_ROUTES.has(route)) {
      throw new AppError('BINARY_ROUTE_NOT_ALLOWED', 'La ruta solicitada no admite carga binaria.', 400);
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw badRequest('El archivo enviado no contiene datos.');
    }

    const metadata = parseMetadataHeader(req.get('x-dms-payload'));
    req.binaryUpload = {
      route,
      metadata,
      buffer: req.body,
    };
    req.actionEnvelope = { route, payload: metadata, sessionToken: '' };
    next();
  } catch (error) {
    next(error);
  }
}

function payloadWithBinary(route, metadata, buffer) {
  return {
    ...metadata,
    // Las cargas normales pueden reutilizar uploadBase64(), que acepta Buffer.
    // Los bloques reanudables mantienen temporalmente su contrato Base64 interno;
    // la conversión ocurre en el servidor y ya no viaja por la red.
    base64: BASE64_ONLY_ROUTES.has(route) ? buffer.toString('base64') : buffer,
  };
}

function activityPayload(metadata, buffer) {
  return {
    ...metadata,
    binaryUpload: true,
    binaryBytes: Number(buffer?.length || 0),
  };
}

export const binaryUploadRouter = express.Router();

binaryUploadRouter.post(
  '/',
  express.raw({ type: 'application/octet-stream', limit: BINARY_BODY_LIMIT }),
  prepareBinaryEnvelope,
  actionRateLimitMiddleware,
  async (req, res, next) => {
    const startedAt = Date.now();
    const route = req.binaryUpload?.route || '';
    const metadata = req.binaryUpload?.metadata || {};
    const buffer = req.binaryUpload?.buffer;
    const sessionToken = clean(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
    const loggedPayload = activityPayload(metadata, buffer);

    try {
      res.setHeader('Cache-Control', 'no-store');
      const requestOrigin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
      const payload = payloadWithBinary(route, metadata, buffer);
      const execute = () => runWithSheetsRouteReadCache(route, () => (
        runWithActionConcurrency(route, () => dispatchAction({
          route,
          payload,
          sessionToken,
          ip: req.ip,
          userAgent: req.get('user-agent') || '',
          origin: requestOrigin,
        }))
      ));
      const data = await runWithActionSingleFlight({
        route,
        payload: loggedPayload,
        sessionToken,
      }, execute);

      void recordApiActivityFromToken({
        sessionToken,
        route,
        payload: loggedPayload,
        data,
        startedAt,
        endedAt: Date.now(),
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      });

      res.json({ ok: true, data });
    } catch (error) {
      if (route && sessionToken) {
        void recordApiActivityFromToken({
          sessionToken,
          route,
          payload: loggedPayload,
          error,
          startedAt,
          endedAt: Date.now(),
          ip: req.ip,
          userAgent: req.get('user-agent') || '',
        });
      }
      next(error);
    }
  },
);
