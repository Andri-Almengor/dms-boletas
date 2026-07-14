import http from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { concurrencyMiddleware, concurrencySnapshot } from './middleware/concurrency.middleware.js';

function mb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function sendHealth(res) {
  const memory = process.memoryUsage();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    service: 'dms-boletas-backend',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      heapTotalMb: mb(memory.heapTotal),
    },
    concurrency: concurrencySnapshot(),
  }));
}

function requestHandler(req, res) {
  if (String(req.url || '').startsWith('/api/health')) {
    sendHealth(res);
    return;
  }

  concurrencyMiddleware(req, res, (error) => {
    if (!error) {
      app(req, res);
      return;
    }

    res.statusCode = Number(error.status || 503);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '2');
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
});

function shutdown(signal) {
  console.log(`${signal}: cerrando servidor...`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(1);
  }, env.shutdownGraceMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
