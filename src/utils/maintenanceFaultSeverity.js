// Shared domain rule: the same validation runs in the device editor, Excel import,
// and the authenticated maintenance backend before a confirmed device save.
export const MAINTENANCE_FAULT_SEVERITIES = Object.freeze(['Leve', 'Moderada', 'Crítica']);
export const MIN_MAINTENANCE_FAULT_OBSERVATION_LENGTH = 20;

function normalized(value) {
  return String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

export function isMaintenanceDeviceFaulty(device = {}) {
  return normalized(device.estado ?? device.Estado) === 'mal estado';
}

export function normalizeMaintenanceFaultSeverity(value) {
  return MAINTENANCE_FAULT_SEVERITIES.find((item) => normalized(item) === normalized(value)) || '';
}

export function maintenanceFaultObservationLength(value) {
  return Array.from(String(value ?? '').trim()).length;
}

export function validateMaintenanceFaultDetails(device = {}, { projectMode = false } = {}) {
  if (projectMode || !isMaintenanceDeviceFaulty(device)) {
    return { valid: true, severityError: '', observationError: '' };
  }
  const severity = device.gravedadFalla ?? device.GravedadFalla;
  const observationLength = maintenanceFaultObservationLength(device.observacion ?? device.Observacion);
  const severityError = normalizeMaintenanceFaultSeverity(severity)
    ? '' : 'Seleccione la gravedad de la falla: Leve, Moderada o Crítica.';
  const observationError = observationLength >= MIN_MAINTENANCE_FAULT_OBSERVATION_LENGTH
    ? '' : `La observación es obligatoria y debe contener al menos 20 caracteres (${observationLength}/20).`;
  return { valid: !severityError && !observationError, severityError, observationError };
}
