/**
 * Compatibilidad para localizar la hoja de cálculo usada por DMS Boletas.
 *
 * Este archivo define ss_() porque algunas versiones del backend usan otro
 * nombre para abrir la hoja. Google Apps Script comparte las funciones entre
 * todos los archivos .gs del mismo proyecto.
 *
 * Orden de resolución:
 * 1. Funciones existentes del backend.
 * 2. Constantes globales conocidas.
 * 3. Propiedades del script.
 * 4. Hoja activa, cuando el proyecto está vinculado a Google Sheets.
 */
function ss_() {
  var spreadsheet = tryKnowledgeSpreadsheetFunctions_();
  if (spreadsheet) return spreadsheet;

  var spreadsheetId = getKnowledgeSpreadsheetId_();
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw new Error(
        'Se encontró el ID de la hoja, pero no se pudo abrir. ' +
        'Revise el ID y los permisos del usuario que ejecuta el Web App. Detalle: ' +
        error.message
      );
    }
  }

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    PropertiesService.getScriptProperties().setProperty('DMS_SPREADSHEET_ID', active.getId());
    return active;
  }

  throw new Error(
    'No se pudo localizar la hoja de datos de DMS Boletas. ' +
    'En Configuración del proyecto > Propiedades del script agregue ' +
    'DMS_SPREADSHEET_ID con el ID de la hoja de cálculo y vuelva a ejecutar ' +
    'setupKnowledgeBaseModule().'
  );
}

function tryKnowledgeSpreadsheetFunctions_() {
  var functionNames = [
    'getSpreadsheet_',
    'spreadsheet_',
    'openSpreadsheet_',
    'getDatabaseSpreadsheet_',
    'getDataSpreadsheet_'
  ];

  for (var i = 0; i < functionNames.length; i += 1) {
    var functionName = functionNames[i];
    try {
      var candidate = globalThis[functionName];
      if (typeof candidate !== 'function') continue;
      var spreadsheet = candidate();
      if (isKnowledgeSpreadsheet_(spreadsheet)) return spreadsheet;
    } catch (ignored) {
      // Continúa con la siguiente estrategia.
    }
  }

  return null;
}

function getKnowledgeSpreadsheetId_() {
  var globalCandidates = [];

  if (typeof DMS_SPREADSHEET_ID !== 'undefined') globalCandidates.push(DMS_SPREADSHEET_ID);
  if (typeof SPREADSHEET_ID !== 'undefined') globalCandidates.push(SPREADSHEET_ID);
  if (typeof DATABASE_SPREADSHEET_ID !== 'undefined') globalCandidates.push(DATABASE_SPREADSHEET_ID);
  if (typeof DB_SPREADSHEET_ID !== 'undefined') globalCandidates.push(DB_SPREADSHEET_ID);
  if (typeof SHEET_ID !== 'undefined') globalCandidates.push(SHEET_ID);
  if (typeof DMS_SHEET_ID !== 'undefined') globalCandidates.push(DMS_SHEET_ID);

  for (var i = 0; i < globalCandidates.length; i += 1) {
    var globalId = normalizeKnowledgeSpreadsheetId_(globalCandidates[i]);
    if (globalId) return globalId;
  }

  var properties = PropertiesService.getScriptProperties();
  var propertyNames = [
    'DMS_SPREADSHEET_ID',
    'SPREADSHEET_ID',
    'DATABASE_SPREADSHEET_ID',
    'DB_SPREADSHEET_ID',
    'DATA_SPREADSHEET_ID',
    'APP_SPREADSHEET_ID',
    'SHEET_ID',
    'DMS_SHEET_ID'
  ];

  for (var j = 0; j < propertyNames.length; j += 1) {
    var propertyId = normalizeKnowledgeSpreadsheetId_(properties.getProperty(propertyNames[j]));
    if (propertyId) return propertyId;
  }

  return '';
}

function normalizeKnowledgeSpreadsheetId_(value) {
  var text = String(value || '').trim();
  if (!text) return '';

  var urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return urlMatch ? urlMatch[1] : text;
}

function isKnowledgeSpreadsheet_(value) {
  return Boolean(
    value &&
    typeof value.getId === 'function' &&
    typeof value.getSheetByName === 'function' &&
    typeof value.insertSheet === 'function'
  );
}

/**
 * Ejecute esta función cuando el proyecto de Apps Script esté vinculado a la
 * hoja de DMS Boletas. Guarda su ID para que el Web App pueda abrirla después.
 */
function saveActiveSpreadsheetForKnowledge() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'Este proyecto no está vinculado a una hoja activa. Agregue manualmente ' +
      'la propiedad DMS_SPREADSHEET_ID en Configuración del proyecto.'
    );
  }

  PropertiesService.getScriptProperties().setProperty('DMS_SPREADSHEET_ID', active.getId());
  return {
    ok: true,
    spreadsheetId: active.getId(),
    spreadsheetName: active.getName(),
    spreadsheetUrl: active.getUrl()
  };
}

/** Comprueba qué hoja utilizará el módulo antes de crear tablas o carpetas. */
function testKnowledgeSpreadsheetConnection() {
  var spreadsheet = ss_();
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl()
  };
}
