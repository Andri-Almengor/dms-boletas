import { MODULE_ROUTES } from './moduleApi';

function prepend(routes, route) {
  if (!routes.includes(route)) routes.unshift(route);
}

prepend(MODULE_ROUTES.failureTypes.create, 'catalog.operational.failureTypes.create');
prepend(MODULE_ROUTES.deviceTypes.create, 'catalog.operational.deviceTypes.create');
prepend(MODULE_ROUTES.manufacturers.create, 'catalog.operational.manufacturers.create');
prepend(MODULE_ROUTES.models.create, 'catalog.operational.models.create');
