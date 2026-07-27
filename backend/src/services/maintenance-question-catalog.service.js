import { env } from '../config/env.js';
import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { sheetsApi } from '../infra/google.js';
import {
  appendRows,
  invalidateTableCache,
  readTable,
} from '../infra/sheets.repository.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

export const MAINTENANCE_QUESTION_SHEET = 'TipoDispositivoPreguntas';
export const MAINTENANCE_QUESTION_COLUMNS = [
  'PreguntaDispositivoID',
  'TipoDispositivoID',
  'Clave',
  'Pregunta',
  'Orden',
  'TipoRespuesta',
  'Activo',
  'Estado',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
];
export const DEVICE_QUESTION_SNAPSHOT_COLUMN = 'RespuestasDetalleJSON';

const DEFAULT_QUESTION_GROUPS = [
  {
    aliases: ['camara', 'camaras', 'camera', 'cctv'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión de red o video está correcta?'],
      ['montaje', '¿El montaje se encuentra firme y en buen estado?'],
      ['visualizacion', '¿La visualización y grabación son correctas?'],
    ],
  },
  {
    aliases: ['puerta', 'puertas', 'control de acceso', 'control acceso'],
    questions: [
      ['lector', '¿El lector funciona correctamente?'],
      ['cerradura', '¿La cerradura funciona correctamente?'],
      ['funcion', '¿La apertura y cierre funcionan correctamente?'],
      ['contactos', '¿Los contactos y sensores reportan correctamente?'],
    ],
  },
  {
    aliases: ['servidor', 'servidores', 'server'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación y UPS están correctas?'],
      ['conexiones', '¿Las conexiones están correctas?'],
      ['servicios', '¿Los servicios del sistema están activos?'],
      ['almacenamiento', '¿El almacenamiento tiene capacidad disponible?'],
      ['respaldo', '¿El respaldo funciona correctamente?'],
    ],
  },
  {
    aliases: ['grabador', 'grabadores', 'nvr', 'dvr'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexiones', '¿Las conexiones están correctas?'],
      ['grabacion', '¿La grabación funciona correctamente?'],
      ['visualizacion', '¿La visualización es correcta?'],
      ['almacenamiento', '¿El almacenamiento está en buen estado?'],
    ],
  },
  {
    aliases: ['bocina', 'bocinas', 'altavoz', 'altavoces', 'audio'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión está correcta?'],
      ['montaje', '¿El montaje está firme y en buen estado?'],
      ['pruebaSonido', '¿La prueba de sonido fue satisfactoria?'],
    ],
  },
  {
    aliases: ['sensor perimetral', 'sensores perimetrales'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión está correcta?'],
      ['montaje', '¿El montaje está firme?'],
      ['pruebaDeteccion', '¿La prueba de detección fue satisfactoria?'],
    ],
  },
  {
    aliases: ['sensor movimiento', 'sensor de movimiento', 'sensores de movimiento'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión está correcta?'],
      ['montaje', '¿El montaje está firme?'],
      ['pruebaDeteccion', '¿La prueba de movimiento fue satisfactoria?'],
    ],
  },
  {
    aliases: ['sensor ruptura', 'sensor de ruptura', 'sensores de ruptura'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión está correcta?'],
      ['montaje', '¿El montaje está firme?'],
      ['pruebaDeteccion', '¿La prueba de ruptura o simulación fue satisfactoria?'],
    ],
  },
  {
    aliases: ['impresora', 'impresoras', 'printer'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión está correcta?'],
      ['consumibles', '¿Los consumibles están en buen estado?'],
      ['pruebaImpresion', '¿La prueba de impresión fue satisfactoria?'],
    ],
  },
  {
    aliases: ['gabinete', 'gabinetes', 'rack'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['conexiones', '¿Las conexiones están ordenadas y correctas?'],
      ['mediciones', '¿Se realizaron las mediciones?'],
      ['respaldo', '¿El respaldo eléctrico funciona correctamente?'],
    ],
  },
  {
    aliases: ['videowall', 'video wall', 'video-wall'],
    questions: [
      ['limpieza', '¿Se realizó la limpieza?'],
      ['alimentacion', '¿La alimentación funciona correctamente?'],
      ['conexion', '¿La conexión de video está correcta?'],
      ['montaje', '¿El montaje está firme y alineado?'],
      ['visualizacion', '¿La visualización es correcta?'],
      ['calibracion', '¿La calibración y el mosaico están correctos?'],
    ],
  },
];

let ensurePromise = null;
let catalogReady = false;

export function cleanMaintenanceQuestionValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalizeMaintenanceQuestionValue(value) {
  return cleanMaintenanceQuestionValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isActiveMaintenanceQuestion(row = {}) {
  const active = String(row.Activo ?? 'true').trim().toLowerCase();
  const status = cleanMaintenanceQuestionValue(row.Estado, 'ACTIVO').toUpperCase();
  return !['false', '0', 'no'].includes(active) && status !== 'INACTIVO';
}

export function legacyMaintenanceQuestions(typeName = '') {
  const key = normalizeMaintenanceQuestionValue(typeName);
  const group = DEFAULT_QUESTION_GROUPS.find((item) => item.aliases.some((alias) => {
    const aliasKey = normalizeMaintenanceQuestionValue(alias);
    return key === aliasKey || key.includes(aliasKey) || aliasKey.includes(key);
  }));
  return (group?.questions || []).map(([questionKey, label], index) => ({
    PreguntaDispositivoID: `legacy:${key || 'dispositivo'}:${questionKey}`,
    TipoDispositivoID: '',
    Clave: questionKey,
    Pregunta: label,
    Orden: (index + 1) * 10,
    TipoRespuesta: 'SI_NO',
    Activo: true,
    Estado: 'ACTIVO',
    Origen: 'LEGACY',
  }));
}

async function createSheetIfMissing() {
  const response = await sheetsApi.spreadsheets.get({
    spreadsheetId: env.sheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const exists = (response.data.sheets || []).some((sheet) => sheet.properties?.title === MAINTENANCE_QUESTION_SHEET);
  if (exists) return false;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: MAINTENANCE_QUESTION_SHEET,
            gridProperties: { rowCount: 1000, columnCount: MAINTENANCE_QUESTION_COLUMNS.length },
          },
        },
      }],
    },
  });
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: env.sheetId,
    range: `'${MAINTENANCE_QUESTION_SHEET}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [MAINTENANCE_QUESTION_COLUMNS] },
  });
  invalidateTableCache(MAINTENANCE_QUESTION_SHEET);
  return true;
}

async function seedLegacyQuestions(actor = 'SYSTEM') {
  const deviceTypes = await readTable('TiposDispositivo', { force: true });
  const timestamp = nowIso();
  const rows = [];

  for (const type of deviceTypes) {
    const typeId = cleanMaintenanceQuestionValue(pick(type, ['TipoDispositivoID', 'id']));
    const typeName = cleanMaintenanceQuestionValue(pick(type, ['Nombre', 'TipoDispositivo']));
    if (!typeId || !typeName) continue;
    const defaults = legacyMaintenanceQuestions(typeName);
    defaults.forEach((question, index) => rows.push({
      PreguntaDispositivoID: uuid(),
      TipoDispositivoID: typeId,
      Clave: question.Clave,
      Pregunta: question.Pregunta,
      Orden: (index + 1) * 10,
      TipoRespuesta: 'SI_NO',
      Activo: true,
      Estado: 'ACTIVO',
      CreadoPor: actor,
      FechaCreacion: timestamp,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    }));
  }

  if (rows.length) await appendRows(MAINTENANCE_QUESTION_SHEET, rows, { chunkSize: 200 });
  return rows;
}

export async function ensureMaintenanceQuestionCatalog(actor = 'SYSTEM') {
  if (catalogReady) return { created: false };
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const created = await createSheetIfMissing();
    await ensureSheetColumns(MAINTENANCE_QUESTION_SHEET, MAINTENANCE_QUESTION_COLUMNS);
    if (created) await seedLegacyQuestions(actor);
    catalogReady = true;
    return { created };
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export async function readMaintenanceQuestions({ includeInactive = false, typeId = '' } = {}) {
  await ensureMaintenanceQuestionCatalog();
  let rows = await readTable(MAINTENANCE_QUESTION_SHEET);
  if (!includeInactive) rows = rows.filter(isActiveMaintenanceQuestion);
  if (typeId) rows = rows.filter((row) => cleanMaintenanceQuestionValue(row.TipoDispositivoID) === cleanMaintenanceQuestionValue(typeId));
  return [...rows].sort((left, right) => (
    Number(left.Orden || 0) - Number(right.Orden || 0)
    || cleanMaintenanceQuestionValue(left.Pregunta).localeCompare(cleanMaintenanceQuestionValue(right.Pregunta), 'es')
  ));
}

export async function resolveMaintenanceQuestionsForType({ typeId = '', typeName = '', includeInactive = false } = {}) {
  const cleanTypeId = cleanMaintenanceQuestionValue(typeId);
  let resolvedTypeId = cleanTypeId;
  let resolvedTypeName = cleanMaintenanceQuestionValue(typeName);

  if (!resolvedTypeId && resolvedTypeName) {
    const deviceTypes = await readTable('TiposDispositivo');
    const type = deviceTypes.find((row) => normalizeMaintenanceQuestionValue(row.Nombre) === normalizeMaintenanceQuestionValue(resolvedTypeName));
    resolvedTypeId = cleanMaintenanceQuestionValue(type?.TipoDispositivoID);
    resolvedTypeName = cleanMaintenanceQuestionValue(type?.Nombre, resolvedTypeName);
  }

  if (resolvedTypeId) {
    const rows = await readMaintenanceQuestions({ includeInactive, typeId: resolvedTypeId });
    if (rows.length || includeInactive) return rows;
  }

  // Compatibilidad con mantenimientos históricos que no tienen TipoDispositivoID.
  if (!resolvedTypeId) return legacyMaintenanceQuestions(resolvedTypeName);
  return [];
}

export function maintenanceQuestionClientView(row = {}, typeName = '') {
  return {
    id: cleanMaintenanceQuestionValue(row.PreguntaDispositivoID),
    questionId: cleanMaintenanceQuestionValue(row.PreguntaDispositivoID),
    typeId: cleanMaintenanceQuestionValue(row.TipoDispositivoID),
    typeName: cleanMaintenanceQuestionValue(typeName || row.TipoDispositivo),
    key: cleanMaintenanceQuestionValue(row.Clave),
    label: cleanMaintenanceQuestionValue(row.Pregunta),
    order: Number(row.Orden || 0),
    responseType: cleanMaintenanceQuestionValue(row.TipoRespuesta, 'SI_NO'),
    active: isActiveMaintenanceQuestion(row),
    status: cleanMaintenanceQuestionValue(row.Estado, 'ACTIVO'),
    origin: cleanMaintenanceQuestionValue(row.Origen, 'CATALOGO'),
  };
}

export function parseMaintenanceQuestionSnapshot(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseMaintenanceAnswers(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function buildMaintenanceQuestionSnapshot(payload = {}, before = {}) {
  const answers = parseMaintenanceAnswers(
    payload.respuestas
      || payload.answers
      || payload.RespuestasJSON
      || before.RespuestasJSON,
  );
  const typeId = cleanMaintenanceQuestionValue(pick(payload, ['TipoDispositivoID', 'tipoDispositivoId'], before.TipoDispositivoID));
  const typeName = cleanMaintenanceQuestionValue(pick(
    payload,
    ['TipoDispositivo', 'Categoria', 'categoria'],
    before.TipoDispositivo || before.Categoria,
  ));
  const activeQuestions = await resolveMaintenanceQuestionsForType({ typeId, typeName, includeInactive: false });
  const suppliedSnapshot = parseMaintenanceQuestionSnapshot(
    payload.RespuestasDetalleJSON
      || payload.respuestasDetalle
      || payload.questionDetails
      || before.RespuestasDetalleJSON,
  );
  const existingByKey = new Map(suppliedSnapshot.map((item) => [cleanMaintenanceQuestionValue(item.key || item.Clave), item]));
  const activeKeys = new Set();
  const snapshot = activeQuestions.map((question, index) => {
    const key = cleanMaintenanceQuestionValue(question.Clave);
    activeKeys.add(key);
    const existing = existingByKey.get(key) || {};
    return {
      questionId: cleanMaintenanceQuestionValue(question.PreguntaDispositivoID || existing.questionId),
      typeId,
      key,
      label: cleanMaintenanceQuestionValue(question.Pregunta || existing.label || key),
      order: Number(question.Orden || existing.order || (index + 1) * 10),
      responseType: cleanMaintenanceQuestionValue(question.TipoRespuesta || existing.responseType, 'SI_NO'),
      value: cleanMaintenanceQuestionValue(answers[key] ?? existing.value),
      activeAtSave: true,
    };
  });

  // Conserva preguntas históricas eliminadas o desactivadas para no alterar reportes anteriores.
  for (const item of suppliedSnapshot) {
    const key = cleanMaintenanceQuestionValue(item.key || item.Clave);
    if (!key || activeKeys.has(key)) continue;
    const value = cleanMaintenanceQuestionValue(answers[key] ?? item.value);
    if (!value && !item.label) continue;
    snapshot.push({
      questionId: cleanMaintenanceQuestionValue(item.questionId || item.PreguntaDispositivoID),
      typeId: cleanMaintenanceQuestionValue(item.typeId || typeId),
      key,
      label: cleanMaintenanceQuestionValue(item.label || item.Pregunta || key),
      order: Number(item.order || item.Orden || 9999),
      responseType: cleanMaintenanceQuestionValue(item.responseType || item.TipoRespuesta, 'SI_NO'),
      value,
      activeAtSave: false,
    });
  }

  return snapshot.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'));
}

export async function assertMaintenanceDeviceType(typeId) {
  const cleanTypeId = cleanMaintenanceQuestionValue(typeId);
  if (!cleanTypeId) throw badRequest('Seleccione el tipo de dispositivo relacionado con la pregunta.');
  const types = await readTable('TiposDispositivo');
  const type = types.find((row) => cleanMaintenanceQuestionValue(row.TipoDispositivoID) === cleanTypeId);
  if (!type) throw badRequest('El tipo de dispositivo seleccionado no existe.');
  return type;
}
