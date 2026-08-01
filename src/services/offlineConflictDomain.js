const DEFINITIONS = {
  maintenanceUpdate: {
    entityType: 'Mantenimiento',
    idKeys: ['maintenanceId', 'MantenimientoID', 'id'],
    fields: {
      TituloMantenimiento: ['TituloMantenimiento', 'titulo'],
      ClienteID: ['ClienteID', 'ClienteRef', 'clienteId'],
      Cliente: ['Cliente', 'cliente'],
      UbicacionID: ['UbicacionID', 'ubicacionId'],
      Ubicacion: ['Ubicacion', 'ubicacion'],
      Estado: ['Estado', 'estado'],
      Fecha: ['Fecha', 'fecha'],
      FechaFinalizacion: ['FechaFinalizacion', 'fechaFinalizacion'],
      ResponsableIDsJSON: ['ResponsableIDsJSON', 'ResponsableIDs', 'responsables'],
      DescripcionGeneral: ['DescripcionGeneral', 'descripcion'],
      CantidadesJSON: ['CantidadesJSON', 'counts', 'cantidades'],
    },
  },
  maintenanceDeviceUpdate: {
    entityType: 'DispositivoMantenimiento',
    idKeys: ['deviceId', 'EvidenciaMantenimientoID', 'id'],
    fields: {
      UbicacionEquipoID: ['UbicacionEquipoID', 'ubicacionEquipoId'],
      Zona: ['Zona', 'zona'],
      Categoria: ['Categoria', 'TipoDispositivo', 'categoria'],
      NombreDispositivo: ['NombreDispositivo', 'nombre'],
      TipoDispositivoID: ['TipoDispositivoID', 'tipoDispositivoId'],
      FabricanteID: ['FabricanteID', 'fabricanteId'],
      Fabricante: ['Fabricante', 'fabricante'],
      ModeloID: ['ModeloID', 'modeloId'],
      Modelo: ['Modelo', 'modelo'],
      Serie: ['Serie', 'serie'],
      Funcionamiento: ['Funcionamiento', 'funcionamiento'],
      EnUso: ['EnUso', 'enUso'],
      Estado: ['Estado', 'estado'],
      Observacion: ['Observacion', 'observacion'],
      RespuestasJSON: ['RespuestasJSON', 'respuestas', 'answers'],
      FechaTrabajo: ['FechaTrabajo', 'fechaTrabajo'],
      TecnicoIDsJSON: ['TecnicoIDsJSON', 'TecnicoIDs', 'tecnicoIds'],
    },
  },
  maintenanceDeviceAutosave: null,
  ticketUpdate: {
    entityType: 'Boleta',
    idKeys: ['boletaUid', 'BoletaUID', 'id'],
    fields: {
      Titulo: ['Titulo', 'titulo'],
      Estado: ['Estado', 'estado'],
      ClienteID: ['ClienteID', 'ClienteRef', 'clienteId'],
      Cliente: ['Cliente', 'cliente'],
      Fecha: ['Fecha', 'fecha'],
      HoraInicio: ['HoraInicio', 'horaInicio'],
      HoraFinal: ['HoraFinal', 'horaFinal'],
      Ubicacion: ['Ubicacion', 'ubicacion'],
      UbicacionEquipo: ['UbicacionEquipo', 'ubicacionEquipo'],
      Supervisor: ['Supervisor', 'supervisor'],
      RazonVisita: ['RazonVisita', 'Razon_visita', 'razonVisita'],
      Descripcion: ['Descripcion', 'descripcion'],
      PruebasRealizadas: ['PruebasRealizadas', 'pruebasRealizadas'],
      Resultado: ['Resultado', 'resultado'],
      Recomendaciones: ['Recomendaciones', 'recomendaciones'],
      Fabricante: ['Fabricante', 'fabricante'],
      Modelo: ['Modelo', 'modelo'],
      Serie: ['Serie', 'serie'],
      AsignadoA: ['AsignadoA', 'asignados'],
    },
  },
  ticketAutosave: null,
  clientLocationUpdate: {
    entityType: 'UbicacionCliente',
    idKeys: ['UbicacionID', 'ubicacionId', 'id'],
    fields: {
      ClienteID: ['ClienteID', 'clienteId'],
      Nombre: ['Nombre', 'nombre'],
      Direccion: ['Direccion', 'direccion'],
      Notas: ['Notas', 'notas'],
      Estado: ['Estado', 'status'],
    },
  },
  equipmentLocationUpdate: {
    entityType: 'UbicacionEquipo',
    idKeys: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    fields: {
      UbicacionID: ['UbicacionID', 'ubicacionId'],
      Nombre: ['Nombre', 'nombre'],
      Descripcion: ['Descripcion', 'descripcion'],
      Estado: ['Estado', 'status'],
    },
  },
  deviceTypeUpdate: {
    entityType: 'TipoDispositivo',
    idKeys: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    fields: {
      Nombre: ['Nombre', 'nombre'],
      Descripcion: ['Descripcion', 'descripcion'],
      Estado: ['Estado', 'status'],
    },
  },
  manufacturerUpdate: {
    entityType: 'Fabricante',
    idKeys: ['FabricanteID', 'fabricanteId', 'id'],
    fields: {
      Nombre: ['Nombre', 'nombre'],
      LogoURL: ['LogoURL', 'logoUrl'],
      Estado: ['Estado', 'status'],
    },
  },
  modelUpdate: {
    entityType: 'Modelo',
    idKeys: ['ModeloID', 'modeloId', 'id'],
    fields: {
      TipoDispositivoID: ['TipoDispositivoID', 'tipoDispositivoId'],
      FabricanteID: ['FabricanteID', 'fabricanteId'],
      Nombre: ['Nombre', 'nombre'],
      ImagenReferenciaURL: ['ImagenReferenciaURL', 'imagenReferenciaURL'],
      Descripcion: ['Descripcion', 'descripcion'],
      Estado: ['Estado', 'status'],
    },
  },
  deviceManufacturerUpdate: {
    entityType: 'RelacionDispositivoFabricante',
    idKeys: ['RelacionID', 'relacionId', 'id'],
    fields: {
      TipoDispositivoID: ['TipoDispositivoID', 'tipoDispositivoId'],
      FabricanteID: ['FabricanteID', 'fabricanteId'],
      Estado: ['Estado', 'status'],
    },
  },
};

