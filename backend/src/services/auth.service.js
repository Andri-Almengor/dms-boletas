import { env } from '../config/env.js';
import { appendRow, readTable, updateRow } from '../infra/sheets.repository.js';
import { AppError, unauthorized } from '../core/errors.js';
import { getUserPermissions, safeUser } from './permissions.service.js';
import { asBool, hashPassword, nowIso, randomToken, sha256, uuid, verifyPassword } from '../core/utils.js';

export async function login(username, password, requestMeta = {}) {
  const users = await readTable('Usuarios');
  const key = String(username || '').trim().toLowerCase();
  const user = users.find((item) => [item.NombreUsuario, item.Correo].some((value) => String(value || '').trim().toLowerCase() === key));
  if (!user || String(user.Estado || '').toUpperCase() !== 'ACTIVO') throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  if (user.BloqueadoHasta && new Date(user.BloqueadoHasta) > new Date()) throw new AppError('ACCOUNT_LOCKED', 'La cuenta está bloqueada temporalmente.', 423);
  if (!verifyPassword(password, user.PasswordSalt, user.PasswordHash)) {
    const attempts = Number(user.IntentosFallidos || 0) + 1;
    const patch = { IntentosFallidos: attempts, ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() };
    if (attempts >= 5) patch.BloqueadoHasta = new Date(Date.now() + 15 * 60000).toISOString();
    await updateRow('Usuarios', user.UsuarioID, patch);
    throw new AppError('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  }
  const token = randomToken();
  const expires = new Date(Date.now() + env.sessionHours * 3600000).toISOString();
  await appendRow('Sesiones', { SesionID: uuid(), UsuarioID: user.UsuarioID, TokenHash: sha256(token), FechaInicio: nowIso(), FechaExpiracion: expires, Revocada: false, IP: requestMeta.ip || '', UserAgent: requestMeta.userAgent || '', FechaRevocacion: '' });
  await updateRow('Usuarios', user.UsuarioID, { IntentosFallidos: 0, BloqueadoHasta: '', UltimoAcceso: nowIso(), ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() });
  return { sessionToken: token, user: safeUser(user), permissions: await getUserPermissions(user), mustChangePassword: asBool(user.CambioPasswordObligatorio, false) };
}

export async function authenticate(token) {
  if (!token) throw unauthorized();
  const sessions = await readTable('Sesiones');
  const session = sessions.find((item) => item.TokenHash === sha256(token) && !asBool(item.Revocada, false));
  if (!session || new Date(session.FechaExpiracion) <= new Date()) throw unauthorized();
  const users = await readTable('Usuarios');
  const user = users.find((item) => String(item.UsuarioID) === String(session.UsuarioID));
  if (!user || String(user.Estado).toUpperCase() !== 'ACTIVO') throw unauthorized();
  return { user, session, permissions: await getUserPermissions(user) };
}

export async function logout(token) {
  if (!token) return { loggedOut: true };
  const hash = sha256(token); const sessions = await readTable('Sesiones');
  const session = sessions.find((item) => item.TokenHash === hash && !asBool(item.Revocada, false));
  if (session) await updateRow('Sesiones', session.SesionID, { Revocada: true, FechaRevocacion: nowIso() });
  return { loggedOut: true };
}

export async function changePassword(user, currentPassword, newPassword) {
  if (!verifyPassword(currentPassword, user.PasswordSalt, user.PasswordHash)) throw new AppError('INVALID_PASSWORD', 'La contraseña actual es incorrecta.', 400);
  if (String(newPassword || '').length < 8) throw new AppError('WEAK_PASSWORD', 'La nueva contraseña debe tener al menos 8 caracteres.', 400);
  const { salt, hash } = hashPassword(newPassword);
  await updateRow('Usuarios', user.UsuarioID, { PasswordSalt: salt, PasswordHash: hash, CambioPasswordObligatorio: false, ActualizadoPor: user.UsuarioID, FechaActualizacion: nowIso() });
  return { changed: true };
}
