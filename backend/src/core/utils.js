import crypto from 'node:crypto';

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const asString = (value, fallback = '') => value === undefined || value === null ? fallback : String(value).trim();
export const asBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true','1','si','sí','yes','activo'].includes(String(value).trim().toLowerCase());
};
export const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return String(value).split(',').map((v) => v.trim()).filter(Boolean); }
};
export const pick = (obj, keys, fallback = '') => {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return obj[key];
  return fallback;
};
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const randomToken = () => crypto.randomBytes(48).toString('base64url');
export const randomPassword = () => `${crypto.randomBytes(5).toString('base64url')}A9!`;
export function hashPassword(password, salt = crypto.randomBytes(24).toString('hex')) {
  const digest = crypto.pbkdf2Sync(String(password), salt, 210000, 32, 'sha256').toString('hex');
  return { salt, hash: `pbkdf2$210000$${digest}` };
}
export function verifyPassword(password, salt, storedHash) {
  const stored = String(storedHash || '');
  if (stored.startsWith('pbkdf2$')) {
    const [, iterationsText, expected] = stored.split('$');
    const actual = crypto.pbkdf2Sync(String(password), String(salt), Number(iterationsText), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }
  const candidates = [sha256(`${salt}${password}`), sha256(`${password}${salt}`), sha256(`${salt}:${password}`)];
  return candidates.some((candidate) => candidate === stored);
}
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
