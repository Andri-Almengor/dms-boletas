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


// Los nombres visibles sustituyen a los IDs y claves internas del Excel anterior.
// Cada pestaña corresponde a un tipo realmente seleccionado en el mantenimiento.
export const DEVICE_EXCEL_LABELS = Object.freeze([
  'Nombre del dispositivo', 'Ubicación del equipo', 'Fabricante', 'Modelo',
  'Serie', 'Dirección MAC', 'Fecha de trabajo', 'Técnicos',
  'Funcionamiento', 'En uso', 'Estado', 'Observación',
]);

export function excelDeviceSheetNames(deviceTypes = []) {
  const used = new Set(['instrucciones', 'listas', 'preguntas', 'dispositivos']);
  return deviceTypes.map((type, index) => {
    const label = clean(type.label || type.key).replace(/[\[\]:*?\/\\]/g, ' ').trim() || 'Dispositivo';
    let name = label.slice(0, 31);
    let suffix = 2;
    while (used.has(identity(name))) {
      const trailing = ' (' + suffix++ + ')';
      name = label.slice(0, 31 - trailing.length) + trailing;
    }
    used.add(identity(name));
    return { type, name, index: index + 1 };
  });
}

function excelColumn(index) {
  let number = index + 1;
  let result = '';
  while (number) {
    number -= 1;
    result = String.fromCharCode(65 + number % 26) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

function availableManufacturers(type, catalogs) {
  const relatedIds = (catalogs.relations || [])
    .filter((relation) => clean(pick(relation, ['TipoDispositivoID'])) === clean(type.typeId)
      && relation.Activo !== false && identity(relation.Estado || 'ACTIVO') !== 'inactivo')
    .map((relation) => clean(pick(relation, ['FabricanteID'])));
  return (catalogs.manufacturers || []).filter((maker) => !relatedIds.length
    || relatedIds.includes(clean(pick(maker, ['FabricanteID', 'id']))));
}

function availableModels(type, maker, catalogs) {
  // Misma relación tipo + fabricante del selector del mantenimiento.
  // Admitir modelos históricos sin TipoDispositivoID únicamente cuando su
  // fabricante ya está vinculado al tipo (nunca exponer modelos de otro tipo).
  const typeId = clean(type.typeId);
  const makerId = clean(pick(maker, ['FabricanteID', 'ID', 'id']));
  const manufacturerLinked = (catalogs.relations || []).some((relation) =>
    clean(pick(relation, ['TipoDispositivoID'])) === typeId
    && clean(pick(relation, ['FabricanteID'])) === makerId
    && relation.Activo !== false && identity(relation.Estado || 'ACTIVO') !== 'inactivo');
  return (catalogs.models || []).filter((model) => {
    const modelType = clean(pick(model, ['TipoDispositivoID', 'TipoDispositivoRef']));
    const modelMaker = clean(pick(model, ['FabricanteID', 'FabricanteRef']));
    return modelMaker === makerId
      && (!typeId || modelType === typeId || (!modelType && manufacturerLinked))
      && model.Activo !== false && identity(model.Estado || 'ACTIVO') !== 'inactivo';
  });
}

function questionHeader(question) {
  return 'Pregunta: ' + clean(question.label || question.key);
}

export function excelTemplateSheets({
  deviceTypes = [], equipmentOptions = [], technicians = [], catalogs = {},
  questionsForDevice = () => [], mode = 'MANTENIMIENTO', counts = {},
}) {
  const lists = [];
  const namedRanges = [];
  const addList = (name, values) => {
    const unique = [...new Set(values.map(clean).filter(Boolean))];
    const index = lists.length;
    const col = excelColumn(index);
    lists.push([name, ...unique]);
    namedRanges.push({ name, formula: "'Listas'!$" + col + "$2:$" + col + "$" + Math.max(2, unique.length + 1) });
    return name;
  };
  addList('LOCACIONES', equipmentOptions.map((row) => row.label));
  addList('TECNICOS', technicians.map((row) => row.label || row.name || row.NombreCompleto));
  addList('RESPUESTA_SI_NO', ['Sí', 'No']);
  addList('FUNCIONAMIENTO', ['Sí', 'No', 'No aplica']);
  addList('EN_USO', ['Sí, en uso', 'No, está guardado', 'No']);
  addList('ESTADO', ['Pendiente', 'Correcto', 'Mal estado']);
  addList('SIN_MODELOS', ['']);

  const types = excelDeviceSheetNames(deviceTypes);
  const deviceSheets = types.map(({ type, name, index }) => {
    const questions = questionsForDevice({
      tipoDispositivoId: type.typeId, categoria: type.key,
    }, mode);
    const makers = availableManufacturers(type, catalogs);
    const makerNames = makers.map((maker) => clean(pick(maker, ['Nombre', 'nombre'])));
    const makerRange = addList('FABRICANTES_' + index, makerNames);
    // Un rango por combinación tipo/fabricante: la lista de modelos depende
    // de la selección en la MISMA fila de Excel; nunca muestra otros tipos.
    addList('MODELOS_' + index + '_0', []);
    makers.forEach((maker, makerIndex) => {
      addList('MODELOS_' + index + '_' + (makerIndex + 1),
        availableModels(type, maker, catalogs).map((row) => pick(row, ['Nombre', 'nombre'])));
    });
    const validations = [
      { column: 1, list: 'LOCACIONES' },
      { column: 2, list: makerRange },
      // La validación debe resolver a una REFERENCIA de rango. MODELOS_n_0
      // existe como lista vacía segura si aún no se eligió fabricante.
      // $C fija columna (fabricante) y deja la fila relativa en D2:D... .
      { column: 3, formula: 'INDIRECT("MODELOS_' + index + '_"&IFERROR(MATCH($C2,' + makerRange + ',0),0))' },
      { column: 8, list: 'FUNCIONAMIENTO' },
      { column: 9, list: 'EN_USO' },
      { column: 10, list: 'ESTADO' },
    ];
    questions.forEach((question, questionIndex) => {
      const kind = clean(question.responseType || 'SI_NO').toUpperCase();
      if (kind === 'SI_NO' || identity(question.key).includes('limpieza')) {
        validations.push({ column: DEVICE_EXCEL_LABELS.length + questionIndex, list: 'RESPUESTA_SI_NO' });
      } else if (kind === 'OPCIONES' && question.config?.options?.length) {
        const list = addList('OPCIONES_' + index + '_' + questionIndex, question.config.options);
        validations.push({ column: DEVICE_EXCEL_LABELS.length + questionIndex, list });
      }
    });
    return {
      name,
      rows: [[...DEVICE_EXCEL_LABELS, ...questions.map(questionHeader)]],
      validations, inputRows: MAX_BULK_MAINTENANCE_DEVICES,
      expected: Number(counts[type.countField] || 0),
    };
  });
  const notes = [
    ['PASO', 'INSTRUCCIÓN'],
    ['1', 'Plantilla creada para este mantenimiento: solo aparecen los tipos seleccionados. Cada pestaña de color es un tipo de equipo.'],
    ['2', 'Una fila por equipo. Escriba su nombre y seleccione la ubicación del desplegable. NO necesita escribir ni conocer IDs.'],
    ['3', 'Fabricante tiene los valores de este tipo. Modelo se filtra por el fabricante seleccionado en la misma fila.'],
    ['4', 'Las preguntas son las actuales de cada tipo y se contestan en su propia pestaña. Limpieza: Sí o No.'],
    ['5', 'Las preguntas que se dejan en blanco quedan sin contestar. En proyectos se validan las respuestas obligatorias.'],
    ['6', 'Técnicos: nombres completos separados por punto y coma (;). Dejar vacío utiliza la selección de la aplicación.'],
    ['7', 'Fecha de trabajo: AAAA-MM-DD como texto. Dejar vacío utiliza la fecha actual de Costa Rica.'],
    ['8', 'Para actualizar ubicaciones, modelos, fabricantes o preguntas nuevas, DESCARGUE de nuevo desde el mantenimiento.'],
    ['9', 'El Excel descargado no se sincroniza mientras está cerrado: PostgreSQL es la fuente de verdad, no Google Sheets.'],
    ['10', 'No cambie nombres de las pestañas ni los encabezados. La aplicación validará los datos antes de crear equipos.'],
    ['11', 'Máximo ' + MAX_BULK_MAINTENANCE_DEVICES + ' equipos por importación, sumando todas las pestañas.'],
    ['12', 'Si se agregan más dispositivos que los planificados, se ajustará el esperado hacia arriba automáticamente al guardar.'],
    ...types.map(({ type, name }) => ['Tipo ' + name, String(Number(counts[type.countField] || 0)) + ' dispositivo(s) planificado(s)']),
  ];
  const questionRows = [
    ['PESTAÑA', 'PREGUNTA', 'TIPO DE RESPUESTA', 'OPCIONES', 'OBLIGATORIO EN PROYECTO'],
    ...types.flatMap(({ type, name }) => questionsForDevice(
      { tipoDispositivoId: type.typeId, categoria: type.key }, mode,
    ).map((q) => [
      name, clean(q.label), clean(q.responseType || 'SI_NO'),
      (q.config?.options || []).join(' | '), projectQuestionRequired(q) ? 'Sí' : 'No',
    ])),
  ];
  const maxRows = Math.max(...lists.map((column) => column.length), 1);
  const listRows = Array.from({ length: maxRows }, (_, row) => lists.map((column) => column[row] || ''));
  const sheets = [
    ...deviceSheets,
    { name: 'Instrucciones', rows: notes },
    { name: 'Preguntas', rows: questionRows },
    { name: 'Listas', rows: listRows, hidden: true },
  ];
  sheets.definedNames = namedRanges;
  return sheets;
}

export function validateDeviceExcelRows({
  headers, rows, deviceTypes, equipmentOptions, catalogs = {}, technicians = [],
  questionsForDevice, maintenanceType = 'MANTENIMIENTO', fallbackTechnicianIds = [],
}) {
  const columns = new Map(headers.map((name, i) => [clean(name), i]));
  const problems = [];
  if (columns.size !== headers.filter(Boolean).length) problems.push('Encabezados duplicados.');
  for (const required of ['UbicacionEquipoID', 'TipoDispositivoID', 'NombreDispositivo']) {
    if (!columns.has(required)) problems.push('Falta la columna ' + required);
  }
  if (!rows.length) problems.push('La hoja Dispositivos está vacía.');
  if (rows.length > MAX_BULK_MAINTENANCE_DEVICES) problems.push('Máximo ' + MAX_BULK_MAINTENANCE_DEVICES + ' dispositivos.');
  const value = (row, field) => clean(row[columns.get(field)]);

  const knownQuestions = new Set(deviceTypes.flatMap((type) =>
    questionsForDevice({ tipoDispositivoId: type.typeId, categoria: type.key }, maintenanceType)
      .map((q) => 'Pregunta:' + q.key)));
  headers.filter((h) => h?.startsWith('Pregunta:') && !knownQuestions.has(h))
    .filter((h) => rows.some((row) => value(row, h)))
    .forEach((h) => problems.push('Pregunta no reconocida con respuestas: ' + h));

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
      ubicacionEquipoId: clean(location?.value), ubicacionEquipoNombre: clean(location?.name || location?.label),
      zona: clean(location?.name || location?.label), serie: value(row, 'Serie'),
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
    const allowedMakers = type ? availableManufacturers(type, catalogs) : [];
    const maker = resolve(allowedMakers, value(row, 'FabricanteID'), value(row, 'Fabricante'),
      ['FabricanteID', 'id'], ['Nombre', 'nombre'], 'Fabricante', issues);
    if (maker) {
      draft.fabricanteId = clean(pick(maker, ['FabricanteID', 'id']));
      draft.fabricante = clean(pick(maker, ['Nombre', 'nombre']));
    }
    const modelValue = value(row, 'ModeloID') || value(row, 'Modelo');
    if (modelValue && !maker) issues.push('Seleccione el fabricante antes del modelo');
    const model = resolve(maker && type ? availableModels(type, maker, catalogs) : [],
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


// Traduce pestañas y nombres legibles a la misma validación existente que ya
// convierte respuestas, ubicaciones, catálogos y técnicos en el payload seguro.
export function validateDeviceExcelWorkbook({
  sheets = [], headers, rows, deviceTypes, equipmentOptions, catalogs = {}, technicians = [],
  questionsForDevice, maintenanceType = 'MANTENIMIENTO', fallbackTechnicianIds = [],
}) {
  const context = { deviceTypes, equipmentOptions, catalogs, technicians, questionsForDevice,
    maintenanceType, fallbackTechnicianIds };
  if (!sheets.length || (sheets.length === 1 && sheets[0].name === 'Dispositivos')) {
    return validateDeviceExcelRows({ headers: headers || sheets[0]?.headers || [],
      rows: rows || sheets[0]?.rows || [], ...context });
  }

  const types = excelDeviceSheetNames(deviceTypes);
  const recognized = new Set(['instrucciones', 'preguntas', 'listas']);
  const allRows = [];
  const allErrors = [];
  const matchesName = (left, right) => identity(left) === identity(right);
  const technicianOptions = technicians.map((item) => ({
    id: clean(item.value || item.id || item.UsuarioID),
    name: clean(item.label || item.name || item.NombreCompleto),
  }));
  const translateTechnicians = (value, issues) => {
    if (!clean(value)) return '';
    const ids = [];
    for (const text of clean(value).split(';').map(clean).filter(Boolean)) {
      const matches = technicianOptions.filter((item) => matchesName(item.name, text));
      if (matches.length !== 1) issues.push('Técnico: ' + text + (matches.length ? ' (nombre repetido)' : ' (no disponible)'));
      else ids.push(matches[0].id);
    }
    return ids.join(';');
  };
  for (const sheet of sheets) {
    const tab = types.find(({ name }) => matchesName(name, sheet.name));
    if (!tab) {
      if (!recognized.has(identity(sheet.name))) allErrors.push('Pestaña desconocida: ' + sheet.name
        + '. Descargue una plantilla nueva para este mantenimiento.');
      continue;
    }
    if (!sheet.rows.length) continue;
    const col = new Map(sheet.headers.map((header, index) => [clean(header), index]));
    const required = DEVICE_EXCEL_LABELS.filter((name) => !col.has(name));
    if (required.length) {
      allErrors.push('Pestaña ' + sheet.name + ': faltan columnas ' + required.join(', '));
      continue;
    }
    const qs = questionsForDevice(
      { tipoDispositivoId: tab.type.typeId, categoria: tab.type.key }, maintenanceType,
    );
    const headersForLegacy = [...DEVICE_EXCEL_FIELDS, ...qs.map((q) => 'Pregunta:' + q.key)];
    const expectedHeaders = new Set(qs.map(questionHeader));
    for (const column of sheet.headers.filter((h) => h.startsWith('Pregunta:') && !expectedHeaders.has(h))) {
      if (sheet.rows.some((row) => clean(row[col.get(column)]))) {
        allErrors.push('Pestaña ' + sheet.name + ': pregunta desactualizada: ' + column);
      }
    }
    const indexed = sheet.rows.map((row, offset) => {
      const field = (key) => clean(row[col.get(key)]);
      const issues = [];
      const translated = [
        '', field('Ubicación del equipo'),
        '', tab.type.key, field('Nombre del dispositivo'),
        '', field('Fabricante'), '', field('Modelo'),
        field('Serie'), field('Dirección MAC'), field('Fecha de trabajo'),
        translateTechnicians(field('Técnicos'), issues),
        field('Funcionamiento'), field('En uso'), field('Estado'), field('Observación'),
        ...qs.map((q) => field(questionHeader(q))),
      ];
      return { translated, originalRow: offset + 2, issues };
    });
    const result = validateDeviceExcelRows({
      headers: headersForLegacy, rows: indexed.map((item) => item.translated),
      ...context,
    });
    allRows.push(...result.rows.map((entry, index) => ({
      ...entry, sheetName: sheet.name, rowNumber: indexed[index].originalRow,
      issues: [...entry.issues, ...indexed[index].issues],
    })));
    allErrors.push(...result.errors.filter((error) => !error.startsWith('Fila '))
      .map((error) => 'Pestaña ' + sheet.name + ': ' + error));
    allErrors.push(...result.rows.flatMap((entry, index) => [
      ...entry.issues, ...indexed[index].issues,
    ].map((issue) => 'Pestaña ' + sheet.name + ', fila ' + indexed[index].originalRow + ': ' + issue)));
  }
  if (!allRows.length) allErrors.push('No hay dispositivos escritos en las pestañas de tipos.');
  if (allRows.length > MAX_BULK_MAINTENANCE_DEVICES) allErrors.push(
    'Máximo ' + MAX_BULK_MAINTENANCE_DEVICES + ' dispositivos en todas las pestañas.');
  return { rows: allRows, errors: allErrors };
}
