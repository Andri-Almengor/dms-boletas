import {
  MAINTENANCE_CATEGORIES,
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
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    return String(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseTechnicianIds(row = {}) {
  return parseArray(pick(row, ['TecnicoIDsJSON', 'TecnicoIDs', 'tecnicoIds'], []));
}

function normalizedDate(value, fallback = todayInCostaRica()) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const isoMatch = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return fallback;
}

function parseAnswers(row = {}, categoryName = '') {
  let parsed = {};
  const source = pick(row, ['RespuestasJSON', 'respuestas', 'answers'], {});
  try {
    parsed = typeof source === 'string' ? JSON.parse(source || '{}') : source || {};
  } catch {
    parsed = {};
  }

  const canonicalCategory = getMaintenanceCategory(categoryName).key;
  const empty = createEmptyChecklist(canonicalCategory);
  const answers = { ...empty };
  const allQuestionKeys = new Set(MAINTENANCE_CATEGORIES.flatMap((item) => item.questions.map(([key]) => key)));

  allQuestionKeys.forEach((key) => {
    const capitalized = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const value = pick(parsed, [key, capitalized], pick(row, [key, capitalized], ''));
    if (value !== '') answers[key] = value;
  });

  Object.entries(parsed || {}).forEach(([key, value]) => {
    const normalizedKey = `${String(key).charAt(0).toLowerCase()}${String(key).slice(1)}`;
    if (value !== undefined && value !== null && value !== '') answers[normalizedKey] = value;
  });

  return answers;
}

export function createMaintenanceDevice(category = 'Cámaras') {
  const canonicalCategory = getMaintenanceCategory(category).key;
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
  let responsables = [];
  try {
    responsables = Array.isArray(data?.responsables)
      ? data.responsables.map((item) => String(pick(item, ['UsuarioID', 'value'], item)))
      : parseArray(row.ResponsableIDsJSON);
  } catch { responsables = []; }
  return {
    ...EMPTY_MAINTENANCE,
    titulo: pick(row, ['TituloMantenimiento']),
    clienteId: String(pick(row, ['ClienteID', 'ClienteRef'])),
    cliente: pick(row, ['Cliente', 'ClienteNombre']),
    ubicacionId: String(pick(row, ['UbicacionID'])),
    ubicacion: pick(row, ['Ubicacion']),
    estado: String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase(),
    fecha: normalizedDate(pick(row, ['Fecha'], EMPTY_MAINTENANCE.fecha), EMPTY_MAINTENANCE.fecha),
    fechaFinalizacion: normalizedDate(pick(row, ['FechaFinalizacion'], EMPTY_MAINTENANCE.fechaFinalizacion), EMPTY_MAINTENANCE.fechaFinalizacion),
    responsables, descripcion: pick(row, ['DescripcionGeneral']), counts,
  };
}

export function mapMaintenanceDevice(row = {}) {
  const rawCategory = pick(row, ['TipoDispositivo', 'Categoria', 'categoria'], 'Cámaras');
  const canonicalCategory = getMaintenanceCategory(rawCategory).key;
  const images = pick(row, ['Imagenes', 'images'], []);
  return {
    localId: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'], crypto.randomUUID?.() || Date.now())),
    id: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'])),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID', 'ubicacionEquipoId'])),
    zona: pick(row, ['Zona', 'UbicacionEspecifica', 'zona']),
    fechaTrabajo: normalizedDate(pick(row, ['FechaTrabajo', 'fechaTrabajo', 'FechaCreacion'], todayInCostaRica())),
    tecnicoIds: parseTechnicianIds(row),
    tipoDispositivoId: String(pick(row, ['TipoDispositivoID', 'tipoDispositivoId'])),
    categoria: canonicalCategory,
    fabricanteId: String(pick(row, ['FabricanteID', 'fabricanteId'])),
    fabricante: pick(row, ['Fabricante', 'fabricante']),
    modeloId: String(pick(row, ['ModeloID', 'modeloId'])),
    modelo: pick(row, ['Modelo', 'modelo']),
    nombre: pick(row, ['NombreDispositivo', 'NombreEquipo', 'Descripcion', 'nombre']),
    serie: pick(row, ['Serie', 'serie']),
    funcionamiento: pick(row, ['Funcionamiento', 'funcionamiento']),
    enUso: pick(row, ['EnUso', 'enUso']),
    estado: pick(row, ['EstadoDispositivo', 'Estado', 'estado'], 'Correcto'),
    observacion: pick(row, ['Observacion', 'Observaciones', 'observacion']),
    respuestas: parseAnswers(row, canonicalCategory),
    images: (Array.isArray(images) ? images : []).map((image) => ({
      ...image,
      id: String(pick(image, ['FotoDispositivoID', 'imageId', 'id'])),
    })),
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
    TipoDispositivo: device.categoria,
    Categoria: device.categoria,
    FabricanteID: device.fabricanteId,
    Fabricante: device.fabricante,
    ModeloID: device.modeloId,
    Modelo: device.modelo,
    NombreDispositivo: device.nombre,
    Serie: device.serie,
    Funcionamiento: device.funcionamiento,
    EnUso: device.enUso,
    Estado: device.estado,
    Observacion: device.observacion,
    RespuestasJSON: JSON.stringify(device.respuestas),
    ...device.respuestas,
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
