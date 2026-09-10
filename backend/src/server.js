import http from 'node:http';
import { randomUUID } from 'node:crypto';
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
import {
  startWeeklyBackupScheduler,
  stopWeeklyBackupScheduler,
} from './services/weekly-backup.service.js';

const bootId = randomUUID();
const releaseId = String(
  process.env.RENDER_GIT_COMMIT
  || process.env.COMMIT_SHA
  || process.env.RELEASE_SHA
  || 'unknown',
).slice(0, 80);
const AUTH_WARMUP_TABLES = Object.freeze([
  'Sesiones',
  'Usuarios',
  'Roles',
  'Permisos',
  'RolPermisos',
  'UsuarioPermisos',
]);
const SECONDARY_WARMUP_TABLES = Object.freeze([
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
]);

let startupSecondaryTimer = null;
let startupSchedulersTimer = null;
let memoryTelemetryTimer = null;
let lastTelemetryRss = 0;

function mb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers),
    rssBytes: memory.rss,
  };
}

function safeText(value, maxLength = 2000) {
  return String(value ?? '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, '[redacted-long-token]')
    .slice(0, maxLength);
}

function runtimeSnapshot() {
  const memory = memorySnapshot();
  return {
    bootId,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    release: releaseId,
    memory: {
      rssMb: memory.rssMb,
      heapUsedMb: memory.heapUsedMb,
      heapTotalMb: memory.heapTotalMb,
      externalMb: memory.externalMb,
      arrayBuffersMb: memory.arrayBuffersMb,
    },
    concurrency: concurrencySnapshot(),
    actions: actionConcurrencySnapshot(),
    sheets: googleSheetsGateSnapshot(),
    audit: auditQueueSnapshot(),
    agendaNotifications: agendaNotificationQueueSnapshot(),
  };
}

function logRuntimeSnapshot(kind = 'runtime') {
  const snapshot = runtimeSnapshot();
  const rssBytes = process.memoryUsage().rss;
  const significantSpike = lastTelemetryRss > 0
    && rssBytes - lastTelemetryRss >= env.memoryTelemetrySpikeBytes;
  lastTelemetryRss = rssBytes;
  console.log(`[${significantSpike ? 'runtime-spike' : kind}] ${JSON.stringify(snapshot)}`);
}

function sendHealth(req, res) {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const body = {
    ok: true,
    bootId,
    uptimeSeconds: Math.round(process.uptime()),
  };

  // Diagnóstico ampliado es solo opt-in. Todos los valores son snapshots en
  // memoria; health nunca espera Sheets, Drive, SMTP, Gemini ni Google Chat.
  if (env.healthDetailsPublic) {
    const memory = memorySnapshot();
    body.memory = {
      rssMb: memory.rssMb,
      heapUsedMb: memory.heapUsedMb,
      heapTotalMb: memory.heapTotalMb,
      externalMb: memory.externalMb,
      arrayBuffersMb: memory.arrayBuffersMb,
    };
    body.concurrency = concurrencySnapshot();
    body.actions = actionConcurrencySnapshot();
    body.sheets = googleSheetsGateSnapshot();
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

function warmTables(label, tables) {
  return readTables(tables).then(() => {
    console.log(`[warmup] ${label} completado: ${tables.length} tabla(s).`);
  }).catch((error) => {
    console.warn(`[warmup] ${label} falló sin bloquear disponibilidad: ${safeText(error?.message || error, 500)}`);
  });
}

function scheduleStartupRecovery() {
  // Fase 1: autenticación/autorización inmediatamente después de listen.
  // No se espera para aceptar health/login y no incluye catálogos secundarios.
  setImmediate(() => void warmTables('auth', AUTH_WARMUP_TABLES));

  // Fase 2 y schedulers están escalonados para evitar warmup + backup + Chat
  // simultáneos durante la tormenta de reconexión posterior a un cold start.
  const recoveryGraceMs = Math.max(0, Number(env.startupRecoveryGraceMs || 0));
  const secondaryDelayMs = Math.max(5_000, Math.floor(recoveryGraceMs / 2));
  startupSecondaryTimer = setTimeout(
    () => void warmTables('secondary', SECONDARY_WARMUP_TABLES),
    secondaryDelayMs,
  );
  startupSecondaryTimer.unref?.();

  startupSchedulersTimer = setTimeout(() => {
    startMaintenanceProgressScheduler();
    startWeeklyBackupScheduler({ initialDelayMs: 0 });
    console.log(`[startup] tareas programadas habilitadas después de ${recoveryGraceMs} ms de recuperación.`);
  }, recoveryGraceMs);
  startupSchedulersTimer.unref?.();
}

function startMemoryTelemetry() {
  const initial = memorySnapshot();
  lastTelemetryRss = initial.rssBytes;
  console.log(`[boot] ${JSON.stringify({
    bootId,
    pid: process.pid,
    node: process.version,
    timestamp: new Date().toISOString(),
    release: releaseId,
    memory: {
      rssMb: initial.rssMb,
      heapUsedMb: initial.heapUsedMb,
      heapTotalMb: initial.heapTotalMb,
      externalMb: initial.externalMb,
      arrayBuffersMb: initial.arrayBuffersMb,
    },
  })}`);

  memoryTelemetryTimer = setInterval(
    () => logRuntimeSnapshot('runtime'),
    Math.max(30_000, Number(env.memoryTelemetryIntervalMs || 60_000)),
  );
  memoryTelemetryTimer.unref?.();
}

server.listen(env.port, '0.0.0.0', () => {
  console.log(`DMS backend escuchando en el puerto ${env.port}`);
  console.log(`Concurrencia HTTP: ${env.httpMaxConcurrentRequests}; solicitudes grandes: ${env.httpMaxConcurrentLargeRequests}; cola grande: ${env.httpLargeQueueLimit}`);
  if (env.isProduction && env.frontendOrigin === '*') {
    console.warn('FRONTEND_ORIGIN permite cualquier origen. Configure una lista explícita para endurecer CORS en producción.');
  }
  startMemoryTelemetry();
  scheduleStartupRecovery();
});

let shuttingDown = false;
function shutdown(signal, { exitCode = 0 } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${safeText(signal, 120)} bootId=${bootId} uptime=${Math.round(process.uptime())}s exitCode=${exitCode}`);
  clearTimeout(startupSecondaryTimer);
  clearTimeout(startupSchedulersTimer);
  clearInterval(memoryTelemetryTimer);
  stopMaintenanceProgressScheduler();
  stopWeeklyBackupScheduler();

  server.close(async () => {
    const queueWaitMs = Math.max(1_000, Math.min(10_000, env.shutdownGraceMs - 1_000));
    const notificationsDrained = await drainAgendaNotificationQueue(queueWaitMs).catch(() => false);
    if (!notificationsDrained) {
      console.warn('El cierre continuó con notificaciones de Agenda todavía pendientes; podrán reenviarse desde el detalle.');
    }
    await flushAuditQueue().catch(() => {});
    process.exit(exitCode);
  });
  server.closeIdleConnections?.();
  setTimeout(async () => {
    await flushAuditQueue().catch(() => {});
    server.closeAllConnections?.();
    process.exit(exitCode || 1);
  }, env.shutdownGraceMs).unref();
}

function logFatal(kind, error) {
  const details = {
    bootId,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    kind,
    name: safeText(error?.name || 'Error', 120),
    message: safeText(error?.message || error, 1200),
    stack: safeText(error?.stack || '', 3000),
    runtime: runtimeSnapshot(),
  };
  console.error(`[fatal] ${JSON.stringify(details)}`);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logFatal('uncaughtException', error);
  shutdown('uncaughtException', { exitCode: 1 });
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(safeText(reason, 1200));
  logFatal('unhandledRejection', error);
  shutdown('unhandledRejection', { exitCode: 1 });
});
process.on('warning', (warning) => {
  console.warn(`[warning] ${JSON.stringify({
    bootId,
    name: safeText(warning?.name, 120),
    message: safeText(warning?.message, 1200),
    stack: safeText(warning?.stack, 2400),
  })}`);
});
