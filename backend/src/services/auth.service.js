import { env } from '../config/env.js';
import { appendRow, updateRow, withTransaction } from '../infra/postgres.repository.js';
import { findActiveSessionByTokenHash, findUserById, findUserByLogin } from '../infra/auth-postgres.repository.js';
import { AppError, unauthorized } from '../core/errors.js';
import { calculateUserPermissions, getPermissionTablesForUser, safeUser } from './permissions.service.js';
import { asBool, hashPassword, nowIso, randomToken, sha256, uuid, verifyPassword } from '../core/utils.js';

export async function login(username, password, requestMeta = {}) {
  const user = await findUserByLogin(username);
  if (!user || String(user.Estado || '').toUpperCase() !== 'ACTIVO') throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  if (user.BloqueadoHasta && new Date(user.BloqueadoHasta) > new Date()) throw new AppError('ACCOUNT_LOCKED', 'La cuenta está bloqueada temporalmente.', 423);
  if (!verifyPassword(password, user.PasswordSalt, user.PasswordHash)) {
    const attempts = Number(user.IntentosFallidos || 0) + 1;
    const patch = { IntentosFallidos: attempts, ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() };
    if (attempts >= 5) patch.BloqueadoHasta = new Date(Date.now() + 15 * 60000).toISOString();
    await updateRow('Usuarios', user.UsuarioID, patch);
    throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  }

  const tables = await getPermissionTablesForUser(user);
  const token = randomToken();
  const expires = new Date(Date.now() + env.sessionHours * 3600000).toISOString();
  await withTransaction(async () => {
    await appendRow('Sesiones', { SesionID: uuid(), UsuarioID: user.UsuarioID, TokenHash: sha256(token), FechaInicio: nowIso(), FechaExpiracion: expires, Revocada: false, IP: requestMeta.ip || '', UserAgent: requestMeta.userAgent || '', FechaRevocacion: '' });
    await updateRow('Usuarios', user.UsuarioID, { IntentosFallidos: 0, BloqueadoHasta: '', UltimoAcceso: nowIso(), ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() });
  });
  return { sessionToken: token, user: safeUser(user), permissions: calculateUserPermissions(user, tables), mustChangePassword: asBool(user.CambioPasswordObligatorio, false) };
}

export async function authenticate(token) {
  if (!token) throw unauthorized();
  const session = await findActiveSessionByTokenHash(sha256(token));
  if (!session || new Date(session.FechaExpiracion) <= new Date()) throw unauthorized();
  const user = await findUserById(session.UsuarioID);
  if (!user || String(user.Estado).toUpperCase() !== 'ACTIVO') throw unauthorized();
  const tables = await getPermissionTablesForUser(user);
  return { user, session, permissions: calculateUserPermissions(user, tables) };
}

export async function logout(token) {
  if (!token) return { loggedOut: true };
  const session = await findActiveSessionByTokenHash(sha256(token));
  if (session) await updateRow('Sesiones', session.SesionID, { Revocada: true, FechaRevocacion: nowIso() });
  return { loggedOut: true };
}

export async function changePassword(user, currentPassword, newPassword) {
  if (!verifyPassword(currentPassword, user.PasswordSalt, user.PasswordHash)) throw new AppError('INVALID_PASSWORD', 'La contraseña actual es incorrecta.', 400);
  const next = String(newPassword || '');
  if (next.length < 8) throw new AppError('WEAK_PASSWORD', 'La nueva contraseña debe tener al menos 8 caracteres.', 400);
  if (!/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/\d/.test(next)) throw new AppError('WEAK_PASSWORD', 'La nueva contraseña debe incluir una mayúscula, una minúscula y un número.', 400);
  if (verifyPassword(next, user.PasswordSalt, user.PasswordHash)) throw new AppError('PASSWORD_REUSED', 'La nueva contraseña debe ser diferente de la contraseña actual.', 400);
  const { salt, hash } = hashPassword(next);
  await updateRow('Usuarios', user.UsuarioID, { PasswordSalt: salt, PasswordHash: hash, CambioPasswordObligatorio: false, ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() });
  return { changed: true };
}
