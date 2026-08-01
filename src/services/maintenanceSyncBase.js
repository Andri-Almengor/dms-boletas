function clean(value) {
  return String(value ?? '').trim();
}

function pickOwn(record, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record || {}, key)) return record[key];
  }
  return undefined;
}

function snapshot(record = {}, fields = {}) {
  return Object.entries(fields).reduce((result, [field, aliases]) => {
    const value = pickOwn(record, [field, ...(aliases || [])]);
    if (value !== undefined) result[field] = value;
    return result;
  }, {});
}

export const MAINTENANCE_SYNC_FIELDS = Object.freeze({
  TituloMantenimiento: ['titulo'],
  ClienteID: ['ClienteRef', 'clienteId'],
  Cliente: ['cliente'],
  UbicacionID: ['ubicacionId'],
  Ubicacion: ['ubicacion'],
  Estado: ['estado'],
  Fecha: ['fecha'],
  FechaFinalizacion: ['fechaFinalizacion'],
  ResponsableIDsJSON: ['ResponsableIDs', 'responsables'],
  DescripcionGeneral: ['descripcion'],
  CantidadesJSON: ['counts', 'cantidades'],
  CantCámaras: [],
  CantPuertas: [],
  CantServidores: [],
  CantGrabadores: [],
  CantBocinas: [],
  CantSensoresPerimetrales: [],
  CantSensoresMovimiento: [],
  CantSensorRuptura: [],
  CantImpresora: [],
  CantGabinetes: [],
  CantVideoWall: [],
});

export const MAINTENANCE_DEVICE_SYNC_FIELDS = Object.freeze({
  UbicacionEquipoID: ['ubicacionEquipoId'],
  UbicacionEquipoNombre: ['ubicacionEquipoNombre'],
  Zona: ['zona'],
  Categoria: ['TipoDispositivo', 'categoria'],
  NombreDispositivo: ['nombre'],
  TipoDispositivoID: ['tipoDispositivoId'],
  FabricanteID: ['fabricanteId'],
  Fabricante: ['fabricante'],
  ModeloID: ['modeloId'],
  Modelo: ['modelo'],
  Serie: ['serie'],
  Funcionamiento: ['funcionamiento'],
  EnUso: ['enUso'],
  Estado: ['estado'],
  Observacion: ['observacion'],
  RespuestasJSON: ['respuestas', 'answers'],
  FechaTrabajo: ['fechaTrabajo'],
  TecnicoIDsJSON: ['TecnicoIDs', 'tecnicoIds'],
});

export const MAINTENANCE_IMAGE_SYNC_FIELDS = Object.freeze({
  Tipo: ['tipo', 'type'],
  Nota: ['nota', 'note'],
});

export function buildMaintenanceSyncBase(record = {}, {
  entityType,
  entityId,
  maintenanceId,
  fields,
} = {}) {
  const updatedAt = clean(record.FechaActualizacion || record.updatedAt || record.FechaCreacion || record.createdAt);
  if (!updatedAt || !entityId) return null;
  return {
    entityType: clean(entityType),
    entityId: clean(entityId),
    maintenanceId: clean(maintenanceId),
    updatedAt,
    snapshot: {
      ...snapshot(record, fields),
      FechaActualizacion: updatedAt,
      ActualizadoPor: record.ActualizadoPor || '',
    },
  };
}

export function maintenanceSyncBase(record = {}) {
  const entityId = clean(record.MantenimientoID || record.maintenanceId || record.id);
  return buildMaintenanceSyncBase(record, {
    entityType: 'maintenance',
    entityId,
    maintenanceId: entityId,
    fields: MAINTENANCE_SYNC_FIELDS,
  });
}

export function maintenanceDeviceSyncBase(record = {}, maintenanceId = '') {
  const entityId = clean(record.EvidenciaMantenimientoID || record.deviceId || record.id);
  return buildMaintenanceSyncBase(record, {
    entityType: 'maintenanceDevice',
    entityId,
    maintenanceId: clean(maintenanceId || record.MantenimientoRef),
    fields: MAINTENANCE_DEVICE_SYNC_FIELDS,
  });
}

export function maintenanceImageSyncBase(record = {}, maintenanceId = '') {
  const entityId = clean(record.FotoDispositivoID || record.imageId || record.id);
  return buildMaintenanceSyncBase(record, {
    entityType: 'maintenanceImage',
    entityId,
    maintenanceId,
    fields: MAINTENANCE_IMAGE_SYNC_FIELDS,
  });
}

export function withSyncBase(payload, base) {
  return base ? { ...payload, __syncBase: base } : payload;
}
