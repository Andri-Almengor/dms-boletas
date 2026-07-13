import { MAINTENANCE_CATEGORIES, createEmptyChecklist, createEmptyMaintenanceCounts } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';

export const MAINTENANCE_STEPS = [
  ['Información general', 'Cliente, ubicación, responsables, fechas y descripción.'],
  ['Cantidades esperadas', 'Indica cuántos dispositivos se revisarán por categoría.'],
  ['Dispositivos y evidencias', 'Registra cada equipo, sus pruebas y fotografías.'],
  ['Revisión y finalización', 'Confirma la información y guarda o finaliza.'],
];

export const EMPTY_MAINTENANCE = {
  titulo: '', clienteId: '', cliente: '', ubicacionId: '', ubicacion: '', estado: 'PENDIENTE',
  fecha: new Date().toISOString().slice(0, 10),
  fechaFinalizacion: new Date().toISOString().slice(0, 10),
  responsables: [], descripcion: '', counts: createEmptyMaintenanceCounts(),
};

export function createMaintenanceDevice(category = 'Cámaras') {
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    id: '', ubicacionEquipoId: '', zona: '',
    tipoDispositivoId: '', categoria: category,
    fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
    nombre: '', serie: '', funcionamiento: '', enUso: '', estado: 'Correcto', observacion: '',
    respuestas: createEmptyChecklist(category), images: [], newImages: [],
  };
}

export function mapMaintenance(data) {
  const row = data?.mantenimiento || data || {};
  let counts = createEmptyMaintenanceCounts();
  try {
    counts = { ...counts, ...(typeof row.CantidadesJSON === 'string' ? JSON.parse(row.CantidadesJSON || '{}') : row.CantidadesJSON || {}) };
  } catch { /* Mantiene cantidades vacías. */ }
  MAINTENANCE_CATEGORIES.forEach((item) => {
    const value = pick(row, [item.countField]);
    if (value !== '') counts[item.countField] = Number(value || 0);
  });
  let responsables = [];
  try {
    responsables = Array.isArray(data?.responsables)
      ? data.responsables.map((item) => String(pick(item, ['UsuarioID', 'value'], item)))
      : JSON.parse(row.ResponsableIDsJSON || '[]').map(String);
  } catch { responsables = []; }
  return {
    ...EMPTY_MAINTENANCE,
    titulo: pick(row, ['TituloMantenimiento']),
    clienteId: String(pick(row, ['ClienteID', 'ClienteRef'])),
    cliente: pick(row, ['Cliente', 'ClienteNombre']),
    ubicacionId: String(pick(row, ['UbicacionID'])),
    ubicacion: pick(row, ['Ubicacion']),
    estado: String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase(),
    fecha: String(pick(row, ['Fecha'], EMPTY_MAINTENANCE.fecha)).slice(0, 10),
    fechaFinalizacion: String(pick(row, ['FechaFinalizacion'], EMPTY_MAINTENANCE.fechaFinalizacion)).slice(0, 10),
    responsables, descripcion: pick(row, ['DescripcionGeneral']), counts,
  };
}

export function mapMaintenanceDevice(row) {
  let respuestas = {};
  try { respuestas = typeof row.RespuestasJSON === 'string' ? JSON.parse(row.RespuestasJSON || '{}') : row.RespuestasJSON || {}; } catch { respuestas = {}; }
  return {
    localId: String(pick(row, ['EvidenciaMantenimientoID', 'id'], crypto.randomUUID?.() || Date.now())),
    id: String(pick(row, ['EvidenciaMantenimientoID', 'id'])),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID'])),
    zona: pick(row, ['Zona', 'UbicacionEspecifica']),
    tipoDispositivoId: String(pick(row, ['TipoDispositivoID'])),
    categoria: pick(row, ['TipoDispositivo', 'Categoria'], 'Cámaras'),
    fabricanteId: String(pick(row, ['FabricanteID'])),
    fabricante: pick(row, ['Fabricante']),
    modeloId: String(pick(row, ['ModeloID'])),
    modelo: pick(row, ['Modelo']),
    nombre: pick(row, ['NombreDispositivo']),
    serie: pick(row, ['Serie']),
    funcionamiento: pick(row, ['Funcionamiento']), enUso: pick(row, ['EnUso']),
    estado: pick(row, ['Estado'], 'Correcto'), observacion: pick(row, ['Observacion']), respuestas,
    images: (row.Imagenes || []).map((image) => ({ ...image, id: String(pick(image, ['FotoDispositivoID', 'id'])) })),
    newImages: [],
  };
}

export function maintenancePayload(form, id) {
  return {
    maintenanceId: id, MantenimientoID: id, TituloMantenimiento: form.titulo,
    ClienteID: form.clienteId, ClienteRef: form.clienteId, Cliente: form.cliente,
    UbicacionID: form.ubicacionId, Ubicacion: form.ubicacion, Estado: form.estado,
    Fecha: form.fecha, FechaFinalizacion: form.fechaFinalizacion,
    ResponsableIDs: form.responsables, ResponsableIDsJSON: JSON.stringify(form.responsables),
    DescripcionGeneral: form.descripcion, CantidadesJSON: JSON.stringify(form.counts), ...form.counts,
  };
}

export function maintenanceDevicePayload(device, maintenanceId) {
  return {
    maintenanceId, MantenimientoID: maintenanceId, deviceId: device.id,
    EvidenciaMantenimientoID: device.id, UbicacionEquipoID: device.ubicacionEquipoId,
    Zona: device.zona,
    TipoDispositivoID: device.tipoDispositivoId,
    TipoDispositivo: device.categoria,
    Categoria: device.categoria,
    FabricanteID: device.fabricanteId,
    Fabricante: device.fabricante,
    ModeloID: device.modeloId,
    Modelo: device.modelo,
    NombreDispositivo: device.nombre,
    Serie: device.serie, Funcionamiento: device.funcionamiento,
    EnUso: device.enUso, Estado: device.estado, Observacion: device.observacion,
    RespuestasJSON: JSON.stringify(device.respuestas), ...device.respuestas,
  };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
