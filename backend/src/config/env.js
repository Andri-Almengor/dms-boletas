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

export const env = Object.freeze({
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '10000')),
  sheetId: required('GOOGLE_SHEET_ID', '11u44CTxL2KWqwezF_p3Kkc4OoB71BKsQwIh-NLRFgm4'),
  googleClientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  googlePrivateKey: required('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
  sessionHours: Number(optional('SESSION_HOURS', '12')),
  sheetsCacheTtlMs: optionalNumber('SHEETS_CACHE_TTL_MS', 15000),
  sheetsBatchWindowMs: optionalNumber('SHEETS_BATCH_WINDOW_MS', 5),
  sheetsQuotaRetries: optionalNumber('SHEETS_QUOTA_RETRIES', 4),
  sheetsQuotaBackoffMs: optionalNumber('SHEETS_QUOTA_BACKOFF_MS', 750, 100),
  frontendOrigin: optional('FRONTEND_ORIGIN', '*'),
  appPublicUrl: optional('APP_PUBLIC_URL'),
  smtpHost: optional('SMTP_HOST'),
  smtpPort: Number(optional('SMTP_PORT', '587')),
  smtpSecure: optional('SMTP_SECURE', 'false').toLowerCase() === 'true',
  smtpUser: optional('SMTP_USER'),
  smtpPass: optional('SMTP_PASS'),
  smtpFrom: optional('SMTP_FROM', 'DMS Boletas <no-reply@localhost>'),
  chatWebhook: optional('GOOGLE_CHAT_WEBHOOK'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
});