import {
  appendRow,
  filterRows,
  findById,
  readTable,
  readTables,
  softDelete,
  updateRow,
} from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { badRequest, forbidden, notFound } from '../core/errors.js';
import { countRowsBy, groupRowsBy, indexRowsBy } from '../core/row-index.js';
import { asArray, nowIso, pick, uuid } from '../core/utils.js';
import { getConfig } from './config.module.js';
import { audit } from '../services/audit.service.js';
import { sheetsApi, slidesApi } from '../infra/google.js';
import {
  loadMaintenanceEvidenceContext,
  maintenanceEvidenceMetadata,
  sortMaintenanceEvidenceNewestFirst,
} from '../services/maintenance-evidence-policy.service.js';
import {
  projectChecklistJson,
  projectDeviceProgressSummary,
  validateProjectDeviceProgress,
} from '../services/maintenance-project-checklist.service.js';

const deviceAutosaveWriteTimes = new Map();
const DEVICE_AUTOSAVE_MIN_INTERVAL_MS = 6000;
let maintenanceCreateTail = Promise.resolve();
let maintenanceDeviceCreateTail = Promise.resolve();
let maintenanceImageCreateTail = Promise.resolve();

const CATEGORY_CONFIG = [
  { key: 'Cámara', countField: 'CantCámaras', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['visualizacion', 'Visualización']] },
  { key: 'Puertas', countField: 'CantPuertas', questions: [['lector', 'Lector'], ['cerradura', 'Cerradura'], ['funcion', 'Función'], ['contactos', 'Contactos']] },
  { key: 'Servidor', countField: 'CantServidores', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexiones', 'Conexiones'], ['servicios', 'Servicios'], ['almacenamiento', 'Almacenamiento'], ['respaldo', 'Respaldo']] },
  { key: 'Grabador', countField: 'CantGrabadores', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexiones', 'Conexiones'], ['grabacion', 'Grabación'], ['visualizacion', 'Visualización'], ['almacenamiento', 'Almacenamiento']] },
  { key: 'Bocinas', countField: 'CantBocinas', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['pruebaSonido', 'Prueba de sonido']] },
  { key: 'Sensor Perimetral', countField: 'CantSensoresPerimetrales', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['pruebaDeteccion', 'Prueba de detección']] },
  { key: 'Sensor Movimiento', countField: 'CantSensoresMovimiento', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['pruebaDeteccion', 'Prueba de movimiento']] },
  { key: 'Sensor de Ruptura', countField: 'CantSensorRuptura', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['pruebaDeteccion', 'Prueba de ruptura']] },
  { key: 'Impresora', countField: 'CantImpresora', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['consumibles', 'Consumibles'], ['pruebaImpresion', 'Prueba de impresión']] },
  { key: 'Gabinete', countField: 'CantGabinetes', questions: [['limpieza', 'Limpieza'], ['conexiones', 'Conexiones'], ['mediciones', 'Mediciones'], ['respaldo', 'Respaldo']] },
  { key: 'VideoWall', countField: 'CantVideoWall', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['visualizacion', 'Visualización'], ['calibracion', 'Calibración']] },
];

function serialize(tail, operation, replaceTail) {
  const current = tail.then(operation, operation);
  replaceTail(current.catch(() => {}));
  return current;
}

function withMaintenanceCreateLock(operation) {
  return serialize(maintenanceCreateTail, operation, (next) => { maintenanceCreateTail = next; });
}

function withDeviceCreateLock(operation) {
  return serialize(maintenanceDeviceCreateTail, operation, (next) => { maintenanceDeviceCreateTail = next; });
}

function withImageCreateLock(operation) {
  return serialize(maintenanceImageCreateTail, operation, (next) => { maintenanceImageCreateTail = next; });
}

function validClientGeneratedId(value) {
  return /^[A-Za-z0-9._:-]{8,160}$/.test(String(value || ''));
}

