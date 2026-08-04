import 'dotenv/config';

function required(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function optional(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function optionalNumber(name, fallback, minimum = 0) {
  const value = Number(optional(name, String(fallback)));
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function optionalBoolean(name, fallback = false) {
  const value = optional(name, fallback ? 'true' : 'false').toLowerCase();
  if (['1', 'true', 'yes', 'si', 'sí'].includes(value)) return true;
  if (['0', 'false', 'no'].includes(value)) return false;
  return fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

export const env = Object.freeze({
  nodeEnv,
  port: Number(optional('PORT', '10000')),
  sheetId: required('GOOGLE_SHEET_ID', '11u44CTxL2KWqwezF_p3Kkc4OoB71BKsQwIh-NLRFgm4'),
  googleClientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  googlePrivateKey: required('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
  sessionHours: Number(optional('SESSION_HOURS', '12')),

  // Caché y coalescencia de lecturas. Los cambios realizados por esta misma
  // aplicación actualizan la caché inmediatamente. Los cambios externos
  // (por ejemplo AppSheet) pueden tardar hasta este TTL en reflejarse.
  sheetsCacheTtlMs: optionalNumber('SHEETS_CACHE_TTL_MS', 120_000),
  sheetsBatchWindowMs: optionalNumber('SHEETS_BATCH_WINDOW_MS', 40),
  sheetsForceCoalesceMs: optionalNumber('SHEETS_FORCE_COALESCE_MS', 5_000),

  // Reintentos del repositorio ante 429/RESOURCE_EXHAUSTED.
  sheetsQuotaRetries: optionalNumber('SHEETS_QUOTA_RETRIES', 6),
  sheetsQuotaBackoffMs: optionalNumber('SHEETS_QUOTA_BACKOFF_MS', 1_200, 100),
  sheetsQuotaMaxBackoffMs: optionalNumber('SHEETS_QUOTA_MAX_BACKOFF_MS', 45_000, 1_000),

  // Reintentos externos para fallos transitorios de lectura que Gaxios ya no
  // pudo recuperar: HTTP 5xx, backendError, timeouts y cortes de transporte.
  // Se mantienen separados de los 429 para no duplicar el backoff de cuota.
  sheetsTransientRetries: optionalNumber('SHEETS_TRANSIENT_RETRIES', 2),
  sheetsTransientBackoffMs: optionalNumber('SHEETS_TRANSIENT_BACKOFF_MS', 800, 100),
  sheetsTransientMaxBackoffMs: optionalNumber('SHEETS_TRANSIENT_MAX_BACKOFF_MS', 8_000, 500),

  // Límite conservador del repositorio. 1.5 s deja margen frente al límite
  // de 60 escrituras por minuto de la cuenta de servicio.
  sheetsMaxConcurrentWrites: optionalNumber('SHEETS_MAX_CONCURRENT_WRITES', 1, 1),
  sheetsWriteMinIntervalMs: optionalNumber('SHEETS_WRITE_MIN_INTERVAL_MS', 1_500, 0),

  // Protección global: también cubre llamadas directas a sheetsApi que no
  // pasan por sheets.repository.js (reportes, migraciones y módulos antiguos).
  sheetsGlobalMaxConcurrentReads: optionalNumber('SHEETS_GLOBAL_MAX_CONCURRENT_READS', 2, 1),
  sheetsGlobalReadMinIntervalMs: optionalNumber('SHEETS_GLOBAL_READ_MIN_INTERVAL_MS', 250, 0),
  sheetsGlobalMaxConcurrentWrites: optionalNumber('SHEETS_GLOBAL_MAX_CONCURRENT_WRITES', 1, 1),
  sheetsGlobalWriteMinIntervalMs: optionalNumber('SHEETS_GLOBAL_WRITE_MIN_INTERVAL_MS', 1_500, 0),
  sheetsGlobalReadCacheMs: optionalNumber('SHEETS_GLOBAL_READ_CACHE_MS', 15_000, 0),
  sheetsGlobalReadStaleMs: optionalNumber('SHEETS_GLOBAL_READ_STALE_MS', 5 * 60_000, 0),

  // Los límites siguientes son por solicitud, no por mantenimiento. El total
  // de dispositivos y evidencias permanece abierto; el cliente divide el
  // trabajo automáticamente en todos los lotes que sean necesarios.
  maintenanceImageBatchMaxFiles: optionalNumber('MAINTENANCE_IMAGE_BATCH_MAX_FILES', 20, 1),
  maintenanceImageBatchMaxBase64Chars: optionalNumber('MAINTENANCE_IMAGE_BATCH_MAX_BASE64_CHARS', 22_000_000, 1_000_000),
  maintenanceImageMetadataBatchMaxItems: optionalNumber('MAINTENANCE_IMAGE_METADATA_BATCH_MAX_ITEMS', 100, 1),
  maintenanceImageUploadConcurrency: optionalNumber('MAINTENANCE_IMAGE_UPLOAD_CONCURRENCY', 3, 1),

  // Auditoría no bloqueante. Varias filas se agregan con una sola escritura.
  auditFlushMs: optionalNumber('AUDIT_FLUSH_MS', 5_000, 500),
  auditBatchSize: optionalNumber('AUDIT_BATCH_SIZE', 100, 1),
  auditMaxBufferedRows: optionalNumber('AUDIT_MAX_BUFFERED_ROWS', 2_000, 100),

  httpMaxConcurrentRequests: optionalNumber('HTTP_MAX_CONCURRENT_REQUESTS', 40, 1),
  httpMaxConcurrentLargeRequests: optionalNumber('HTTP_MAX_CONCURRENT_LARGE_REQUESTS', 2, 1),
  httpQueueLimit: optionalNumber('HTTP_QUEUE_LIMIT', 100, 0),
  httpQueueTimeoutMs: optionalNumber('HTTP_QUEUE_TIMEOUT_MS', 15000, 1000),
  httpLargeRequestBytes: optionalNumber('HTTP_LARGE_REQUEST_BYTES', 1000000, 1024),
  heavyActionMaxConcurrent: optionalNumber('HEAVY_ACTION_MAX_CONCURRENT', 1, 1),
  writeActionMaxConcurrent: optionalNumber('WRITE_ACTION_MAX_CONCURRENT', 2, 1),
  serverKeepAliveTimeoutMs: optionalNumber('SERVER_KEEP_ALIVE_TIMEOUT_MS', 65000, 1000),
  serverHeadersTimeoutMs: optionalNumber('SERVER_HEADERS_TIMEOUT_MS', 66000, 2000),
  serverRequestTimeoutMs: optionalNumber('SERVER_REQUEST_TIMEOUT_MS', 360000, 10000),
  shutdownGraceMs: optionalNumber('SHUTDOWN_GRACE_MS', 15000, 1000),

  // Protección HTTP. Los valores predeterminados dejan margen para el uso
  // normal de técnicos y limitan abuso automatizado de rutas públicas.
  securityLoginRateLimitMax: optionalNumber('SECURITY_LOGIN_RATE_LIMIT_MAX', 30, 1),
  securityLoginRateLimitWindowMs: optionalNumber('SECURITY_LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60_000, 1_000),
  securityPublicWriteRateLimitMax: optionalNumber('SECURITY_PUBLIC_WRITE_RATE_LIMIT_MAX', 60, 1),
  securityPublicWriteRateLimitWindowMs: optionalNumber('SECURITY_PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS', 15 * 60_000, 1_000),
  securityPublicReadRateLimitMax: optionalNumber('SECURITY_PUBLIC_READ_RATE_LIMIT_MAX', 300, 1),
  securityPublicReadRateLimitWindowMs: optionalNumber('SECURITY_PUBLIC_READ_RATE_LIMIT_WINDOW_MS', 5 * 60_000, 1_000),
  securityActionRateLimitMax: optionalNumber('SECURITY_ACTION_RATE_LIMIT_MAX', 900, 1),
  securityActionRateLimitWindowMs: optionalNumber('SECURITY_ACTION_RATE_LIMIT_WINDOW_MS', 60_000, 1_000),
  securityRateLimitMaxBuckets: optionalNumber('SECURITY_RATE_LIMIT_MAX_BUCKETS', 10_000, 100),
  securityMaxSessionTokenLength: optionalNumber('SECURITY_MAX_SESSION_TOKEN_LENGTH', 1_024, 128),
  securityPayloadMaxDepth: optionalNumber('SECURITY_PAYLOAD_MAX_DEPTH', 24, 5),
  securityPayloadMaxKeys: optionalNumber('SECURITY_PAYLOAD_MAX_KEYS', 50_000, 100),
  healthDetailsPublic: optionalBoolean('HEALTH_DETAILS_PUBLIC', !isProduction),

  frontendOrigin: optional('FRONTEND_ORIGIN', '*'),
  appPublicUrl: optional('APP_PUBLIC_URL'),
  smtpHost: optional('SMTP_HOST'),
  smtpPort: Number(optional('SMTP_PORT', '587')),
  smtpSecure: optional('SMTP_SECURE', 'false').toLowerCase() === 'true',
  smtpUser: optional('SMTP_USER'),
  smtpPass: optional('SMTP_PASS'),
  smtpFrom: optional('SMTP_FROM', 'DMS Boletas <no-reply@localhost>'),
  chatWebhook: optional('GOOGLE_CHAT_WEBHOOK'),
  isProduction,
});
