import { AppError, forbidden } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { driveApi, sheetsApi } from '../infra/google.js';
import { updateRow } from '../infra/sheets.repository.js';
import {
  cleanMaintenanceQuestionValue,
  legacyMaintenanceQuestions,
  parseMaintenanceAnswers,
  parseMaintenanceQuestionSnapshot,
  resolveMaintenanceQuestionsForType,
} from './maintenance-question-catalog.service.js';
import { getConfig } from '../modules/config.module.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const REPORT_FOLDER_KEYS = [
  'MANTENIMIENTOS_REPORTS_FOLDER_ID',
  'REPORTES_MANTENIMIENTOS_FOLDER_ID',
  'REPORTES_FOLDER_ID',
  'ROOT_FOLDER_ID',
];
const DMS_RED = { red: 183 / 255, green: 19 / 255, blue: 26 / 255 };
const HEADER_GRAY = { red: 229 / 255, green: 231 / 255, blue: 235 / 255 };
const CHECK_GREEN = { red: 0, green: 166 / 255, blue: 81 / 255 };
const CHECK_GREEN_BG = { red: 236 / 255, green: 253 / 255, blue: 243 / 255 };
const CROSS_RED = { red: 217 / 255, green: 48 / 255, blue: 37 / 255 };
const CROSS_RED_BG = { red: 252 / 255, green: 232 / 255, blue: 230 / 255 };
const LINK_BLUE = { red: 17 / 255, green: 85 / 255, blue: 204 / 255 };
const BASE_HEADERS = ['Nombre', 'Modelo', 'Serie'];
const END_HEADERS = ['Estado', 'Observaciones', 'Nota imagen', 'Carpeta dispositivo', 'Link Imagen'];

