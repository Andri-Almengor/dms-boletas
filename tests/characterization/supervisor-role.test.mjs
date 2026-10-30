import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignableUsers,
  assertNewAssignmentsAssignable,
  calculateUserPermissions,
  isSupervisorRole,
} from '../../backend/src/services/permissions.service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (filename) => readFileSync(path.join(ROOT, filename), 'utf8');
const ROLES = [
  { RolID: 'admin', Nombre: 'Administrador', EsAdministrador: 'true', Estado: 'ACTIVO' },
  { RolID: 'supervisor', Nombre: 'Supervisor', EsAdministrador: 'true', Estado: 'ACTIVO' },
  { RolID: 'tecnico', Nombre: 'Técnico', EsAdministrador: 'false', Estado: 'ACTIVO' },
];
const USERS = [
  { UsuarioID: 'a', RolID: 'admin', Estado: 'ACTIVO' },
  { UsuarioID: 's', RolID: 'supervisor', Estado: 'ACTIVO' },
  { UsuarioID: 't', RolID: 'tecnico', Estado: 'ACTIVO' },
  { UsuarioID: 'i', RolID: 'tecnico', Estado: 'INACTIVO' },
];
const permissions = [
  { PermisoID: 'p1', Codigo: 'USUARIOS_GESTIONAR', Estado: 'ACTIVO' },
  { PermisoID: 'p2', Codigo: 'BOLETAS_EDITAR', Estado: 'ACTIVO' },
  { PermisoID: 'p3', Codigo: 'MANTENIMIENTOS_GESTIONAR', Estado: 'ACTIVO' },
  { PermisoID: 'p4', Codigo: 'AGENDA_VER', Estado: 'ACTIVO' },
  { PermisoID: 'p5', Codigo: 'INACTIVO', Estado: 'INACTIVO' },
];

test('Supervisor hereda exactamente el conjunto de permisos activos del administrador existente', () => {
  const tables = { Roles: ROLES, Permisos: permissions, RolPermisos: [], UsuarioPermisos: [] };
  const admin = calculateUserPermissions({ UsuarioID: 'a', RolID: 'admin' }, tables);
  const supervisor = calculateUserPermissions({ UsuarioID: 's', RolID: 'supervisor' }, tables);
  assert.deepEqual(supervisor, admin);
  assert.ok(supervisor.includes('USUARIOS_GESTIONAR'));
  assert.ok(supervisor.includes('BOLETAS_EDITAR'));
  assert.ok(supervisor.includes('MANTENIMIENTOS_GESTIONAR'));
  assert.ok(!supervisor.includes('INACTIVO'));
});

test('la exclusión es por rol Supervisor, no por EsAdministrador ni por EsSupervisor de contactos', () => {
  assert.equal(isSupervisorRole(ROLES[1]), true);
  assert.equal(isSupervisorRole({ Nombre: ' supervisor ' }), true);
  assert.equal(isSupervisorRole(ROLES[0]), false);
  assert.equal(isSupervisorRole({ EsSupervisor: true, Nombre: 'Contacto de cliente' }), false);
  assert.deepEqual(assignableUsers(USERS, ROLES).map((u) => u.UsuarioID), ['a', 't']);
  assert.deepEqual(assignableUsers([{ UsuarioID: 's', RolID: 'supervisor', Estado: 'ACTIVO' }], ROLES), []);
});

test('backend rechaza nuevas asignaciones de Supervisor sin impedir conservar enlaces históricos', () => {
  assert.doesNotThrow(() => assertNewAssignmentsAssignable(['a', 't'], USERS, ROLES));
  assert.throws(() => assertNewAssignmentsAssignable(['s'], USERS, ROLES), /Supervisor/);
  assert.throws(() => assertNewAssignmentsAssignable(['i'], USERS, ROLES), /inactiva/);
  assert.throws(() => assertNewAssignmentsAssignable(['desconocido'], USERS, ROLES), /inactiva/);
  assert.doesNotThrow(() => assertNewAssignmentsAssignable(['s', 't'], USERS, ROLES, ['s']));
  assert.throws(() => assertNewAssignmentsAssignable(['s'], USERS, ROLES, ['a']), /Supervisor/);
});

test('la migración agrega Supervisor sin modificar roles ni usuarios anteriores', () => {
  const sql = source('backend/migrations/022_supervisor_role.sql');
  assert.match(sql, /INSERT INTO "Roles"/);
  assert.match(sql, /'Supervisor'/);
  assert.match(sql, /"EsAdministrador"/);
  assert.match(sql, /'true'/);
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.doesNotMatch(sql, /UPDATE\s+"Usuarios"|DELETE\s+FROM\s+"Roles"/i);
});

test('los selectores consumen exclusivamente usuarios asignables y la administración conserva users.list', () => {
  const routes = source('src/services/moduleApi.js');
  const ticket = source('src/features/tickets/useTicketFormResources.js');
  const maintenance = source('src/features/maintenance/useMaintenanceResources.js');
  const device = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const agenda = source('src/pages/agenda/AgendaPage.jsx');
  const users = source('backend/src/modules/users.module.js');
  assert.match(routes, /assignmentList:\s*\['users\.assignment\.list'\]/);
  assert.match(routes, /adminList:\s*\['users\.list'\]/);
  assert.match(ticket, /users: \{ routes: MODULE_ROUTES\.users\.assignmentList/);
  assert.match(maintenance, /routes: MODULE_ROUTES\.users\.assignmentList/);
  assert.match(device, /requestAvailable\(MODULE_ROUTES\.users\.assignmentList/);
  assert.match(agenda, /apiRequest\('users\.assignment\.list'/);
  assert.match(users, /assignableUsers\(Usuarios, Roles\)/);
  assert.match(users, /list: async \(\{ payload \}\) => filterRows\(\(await readTable\('Usuarios'\)\)/);
});

test('agenda, boletas y mantenimientos revalidan asignaciones en el backend', () => {
  const agenda = source('backend/src/modules/agenda.module.js');
  const tickets = source('backend/src/modules/tickets.module.js');
  const maintenance = source('backend/src/modules/maintenance.module.js');
  assert.match(agenda, /assertNewAssignmentsAssignable\(userIds, tables\.Usuarios/);
  assert.match(agenda, /assertNewAssignmentsAssignable\(newUserIds, tables\.Usuarios/);
  assert.match(tickets, /assertNewAssignmentsAssignable\(nextIds, tables\.Usuarios/);
  assert.match(maintenance, /assertNewAssignmentsAssignable\(ids, users, roles\)/);
  assert.match(maintenance, /assertNewAssignmentsAssignable\(asArray\(payload\.ResponsableIDsJSON\)/);
});
