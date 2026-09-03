import http from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { resolveRequestId } from './core/request-security.js';
import { concurrencyMiddleware, concurrencySnapshot } from './middleware/concurrency.middleware.js';
import { securityRateLimitSnapshot } from './middleware/security.middleware.js';
import { readTables } from './infra/sheets.repository.js';
import { googleSheetsGateSnapshot } from './infra/google.js';
import { auditQueueSnapshot, flushAuditQueue } from './services/audit.service.js';
import { actionConcurrencySnapshot } from './services/action-concurrency.service.js';
import {
  agendaNotificationQueueSnapshot,
  drainAgendaNotificationQueue,
} from './services/agenda-notification-queue.service.js';
import {
  startMaintenanceProgressScheduler,
  stopMaintenanceProgressScheduler,
} from './services/maintenance-progress-chat.service.js';
import { uploadPressureSnapshot } from './services/upload-pressure.service.js';
import {
  startWeeklyBackupScheduler,
  stopWeeklyBackupScheduler,
} from './services/weekly-backup.service.js';

function mb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function sendHealth(req, res) {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const body = {
    ok: true,
    service: 'dms-boletas-backend',
    time: new Date().toISOString(),
  };

  if (env.healthDetailsPublic) {
    const memory = process.memoryUsage();
    body.uptimeSeconds = Math.round(process.uptime());
    body.memory = {
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      heapTotalMb: mb(memory.heapTotal),
    };
    body.concurrency = concurrencySnapshot();
    body.actions = actionConcurrencySnapshot();
    body.sheets = googleSheetsGateSnapshot();
    body.audit = auditQueueSnapshot();
    body.security = securityRateLimitSnapshot();
    body.uploads = uploadPressureSnapshot();
    body.agendaNotifications = agendaNotificationQueueSnapshot();
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function requestHandler(req, res) {
  const requestPath = String(req.url || '').split('?', 1)[0];
  if (requestPath === '/api/health') {
    sendHealth(req, res);
    return;
  }

  concurrencyMiddleware(req, res, (error) => {
    if (!error) {
      app(req, res);
      return;
    }

    const requestId = resolveRequestId(req.headers['x-request-id']);
    res.statusCode = Number(error.status || 503);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '2');
    res.setHeader('X-Request-ID', requestId);
    res.end(JSON.stringify({
      ok: false,
      error: {
        code: error.code || 'SERVER_BUSY',
        message: error.message || 'El servidor está ocupado. Intente nuevamente.',
      },
    }));
  });
}

const server = http.createServer(requestHandler);
server.keepAliveTimeout = env.serverKeepAliveTimeoutMs;
server.headersTimeout = Math.max(env.serverHeadersTimeoutMs, server.keepAliveTimeout + 1000);
server.requestTimeout = env.serverRequestTimeoutMs;
server.maxRequestsPerSocket = 1000;

server.listen(env.port, '0.0.0.0', () => {
  console.log(`DMS backend escuchando en el puerto ${env.port}`);
  console.log(`Concurrencia HTTP: ${env.httpMaxConcurrentRequests}; solicitudes grandes: ${env.httpMaxConcurrentLargeRequests}`);
  if (env.isProduction && env.frontendOrigin === '*') {
    console.warn('FRONTEND_ORIGIN permite cualquier origen. Configure una lista explícita para endurecer CORS en producción.');
  }

  startMaintenanceProgressScheduler();
  startWeeklyBackupScheduler();

  // Una sola lectura batch prepara autenticación, permisos y catálogos antes
  // de que varios técnicos abran la aplicación al mismo tiempo después de un
  // reinicio de Render. No bloquea el arranque ni el health check.
  setTimeout(() => {
    readTables([
      'Sesiones',
      'Usuarios',
      'Roles',
      'Permisos',
      'RolPermisos',
      'UsuarioPermisos',
      'Clientes',
      'ClienteUbicaciones',
      'ClienteUbicacionesEquipo',
      'ClienteContactos',
      'Categorias',
      'TiposDispositivo',
      'Fabricantes',
      'Modelos',
      'TiposFalla',
      'TipoDispositivoFabricantes',
    ]).then(() => {
      console.log('Caché crítica de Sheets precargada correctamente.');
    }).catch((error) => {
      console.warn(`No se pudo precargar la caché de Sheets: ${error.message}`);
    });
  }, 750).unref?.();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: cerrando servidor...`);
  stopMaintenanceProgressScheduler();
  stopWeeklyBackupScheduler();

  server.close(async () => {
    const queueWaitMs = Math.max(1_000, Math.min(10_000, env.shutdownGraceMs - 1_000));
    const notificationsDrained = await drainAgendaNotificationQueue(queueWaitMs).catch(() => false);
    if (!notificationsDrained) {
      console.warn('El cierre continuó con notificaciones de Agenda todavía pendientes; podrán reenviarse desde el detalle.');
    }
    await flushAuditQueue().catch(() => {});
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(async () => {
    await flushAuditQueue().catch(() => {});
    server.closeAllConnections?.();
    process.exit(1);
  }, env.shutdownGraceMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
