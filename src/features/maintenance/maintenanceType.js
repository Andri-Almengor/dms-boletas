export function normalizeMaintenanceType(value = 'MANTENIMIENTO') {
  return String(value || 'MANTENIMIENTO').trim().toUpperCase() === 'PROYECTO'
    ? 'PROYECTO'
    : 'MANTENIMIENTO';
}

export function isProjectMaintenance(value) {
  return normalizeMaintenanceType(value) === 'PROYECTO';
}
