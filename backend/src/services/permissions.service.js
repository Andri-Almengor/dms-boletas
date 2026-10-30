import { findRows, readTable } from '../infra/postgres.repository.js';
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

export async function getPermissionTablesForUser(user) {
  const roleId = String(user?.RolID || '').trim();
  const userId = String(user?.UsuarioID || '').trim();
  const [roles, permissions, roleLinks, userLinks] = await Promise.all([
    roleId ? findRows('Roles', { RolID: roleId }, { limit: 2 }) : Promise.resolve([]),
    readTable('Permisos'),
    roleId ? findRows('RolPermisos', { RolID: roleId }, { limit: 50_000 }) : Promise.resolve([]),
    userId ? findRows('UsuarioPermisos', { UsuarioID: userId }, { limit: 50_000 }) : Promise.resolve([]),
  ]);
  return {
    Roles: roles,
    Permisos: permissions,
    RolPermisos: roleLinks,
    UsuarioPermisos: userLinks,
  };
}

export async function getUserPermissions(user, prefetchedTables = null) {
  const tables = prefetchedTables || await getPermissionTablesForUser(user);
  return calculateUserPermissions(user, tables);
}

export function safeUser(user) {
  const { PasswordHash, PasswordSalt, __rowNumber, ...safe } = user;
  return safe;
}
/**
 * Solo las personas operativas aparecen en AsignadoA, Agenda y responsables.
 * EsAdministrador sigue siendo la única fuente de permisos del rol Supervisor.
 * No se eliminan usuarios históricos de boletas o mantenimientos existentes.
 */
export function isSupervisorRole(role = {}) {
  return String(role.Nombre || '').trim().toUpperCase() === 'SUPERVISOR';
}

export function assignableUsers(users = [], roles = []) {
  const supervisorIds = new Set(roles.filter(isSupervisorRole).map((role) => String(role.RolID)));
  return users.filter((user) => (
    String(user.Estado || '').trim().toUpperCase() === 'ACTIVO'
    && !supervisorIds.has(String(user.RolID || ''))
  ));
}

export function assertNewAssignmentsAssignable(ids = [], users = [], roles = [], previousIds = []) {
  const previous = new Set(previousIds.map(String));
  const eligible = new Set(assignableUsers(users, roles).map((user) => String(user.UsuarioID)));
  const invalid = ids.map(String).filter((id) => !eligible.has(id) && !previous.has(id));
  if (invalid.length) {
    // Los registros históricos pueden conservar un Supervisor ya asignado;
    // nunca se permite asignarlo a un trabajo nuevo o distinto.
    throw new Error('La asignación incluye una persona inactiva o con rol Supervisor, que no realiza visitas.');
  }
}
