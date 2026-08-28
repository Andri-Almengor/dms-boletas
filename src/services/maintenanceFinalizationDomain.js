export const MAINTENANCE_FINALIZATION_PRIORITY = 90;

export const MAINTENANCE_FINALIZATION_PHASES = Object.freeze([
  { id: 'ESPERANDO_SINCRONIZACION', label: 'Esperando sincronización', progress: 10 },
  { id: 'ESPERANDO_1700', label: 'Programado para las 5:00 p. m.', progress: 0 },
  { id: 'VALIDANDO', label: 'Validando mantenimiento', progress: 25 },
  { id: 'GENERANDO_BOLETAS', label: 'Generando boletas automáticas', progress: 50 },
  { id: 'ENTREGANDO', label: 'Organizando evidencias y enviando', progress: 75 },
  { id: 'COMPLETANDO', label: 'Confirmando la finalización', progress: 90 },
  { id: 'COMPLETADO', label: 'Mantenimiento finalizado', progress: 100 },
]);

function clean(value) {
  return String(value ?? '').trim();
}

function legacySignatureError(value) {
  const text = clean(value).toLowerCase();
  return text.includes('debe firmar el mantenimiento general')
    || text.includes('mantenimiento general debe contar con la firma del cliente')
    || text.includes('maintenance_signature_required');
}

export function maintenanceFinalizationDedupeKey(maintenanceId) {
  return `maintenanceFinalize:${clean(maintenanceId)}`;
}

export function maintenanceFinalizationRequestId(maintenanceId) {
  return `finalize-${clean(maintenanceId)}`;
}

export function maintenanceFinalizationPayload(maintenanceId, { retry = false, cancel = false } = {}) {
  const id = clean(maintenanceId);
  return {
    maintenanceId: id,
    MantenimientoID: id,
    finalizationRequestId: maintenanceFinalizationRequestId(id),
    retryFinalization: Boolean(retry),
    cancelScheduledFinalization: Boolean(cancel),
    requestedAt: new Date().toISOString(),
  };
}

export function finalizationPhase(value) {
  const normalized = clean(value).toUpperCase();
  return MAINTENANCE_FINALIZATION_PHASES.find((item) => item.id === normalized)
    || MAINTENANCE_FINALIZATION_PHASES[0];
}

export function maintenanceFinalizationView(row = {}, operation = null) {
  const operationStatus = clean(operation?.status).toUpperCase();
  const serverState = clean(row.EstadoFinalizacion).toUpperCase();
  let phaseId = clean(row.PasoFinalizacion).toUpperCase();
  let state = serverState;
  const storedError = clean(operation?.lastError || row.UltimoErrorFinalizacion);
  const legacySignatureFailure = legacySignatureError(storedError);

  if (operation) {
    if (!phaseId || ['PENDIENTE', 'ERROR', 'CONFLICT'].includes(operationStatus)) {
      phaseId = 'ESPERANDO_SINCRONIZACION';
    }
    if (operationStatus === 'SYNCING') state = 'EN_PROCESO';
    else if (operationStatus === 'ERROR') state = 'ERROR';
    else if (operationStatus === 'CONFLICT') state = 'BLOQUEADO';
    else if (!state || state === 'NINGUNO') state = 'PENDIENTE_SINCRONIZACION';
  }

  if (clean(row.Estado).toUpperCase() === 'FINALIZADO') {
    state = 'COMPLETADO';
    phaseId = 'COMPLETADO';
  } else if (legacySignatureFailure) {
    // Los mantenimientos que fallaron con la política antigua de firma deben
    // quedar recuperables aunque EstadoFinalizacion haya quedado EN_PROCESO.
    state = 'ERROR';
    phaseId = 'VALIDANDO';
  } else if (state === 'PROGRAMADO') {
    phaseId = 'ESPERANDO_1700';
  }

  const phase = finalizationPhase(phaseId || (state === 'COMPLETADO' ? 'COMPLETADO' : 'ESPERANDO_SINCRONIZACION'));
  const error = legacySignatureFailure
    ? 'Este mantenimiento quedó detenido por la política anterior de firma. Ahora puede reintentarse y finalizarse sin firma.'
    : storedError;
  const scheduled = state === 'PROGRAMADO';
  const active = Boolean(operation)
    || ['PROGRAMADO', 'PENDIENTE_SINCRONIZACION', 'EN_PROCESO', 'ERROR', 'BLOQUEADO'].includes(state);

  return {
    active,
    state: state || 'NINGUNO',
    phaseId: phase.id,
    label: phase.label,
    progress: phase.progress,
    error,
    scheduled,
    scheduledAt: clean(row.FinalizacionProgramadaPara),
    canRetry: state === 'ERROR' || operationStatus === 'ERROR' || legacySignatureFailure,
    canCancelSchedule: scheduled && !operation,
    blocked: state === 'BLOQUEADO' || operationStatus === 'CONFLICT',
    completed: state === 'COMPLETADO',
    legacySignatureFailure,
  };
}
