import { pick } from '../core/utils.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { maintenanceDynamicQuestionHandlers } from '../modules/maintenance-question-ready.module.js';
import { maintenanceScalableImageHandlers } from '../modules/maintenance-scalable-images.module.js';
import { resolveConflictAwarePayload } from './sync-conflict.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceSyncConflictPolicy');
const writeTails = new Map();

function withConflictWrite(key, operation) {
  const normalized = clean(key);
  const previous = writeTails.get(normalized) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const settled = current.catch(() => {});
  writeTails.set(normalized, settled);
  settled.finally(() => {
    if (writeTails.get(normalized) === settled) writeTails.delete(normalized);
  });
  return current;
}

const MAINTENANCE_FIELDS = Object.freeze({
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

const LOCATION_FIELDS = Object.freeze({
  UbicacionesEquipoJSON: ['ubicacionesEquipoJSON', 'UbicacionesEquipoIDs', 'ubicacionesEquipoIds', 'locationIds', 'locations'],
});

const DEVICE_FIELDS = Object.freeze({
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

const IMAGE_FIELDS = Object.freeze({
  Tipo: ['tipo', 'type'],
  Nota: ['nota', 'note'],
});

function clean(value) {
  return String(value ?? '').trim();
}

function wrapHandler(container, name, {
  table,
  idKeys,
  fieldAliases,
  entityType,
  maintenanceId,
}) {
  const original = container[name];
  if (typeof original !== 'function') return;
  container[name] = async (ctx) => {
    const id = clean(pick(ctx.payload, idKeys));
    if (!id || !ctx.payload?.__syncBase) return original(ctx);
    const lockKey = table === 'Mantenimiento imagenes' ? table : `${table}:${id}`;
    return withConflictWrite(lockKey, async () => {
      const before = await findById(table, id);
      const safePayload = resolveConflictAwarePayload({
        payload: ctx.payload,
        before,
        fieldAliases,
        entityType,
        entityId: id,
        maintenanceId: typeof maintenanceId === 'function'
          ? maintenanceId(ctx, before)
          : clean(maintenanceId),
      });
      return original({ ...ctx, payload: safePayload });
    });
  };
}

if (!maintenanceDynamicQuestionHandlers[INSTALL_FLAG]) {
  wrapHandler(maintenanceDynamicQuestionHandlers, 'update', {
    table: 'Mantenimiento',
    idKeys: ['maintenanceId', 'MantenimientoID', 'id'],
    fieldAliases: MAINTENANCE_FIELDS,
    entityType: 'maintenance',
    maintenanceId: (ctx) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']),
  });
  wrapHandler(maintenanceDynamicQuestionHandlers, 'locationsUpdate', {
    table: 'Mantenimiento',
    idKeys: ['maintenanceId', 'MantenimientoID', 'id'],
    fieldAliases: LOCATION_FIELDS,
    entityType: 'maintenanceLocations',
    maintenanceId: (ctx) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']),
  });
  wrapHandler(maintenanceDynamicQuestionHandlers, 'deviceUpdate', {
    table: 'Evidencia_Mantenimientos',
    idKeys: ['deviceId', 'EvidenciaMantenimientoID', 'id'],
    fieldAliases: DEVICE_FIELDS,
    entityType: 'maintenanceDevice',
    maintenanceId: (ctx, before) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], before.MantenimientoRef),
  });
  wrapHandler(maintenanceDynamicQuestionHandlers, 'deviceAutosave', {
    table: 'Evidencia_Mantenimientos',
    idKeys: ['deviceId', 'EvidenciaMantenimientoID', 'id'],
    fieldAliases: DEVICE_FIELDS,
    entityType: 'maintenanceDevice',
    maintenanceId: (ctx, before) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], before.MantenimientoRef),
  });
  wrapHandler(maintenanceDynamicQuestionHandlers, 'imageUpdate', {
    table: 'Mantenimiento imagenes',
    idKeys: ['imageId', 'FotoDispositivoID', 'id'],
    fieldAliases: IMAGE_FIELDS,
    entityType: 'maintenanceImage',
    maintenanceId: (ctx) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID']),
  });
  wrapHandler(maintenanceDynamicQuestionHandlers, 'imageDelete', {
    table: 'Mantenimiento imagenes',
    idKeys: ['imageId', 'FotoDispositivoID', 'id'],
    fieldAliases: IMAGE_FIELDS,
    entityType: 'maintenanceImage',
    maintenanceId: (ctx) => pick(ctx.payload, ['maintenanceId', 'MantenimientoID']),
  });
  maintenanceDynamicQuestionHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceScalableImageHandlers[INSTALL_FLAG]) {
  const updateBatch = maintenanceScalableImageHandlers.updateBatch;
  maintenanceScalableImageHandlers.updateBatch = async (ctx) => {
    const updates = Array.isArray(ctx.payload?.updates) ? ctx.payload.updates : [];
    if (!updates.some((item) => item?.__syncBase)) return updateBatch(ctx);
    return withConflictWrite('Mantenimiento imagenes', async () => {
      const rows = await readTable('Mantenimiento imagenes', { force: true });
      const byId = new Map(rows.map((row) => [clean(row.FotoDispositivoID), row]));
      const safeUpdates = updates.map((input) => {
        const imageId = clean(pick(input, ['imageId', 'FotoDispositivoID', 'id']));
        const before = byId.get(imageId);
        if (!before || !input?.__syncBase) return input;
        return resolveConflictAwarePayload({
          payload: input,
          before,
          fieldAliases: IMAGE_FIELDS,
          entityType: 'maintenanceImage',
          entityId: imageId,
          maintenanceId: clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID'])),
        });
      });
      return updateBatch({ ...ctx, payload: { ...ctx.payload, updates: safeUpdates } });
    });
  };
  maintenanceScalableImageHandlers[INSTALL_FLAG] = true;
}
