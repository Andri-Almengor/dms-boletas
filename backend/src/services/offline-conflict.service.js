import { AppError } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';

const DEFINITIONS = [
  {
    routes: ['maintenance.update', 'mantenimientos.update'],
    table: 'Mantenimiento',
    entityType: 'Mantenimiento',
    idField: 'MantenimientoID',
    idAliases: ['maintenanceId', 'MantenimientoID', 'id'],
    fields: ['TituloMantenimiento', 'ClienteID', 'Cliente', 'UbicacionID', 'Ubicacion', 'Estado', 'Fecha', 'FechaFinalizacion', 'ResponsableIDsJSON', 'DescripcionGeneral', 'CantidadesJSON'],
  },
  {
    routes: ['maintenance.devices.update', 'mantenimientos.dispositivos.update', 'maintenance.devices.autosave', 'mantenimientos.dispositivos.autosave'],
    table: 'Evidencia_Mantenimientos',
    entityType: 'DispositivoMantenimiento',
    idField: 'EvidenciaMantenimientoID',
    idAliases: ['deviceId', 'EvidenciaMantenimientoID', 'id'],
    fields: ['UbicacionEquipoID', 'Zona', 'Categoria', 'NombreDispositivo', 'TipoDispositivoID', 'FabricanteID', 'Fabricante', 'ModeloID', 'Modelo', 'Serie', 'Funcionamiento', 'EnUso', 'Estado', 'Observacion', 'RespuestasJSON', 'FechaTrabajo', 'TecnicoIDsJSON'],
  },
  {
    routes: ['boletas.update', 'tickets.update', 'boletas.autosave'],
    table: 'Boletas',
    entityType: 'Boleta',
    idField: 'BoletaUID',
    idAliases: ['boletaUid', 'BoletaUID', 'id'],
    fields: ['Titulo', 'Estado', 'ClienteID', 'Cliente', 'Fecha', 'HoraInicio', 'HoraFinal', 'Ubicacion', 'UbicacionEquipo', 'Supervisor', 'RazonVisita', 'Descripcion', 'PruebasRealizadas', 'Resultado', 'Recomendaciones', 'Fabricante', 'Modelo', 'Serie', 'AsignadoA'],
  },
  {
    routes: ['clientLocations.update', 'clients.locations.update', 'clientes.ubicaciones.update', 'ubicacionesCliente.update'],
    table: 'ClienteUbicaciones',
    entityType: 'UbicacionCliente',
    idField: 'UbicacionID',
    idAliases: ['UbicacionID', 'ubicacionId', 'id'],
    fields: ['ClienteID', 'Nombre', 'Direccion', 'Notas', 'Estado'],
  },
  {
    routes: ['equipmentLocations.update', 'clients.equipmentLocations.update', 'clientes.ubicacionesEquipo.update', 'ubicacionesEquipo.update'],
    table: 'ClienteUbicacionesEquipo',
    entityType: 'UbicacionEquipo',
    idField: 'UbicacionEquipoID',
    idAliases: ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'],
    fields: ['UbicacionID', 'Nombre', 'Descripcion', 'Estado'],
  },
  {
    routes: ['catalog.deviceTypes.update', 'deviceTypes.update', 'tiposDispositivo.update'],
    table: 'TiposDispositivo',
    entityType: 'TipoDispositivo',
    idField: 'TipoDispositivoID',
    idAliases: ['TipoDispositivoID', 'tipoDispositivoId', 'id'],
    fields: ['Nombre', 'Descripcion', 'Estado'],
  },
  {
    routes: ['catalog.manufacturers.update', 'manufacturers.update', 'fabricantes.update'],
    table: 'Fabricantes',
    entityType: 'Fabricante',
    idField: 'FabricanteID',
    idAliases: ['FabricanteID', 'fabricanteId', 'id'],
    fields: ['Nombre', 'LogoURL', 'Estado'],
  },
  {
    routes: ['catalog.models.update', 'models.update', 'modelos.update'],
    table: 'Modelos',
    entityType: 'Modelo',
    idField: 'ModeloID',
    idAliases: ['ModeloID', 'modeloId', 'id'],
    fields: ['TipoDispositivoID', 'FabricanteID', 'Nombre', 'ImagenReferenciaURL', 'Descripcion', 'Estado'],
  },
  {
    routes: ['catalog.deviceManufacturers.update', 'deviceManufacturers.update', 'tipoDispositivoFabricantes.update'],
    table: 'TipoDispositivoFabricantes',
    entityType: 'RelacionDispositivoFabricante',
    idField: 'RelacionID',
    idAliases: ['RelacionID', 'relacionId', 'id'],
    fields: ['TipoDispositivoID', 'FabricanteID', 'Estado'],
  },
];

