import { bootId, logRuntime, safeError, startDiagnostics } from './core/runtime-diagnostics.js';
import http from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { resolveRequestId } from './core/request-security.js';
import { concurrencyMiddleware, concurrencySnapshot } from './middleware/concurrency.middleware.js';
import { securityRateLimitSnapshot } from './middleware/security.middleware.js';
import { closePostgres, postgresSnapshot, query } from './infra/postgres.js';
import { googleSheetsGateSnapshot } from './infra/google.js';
import { auditQueueSnapshot, flushAuditQueue } from './services/audit.service.js';
import { actionConcurrencySnapshot } from './services/action-concurrency.service.js';
import { agendaNotificationQueueSnapshot, drainAgendaNotificationQueue } from './services/agenda-notification-queue.service.js';
import { startMaintenanceProgressScheduler, stopMaintenanceProgressScheduler } from './services/maintenance-progress-chat.service.js';
import { startWeeklyBackupScheduler, stopWeeklyBackupScheduler } from './services/weekly-backup.service.js';

function mb(value) { return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10; }

function sendHealth(req, res) {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const body = { ok: true, bootId, uptimeSeconds: Math.round(process.uptime()), service: 'dms-boletas-backend', time: new Date().toISOString() };
  if (env.healthDetailsPublic) {
    const memory = process.memoryUsage();
    body.memory = { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal) };
    body.concurrency = concurrencySnapshot();
    body.actions = actionConcurrencySnapshot();
    body.database = postgresSnapshot();
    body.googleSheets = googleSheetsGateSnapshot();
    body.audit = auditQueueSnapshot();
    body.security = securityRateLimitSnapshot();
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
  if (requestPath === '/api/health') return sendHealth(req, res);
  const method = String(req.method || 'GET').toUpperCase();
  if (!requestPath.startsWith('/api/') && (method === 'GET' || method === 'HEAD')) return app(req, res);
  concurrencyMiddleware(req, res, (error) => {
    if (!error) return app(req, res);
    const requestId = resolveRequestId(req.headers['x-request-id']);
    res.statusCode = Number(error.status || 503);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '2');
    res.setHeader('X-Request-ID', requestId);
    res.end(JSON.stringify({ ok: false, error: { code: error.code || 'SERVER_BUSY', message: error.message || 'El servidor está ocupado. Intente nuevamente.' } }));
  });
}

const server = http.createServer(requestHandler);
server.keepAliveTimeout = env.serverKeepAliveTimeoutMs;
server.headersTimeout = Math.max(env.serverHeadersTimeoutMs, server.keepAliveTimeout + 1000);
server.requestTimeout = env.serverRequestTimeoutMs;
server.maxRequestsPerSocket = 1000;
let shuttingDown = false;

const startupRss = process.memoryUsage().rss;
try {
  await query('SELECT schema_version FROM sync_state WHERE singleton=TRUE', [], { label: 'startup.health' });
  await query(
    'SELECT "SizeBytes","IsPrimary","ExtractionStatus","Status" FROM "KnowledgeAttachments" LIMIT 0',
    [],
    { label: 'startup.knowledge_schema' },
  );
  logRuntime('postgres_ready', {}, { rssDeltaBytes: process.memoryUsage().rss - startupRss });
} catch (error) {
  logRuntime('postgres_failed', {}, { error: safeError(error) });
  await closePostgres().catch(() => {});
  throw new Error('PostgreSQL no está disponible o las migraciones no fueron aplicadas.');
}

server.listen(env.port, '0.0.0.0', () => {
  console.log(`DMS backend escuchando en el puerto ${env.port}`);
  console.log(`Concurrencia HTTP: ${env.httpMaxConcurrentRequests}; pool PostgreSQL: ${env.pgPoolMax}`);
  if (env.isProduction && env.frontendOrigin === '*') console.warn('FRONTEND_ORIGIN permite cualquier origen. Configure una lista explícita para endurecer CORS en producción.');
  if (!shuttingDown) {
    startMaintenanceProgressScheduler();
    startWeeklyBackupScheduler();
  }
});

const stopDiagnostics = startDiagnostics(() => ({
  concurrency: concurrencySnapshot(), actions: actionConcurrencySnapshot(),
  database: postgresSnapshot(), googleSheets: googleSheetsGateSnapshot(), audit: auditQueueSnapshot(),
  agenda: agendaNotificationQueueSnapshot(),
}));

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logRuntime('runtime_shutdown', {}, { signal, exitCode });
  stopDiagnostics();
  stopMaintenanceProgressScheduler();
  stopWeeklyBackupScheduler();
  server.close(async () => {
    const queueWaitMs = Math.max(1_000, Math.min(10_000, env.shutdownGraceMs - 1_000));
    const notificationsDrained = await drainAgendaNotificationQueue(queueWaitMs).catch(() => false);
    if (!notificationsDrained) console.warn('El cierre continuó con notificaciones de Agenda todavía pendientes; podrán reenviarse desde el detalle.');
    await flushAuditQueue().catch(() => {});
    await closePostgres().catch(() => {});
    process.exit(exitCode);
  });
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    void closePostgres().finally(() => process.exit(1));
  }, env.shutdownGraceMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('warning', (error) => logRuntime('runtime_warning', {}, { error: safeError(error) }));
process.on('uncaughtException', (error) => {
  logRuntime('runtime_uncaught_exception', {}, { error: safeError(error) });
  server.closeAllConnections?.();
  void closePostgres().finally(() => process.exit(1));
});
process.on('unhandledRejection', (error) => {
  logRuntime('runtime_unhandled_rejection', {}, { error: safeError(error) });
  shutdown('unhandledRejection', 1);
});
