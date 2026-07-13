import { readTable } from '../infra/sheets.repository.js';
import { asBool } from '../core/utils.js';

export async function getUserPermissions(user) {
  const [roles, permissions, roleLinks, userLinks] = await Promise.all([readTable('Roles'), readTable('Permisos'), readTable('RolPermisos'), readTable('UsuarioPermisos')]);
  const role = roles.find((item) => String(item.RolID) === String(user.RolID));
  const activePermissions = permissions.filter((item) => String(item.Estado || 'ACTIVO').toUpperCase() === 'ACTIVO');
  if (role && asBool(role.EsAdministrador, false)) return activePermissions.map((item) => item.Codigo).filter(Boolean);
  const allowedIds = new Set();
  roleLinks.filter((item) => String(item.RolID) === String(user.RolID) && asBool(item.Permitido, true)).forEach((item) => allowedIds.add(String(item.PermisoID)));
  userLinks.filter((item) => String(item.UsuarioID) === String(user.UsuarioID)).forEach((item) => { if (asBool(item.Permitido, true)) allowedIds.add(String(item.PermisoID)); else allowedIds.delete(String(item.PermisoID)); });
  return activePermissions.filter((item) => allowedIds.has(String(item.PermisoID))).map((item) => item.Codigo).filter(Boolean);
}

export function safeUser(user) {
  const { PasswordHash, PasswordSalt, __rowNumber, ...safe } = user;
  return safe;
}
