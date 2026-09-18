import 'dotenv/config';

function required(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}
function optional(name, fallback = '') { return String(process.env[name] ?? fallback).trim(); }
function optionalNumber(name, fallback, minimum = 0) {
  const value = Number(optional(name, String(fallback)));
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
function optionalBoolean(name, fallback = false) {
  const value = optional(name, fallback ? 'true' : 'false').toLowerCase();
  if (['1','true','yes','si','sí'].includes(value)) return true;
  if (['0','false','no'].includes(value)) return false;
  return fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const pgPoolMax = optionalNumber('PG_POOL_MAX', 3, 1);
const configuredTestDatabaseUrl = optional('TEST_DATABASE_URL');
const databaseUrl = nodeEnv === 'test' && configuredTestDatabaseUrl
  ? configuredTestDatabaseUrl
  : required('DATABASE_URL');

export const env = Object.freeze({
  nodeEnv,
  port: Number(optional('PORT', '10000')),
  databaseUrl,
  testDatabaseUrl: configuredTestDatabaseUrl,
  pgPoolMax,
  pgIdleTimeoutMs: optionalNumber('PG_IDLE_TIMEOUT_MS', 30_000, 1_000),
  pgConnectionTimeoutMs: optionalNumber('PG_CONNECTION_TIMEOUT_MS', 8_000, 500),
  pgStatementTimeoutMs: optionalNumber('PG_STATEMENT_TIMEOUT_MS', 60_000, 1_000),
  pgSlowQueryMs: optionalNumber('PG_SLOW_QUERY_MS', 1_000, 50),

  // The former spreadsheet database identifier is intentionally absent from runtime persistence.
  // Database CLI commands must work with DATABASE_URL alone. Google credentials
  // are validated lazily by infra/google.js when Drive/Docs/Sheets reports are used.
  googleClientEmail: optional('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  googlePrivateKey: optional('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
  sessionHours: Number(optional('SESSION_HOURS', '12')),

  incrementalSyncEnabled: optionalBoolean('INCREMENTAL_SYNC_ENABLED', true),
  // v2 deliberately invalidates cursors/generation created by the former Sheets log once.
  syncSchemaVersion: optionalNumber('SYNC_SCHEMA_VERSION', 2, 2),
  syncDeltaMaxEvents: optionalNumber('SYNC_DELTA_MAX_EVENTS', 250, 1),
  syncDeltaSnapshotThreshold: optionalNumber('SYNC_DELTA_SNAPSHOT_THRESHOLD', 5_000, 100),
  syncBackgroundIntervalMs: optionalNumber('SYNC_BACKGROUND_INTERVAL_MS', 60_000, 15_000),
  syncIntegrityCheckMs: optionalNumber('SYNC_INTEGRITY_CHECK_MS', 15 * 60_000, 60_000),

  maintenanceImageBatchMaxFiles: optionalNumber('MAINTENANCE_IMAGE_BATCH_MAX_FILES', 20, 1),
  maintenanceImageBatchMaxBase64Chars: optionalNumber('MAINTENANCE_IMAGE_BATCH_MAX_BASE64_CHARS', 22_000_000, 1_000_000),
  maintenanceImageMetadataBatchMaxItems: optionalNumber('MAINTENANCE_IMAGE_METADATA_BATCH_MAX_ITEMS', 100, 1),
  maintenanceImageUploadConcurrency: optionalNumber('MAINTENANCE_IMAGE_UPLOAD_CONCURRENCY', 3, 1),
  maintenanceProgressChatEnabled: optionalBoolean('MAINTENANCE_PROGRESS_CHAT_ENABLED', true),
  maintenanceProgressChatTimezone: optional('MAINTENANCE_PROGRESS_CHAT_TIMEZONE', 'America/Costa_Rica'),
  maintenanceProgressChatHours: optional('MAINTENANCE_PROGRESS_CHAT_HOURS', '7,17'),
  maintenanceProgressChatTickMs: optionalNumber('MAINTENANCE_PROGRESS_CHAT_TICK_MS', 30_000, 10_000),

  auditFlushMs: optionalNumber('AUDIT_FLUSH_MS', 5_000, 500),
  auditBatchSize: optionalNumber('AUDIT_BATCH_SIZE', 100, 1),
  auditMaxBufferedRows: optionalNumber('AUDIT_MAX_BUFFERED_ROWS', 2_000, 100),

  memoryBudgetMb: optionalNumber('MEMORY_BUDGET_MB', 512, 128),
  httpMaxConcurrentRequests: optionalNumber('HTTP_MAX_CONCURRENT_REQUESTS', Math.max(4, pgPoolMax), 2),
  httpMaxConcurrentLargeRequests: optionalNumber('HTTP_MAX_CONCURRENT_LARGE_REQUESTS', 1, 1),
  httpQueueLimit: optionalNumber('HTTP_QUEUE_LIMIT', Math.max(8, pgPoolMax * 2), 0),
  httpQueueTimeoutMs: optionalNumber('HTTP_QUEUE_TIMEOUT_MS', 15_000, 1_000),
  httpLargeRequestBytes: optionalNumber('HTTP_LARGE_REQUEST_BYTES', 1_000_000, 1024),
  heavyActionMaxConcurrent: optionalNumber('HEAVY_ACTION_MAX_CONCURRENT', 1, 1),
  writeActionMaxConcurrent: optionalNumber('WRITE_ACTION_MAX_CONCURRENT', 2, 1),
  serverKeepAliveTimeoutMs: optionalNumber('SERVER_KEEP_ALIVE_TIMEOUT_MS', 65_000, 1_000),
  serverHeadersTimeoutMs: optionalNumber('SERVER_HEADERS_TIMEOUT_MS', 66_000, 2_000),
  serverRequestTimeoutMs: optionalNumber('SERVER_REQUEST_TIMEOUT_MS', 360_000, 10_000),
  shutdownGraceMs: optionalNumber('SHUTDOWN_GRACE_MS', 15_000, 1_000),

  agendaNotificationMaxConcurrent: optionalNumber('AGENDA_NOTIFICATION_MAX_CONCURRENT', 1, 1),
  agendaNotificationQueueLimit: optionalNumber('AGENDA_NOTIFICATION_QUEUE_LIMIT', 100, 1),

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
