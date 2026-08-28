import crypto from 'node:crypto';
import { Router } from 'express';
import { wakeScheduledMaintenanceFinalizations } from '../services/maintenance-finalization-schedule.patch.js';

export const maintenanceFinalizationWorkerRouter = Router();

function clean(value) {
  return String(value ?? '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

maintenanceFinalizationWorkerRouter.post('/wake', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const configuredSecret = clean(process.env.MAINTENANCE_FINALIZATION_WAKE_SECRET);
    if (!configuredSecret) {
      return res.status(503).json({
        ok: false,
        error: {
          code: 'FINALIZATION_WAKE_NOT_CONFIGURED',
          message: 'El worker de finalización programada todavía no tiene configurado su secreto.',
        },
      });
    }

    const suppliedSecret = req.get('x-dms-worker-secret') || req.body?.secret || '';
    if (!safeEqual(suppliedSecret, configuredSecret)) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'FINALIZATION_WAKE_UNAUTHORIZED',
          message: 'No autorizado.',
        },
      });
    }

    const requestedWait = Number(req.body?.waitMs ?? 25_000);
    const waitMs = Number.isFinite(requestedWait)
      ? Math.max(0, Math.min(45_000, requestedWait))
      : 25_000;
    const data = await wakeScheduledMaintenanceFinalizations({
      waitMs,
      source: clean(req.body?.source) || 'APPS_SCRIPT',
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});