function definitionForRoute(route) {
  return DEFINITIONS.find((definition) => definition.routes.includes(String(route || ''))) || null;
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

export function stableConflictValue(value) {
  const parsed = parseStructured(value);
  if (Array.isArray(parsed)) return parsed.map(stableConflictValue);
  if (parsed && typeof parsed === 'object') {
    return Object.keys(parsed).sort().reduce((result, key) => {
      result[key] = stableConflictValue(parsed[key]);
      return result;
    }, {});
  }
  if (typeof parsed === 'string') return parsed.trim();
  if (parsed === undefined) return null;
  return parsed;
}

export function detectOfflineFieldConflicts(metadata = {}, serverRecord = {}, allowedFields = []) {
  const allowed = new Set(allowedFields);
  const fields = [...new Set((Array.isArray(metadata?.fields) ? metadata.fields : [])
    .map(String)
    .filter((field) => allowed.has(field)))]
    .slice(0, 40);
  const baseValues = metadata?.baseValues && typeof metadata.baseValues === 'object'
    ? metadata.baseValues
    : {};
  return fields.filter((field) => (
    JSON.stringify(stableConflictValue(serverRecord?.[field]))
    !== JSON.stringify(stableConflictValue(baseValues[field]))
  ));
}

function conflictError(message, details) {
  return new AppError('OFFLINE_SYNC_CONFLICT', message, 409, details);
}

export async function assertOfflineWritePrecondition(route, payload = {}) {
  const metadata = payload?.__offlineConflict;
  if (!metadata || typeof metadata !== 'object') return null;
  if (String(metadata.strategy || '').toUpperCase() === 'KEEP_LOCAL') return null;

  const definition = definitionForRoute(route);
  if (!definition) return null;

  const payloadId = String(firstValue(payload, definition.idAliases) || '');
  const metadataId = String(metadata.entityId || '');
  const entityId = payloadId || metadataId;
  if (!entityId || (payloadId && metadataId && payloadId !== metadataId)) {
    throw conflictError('No fue posible validar la versión original del registro offline.', {
      reason: 'INVALID_PRECONDITION',
      entityType: definition.entityType,
      entityId,
      fields: [],
    });
  }

  const rows = await readTable(definition.table, { force: true });
  const current = rows.find((row) => String(row?.[definition.idField] || '') === entityId);
  if (!current) {
    throw conflictError('El registro fue eliminado o ya no está disponible en el servidor.', {
      reason: 'SERVER_RECORD_MISSING',
      entityType: definition.entityType,
      entityId,
      fields: [],
      baseVersion: String(metadata.baseVersion || ''),
    });
  }

  const fields = detectOfflineFieldConflicts(metadata, current, definition.fields);
  if (!fields.length) return current;

  throw conflictError('Otro usuario modificó parte de este registro mientras el dispositivo estaba sin conexión.', {
    reason: 'CONCURRENT_UPDATE',
    entityType: definition.entityType,
    entityId,
    fields,
    baseVersion: String(metadata.baseVersion || ''),
    serverVersion: String(current.FechaActualizacion || ''),
    baseValues: Object.fromEntries(fields.map((field) => [field, metadata.baseValues?.[field]])),
    serverValues: Object.fromEntries(fields.map((field) => [field, current[field]])),
  });
}

export function stripOfflineConflictMetadata(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { __offlineConflict: _offlineConflict, ...cleanPayload } = payload;
  return cleanPayload;
}
