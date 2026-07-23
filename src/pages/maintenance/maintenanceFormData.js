import {
  MAINTENANCE_CATEGORIES,
  canonicalMaintenanceCategoryName,
  createEmptyChecklist,
  createEmptyMaintenanceCounts,
  getMaintenanceCategory,
} from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';
import { todayInCostaRica } from '../../utils/costaRicaDate';

export const MAINTENANCE_STEPS = [
  ['Información general', 'Cliente, ubicación, responsables, fechas y descripción.'],
  ['Cantidades esperadas', 'Indica cuántos dispositivos se revisarán por categoría.'],
  ['Dispositivos y evidencias', 'Registra cada equipo, sus pruebas, técnicos y fotografías.'],
  ['Revisión y finalización', 'Confirma la información y guarda o finaliza.'],
];

export const EMPTY_MAINTENANCE = {
  titulo: '', clienteId: '', cliente: '', ubicacionId: '', ubicacion: '', estado: 'PENDIENTE',
  fecha: todayInCostaRica(),
  fechaFinalizacion: todayInCostaRica(),
  responsables: [], descripcion: '', counts: createEmptyMaintenanceCounts(),
};

function parseArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(value || '[]');
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    return String(value || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseTechnicianIds(row = {}) {
  return parseArray(pick(row, ['TecnicoIDsJSON', 'TecnicoIDs', 'tecnicoIds'], []));
}

function dateInput(value, fallback = todayInCostaRica()) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

function answerValue(row, key) {
  const upper = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  return pick(row, [key, upper], '');
}

function parseAnswers(row, categoryName) {
  let parsed = {};
  try {
    parsed = typeof row.RespuestasJSON === 'string'
      ? JSON.parse(row.RespuestasJSON || '{}')
      : row.RespuestasJSON || row.respuestas || {};
  } catch {
    parsed = {};
  }

  const answers = { ...createEmptyChecklist(categoryName), ...parsed };
  getMaintenanceCategory(categoryName).questions.forEach(([key]) => {
    const explicit = answerValue(row, key);
    if ((answers[key] === '' || answers[key] === undefined) && explicit !== '') answers[key] = explicit;
  });
  return answers;
}

function mapImage(image) {
  return {
    ...image,
    id: String(pick(image, ['FotoDispositivoID', 'imageId', 'id'])),
    Tipo: pick(image, ['Tipo', 'tipo'], 'Antes'),
    Nota: pick(image, ['Nota', 'nota']),
    dirty: false,
  };
}

export function createMaintenanceDevice(category = 'Cámara') {
  const canonicalCategory = canonicalMaintenanceCategoryName(category);
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    id: '', ubicacionEquipoId: '', zona: '',
    fechaTrabajo: todayInCostaRica(), tecnicoIds: [],
    tipoDispositivoId: '', categoria: canonicalCategory,
    fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
    nombre: '', serie: '', funcionamiento: '', enUso: '', estado: 'Correcto', observacion: '',
    respuestas: createEmptyChecklist(canonicalCategory), images: [], newImages: [],
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

  const responsables = Array.isArray(data?.responsables)
    ? data.responsables.map((item) => String(pick(item, ['UsuarioID', 'value'], item))).filter(Boolean)
    : parseArray(pick(row, ['ResponsableIDsJSON', 'ResponsableIDs'], []));

  return {
    ...EMPTY_MAINTENANCE,
    titulo: pick(row, ['TituloMantenimiento', 'titulo']),
    clienteId: String(pick(row, ['ClienteID', 'ClienteRef', 'clienteId'])),
    cliente: pick(row, ['Cliente', 'ClienteNombre', 'cliente']),
    ubicacionId: String(pick(row, ['UbicacionID', 'ubicacionId'])),
    ubicacion: pick(row, ['Ubicacion', 'ubicacion']),
    estado: String(pick(row, ['Estado', 'estado'], 'PENDIENTE')).toUpperCase(),
    fecha: dateInput(pick(row, ['Fecha', 'fecha'], EMPTY_MAINTENANCE.fecha), EMPTY_MAINTENANCE.fecha),
    fechaFinalizacion: dateInput(pick(row, ['FechaFinalizacion', 'fechaFinalizacion'], EMPTY_MAINTENANCE.fechaFinalizacion), EMPTY_MAINTENANCE.fechaFinalizacion),
    responsables,
    descripcion: pick(row, ['DescripcionGeneral', 'descripcion']),
    counts,
  };
}

export function mapMaintenanceDevice(row = {}) {
  const category = canonicalMaintenanceCategoryName(pick(row, ['TipoDispositivo', 'Categoria', 'categoria'], 'Cámara'));
  return {
    localId: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'], crypto.randomUUID?.() || Date.now())),
    id: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'])),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID', 'ubicacionEquipoId'])),
    zona: pick(row, ['Zona', 'UbicacionEspecifica', 'zona']),
    fechaTrabajo: dateInput(pick(row, ['FechaTrabajo', 'fechaTrabajo', 'FechaCreacion'], todayInCostaRica())),
    tecnicoIds: parseTechnicianIds(row),
    tipoDispositivoId: String(pick(row, ['TipoDispositivoID', 'tipoDispositivoId'])),
    categoria: category,
    fabricanteId: String(pick(row, ['FabricanteID', 'fabricanteId'])),
    fabricante: pick(row, ['Fabricante', 'fabricante']),
    modeloId: String(pick(row, ['ModeloID', 'modeloId'])),
    modelo: pick(row, ['Modelo', 'modelo']),
    nombre: pick(row, ['NombreDispositivo', 'nombre', 'Nombre']),
    serie: pick(row, ['Serie', 'serie']),
    funcionamiento: pick(row, ['Funcionamiento', 'funcionamiento']),
    enUso: pick(row, ['EnUso', 'enUso']),
    estado: pick(row, ['Estado', 'estado'], 'Correcto'),
    observacion: pick(row, ['Observacion', 'observacion']),
    respuestas: parseAnswers(row, category),
    images: (row.Imagenes || row.images || []).map(mapImage),
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
  const technicianIds = (device.tecnicoIds || []).map(String).filter(Boolean);
  const category = canonicalMaintenanceCategoryName(device.categoria);
  return {
    maintenanceId, MantenimientoID: maintenanceId, deviceId: device.id,
    EvidenciaMantenimientoID: device.id, UbicacionEquipoID: device.ubicacionEquipoId,
    Zona: device.zona,
    FechaTrabajo: device.fechaTrabajo,
    fechaTrabajo: device.fechaTrabajo,
    TecnicoIDs: technicianIds,
    tecnicoIds: technicianIds,
    TecnicoIDsJSON: JSON.stringify(technicianIds),
    TipoDispositivoID: device.tipoDispositivoId,
    TipoDispositivo: category,
    Categoria: category,
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