function clean(value, fallback = '') {
  return cleanMaintenanceQuestionValue(value, fallback);
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAdmin(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_ELIMINAR');
}

function safeSheetName(value, usedNames) {
  const base = (clean(value, 'Dispositivos')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Dispositivos');
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 75)} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function quotedSheetName(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let value = Number(index) + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function checklistMark(value) {
  const key = normalize(value);
  const compact = key.replace(/\s+/g, '');
  const good = new Set(['si', 'ok', 'correcto', 'funciona', 'bueno', 'aprobado', 'bien', 'true', '1', 'realizado', 'completado']);
  const bad = new Set(['no', 'x', 'incorrecto', 'falla', 'malo', 'pendiente', 'false', '0', 'defectuoso', 'nofunciona']);
  if (good.has(key) || good.has(compact)) return '✅';
  if (bad.has(key) || bad.has(compact)) return '❌';
  return clean(value);
}

function normalizedUsage(value) {
  const key = normalize(value);
  if (['si en uso', 'en uso', 'si', 'activo'].includes(key)) return 'si_en_uso';
  if (['no esta guardado', 'no esta guardo', 'guardado', 'no', 'almacenado'].includes(key)) return 'no_guardado';
  return key;
}

function deviceOverallMark(device) {
  const functioning = checklistMark(device?.Funcionamiento) === '✅';
  const usage = normalizedUsage(device?.EnUso);
  return functioning && (usage === 'si_en_uso' || usage === 'no_guardado') ? '✅' : '❌';
}

function latestImageInfo(device) {
  const images = (device?.Imagenes || []).filter((image) => image?.Activo !== false);
  const latest = images[images.length - 1] || null;
  if (!latest) return { note: '', label: '', url: '' };
  const type = normalize(latest.Tipo || latest.Estado || latest.TipoFoto);
  const typeLabel = type.includes('desp') ? 'Foto después' : type.includes('antes') ? 'Foto antes' : 'Foto adicional';
  return {
    note: clean(latest.Nota),
    label: `${clean(device.NombreDispositivo, 'Dispositivo')} - ${typeLabel}`,
    url: clean(latest.DriveURL) || (clean(latest.DriveFileID) ? `https://drive.google.com/file/d/${encodeURIComponent(latest.DriveFileID)}/view` : ''),
  };
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findChildFolder(parentId, name, cache) {
  if (!parentId || !clean(name)) return null;
  const safeName = clean(name)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const cacheKey = `${parentId}::${normalize(safeName)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const response = await driveApi.files.list({
    q: `'${escapeDriveQuery(parentId)}' in parents and name='${escapeDriveQuery(safeName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folder = response.data.files?.[0] || null;
  cache.set(cacheKey, folder);
  return folder;
}

async function deviceFolderInfo(maintenance, device, cache) {
  const maintenanceFolderId = clean(maintenance?.CarpetaDriveID);
  if (!maintenanceFolderId) return { id: '', url: '' };
  const zone = await findChildFolder(maintenanceFolderId, device.Zona || 'Zona sin nombre', cache);
  if (!zone) return { id: '', url: '' };
  const category = await findChildFolder(zone.id, device.Categoria || device.TipoDispositivo || 'Categoría sin nombre', cache);
  if (!category) return { id: '', url: '' };
  const folder = await findChildFolder(category.id, device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo', cache);
  if (!folder) return { id: '', url: '' };
  return { id: folder.id, url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` };
}

function questionFromCatalog(row = {}, index = 0) {
  return {
    questionId: clean(row.PreguntaDispositivoID || row.questionId),
    typeId: clean(row.TipoDispositivoID || row.typeId),
    key: clean(row.Clave || row.key),
    label: clean(row.Pregunta || row.label || row.Clave),
    order: Number(row.Orden ?? row.order ?? (index + 1) * 10),
    responseType: clean(row.TipoRespuesta || row.responseType, 'SI_NO'),
    value: clean(row.value),
  };
}

async function questionsForDevice(device) {
  const answers = parseMaintenanceAnswers(device.RespuestasJSON);
  const snapshot = parseMaintenanceQuestionSnapshot(answers.__preguntas);
  if (snapshot.length) return snapshot.map(questionFromCatalog).filter((item) => item.key && item.label);

  const typeId = clean(device.TipoDispositivoID);
  const typeName = clean(device.TipoDispositivo || device.Categoria);
  const catalog = await resolveMaintenanceQuestionsForType({ typeId, typeName, includeInactive: false });
  const questions = catalog.length ? catalog : legacyMaintenanceQuestions(typeName);
  return questions.map(questionFromCatalog).filter((item) => item.key && item.label);
}

async function buildSections(data) {
  const groups = new Map();
  for (const device of data.dispositivos || []) {
    const groupId = clean(device.TipoDispositivoID) || `name:${normalize(device.TipoDispositivo || device.Categoria)}`;
    const current = groups.get(groupId) || {
      id: groupId,
      name: clean(device.TipoDispositivo || device.Categoria, 'Otros'),
      devices: [],
      questionMap: new Map(),
    };
    const questions = await questionsForDevice(device);
    questions.forEach((question) => {
      const existing = current.questionMap.get(question.key);
      if (!existing || question.order < existing.order) current.questionMap.set(question.key, question);
    });
    current.devices.push({ device, questions });
    groups.set(groupId, current);
  }

  const usedNames = new Set();
  const folderCache = new Map();
  const sections = [];
  for (const group of groups.values()) {
    const questions = [...group.questionMap.values()]
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'));
    const headers = [...BASE_HEADERS, ...questions.map((question) => question.label), ...END_HEADERS];
    const rows = [];
    for (const item of group.devices) {
      const answers = parseMaintenanceAnswers(item.device.RespuestasJSON);
      const snapshotValues = new Map(item.questions.map((question) => [question.key, question.value]));
      const latest = latestImageInfo(item.device);
      const folder = await deviceFolderInfo(data.mantenimiento, item.device, folderCache).catch(() => ({ id: '', url: '' }));
      const values = [
        clean(item.device.NombreDispositivo, 'Sin nombre'),
        clean(item.device.Modelo),
        clean(item.device.Serie),
        ...questions.map((question) => checklistMark(answers[question.key] ?? snapshotValues.get(question.key))),
        deviceOverallMark(item.device),
        clean(item.device.Observacion),
        latest.note,
        folder.url ? 'Abrir carpeta' : '',
        latest.url ? (latest.label || 'Abrir imagen') : '',
      ];
      const links = [];
      const folderColumn = headers.indexOf('Carpeta dispositivo');
      const imageColumn = headers.indexOf('Link Imagen');
      if (folder.url) links.push({ column: folderColumn, url: folder.url });
      if (latest.url) links.push({ column: imageColumn, url: latest.url });
      rows.push({ values, links });
    }
    sections.push({
      name: safeSheetName(group.name, usedNames),
      title: group.name,
      headers,
      questions,
      rows,
    });
  }
  return sections.sort((left, right) => left.title.localeCompare(right.title, 'es'));
}

function columnWidth(header) {
  const key = normalize(header);
  if (key === 'nombre') return 220;
  if (key === 'modelo' || key === 'serie') return 150;
  if (key === 'observaciones' || key === 'nota imagen' || key === 'link imagen') return 240;
  if (key === 'carpeta dispositivo') return 170;
  return Math.max(115, Math.min(260, 70 + clean(header).length * 5));
}

function setupRequests(sheetId, section, first) {
  const rowCount = Math.max(section.rows.length + 10, 100);
  const columnCount = section.headers.length;
  const questionStart = BASE_HEADERS.length;
  const questionEnd = questionStart + section.questions.length;
  const stateColumn = section.headers.indexOf('Estado');
  const requests = [];
  if (first) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, title: section.name, gridProperties: { rowCount, columnCount, frozenRowCount: 2 } },
        fields: 'title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount',
      },
    });
  } else {
    requests.push({ addSheet: { properties: { sheetId, title: section.name, gridProperties: { rowCount, columnCount, frozenRowCount: 2 } } } });
  }
  requests.push(
    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: DMS_RED, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: HEADER_GRAY, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat' } },
  );
  if (section.rows.length) {
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: section.rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy' } });
    for (let column = questionStart; column < questionEnd; column += 1) {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: section.rows.length + 2, startColumnIndex: column, endColumnIndex: column + 1 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat' } });
    }
    if (stateColumn >= 0) {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: section.rows.length + 2, startColumnIndex: stateColumn, endColumnIndex: stateColumn + 1 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat' } });
    }
    requests.push(
      { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId, startRowIndex: 2, endRowIndex: section.rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '✅' }] }, format: { backgroundColor: CHECK_GREEN_BG, textFormat: { foregroundColor: CHECK_GREEN, bold: true } } } } } },
      { addConditionalFormatRule: { index: 1, rule: { ranges: [{ sheetId, startRowIndex: 2, endRowIndex: section.rows.length + 2, startColumnIndex: 0, endColumnIndex: columnCount }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '❌' }] }, format: { backgroundColor: CROSS_RED_BG, textFormat: { foregroundColor: CROSS_RED, bold: true } } } } } },
    );
  }
  section.headers.forEach((header, index) => requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize: columnWidth(header) }, fields: 'pixelSize' } }));
  return requests;
}

function linkRequests(sheetId, section) {
  return section.rows.flatMap((row, rowIndex) => row.links.map((link) => ({
    updateCells: {
      range: { sheetId, startRowIndex: rowIndex + 2, endRowIndex: rowIndex + 3, startColumnIndex: link.column, endColumnIndex: link.column + 1 },
      rows: [{ values: [{ userEnteredFormat: { textFormat: { foregroundColor: LINK_BLUE, underline: true } }, textFormatRuns: [], hyperlink: link.url }] }],
      fields: 'userEnteredFormat.textFormat,hyperlink',
    },
  })));
}

async function reportFolderId() {
  const config = await getConfig();
  const folderId = clean(pick(config, REPORT_FOLDER_KEYS));
  if (!folderId) throw new AppError('MAINTENANCE_REPORT_FOLDER_MISSING', 'No hay una carpeta de Drive configurada para los reportes de mantenimiento.', 500);
  return folderId;
}

async function createReportFile(title) {
  const folderId = await reportFolderId();
  const created = await driveApi.files.create({
    requestBody: { name: title, mimeType: GOOGLE_SHEET_MIME, parents: [folderId] },
    fields: 'id,name,mimeType,parents,webViewLink',
    supportsAllDrives: true,
  });
  return created.data;
}

async function shareWithUser(fileId, ctx) {
  const email = clean(pick(ctx.user, ['Correo', 'Email', 'email']));
  if (!email) return { shared: false, inheritedAccess: true };
  try {
    await driveApi.permissions.create({
      fileId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role: 'writer', emailAddress: email },
    });
    return { shared: true, email };
  } catch (error) {
    console.warn(`[maintenance-dynamic-report] No se pudo crear permiso directo para ${fileId}:`, error?.message || error);
    return { shared: false, inheritedAccess: true, warning: 'El archivo conserva los permisos heredados de la carpeta.' };
  }
}

async function batchUpdate(spreadsheetId, requests, chunkSize = 350) {
  for (let index = 0; index < requests.length; index += chunkSize) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(index, index + chunkSize) },
    });
  }
}

async function writeSpreadsheet(spreadsheetId, sections, maintenance) {
  const metadata = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const firstSheetId = metadata.data.sheets?.[0]?.properties?.sheetId;
  if (firstSheetId === undefined) throw new Error('El archivo no contiene una hoja inicial.');
  const usedIds = new Set((metadata.data.sheets || []).map((sheet) => Number(sheet.properties?.sheetId)));
  const sheetIds = sections.map((_, index) => {
    if (index === 0) return firstSheetId;
    let id = 1000 + index;
    while (usedIds.has(id)) id += sections.length + 1;
    usedIds.add(id);
    return id;
  });

  const setup = sections.flatMap((section, index) => setupRequests(sheetIds[index], section, index === 0));
  await batchUpdate(spreadsheetId, setup);

  for (const section of sections) {
    const title = `Checklist ${section.title} - ${maintenance.Cliente || 'Cliente'} - ${String(maintenance.Fecha || '').slice(0, 10)}`;
    const values = [
      [title, ...new Array(Math.max(section.headers.length - 1, 0)).fill('')],
      section.headers,
      ...section.rows.map((row) => row.values),
    ];
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedSheetName(section.name)}!A1:${columnLetter(section.headers.length - 1)}${values.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  const links = sections.flatMap((section, index) => linkRequests(sheetIds[index], section));
  if (links.length) await batchUpdate(spreadsheetId, links);
}

export async function createDynamicMaintenanceSpreadsheetReport(ctx) {
  if (!isAdmin(ctx)) throw forbidden('Solo los administradores pueden crear reportes de mantenimiento.');
  const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const data = await maintenanceHandlers.get({ ...ctx, payload: { maintenanceId } });
  const sections = await buildSections(data);
  if (!sections.length) throw new AppError('MAINTENANCE_REPORT_WITHOUT_DEVICES', 'No hay dispositivos registrados para crear el checklist.', 400);

  const title = `Checklist mantenimiento DMS - ${data.mantenimiento.Cliente || 'Cliente'} - ${String(data.mantenimiento.Fecha || '').slice(0, 10)}`;
  const created = await createReportFile(title);
  try {
    await writeSpreadsheet(created.id, sections, data.mantenimiento);
  } catch (error) {
    console.error(`[maintenance-dynamic-report] No se pudo construir el Sheet ${created.id}:`, error);
    throw new AppError('MAINTENANCE_SPREADSHEET_WRITE_FAILED', 'El archivo se creó en Drive, pero no fue posible construir el checklist dinámico por tipo de dispositivo.', 502, { cause: error?.message || String(error), fileId: created.id });
  }

  const access = await shareWithUser(created.id, ctx);
  const url = created.webViewLink || `https://docs.google.com/spreadsheets/d/${created.id}/edit`;
  await updateRow('Mantenimiento', data.mantenimiento.MantenimientoID, {
    SpreadsheetID: created.id,
    SpreadsheetURL: url,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });
  return {
    spreadsheetId: created.id,
    spreadsheetUrl: url,
    excelUrl: `https://docs.google.com/spreadsheets/d/${created.id}/export?format=xlsx`,
    rows: sections.reduce((sum, section) => sum + section.rows.length, 0),
    sheets: sections.map((section) => section.name),
    questions: sections.reduce((sum, section) => sum + section.questions.length, 0),
    access,
  };
}
