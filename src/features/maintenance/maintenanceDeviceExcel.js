import { createMaintenanceDevice } from '../../pages/maintenance/maintenanceFormData.js';
import { MAX_BULK_MAINTENANCE_DEVICES } from './maintenanceDeviceState.js';
import { normalizeMacAddress, macAddressError } from '../../utils/macAddress.js';
import { pick } from '../../services/moduleApi.js';
import { projectQuestionRequired } from './maintenanceProjectRelations.js';

export const DEVICE_EXCEL_FIELDS = Object.freeze([
  'UbicacionEquipoID', 'UbicacionEquipo', 'TipoDispositivoID', 'TipoDispositivo',
  'NombreDispositivo', 'FabricanteID', 'Fabricante', 'ModeloID', 'Modelo',
  'Serie', 'DireccionMAC', 'FechaTrabajo', 'TecnicoIDs', 'Funcionamiento',
  'EnUso', 'Estado', 'Observacion',
]);
const clean = (value) => String(value ?? '').trim();
const identity = (value) => clean(value).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

function resolve(rows, id, name, idKeys, nameKeys, label, errors) {
  if (!id && !name) return null;
  const matches = rows.filter((row) => id
    ? clean(pick(row, idKeys)) === id
    : identity(pick(row, nameKeys)) === identity(name));
  if (matches.length !== 1) errors.push(label + ': ' + (matches.length ? 'nombre ambiguo, use el ID' : 'no existe'));
  else if (id && name && identity(pick(matches[0], nameKeys)) !== identity(name)) {
    errors.push(label + ': el ID y el nombre no coinciden');
  }
  return matches.length === 1 ? matches[0] : null;
}

function questionAnswer(value, question, errors) {
  if (!value) return '';
  const type = clean(question.responseType || 'SI_NO').toUpperCase();
  if (type === 'SI_NO') {
    if (['si', 'sí', '1', 'true'].includes(identity(value))) return 'Sí';
    if (['no', '0', 'false'].includes(identity(value))) return 'No';
    errors.push(question.label + ': responda Sí o No');
    return '';
  }
  if (type === 'OPCIONES') {
    const option = (question.config?.options || []).find((item) => identity(item) === identity(value));
    if (!option) errors.push(question.label + ': opción no disponible');
    return option || '';
  }
  if (type === 'NUMERO' || type === 'CANTIDAD') {
    const number = Number(value);
    if (!Number.isFinite(number) || !/^[-+]?\d+(\.\d+)?$/.test(value)
      || (type === 'CANTIDAD' && (!Number.isInteger(number) || number < 0))) {
      errors.push(question.label + ': número inválido');
    }
  }
  if (type === 'MAC') {
    if (macAddressError(value)) errors.push(question.label + ': MAC inválida');
    return normalizeMacAddress(value);
  }
  if (type === 'RELACION_DISPOSITIVO') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Objeto inválido');
      return parsed;
    } catch {
      errors.push(question.label + ': se requiere JSON válido o dejar la celda vacía');
      return '';
    }
  }
  return value;
}

export function excelQuestionColumns(questions = [], mode = 'MANTENIMIENTO') {
  const byKey = new Map();
  questions.forEach((q) => {
    if (q.key && q.active !== false && ['AMBOS', mode].includes(q.appliesTo || 'MANTENIMIENTO') && !byKey.has(q.key)) {
      byKey.set(q.key, q);
    }
  });
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, 'es'));
}

