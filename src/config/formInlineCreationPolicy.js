export const IMPLIED_OPERATIONAL_CLIENT_PERMISSIONS = Object.freeze([
  'BOLETAS_CREAR',
  'BOLETAS_EDITAR',
  'MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR',
  'MANTENIMIENTOS_GESTIONAR',
]);

export const TICKET_INLINE_CREATION_FIELDS = Object.freeze([
  Object.freeze({ key: 'category', label: 'Categoría' }),
  Object.freeze({ key: 'failure', label: 'Tipo de falla' }),
  Object.freeze({ key: 'location', label: 'Ubicación' }),
  Object.freeze({ key: 'equipment', label: 'Ubicación del equipo' }),
  Object.freeze({ key: 'supervisor', label: 'Supervisor' }),
  Object.freeze({ key: 'device', label: 'Tipo de dispositivo' }),
  Object.freeze({ key: 'manufacturer', label: 'Fabricante' }),
  Object.freeze({ key: 'model', label: 'Modelo' }),
]);

export const MAINTENANCE_INLINE_CREATION_FIELDS = Object.freeze([
  Object.freeze({ key: 'location', label: 'Ubicación del cliente' }),
  Object.freeze({ key: 'equipment', label: 'Ubicación del equipo' }),
  Object.freeze({ key: 'device', label: 'Tipo de dispositivo' }),
  Object.freeze({ key: 'manufacturer', label: 'Fabricante' }),
  Object.freeze({ key: 'model', label: 'Modelo' }),
]);

export function hasImpliedOperationalClientPermission(permissions = []) {
  const available = new Set(Array.isArray(permissions) ? permissions : []);
  return IMPLIED_OPERATIONAL_CLIENT_PERMISSIONS.some((permission) => available.has(permission));
}
