import express from 'express';
import { authenticate } from '../services/auth.service.js';
import { recordUiActivity } from '../services/activity-log.service.js';
import { buildActivityReport } from '../modules/activity-reports.module.js';

function tokenFromRequest(req) {
  return String(
    req.headers.authorization?.replace(/^Bearer\s+/i, '')
    || req.body?.sessionToken
    || '',
  ).trim();
}

function assertAdmin(auth) {
  if (!Array.isArray(auth?.permissions) || !auth.permissions.includes('USUARIOS_GESTIONAR')) {
    const error = new Error('Solo un administrador puede generar reportes de actividad.');
    error.code = 'FORBIDDEN';
    error.status = 403;
    throw error;
  }
}

export const activityReportRouter = express.Router();

activityReportRouter.post('/track', async (req, res, next) => {
  try {
    const auth = await authenticate(tokenFromRequest(req));
    const event = req.body?.event || req.body || {};
    const result = recordUiActivity(auth, event, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
});

activityReportRouter.post('/report', async (req, res, next) => {
  try {
    const auth = await authenticate(tokenFromRequest(req));
    assertAdmin(auth);
    const report = await buildActivityReport(req.body?.filters || req.body || {});
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data: report });
  } catch (error) {
    next(error);
  }
});
