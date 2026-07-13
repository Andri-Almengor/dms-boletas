import 'dotenv/config';

function required(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function optional(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

export const env = Object.freeze({
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '10000')),
  sheetId: required('GOOGLE_SHEET_ID', '11u44CTxL2KWqwezF_p3Kkc4OoB71BKsQwIh-NLRFgm4'),
  googleClientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  googlePrivateKey: required('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
  sessionHours: Number(optional('SESSION_HOURS', '12')),
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
