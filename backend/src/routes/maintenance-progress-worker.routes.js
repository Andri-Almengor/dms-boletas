import crypto from 'node:crypto';
import { Router } from 'express';
import { sendScheduledMaintenanceProgressForSlot } from '../services/maintenance-progress-chat.service.js';

export const maintenanceProgressWorkerRouter = Router();

function clean(value) {
  return String(value ?? '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

maintenanceProgressWorkerRouter.post('/wake', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    // Se reutiliza el secreto del worker de mantenimientos ya configurado en
    // Render y Apps Script; no se introduce una segunda credencial operativa.
    const configuredSecret = clean(process.env.MAINTENANCE_FINALIZATION_WAKE_SECRET);
    if (!configuredSecret) {
      return res.status(503).json({
        ok: false,
        error: {
          code: 'MAINTENANCE_PROGRESS_WAKE_NOT_CONFIGURED',
          message: 'El worker de recordatorios de mantenimiento todavía no tiene configurado su secreto.',
        },
      });
    }

    const suppliedSecret = req.get('x-dms-worker-secret') || req.body?.secret || '';
    if (!safeEqual(suppliedSecret, configuredSecret)) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'MAINTENANCE_PROGRESS_WAKE_UNAUTHORIZED',
          message: 'No autorizado.',
        },
      });
    }

    const data = await sendScheduledMaintenanceProgressForSlot({
      slot: clean(req.body?.slot),
      now: new Date(),
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});