export function excelTemplateSheets({ deviceTypes, equipmentOptions, technicians, questions, mode }) {
  const active = excelQuestionColumns(questions, mode);
  return [
    { name: 'Dispositivos', rows: [[...DEVICE_EXCEL_FIELDS, ...active.map((q) => 'Pregunta:' + q.key)]] },
    { name: 'Instrucciones', rows: [
      ['PASO', 'INSTRUCCIÓN'],
      ['1', 'Una fila por dispositivo en la pestaña Dispositivos. No cambie encabezados ni claves de pregunta.'],
      ['2', 'UbicacionEquipoID y TipoDispositivoID: use los IDs de Catalogos. No se crean ubicaciones o tipos nuevos.'],
      ['3', 'NombreDispositivo: obligatorio. Serie, MAC, fabricante, modelo y observación: opcionales.'],
      ['4', 'FechaTrabajo: AAAA-MM-DD. Si se omite, se usa la fecha actual de Costa Rica.'],
      ['5', 'TecnicoIDs: identificadores separados con ;. Si queda vacío, se usan los técnicos seleccionados en pantalla.'],
      ['6', 'Funcionamiento: Sí o No. EnUso: Sí, en uso / No, está guardado / No.'],
      ['7', 'Preguntas tipo SI_NO: Sí / No. OPCIONES: elija una de las opciones que indica Preguntas.'],
      ['8', 'Preguntas NUMERO/CANTIDAD: números. MAC: AA:BB:CC:DD:EE:FF.'],
      ['9', 'RELACION_DISPOSITIVO: objeto JSON válido, o complete la relación manualmente después.'],
      ['10', 'Estado efectivo calculado por las reglas existentes. Si no completa respuestas, permanece pendiente.'],
      ['11', 'Límite: ' + MAX_BULK_MAINTENANCE_DEVICES + ' filas por archivo. Revise la vista previa antes de guardar.'],
      ['12', 'En fallos parciales, el botón Reintentar guarda solo filas no confirmadas.'],
    ] },
    { name: 'Catalogos', rows: [
      ['TIPO', 'ID', 'NOMBRE'],
      ...deviceTypes.map((item) => ['Tipo de dispositivo', clean(item.typeId), clean(item.label || item.key)]),
      ...equipmentOptions.map((item) => ['Ubicación', clean(item.value), clean(item.label)]),
      ...technicians.map((item) => ['Técnico', clean(item.value || item.id || item.UsuarioID), clean(item.label || item.name || item.NombreCompleto)]),
    ] },
    { name: 'Preguntas', rows: [
      ['TIPO', 'CLAVE EN EXCEL', 'PREGUNTA', 'RESPUESTA', 'OPCIONES', 'OBLIGATORIO EN PROYECTO'],
      ...active.map((q) => [clean(q.typeName || 'Todos'), 'Pregunta:' + q.key,
        clean(q.label), clean(q.responseType), (q.config?.options || []).join(' | '),
        projectQuestionRequired(q) ? 'Sí' : 'No']),
    ] },
  ];
}

