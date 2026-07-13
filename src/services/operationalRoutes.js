import { MODULE_ROUTES } from './moduleApi';

function prepend(routes, route) {
  if (!routes.includes(route)) routes.unshift(route);
}

// Personal asignable: expone únicamente usuarios activos y saneados.
prepend(MODULE_ROUTES.users.list, 'users.assignment.list');

// Lectura y altas desde boletas/mantenimientos sin habilitar la pantalla
// administrativa completa de catálogos para el técnico.
prepend(MODULE_ROUTES.categories.list, 'catalog.operational.categories.list');
prepend(MODULE_ROUTES.categories.create, 'catalog.operational.categories.create');
prepend(MODULE_ROUTES.failureTypes.list, 'catalog.operational.failureTypes.list');
prepend(MODULE_ROUTES.deviceTypes.list, 'catalog.operational.deviceTypes.list');
prepend(MODULE_ROUTES.manufacturers.list, 'catalog.operational.manufacturers.list');
prepend(MODULE_ROUTES.models.list, 'catalog.operational.models.list');
prepend(MODULE_ROUTES.deviceManufacturers.list, 'catalog.operational.deviceManufacturers.list');
prepend(MODULE_ROUTES.deviceManufacturers.create, 'catalog.operational.deviceManufacturers.create');
