export function postgresSslConfig(mode = process.env.PG_SSL_MODE) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!normalized || ['disable', 'off', 'false', '0'].includes(normalized)) return undefined;
  if (['verify-full', 'verify', 'strict'].includes(normalized)) return { rejectUnauthorized: true };
  if (['require', 'on', 'true', '1'].includes(normalized)) return { rejectUnauthorized: false };
  throw new Error(`PG_SSL_MODE inválido: ${normalized}. Use disable, require o verify-full.`);
}