DEFINITIONS.maintenanceDeviceAutosave = DEFINITIONS.maintenanceDeviceUpdate;
DEFINITIONS.ticketAutosave = DEFINITIONS.ticketUpdate;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function firstOwn(object, keys) {
  for (const key of keys) {
    if (hasOwn(object, key)) return object[key];
  }
  return undefined;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function parseStructured(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try { return JSON.parse(text); } catch { return value; }
}

export function stableOfflineValue(value) {
  const parsed = parseStructured(value);
  if (Array.isArray(parsed)) return parsed.map(stableOfflineValue);
  if (parsed && typeof parsed === 'object') {
    return Object.keys(parsed).sort().reduce((result, key) => {
      result[key] = stableOfflineValue(parsed[key]);
      return result;
    }, {});
  }
  if (typeof parsed === 'string') return parsed.trim();
  if (parsed === undefined) return null;
  return parsed;
}

export function sameOfflineValue(left, right) {
  return JSON.stringify(stableOfflineValue(left)) === JSON.stringify(stableOfflineValue(right));
}

export function offlineConflictDefinition(kind) {
  return DEFINITIONS[kind] || null;
}

export function offlineConflictEntityId(kind, payload = {}) {
  const definition = offlineConflictDefinition(kind);
  return definition ? String(firstValue(payload, definition.idKeys) || '') : '';
}

export function offlineConflictPatch(kind, payload = {}) {
  const definition = offlineConflictDefinition(kind);
  if (!definition) return {};
  return Object.entries(definition.fields).reduce((patch, [canonical, aliases]) => {
    const value = firstOwn(payload, aliases);
    if (value !== undefined) patch[canonical] = value;
    return patch;
  }, {});
}

export function buildOfflineConflictMetadata(kind, payload = {}, baseRecord = null) {
  const definition = offlineConflictDefinition(kind);
  const entityId = offlineConflictEntityId(kind, payload);
  const patch = offlineConflictPatch(kind, payload);
  const fields = Object.keys(patch);
  if (!definition || !entityId || !baseRecord || !fields.length) return null;

  const baseValues = Object.fromEntries(fields.map((field) => [field, baseRecord?.[field]]));
  return {
    version: 1,
    entityType: definition.entityType,
    entityId,
    fields,
    baseValues,
    baseVersion: String(baseRecord?.FechaActualizacion || baseRecord?.UpdatedAt || ''),
    capturedAt: Date.now(),
    strategy: 'REVIEW',
  };
}

export function detectOfflineFieldConflicts(metadata = {}, serverRecord = {}) {
  const fields = Array.isArray(metadata?.fields) ? metadata.fields : [];
  const baseValues = metadata?.baseValues && typeof metadata.baseValues === 'object'
    ? metadata.baseValues
    : {};
  return fields.filter((field) => !sameOfflineValue(serverRecord?.[field], baseValues[field]));
}

export function isOfflineConflictError(error) {
  return Number(error?.status || error?.statusCode || 0) === 409
    && String(error?.code || '').toUpperCase() === 'OFFLINE_SYNC_CONFLICT';
}

export function offlineConflictMessage(details = {}) {
  const fields = Array.isArray(details?.fields) ? details.fields : [];
  const label = String(details?.entityType || 'registro').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (!fields.length) return `El ${label} cambió en el servidor mientras este dispositivo estaba sin conexión.`;
  return `El ${label} cambió en ${fields.length} campo${fields.length === 1 ? '' : 's'} mientras este dispositivo estaba sin conexión.`;
}
