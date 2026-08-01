import {
  MAINTENANCE_CATEGORIES,
  canonicalMaintenanceCategoryName,
  createEmptyChecklist,
  createEmptyMaintenanceCounts,
  getMaintenanceCategory,
} from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';
import {
  maintenanceDeviceSyncBase,
  maintenanceImageSyncBase,
  maintenanceSyncBase,
  withSyncBase,
} from '../../services/maintenanceSyncBase';
import { todayInCostaRica } from '../../utils/costaRicaDate';
import { createLocalId } from '../../utils/localId';
import {
  AUTOMATIC_PENDING_STATE,
  effectiveMaintenanceDeviceState,
} from '../../utils/maintenanceChecklistStatus';

export { fileToBase64 } from '../../utils/fileEncoding';

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
  responsables: [], descripcion: '', counts: createEmptyMaintenanceCounts(), syncBase: null,
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

function parseAnswersBundle(row, categoryName) {
  let parsed = {};
  try {
    parsed = typeof row.RespuestasJSON === 'string'
      ? JSON.parse(row.RespuestasJSON || '{}')
      : row.RespuestasJSON || row.respuestas || {};
  } catch {
    parsed = {};
  }

  const questionDetails = Array.isArray(parsed.__preguntas)
    ? parsed.__preguntas.map((item) => ({
      questionId: String(item.questionId || item.PreguntaDispositivoID || ''),
      typeId: String(item.typeId || item.TipoDispositivoID || ''),
      key: String(item.key || item.Clave || ''),
      label: String(item.label || item.Pregunta || item.key || ''),
      order: Number(item.order ?? item.Orden ?? 0),
      responseType: String(item.responseType || item.TipoRespuesta || 'SI_NO'),
      value: String(item.value ?? ''),
      activeAtSave: item.activeAtSave !== false,
      historical: item.activeAtSave === false,
    })).filter((item) => item.key)
    : [];

  const { __preguntas: _questionMetadata, ...plainAnswers } = parsed;
  const answers = { ...createEmptyChecklist(categoryName), ...plainAnswers };
  questionDetails.forEach((item) => {
    if ((answers[item.key] === '' || answers[item.key] === undefined) && item.value !== '') answers[item.key] = item.value;
  });
  getMaintenanceCategory(categoryName).questions.forEach(([key]) => {
    const explicit = answerValue(row, key);
    if ((answers[key] === '' || answers[key] === undefined) && explicit !== '') answers[key] = explicit;
  });
  return { answers, questionDetails };
}

function mapImage(image, maintenanceId = '') {
  return {
    ...image,
    id: String(pick(image, ['FotoDispositivoID', 'imageId', 'id'])),
    Tipo: pick(image, ['Tipo', 'tipo'], 'Antes'),
    Nota: pick(image, ['Nota', 'nota']),
    syncBase: maintenanceImageSyncBase(image, maintenanceId),
    dirty: false,
  };
}

export function createMaintenanceDevice(category = 'Cámara') {
  const canonicalCategory = canonicalMaintenanceCategoryName(category);
  return {
    localId: createLocalId(),
    id: '', ubicacionEquipoId: '', ubicacionEquipoNombre: '', zona: '',
    fechaTrabajo: todayInCostaRica(), tecnicoIds: [],
    tipoDispositivoId: '', categoria: canonicalCategory,
    fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
    nombre: '', serie: '', funcionamiento: '', enUso: '', estado: AUTOMATIC_PENDING_STATE, observacion: '',
    respuestas: createEmptyChecklist(canonicalCategory), questionDetails: [], images: [], newImages: [], syncBase: null,
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
    syncBase: maintenanceSyncBase(row),
  };
}

export function mapMaintenanceDevice(row = {}) {
  const category = canonicalMaintenanceCategoryName(pick(row, ['TipoDispositivo', 'Categoria', 'categoria'], 'Cámara'));
  const bundle = parseAnswersBundle(row, category);
  const equipmentLocationName = pick(row, [
    'UbicacionEquipoNombre',
    'equipmentLocationName',
    'UbicacionEquipo',
    'Ubicación del equipo',
  ]);
  const legacyLocation = pick(row, ['Zona', 'UbicacionEspecifica', 'zona']);
  const maintenanceId = String(pick(row, ['MantenimientoRef', 'maintenanceId', 'MantenimientoID']));
  const mapped = {
    localId: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'], createLocalId())),
    id: String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'])),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID', 'ubicacionEquipoId'])),
    ubicacionEquipoNombre: equipmentLocationName,
    // `zona` se conserva como alias visual y de compatibilidad, pero siempre prioriza
    // el nombre resuelto desde el dropdown de ubicación del equipo.
    zona: equipmentLocationName || legacyLocation,
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
    estado: pick(row, ['Estado', 'estado'], AUTOMATIC_PENDING_STATE),
    observacion: pick(row, ['Observacion', 'observacion']),
    respuestas: bundle.answers,
    questionDetails: bundle.questionDetails,
    images: (row.Imagenes || row.images || []).map((image) => mapImage(image, maintenanceId)),
    newImages: [],
    syncBase: maintenanceDeviceSyncBase(row, maintenanceId),
  };
  return {
    ...mapped,
    estado: effectiveMaintenanceDeviceState(mapped, getMaintenanceCategory(category).questions),
  };
}

export function maintenancePayload(form, id) {
  return withSyncBase({
    maintenanceId: id, MantenimientoID: id, TituloMantenimiento: form.titulo,
    ClienteID: form.clienteId, ClienteRef: form.clienteId, Cliente: form.cliente,
    UbicacionID: form.ubicacionId, Ubicacion: form.ubicacion, Estado: form.estado,
    Fecha: form.fecha, FechaFinalizacion: form.fechaFinalizacion,
    ResponsableIDs: form.responsables, ResponsableIDsJSON: JSON.stringify(form.responsables),
    DescripcionGeneral: form.descripcion, CantidadesJSON: JSON.stringify(form.counts), ...form.counts,
  }, form.syncBase);
}

export function maintenanceDevicePayload(device, maintenanceId) {
  const technicianIds = (device.tecnicoIds || []).map(String).filter(Boolean);
  const category = canonicalMaintenanceCategoryName(device.categoria);
  const equipmentLocationName = String(device.ubicacionEquipoNombre || device.zona || '').trim();
  const effectiveState = effectiveMaintenanceDeviceState(device, getMaintenanceCategory(category).questions);
  return withSyncBase({
    maintenanceId, MantenimientoID: maintenanceId, deviceId: device.id,
    EvidenciaMantenimientoID: device.id,
    UbicacionEquipoID: device.ubicacionEquipoId,
    ubicacionEquipoId: device.ubicacionEquipoId,
    UbicacionEquipoNombre: equipmentLocationName,
    ubicacionEquipoNombre: equipmentLocationName,
    // Compatibilidad con reportes existentes: Zona replica el valor del dropdown.
    Zona: equipmentLocationName,
    zona: equipmentLocationName,
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
    EnUso: device.enUso, Estado: effectiveState, Observacion: device.observacion,
    questionDetails: device.questionDetails || [],
    respuestasDetalle: device.questionDetails || [],
    RespuestasJSON: JSON.stringify(device.respuestas), ...device.respuestas,
  }, device.syncBase);
}
