import { MODULE_ROUTES } from './moduleApi';

// Los formularios operativos necesitan consultar personal activo sin conceder
// acceso a la administración completa de usuarios.
const assignmentRoute = 'users.assignment.list';
if (!MODULE_ROUTES.users.list.includes(assignmentRoute)) {
  MODULE_ROUTES.users.list = [assignmentRoute, ...MODULE_ROUTES.users.list];
}