export function validateDeviceExcelRows({
  headers, rows, deviceTypes, equipmentOptions, catalogs = {}, technicians = [],
  questionsForDevice, maintenanceType = 'MANTENIMIENTO', fallbackTechnicianIds = [],
}) {
  const columns = new Map(headers.map((name, i) => [clean(name), i]));
  const problems = [];
  if (columns.size !== headers.filter(Boolean).length) problems.push('Encabezados duplicados.');
  if (!rows.length) problems.push('La hoja Dispositivos está vacía.');
  if (rows.length > MAX_BULK_MAINTENANCE_DEVICES) problems.push('Máximo ' + MAX_BULK_MAINTENANCE_DEVICES + ' dispositivos.');
  const value = (row, field) => clean(row[columns.get(field)]);

  const knownQuestions = new Set(deviceTypes.flatMap((type) =>
    questionsForDevice({ tipoDispositivoId: type.typeId, categoria: type.key }, maintenanceType)
      .map((q) => 'Pregunta:' + q.key)));
  headers.filter((h) => h?.startsWith('Pregunta:') && !knownQuestions.has(h))
    .forEach((h) => problems.push('Pregunta no reconocida: ' + h));

  const prepared = rows.slice(0, MAX_BULK_MAINTENANCE_DEVICES).map((row, index) => {
    const issues = [];
    const name = value(row, 'NombreDispositivo');
    if (!name) issues.push('Falta NombreDispositivo');
    const type = resolve(deviceTypes.map((t) => ({ id: t.typeId, name: t.key, item: t })),
      value(row, 'TipoDispositivoID'), value(row, 'TipoDispositivo'),
      ['id'], ['name'], 'Tipo', issues)?.item;
    if (!type) issues.push('Tipo no habilitado en las cantidades de este mantenimiento');
    const location = resolve(equipmentOptions.map((l) => ({ id: l.value, name: l.label, item: l })),
      value(row, 'UbicacionEquipoID'), value(row, 'UbicacionEquipo'),
      ['id'], ['name'], 'Ubicación', issues)?.item;
    if (!location) issues.push('Seleccione una ubicación válida');
    const draft = createMaintenanceDevice(type?.key || 'Cámara', maintenanceType);
    Object.assign(draft, {
      nombre: name, tipoDispositivoId: clean(type?.typeId),
      ubicacionEquipoId: clean(location?.value), ubicacionEquipoNombre: clean(location?.label),
      zona: clean(location?.label), serie: value(row, 'Serie'),
      observacion: value(row, 'Observacion'),
    });
    const mac = value(row, 'DireccionMAC');
    if (macAddressError(mac)) issues.push('Dirección MAC inválida');
    draft.macAddress = normalizeMacAddress(mac);
    const date = value(row, 'FechaTrabajo');
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))
        || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) issues.push('FechaTrabajo debe ser AAAA-MM-DD');
      else draft.fechaTrabajo = date;
    }
    const maker = resolve(catalogs.manufacturers || [],
      value(row, 'FabricanteID'), value(row, 'Fabricante'),
      ['FabricanteID', 'id'], ['Nombre', 'nombre'], 'Fabricante', issues);
    if (maker) {
      draft.fabricanteId = clean(pick(maker, ['FabricanteID', 'id']));
      draft.fabricante = clean(pick(maker, ['Nombre', 'nombre']));
      if ((catalogs.relations || []).length && type?.typeId
        && !catalogs.relations.some((relation) =>
          clean(pick(relation, ['TipoDispositivoID'])) === clean(type.typeId)
          && clean(pick(relation, ['FabricanteID'])) === draft.fabricanteId)) issues.push('Fabricante no corresponde al tipo');
    }
    const model = resolve((catalogs.models || []).filter((m) =>
      !maker || clean(pick(m, ['FabricanteID'])) === draft.fabricanteId),
    value(row, 'ModeloID'), value(row, 'Modelo'),
    ['ModeloID', 'id'], ['Nombre', 'nombre'], 'Modelo', issues);
    if (model) {
      draft.modeloId = clean(pick(model, ['ModeloID', 'id']));
      draft.modelo = clean(pick(model, ['Nombre', 'nombre']));
    }
    const ids = value(row, 'TecnicoIDs');
    draft.tecnicoIds = ids ? [...new Set(ids.split(/[;,]/).map(clean).filter(Boolean))] : [...fallbackTechnicianIds];
    draft.tecnicoIds.forEach((id) => {
      if (!technicians.some((t) => id === clean(t.value || t.id || t.UsuarioID))) issues.push('Técnico no asignable: ' + id);
    });
    const operating = value(row, 'Funcionamiento');
    if (operating) {
      if (!['si', 'no', 'no aplica'].includes(identity(operating))) issues.push('Funcionamiento no válido');
      else draft.funcionamiento = identity(operating) === 'si' ? 'Sí' : identity(operating) === 'no' ? 'No' : 'No aplica';
    }
    const inUse = value(row, 'EnUso');
    if (inUse) {
      if (!['si, en uso', 'no, esta guardado', 'no'].includes(identity(inUse))) issues.push('EnUso no válido');
      else draft.enUso = identity(inUse) === 'si, en uso' ? 'Sí, en uso' : identity(inUse) === 'no' ? 'No' : 'No, está guardado';
    }
    const state = value(row, 'Estado');
    if (state) {
      if (!['pendiente', 'correcto', 'mal estado'].includes(identity(state))) issues.push('Estado no válido');
      else draft.estado = state;
    }
    const questions = type ? questionsForDevice(draft, maintenanceType) : [];
    const valid = new Set(questions.map((q) => q.key));
    questions.forEach((q) => {
      const answer = value(row, 'Pregunta:' + q.key);
      if (maintenanceType === 'PROYECTO' && projectQuestionRequired(q) && !answer) issues.push('Pregunta obligatoria: ' + q.label);
      if (answer) draft.respuestas[q.key] = questionAnswer(answer, q, issues);
    });
    headers.filter((h) => h?.startsWith('Pregunta:')).forEach((h) => {
      if (value(row, h) && !valid.has(h.slice(9))) issues.push(h + ' no aplica a este tipo');
    });
    draft.questionDetails = questions.map((q) => ({ ...q, value: draft.respuestas[q.key] ?? '' }));
    return { rowNumber: index + 2, name, draft, locationName: location?.label || '', issues };
  });
  return { rows: prepared, errors: [...problems, ...prepared.flatMap((r) =>
    r.issues.map((issue) => 'Fila ' + r.rowNumber + ': ' + issue))] };
}