function sameValue(left, right) {
  if (typeof left === 'boolean' || typeof right === 'boolean') return Boolean(left) === Boolean(right);
  if (typeof left === 'number' || typeof right === 'number') return Number(left || 0) === Number(right || 0);
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function normalizeCategoryName(value) {
  const text = String(value || '').trim();
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (normalized === 'camara' || normalized === 'camaras') return 'Cámara';
  return text;
}

function normalizedDynamicCountName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function fixedCountFieldForDevice(device = {}) {
  const category = normalizeCategoryName(device.TipoDispositivo || device.Categoria);
  const normalized = normalizedDynamicCountName(category);
  return CATEGORY_CONFIG.find((item) => normalizedDynamicCountName(item.key) === normalized)?.countField || '';
}

function sanitizeMaintenanceCounts(counts = {}, devices = [], deviceTypes = []) {
  const cleaned = { ...(counts || {}) };
  const canonicalSources = [
    ...(devices || []).filter((device) => device.Activo !== false),
    ...(deviceTypes || []).map((type) => ({
      TipoDispositivoID: type.TipoDispositivoID,
      TipoDispositivo: type.Nombre,
      Categoria: type.Nombre,
    })),
  ];

  canonicalSources.forEach((device) => {
    if (!fixedCountFieldForDevice(device)) return;

    const typeId = String(device.TipoDispositivoID || '').trim();
    if (typeId) delete cleaned[`TipoDispositivo:${typeId}`];

    const names = [device.TipoDispositivo, device.Categoria];
    names.forEach((name) => {
      const normalized = normalizedDynamicCountName(name);
      if (normalized) delete cleaned[`TipoDispositivoNombre:${normalized}`];
    });
  });

  return cleaned;
}

function normalizeMaintenanceType(value, fallback = 'MANTENIMIENTO') {
  const normalized = String(value || fallback || 'MANTENIMIENTO').trim().toUpperCase();
  return normalized === 'PROYECTO' ? 'PROYECTO' : 'MANTENIMIENTO';
}

function maintenancePayload(payload, before = {}) {
  const counts = payload.counts || payload.cantidades || (() => {
    try { return JSON.parse(payload.CantidadesJSON || '{}'); } catch { return {}; }
  })();
  const row = {
    TituloMantenimiento: pick(payload, ['TituloMantenimiento', 'titulo'], before.TituloMantenimiento),
    TipoMantenimiento: normalizeMaintenanceType(
      pick(payload, ['TipoMantenimiento', 'tipoMantenimiento', 'maintenanceType'], before.TipoMantenimiento || 'MANTENIMIENTO'),
    ),
    ClienteID: pick(payload, ['ClienteID', 'ClienteRef', 'clienteId'], before.ClienteID),
    Cliente: pick(payload, ['Cliente', 'cliente'], before.Cliente),
    UbicacionID: pick(payload, ['UbicacionID', 'ubicacionId'], before.UbicacionID),
    Ubicacion: pick(payload, ['Ubicacion', 'ubicacion'], before.Ubicacion),
    Estado: pick(payload, ['Estado', 'estado'], before.Estado || 'PENDIENTE'),
    Fecha: pick(payload, ['Fecha', 'fecha'], before.Fecha),
    FechaFinalizacion: pick(payload, ['FechaFinalizacion', 'fechaFinalizacion'], before.FechaFinalizacion),
    ResponsableIDsJSON: JSON.stringify(asArray(payload.ResponsableIDs || payload.responsables || before.ResponsableIDsJSON)),
    DescripcionGeneral: pick(payload, ['DescripcionGeneral', 'descripcion'], before.DescripcionGeneral),
    CantidadesJSON: JSON.stringify(counts),
    ProyectoChecklistJSON: normalizeMaintenanceType(
      pick(payload, ['TipoMantenimiento', 'tipoMantenimiento', 'maintenanceType'], before.TipoMantenimiento || 'MANTENIMIENTO'),
    ) === 'PROYECTO'
      ? projectChecklistJson(payload.projectChecklist || payload.ProyectoChecklistJSON || before.ProyectoChecklistJSON)
      : (before.ProyectoChecklistJSON || ''),
  };
  CATEGORY_CONFIG.forEach((category) => {
    row[category.countField] = Number(counts[category.countField] ?? payload[category.countField] ?? before[category.countField] ?? 0);
  });
  return row;
}

function answerColumnValue(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value;
}

function devicePayload(payload, before = {}) {
  let answers = payload.respuestas || payload.answers || payload.RespuestasJSON || before.RespuestasJSON || {};
  if (typeof answers === 'string') {
    try { answers = JSON.parse(answers); } catch { answers = {}; }
  }
  const category = normalizeCategoryName(pick(
    payload,
    ['TipoDispositivo', 'Categoria', 'categoria'],
    before.TipoDispositivo || before.Categoria,
  ));
  return {
    UbicacionEquipoID: pick(payload, ['UbicacionEquipoID', 'ubicacionEquipoId'], before.UbicacionEquipoID),
    Zona: pick(payload, ['Zona', 'zona'], before.Zona),
    Categoria: category,
    NombreDispositivo: pick(payload, ['NombreDispositivo', 'nombre'], before.NombreDispositivo),
    TipoDispositivoID: pick(payload, ['TipoDispositivoID', 'tipoDispositivoId'], before.TipoDispositivoID),
    TipoDispositivo: category,
    FabricanteID: pick(payload, ['FabricanteID', 'fabricanteId'], before.FabricanteID),
    Fabricante: pick(payload, ['Fabricante', 'fabricante'], before.Fabricante),
    ModeloID: pick(payload, ['ModeloID', 'modeloId'], before.ModeloID),
    Modelo: pick(payload, ['Modelo', 'modelo'], before.Modelo),
    Serie: pick(payload, ['Serie', 'serie'], before.Serie),
    DireccionMAC: pick(payload, ['DireccionMAC', 'macAddress', 'mac'], before.DireccionMAC),
    Funcionamiento: pick(payload, ['Funcionamiento', 'funcionamiento'], before.Funcionamiento),
    EnUso: pick(payload, ['EnUso', 'enUso'], before.EnUso),
    Estado: pick(payload, ['Estado', 'estado'], before.Estado || 'Correcto'),
    Observacion: pick(payload, ['Observacion', 'observacion'], before.Observacion),
    ProyectoProgresoJSON: pick(payload, ['ProyectoProgresoJSON', 'projectProgress', 'proyectoProgreso'], before.ProyectoProgresoJSON || ''),
    RespuestasJSON: JSON.stringify(answers),
    ...Object.fromEntries(Object.entries(answers).map(([key, value]) => [
      key.charAt(0).toUpperCase() + key.slice(1),
      answerColumnValue(value),
    ])),
  };
}

function changedDevicePatch(before, payload, userId) {
  const candidate = devicePayload(payload, before);
  const changed = Object.fromEntries(Object.entries(candidate).filter(([key, value]) => !sameValue(before[key], value)));
  if (!Object.keys(changed).length) return {};
  return { ...changed, ActualizadoPor: userId, FechaActualizacion: nowIso() };
}

function maintenanceRow(tables, id) {
  const row = (tables.Mantenimiento || [])
    .find((item) => String(item.MantenimientoID ?? '') === String(id ?? ''));
  if (!row) throw notFound('No se encontró el registro en Mantenimiento.');
  return row;
}

async function enrich(row, providedTables = null) {
  const tables = providedTables || await readTables(['Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
  const devices = (tables.Evidencia_Mantenimientos || [])
    .filter((device) => String(device.MantenimientoRef) === String(row.MantenimientoID) && device.Activo !== false);
  const imagesByDevice = groupRowsBy(
    tables['Mantenimiento imagenes'] || [],
    (image) => image.DispositivoMantenimientoRef,
    { predicate: (image) => image.Activo !== false },
  );
  return {
    mantenimiento: row,
    responsables: asArray(row.ResponsableIDsJSON).map((UsuarioID) => ({ UsuarioID })),
    dispositivos: devices.map((device) => {
      const category = normalizeCategoryName(device.TipoDispositivo || device.Categoria);
      return {
        ...device,
        Categoria: category,
        TipoDispositivo: category,
        Imagenes: sortMaintenanceEvidenceNewestFirst(imagesByDevice.get(String(device.EvidenciaMantenimientoID)) || [])
          .map((image) => ({
            ...image,
            PreviewURL: image.DriveFileID
              ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(image.DriveFileID)}&sz=w1200`
              : image.DriveURL,
          })),
      };
    }),
  };
}

async function enrichedMaintenanceById(id) {
  const tables = await readTables(['Mantenimiento', 'Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
  return enrich(maintenanceRow(tables, id), tables);
}

function isAdmin(ctx) {
  return ctx.permissions.includes('USUARIOS_GESTIONAR') || ctx.permissions.includes('MANTENIMIENTOS_ELIMINAR') || ctx.permissions.includes('MANTENIMIENTOS_GESTIONAR');
}

export const maintenanceHandlers = {
  list: async ({ payload }) => {
    let rows = (await readTable('Mantenimiento')).filter((row) => row.Activo !== false);
    if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha).slice(0, 10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha).slice(0, 10) <= String(payload.dateTo));

    const result = filterRows(rows, payload, ['TituloMantenimiento', 'TipoMantenimiento', 'Cliente', 'Ubicacion', 'Responsables', 'DescripcionGeneral']);
    if (!result.items.length) return result;

    const pageIds = new Set(result.items.map((row) => String(row.MantenimientoID)));
    const devices = await readTable('Evidencia_Mantenimientos');
    const deviceCounts = countRowsBy(
      devices,
      (device) => device.MantenimientoRef,
      { predicate: (device) => device.Activo !== false && pageIds.has(String(device.MantenimientoRef)) },
    );
    result.items = result.items.map((row) => ({
      ...row,
      DispositivosRegistrados: deviceCounts.get(String(row.MantenimientoID)) || 0,
    }));
    return result;
  },

  get: async ({ payload }) => enrichedMaintenanceById(pick(payload, ['maintenanceId', 'MantenimientoID', 'id'])),

  create: async (ctx) => withMaintenanceCreateLock(async () => {
    const requestedId = String(pick(ctx.payload, ['maintenanceId', 'MantenimientoID'], '')).trim();
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local del mantenimiento no es válido.');
    const rows = await readTable('Mantenimiento', { force: true });
    if (requestedId) {
      const existing = rows.find((item) => String(item.MantenimientoID) === requestedId);
      if (existing) {
        const sameOwner = String(existing.CreadoPor || '') === String(ctx.user.UsuarioID || '');
        if (!sameOwner && !isAdmin(ctx)) throw badRequest('El identificador local ya pertenece a otro mantenimiento.');
        return enrich(existing);
      }
    }

    const base = maintenancePayload(ctx.payload);
    if (!base.TituloMantenimiento || !base.ClienteID) throw badRequest('Título y cliente son obligatorios.');
    const users = await readTable('Usuarios');
    const usersById = indexRowsBy(users, (user) => user.UsuarioID);
    const ids = asArray(base.ResponsableIDsJSON);
    const row = {
      MantenimientoID: requestedId || uuid(),
      ...base,
      Responsables: ids.map((id) => usersById.get(String(id))?.NombreCompleto || id).join(', '),
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    await appendRow('Mantenimiento', row);
    await audit(ctx, 'CREAR_MANTENIMIENTO', 'Mantenimiento', row.MantenimientoID, null, row);
    return enrich(row);
  }),

  update: async (ctx) => {
    const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID']);
    const tables = await readTables(['Mantenimiento', 'Usuarios', 'Evidencia_Mantenimientos', 'Mantenimiento imagenes', 'TiposDispositivo']);
    const before = maintenanceRow(tables, id);
    const payload = maintenancePayload(ctx.payload, before);
    // Client changes must not keep a main location belonging to the previous
    // client. Existing device locations are deliberately left untouched and
    // reassigned through the existing inventory workflow.
    if (String(payload.ClienteID || '').trim() !== String(before.ClienteID || '').trim()) {
      const locationId = String(payload.UbicacionID || '').trim();
      if (locationId) {
        let mainLocation;
        try {
          mainLocation = await findById('ClienteUbicaciones', locationId);
        } catch {
          throw badRequest('La ubicación principal del cliente no existe. Seleccione una ubicación del nuevo cliente.');
        }
        if (String(mainLocation.ClienteID || '').trim() !== String(payload.ClienteID || '').trim()) {
          throw badRequest('La ubicación principal seleccionada no pertenece al nuevo cliente del mantenimiento.');
        }
      }
    }
    const maintenanceDevices = (tables.Evidencia_Mantenimientos || [])
      .filter((device) => String(device.MantenimientoRef) === String(id) && device.Activo !== false);
    let nextCounts = {};
    try { nextCounts = JSON.parse(payload.CantidadesJSON || '{}'); } catch { nextCounts = {}; }
    const sanitizedCounts = sanitizeMaintenanceCounts(
      nextCounts,
      maintenanceDevices,
      tables.TiposDispositivo || [],
    );
    payload.CantidadesJSON = JSON.stringify(sanitizedCounts);
    CATEGORY_CONFIG.forEach((category) => {
      payload[category.countField] = Number(
        sanitizedCounts[category.countField]
        ?? payload[category.countField]
        ?? before[category.countField]
        ?? 0,
      );
    });
    const previousType = normalizeMaintenanceType(before.TipoMantenimiento);
    const requestedType = normalizeMaintenanceType(payload.TipoMantenimiento);
    if (previousType !== requestedType) {
      const hasDevices = (tables.Evidencia_Mantenimientos || []).some((device) => (
        String(device.MantenimientoRef) === String(id) && device.Activo !== false
      ));
      if (hasDevices) throw badRequest('No se puede cambiar entre Mantenimiento y Proyecto después de registrar dispositivos. Cree otro registro o elimine primero los dispositivos.');
    }
    const usersById = indexRowsBy(tables.Usuarios || [], (user) => user.UsuarioID);
    payload.Responsables = asArray(payload.ResponsableIDsJSON)
      .map((userId) => usersById.get(String(userId))?.NombreCompleto || userId)
      .join(', ');
    const changed = Object.fromEntries(Object.entries(payload).filter(([key, value]) => !sameValue(before[key], value)));
    const after = Object.keys(changed).length
      ? await updateRow('Mantenimiento', id, { ...changed, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() })
      : before;
    if (Object.keys(changed).length) await audit(ctx, 'EDITAR_MANTENIMIENTO', 'Mantenimiento', id, before, after);
    return enrich(after, tables);
  },

  finalize: async (ctx) => {
    const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID']);
    const maintenance = await findById('Mantenimiento', id);
    if (normalizeMaintenanceType(maintenance.TipoMantenimiento) === 'PROYECTO') {
      throw badRequest('Los proyectos no utilizan la finalización automática de mantenimientos ni generan boletas automáticas.');
    }
    const tables = await readTables(['Evidencia_Mantenimientos', 'Mantenimiento imagenes']);
    const devices = (tables.Evidencia_Mantenimientos || [])
      .filter((device) => String(device.MantenimientoRef) === String(id) && device.Activo !== false);
    if (!devices.length) throw badRequest('Debe registrar al menos un dispositivo.');
    const after = await updateRow('Mantenimiento', id, {
      Estado: 'FINALIZADO',
      FechaFinalizacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    });
    return enrich(after, tables);
  },

  reopen: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    return enrich(await updateRow('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID']), { Estado: 'PENDIENTE', ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }));
  },

  delete: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    return softDelete('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID']), ctx.user.UsuarioID);
  },

  deviceCreate: async (ctx) => withDeviceCreateLock(async () => {
    const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']);
    const requestedId = String(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID'], '')).trim();
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local del dispositivo no es válido.');
    if (!maintenanceId) throw badRequest('Falta el mantenimiento del dispositivo.');
    const maintenance = await findById('Mantenimiento', maintenanceId);
    const progressJson = validateProjectDeviceProgress({ maintenance, payload: ctx.payload });
    const progress = projectDeviceProgressSummary({ maintenance, payload: ctx.payload, progressJson });
    const payload = devicePayload({
      ...ctx.payload,
      ProyectoProgresoJSON: progressJson,
      ...(progress.hasChecklist && !progress.complete ? { Estado: 'Pendiente' } : {}),
    });
    if (!maintenanceId || !payload.Categoria || !payload.NombreDispositivo || !payload.Zona) throw badRequest('Categoría, nombre y ubicación son obligatorios.');

    if (requestedId) {
      const existing = (await readTable('Evidencia_Mantenimientos', { force: true })).find((item) => String(item.EvidenciaMantenimientoID) === requestedId);
      if (existing) {
        if (String(existing.MantenimientoRef) !== String(maintenanceId)) throw badRequest('El dispositivo local ya pertenece a otro mantenimiento.');
        return existing;
      }
    }

    const row = {
      EvidenciaMantenimientoID: requestedId || uuid(),
      MantenimientoRef: maintenanceId,
      ...payload,
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    await appendRow('Evidencia_Mantenimientos', row);
    return row;
  }),

  deviceUpdate: async (ctx) => {
    const id = pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']);
    const before = await findById('Evidencia_Mantenimientos', id);
    const maintenance = await findById('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], before.MantenimientoRef));
    const progressJson = validateProjectDeviceProgress({ maintenance, payload: ctx.payload, before });
    const progress = projectDeviceProgressSummary({ maintenance, payload: ctx.payload, before, progressJson });
    const patch = changedDevicePatch(before, {
      ...ctx.payload,
      ProyectoProgresoJSON: progressJson,
      ...(progress.hasChecklist && !progress.complete ? { Estado: 'Pendiente' } : {}),
    }, ctx.user.UsuarioID);
    return Object.keys(patch).length ? updateRow('Evidencia_Mantenimientos', id, patch) : before;
  },

  deviceAutosave: async (ctx) => {
    const id = String(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']));
    if (!id) throw badRequest('Falta el identificador del dispositivo para autoguardar.');
    const now = Date.now();
    if (now - (deviceAutosaveWriteTimes.get(id) || 0) < DEVICE_AUTOSAVE_MIN_INTERVAL_MS) {
      return { EvidenciaMantenimientoID: id, autosaved: false, throttled: true };
    }
    deviceAutosaveWriteTimes.set(id, now);
    try {
      const before = await findById('Evidencia_Mantenimientos', id);
      const maintenance = await findById('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], before.MantenimientoRef));
      const progressJson = validateProjectDeviceProgress({ maintenance, payload: ctx.payload, before });
      const progress = projectDeviceProgressSummary({ maintenance, payload: ctx.payload, before, progressJson });
      const patch = changedDevicePatch(before, {
        ...ctx.payload,
        ProyectoProgresoJSON: progressJson,
        ...(progress.hasChecklist && !progress.complete ? { Estado: 'Pendiente' } : {}),
      }, ctx.user.UsuarioID);
      if (!Object.keys(patch).length) return { ...before, autosaved: false, unchanged: true };
      const after = await updateRow('Evidencia_Mantenimientos', id, patch);
      return { ...after, autosaved: true };
    } catch (error) {
      deviceAutosaveWriteTimes.delete(id);
      throw error;
    }
  },

  deviceDelete: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    return softDelete('Evidencia_Mantenimientos', pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID']), ctx.user.UsuarioID);
  },

  imageUpload: async (ctx) => withImageCreateLock(async () => {
    const requestedId = String(pick(ctx.payload, ['imageId', 'FotoDispositivoID'], '')).trim();
    const deviceId = pick(ctx.payload, ['deviceId', 'DispositivoMantenimientoRef']);
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local de la fotografía no es válido.');

    const context = await loadMaintenanceEvidenceContext({
      deviceId,
      maintenanceId: pick(ctx.payload, ['maintenanceId', 'MantenimientoID']),
    });

    if (requestedId) {
      const existing = (await readTable('Mantenimiento imagenes', { force: true })).find((item) => String(item.FotoDispositivoID) === requestedId);
      if (existing) {
        if (String(existing.DispositivoMantenimientoRef) !== String(deviceId)) throw badRequest('La fotografía local ya pertenece a otro dispositivo.');
        return { ...existing, PreviewURL: existing.DriveFileID ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(existing.DriveFileID)}&sz=w1200` : existing.DriveURL };
      }
    }

    const metadata = maintenanceEvidenceMetadata(ctx.payload, context);
    const cfg = await getConfig();
    const file = await uploadBase64({ base64: ctx.payload.base64, mimeType: ctx.payload.mimeType || 'image/jpeg', fileName: ctx.payload.fileName, folderId: cfg.EVIDENCIAS_FOLDER_ID || cfg.ROOT_FOLDER_ID });
    const timestamp = nowIso();
    const row = {
      FotoDispositivoID: requestedId || uuid(),
      DispositivoMantenimientoRef: deviceId,
      ...metadata,
      Nombre: file.name,
      Nota: pick(ctx.payload, ['Nota', 'nota']),
      MimeType: file.mimeType,
      Size: file.size || '',
      DriveFileID: file.id,
      DriveURL: file.webViewLink,
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: timestamp,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    await appendRow('Mantenimiento imagenes', row);
    return { ...row, PreviewURL: file.thumbnailLink };
  }),

  imageUpdate: async (ctx) => {
    const imageId = pick(ctx.payload, ['imageId', 'FotoDispositivoID']);
    const before = await findById('Mantenimiento imagenes', imageId);
    const context = await loadMaintenanceEvidenceContext({
      deviceId: before.DispositivoMantenimientoRef,
      maintenanceId: pick(ctx.payload, ['maintenanceId', 'MantenimientoID']),
    });
    const metadata = maintenanceEvidenceMetadata(ctx.payload, context, { existing: before });
    return updateRow('Mantenimiento imagenes', imageId, {
      ...metadata,
      Nota: pick(ctx.payload, ['Nota', 'nota'], before.Nota),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    });
  },

  imageDelete: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    const row = await findById('Mantenimiento imagenes', pick(ctx.payload, ['imageId', 'FotoDispositivoID']));
    await trashFile(row.DriveFileID).catch(() => {});
    return softDelete('Mantenimiento imagenes', row.FotoDispositivoID, ctx.user.UsuarioID);
  },

  mediaGet: async ({ payload }) => {
    const row = await findById('Mantenimiento imagenes', pick(payload, ['imageId', 'FotoDispositivoID']));
    return { FotoDispositivoID: row.FotoDispositivoID, ...await downloadAsDataUrl(row.DriveFileID, row.MimeType) };
  },

  config: async () => ({ categories: CATEGORY_CONFIG }),

  spreadsheetReport: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    const data = await enrichedMaintenanceById(pick(ctx.payload, ['maintenanceId', 'MantenimientoID']));
    const created = await sheetsApi.spreadsheets.create({ requestBody: { properties: { title: `Mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'} - ${String(data.mantenimiento.Fecha).slice(0, 10)}` } } });
    const id = created.data.spreadsheetId;
    const values = [['REPORTE DE MANTENIMIENTO DMS'], ['Título', data.mantenimiento.TituloMantenimiento], ['Cliente', data.mantenimiento.Cliente], ['Ubicación', data.mantenimiento.Ubicacion], ['Fecha', data.mantenimiento.Fecha], [], ['Categoría', 'Nombre', 'Zona', 'Fabricante', 'Modelo', 'Serie', 'Funcionamiento', 'En uso', 'Estado', 'Observación'], ...data.dispositivos.map((device) => [device.Categoria, device.NombreDispositivo, device.Zona, device.Fabricante, device.Modelo, device.Serie, device.Funcionamiento, device.EnUso, device.Estado, device.Observacion])];
    await sheetsApi.spreadsheets.values.update({ spreadsheetId: id, range: 'A1', valueInputOption: 'USER_ENTERED', requestBody: { values } });
    const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, { SpreadsheetID: id, SpreadsheetURL: url, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() });
    return { spreadsheetId: id, spreadsheetUrl: url, excelUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` };
  },

  slidesReport: async (ctx) => {
    if (!isAdmin(ctx)) throw forbidden();
    const data = await enrichedMaintenanceById(pick(ctx.payload, ['maintenanceId', 'MantenimientoID']));
    const created = await slidesApi.presentations.create({ requestBody: { title: `Mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'}` } });
    const id = created.data.presentationId;
    const url = `https://docs.google.com/presentation/d/${id}/edit`;
    await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, { SlidesID: id, SlidesURL: url, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() });
    return { slidesId: id, slidesUrl: url };
  },
};