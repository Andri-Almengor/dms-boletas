import { appendRow, filterRows, findById, readTable, softDelete, updateRow } from '../infra/sheets.repository.js';
import { uploadBase64, downloadAsDataUrl, trashFile } from '../infra/drive.repository.js';
import { badRequest, forbidden } from '../core/errors.js';
import { asArray, nowIso, pick, uuid } from '../core/utils.js';
import { getConfig } from './config.module.js';
import { audit } from '../services/audit.service.js';
import { sheetsApi, slidesApi } from '../infra/google.js';

const deviceAutosaveWriteTimes = new Map();
const DEVICE_AUTOSAVE_MIN_INTERVAL_MS = 6000;
let maintenanceCreateTail = Promise.resolve();
let maintenanceDeviceCreateTail = Promise.resolve();
let maintenanceImageCreateTail = Promise.resolve();

const CATEGORY_CONFIG = [
  { key: 'Cámaras', countField: 'CantCámaras', questions: [['limpieza', 'Limpieza'], ['alimentacion', 'Alimentación'], ['conexion', 'Conexión'], ['montaje', 'Montaje'], ['visualizacion', 'Visualización']] },
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

function maintenancePayload(payload, before = {}) {
  const counts = payload.counts || payload.cantidades || (() => {
    try { return JSON.parse(payload.CantidadesJSON || '{}'); } catch { return {}; }
  })();
  const row = {
    TituloMantenimiento: pick(payload, ['TituloMantenimiento', 'titulo'], before.TituloMantenimiento),
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
  };
  CATEGORY_CONFIG.forEach((category) => {
    row[category.countField] = Number(counts[category.countField] ?? payload[category.countField] ?? before[category.countField] ?? 0);
  });
  return row;
}

function devicePayload(payload, before = {}) {
  let answers = payload.respuestas || payload.answers || payload.RespuestasJSON || before.RespuestasJSON || {};
  if (typeof answers === 'string') {
    try { answers = JSON.parse(answers); } catch { answers = {}; }
  }
  return {
    UbicacionEquipoID: pick(payload, ['UbicacionEquipoID', 'ubicacionEquipoId'], before.UbicacionEquipoID),
    Zona: pick(payload, ['Zona', 'zona'], before.Zona),
    Categoria: pick(payload, ['Categoria', 'categoria', 'TipoDispositivo'], before.Categoria),
    NombreDispositivo: pick(payload, ['NombreDispositivo', 'nombre'], before.NombreDispositivo),
    TipoDispositivoID: pick(payload, ['TipoDispositivoID', 'tipoDispositivoId'], before.TipoDispositivoID),
    TipoDispositivo: pick(payload, ['TipoDispositivo', 'categoria'], before.TipoDispositivo || before.Categoria),
    FabricanteID: pick(payload, ['FabricanteID', 'fabricanteId'], before.FabricanteID),
    Fabricante: pick(payload, ['Fabricante', 'fabricante'], before.Fabricante),
    ModeloID: pick(payload, ['ModeloID', 'modeloId'], before.ModeloID),
    Modelo: pick(payload, ['Modelo', 'modelo'], before.Modelo),
    Serie: pick(payload, ['Serie', 'serie'], before.Serie),
    Funcionamiento: pick(payload, ['Funcionamiento', 'funcionamiento'], before.Funcionamiento),
    EnUso: pick(payload, ['EnUso', 'enUso'], before.EnUso),
    Estado: pick(payload, ['Estado', 'estado'], before.Estado || 'Correcto'),
    Observacion: pick(payload, ['Observacion', 'observacion'], before.Observacion),
    RespuestasJSON: JSON.stringify(answers),
    ...Object.fromEntries(Object.entries(answers).map(([key, value]) => [key.charAt(0).toUpperCase() + key.slice(1), value])),
  };
}

function changedDevicePatch(before, payload, userId) {
  const candidate = devicePayload(payload, before);
  const changed = Object.fromEntries(Object.entries(candidate).filter(([key, value]) => !sameValue(before[key], value)));
  if (!Object.keys(changed).length) return {};
  return { ...changed, ActualizadoPor: userId, FechaActualizacion: nowIso() };
}

async function enrich(row) {
  const devices = (await readTable('Evidencia_Mantenimientos'))
    .filter((device) => String(device.MantenimientoRef) === String(row.MantenimientoID) && device.Activo !== false);
  const images = await readTable('Mantenimiento imagenes');
  return {
    mantenimiento: row,
    responsables: asArray(row.ResponsableIDsJSON).map((UsuarioID) => ({ UsuarioID })),
    dispositivos: devices.map((device) => ({
      ...device,
      Imagenes: images
        .filter((image) => String(image.DispositivoMantenimientoRef) === String(device.EvidenciaMantenimientoID) && image.Activo !== false)
        .map((image) => ({ ...image, PreviewURL: image.DriveFileID ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(image.DriveFileID)}&sz=w1200` : image.DriveURL })),
    })),
  };
}

function isAdmin(ctx) {
  return ctx.permissions.includes('USUARIOS_GESTIONAR') || ctx.permissions.includes('MANTENIMIENTOS_ELIMINAR') || ctx.permissions.includes('MANTENIMIENTOS_GESTIONAR');
}

export const maintenanceHandlers = {
  list: async ({ payload }) => {
    let rows = (await readTable('Mantenimiento')).filter((row) => row.Activo !== false);
    if (payload.dateFrom) rows = rows.filter((row) => String(row.Fecha).slice(0, 10) >= String(payload.dateFrom));
    if (payload.dateTo) rows = rows.filter((row) => String(row.Fecha).slice(0, 10) <= String(payload.dateTo));
    const devices = await readTable('Evidencia_Mantenimientos');
    rows = rows.map((row) => ({ ...row, DispositivosRegistrados: devices.filter((device) => String(device.MantenimientoRef) === String(row.MantenimientoID) && device.Activo !== false).length }));
    return filterRows(rows, payload, ['TituloMantenimiento', 'Cliente', 'Ubicacion', 'Responsables', 'DescripcionGeneral']);
  },

  get: async ({ payload }) => enrich(await findById('Mantenimiento', pick(payload, ['maintenanceId', 'MantenimientoID', 'id']))),

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
    const ids = asArray(base.ResponsableIDsJSON);
    const row = {
      MantenimientoID: requestedId || uuid(),
      ...base,
      Responsables: ids.map((id) => users.find((user) => String(user.UsuarioID) === String(id))?.NombreCompleto || id).join(', '),
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
    const before = await findById('Mantenimiento', id);
    const payload = maintenancePayload(ctx.payload, before);
    const users = await readTable('Usuarios');
    payload.Responsables = asArray(payload.ResponsableIDsJSON).map((userId) => users.find((user) => String(user.UsuarioID) === String(userId))?.NombreCompleto || userId).join(', ');
    const changed = Object.fromEntries(Object.entries(payload).filter(([key, value]) => !sameValue(before[key], value)));
    const after = Object.keys(changed).length
      ? await updateRow('Mantenimiento', id, { ...changed, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() })
      : before;
    if (Object.keys(changed).length) await audit(ctx, 'EDITAR_MANTENIMIENTO', 'Mantenimiento', id, before, after);
    return enrich(after);
  },

  finalize: async (ctx) => {
    const id = pick(ctx.payload, ['maintenanceId', 'MantenimientoID']);
    const devices = (await readTable('Evidencia_Mantenimientos')).filter((device) => String(device.MantenimientoRef) === String(id) && device.Activo !== false);
    if (!devices.length) throw badRequest('Debe registrar al menos un dispositivo.');
    return enrich(await updateRow('Mantenimiento', id, { Estado: 'FINALIZADO', FechaFinalizacion: nowIso(), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }));
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
    const payload = devicePayload(ctx.payload);
    const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']);
    const requestedId = String(pick(ctx.payload, ['deviceId', 'EvidenciaMantenimientoID'], '')).trim();
    if (requestedId && !validClientGeneratedId(requestedId)) throw badRequest('El identificador local del dispositivo no es válido.');
    if (!maintenanceId || !payload.Categoria || !payload.NombreDispositivo || !payload.Zona) throw badRequest('Categoría, nombre y ubicación son obligatorios.');
    await findById('Mantenimiento', maintenanceId);

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
    const patch = changedDevicePatch(before, ctx.payload, ctx.user.UsuarioID);
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
      const patch = changedDevicePatch(before, ctx.payload, ctx.user.UsuarioID);
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
    await findById('Evidencia_Mantenimientos', deviceId);

    if (requestedId) {
      const existing = (await readTable('Mantenimiento imagenes', { force: true })).find((item) => String(item.FotoDispositivoID) === requestedId);
      if (existing) {
        if (String(existing.DispositivoMantenimientoRef) !== String(deviceId)) throw badRequest('La fotografía local ya pertenece a otro dispositivo.');
        return { ...existing, PreviewURL: existing.DriveFileID ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(existing.DriveFileID)}&sz=w1200` : existing.DriveURL };
      }
    }

    const cfg = await getConfig();
    const file = await uploadBase64({ base64: ctx.payload.base64, mimeType: ctx.payload.mimeType || 'image/jpeg', fileName: ctx.payload.fileName, folderId: cfg.EVIDENCIAS_FOLDER_ID || cfg.ROOT_FOLDER_ID });
    const row = {
      FotoDispositivoID: requestedId || uuid(),
      DispositivoMantenimientoRef: deviceId,
      Tipo: String(pick(ctx.payload, ['Tipo', 'tipo'], 'Antes')).toLowerCase().includes('desp') ? 'Despues' : 'Antes',
      Nombre: file.name,
      Nota: pick(ctx.payload, ['Nota', 'nota']),
      MimeType: file.mimeType,
      Size: file.size || '',
      DriveFileID: file.id,
      DriveURL: file.webViewLink,
      Activo: true,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    await appendRow('Mantenimiento imagenes', row);
    return { ...row, PreviewURL: file.thumbnailLink };
  }),

  imageUpdate: async (ctx) => updateRow('Mantenimiento imagenes', pick(ctx.payload, ['imageId', 'FotoDispositivoID']), { Tipo: pick(ctx.payload, ['Tipo', 'tipo']), Nota: pick(ctx.payload, ['Nota', 'nota']), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() }),

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
    const data = await enrich(await findById('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID'])));
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
    const data = await enrich(await findById('Mantenimiento', pick(ctx.payload, ['maintenanceId', 'MantenimientoID'])));
    const created = await slidesApi.presentations.create({ requestBody: { title: `Mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'}` } });
    const id = created.data.presentationId;
    const url = `https://docs.google.com/presentation/d/${id}/edit`;
    await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, { SlidesID: id, SlidesURL: url, ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() });
    return { slidesId: id, slidesUrl: url };
  },
};
