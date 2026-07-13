import { readTables } from '../infra/sheets.repository.js';
import { asBool } from '../core/utils.js';

export const PERMISSION_TABLE_NAMES = ['Roles', 'Permisos', 'RolPermisos', 'UsuarioPermisos'];

export function calculateUserPermissions(user, tables) {
  const roles = tables.Roles || [];
  const permissions = tables.Permisos || [];
  const roleLinks = tables.RolPermisos || [];
  const userLinks = tables.UsuarioPermisos || [];
  const role = roles.find((item) => String(item.RolID) === String(user.RolID));
  const activePermissions = permissions.filter((item) => String(item.Estado || 'ACTIVO').toUpperCase() === 'ACTIVO');
  if (role && asBool(role.EsAdministrador, false)) return activePermissions.map((item) => item.Codigo).filter(Boolean);
  const allowedIds = new Set();
  roleLinks.filter((item) => String(item.RolID) === String(user.RolID) && asBool(item.Permitido, true)).forEach((item) => allowedIds.add(String(item.PermisoID)));
  userLinks.filter((item) => String(item.UsuarioID) === String(user.UsuarioID)).forEach((item) => { if (asBool(item.Permitido, true)) allowedIds.add(String(item.PermisoID)); else allowedIds.delete(String(item.PermisoID)); });
  return activePermissions.filter((item) => allowedIds.has(String(item.PermisoID))).map((item) => item.Codigo).filter(Boolean);
}

export async function getUserPermissions(user, prefetchedTables = null) {
  const tables = prefetchedTables || await readTables(PERMISSION_TABLE_NAMES);
  return calculateUserPermissions(user, tables);
}

export function safeUser(user) {
  const { PasswordHash, PasswordSalt, __rowNumber, ...safe } = user;
  return safe;
}