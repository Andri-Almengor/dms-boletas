/**
 * DMS BOLETAS - REPARACIÓN DE CLIENTES IMPORTADOS
 *
 * Soluciona el caso en que los clientes históricos tienen RowID o ID,
 * pero el backend React espera ClienteID.
 *
 * EJECUCIÓN:
 * 1. Ejecute previewRepairImportedClientIds().
 * 2. Revise la hoja ReparacionClientesPreview.
 * 3. Ejecute runRepairImportedClientIds().
 * 4. Publique una nueva versión del Web App.
 *
 * La reparación es idempotente y no elimina información.
 */

function previewRepairImportedClientIds() {
  return repairImportedClientIds_(true);
}

function runRepairImportedClientIds() {
  return repairImportedClientIds_(false);
}

function repairImportedClientIds_(dryRun) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = repairClientsSpreadsheet_();
    var report = [];

    var clientsSheet = repairFindSheet_(ss, ['Clientes']);
    if (!clientsSheet) throw new Error('No se encontró la hoja Clientes.');

    var clients = repairReadTable_(clientsSheet);
    var clientIdColumn = repairEnsureHeader_(clients, 'ClienteID');
    var activeColumn = repairEnsureHeader_(clients, 'Activo');
    var statusColumn = repairEnsureHeader_(clients, 'Estado');

    var rowIdColumn = repairFindHeader_(clients.headers, ['RowID', 'Row ID']);
    var legacyIdColumn = repairFindHeader_(clients.headers, ['ID']);
    var nameColumn = repairFindHeader_(clients.headers, ['Clientes', 'Cliente', 'Nombre', 'RazonSocial', 'Razón social']);

    if (nameColumn < 0) throw new Error('La hoja Clientes no tiene una columna de nombre reconocida.');

    var idMap = {};
    var nameMap = {};
    var changedClients = 0;

    clients.rows.forEach(function (row, index) {
      var name = repairText_(row[nameColumn]);
      if (!name) return;

      var currentCanonical = repairText_(row[clientIdColumn]);
      var rowId = rowIdColumn >= 0 ? repairText_(row[rowIdColumn]) : '';
      var legacyId = legacyIdColumn >= 0 ? repairText_(row[legacyIdColumn]) : '';
      var canonical = currentCanonical || rowId || legacyId || Utilities.getUuid();
      var changed = false;

      if (!currentCanonical) {
        row[clientIdColumn] = canonical;
        changed = true;
      }
      if (repairBlank_(row[activeColumn])) {
        row[activeColumn] = true;
        changed = true;
      }
      if (repairBlank_(row[statusColumn])) {
        row[statusColumn] = 'ACTIVO';
        changed = true;
      }

      [currentCanonical, rowId, legacyId, canonical].filter(Boolean).forEach(function (oldId) {
        idMap[repairKey_(oldId)] = canonical;
      });
      nameMap[repairKey_(name)] = canonical;

      if (changed) changedClients += 1;
      report.push([
        'CLIENTE',
        changed ? 'REPARAR' : 'OK',
        index + 2,
        name,
        currentCanonical || rowId || legacyId,
        canonical,
        changed ? 'Se completó ClienteID/Activo/Estado' : 'Ya estaba correcto'
      ]);
    });

    var relatedResults = [];
    relatedResults.push(repairClientForeignKeys_(ss, ['ContactosCliente', 'Contactos Clientes', 'Contactos'], 'CONTACTO', idMap, nameMap, dryRun, report));
    relatedResults.push(repairClientForeignKeys_(ss, ['UbicacionesCliente', 'Ubicaciones Clientes', 'Ubicaciones'], 'UBICACION', idMap, nameMap, dryRun, report));
    relatedResults.push(repairLocationIds_(ss, dryRun, report));

    if (!dryRun) repairWriteTable_(clients);

    repairWriteReport_(ss, report, dryRun);

    return {
      ok: true,
      mode: dryRun ? 'PREVIEW' : 'REPAIR',
      clientsReviewed: report.filter(function (item) { return item[0] === 'CLIENTE'; }).length,
      clientsChanged: changedClients,
      related: relatedResults
    };
  } finally {
    lock.releaseLock();
  }
}

function repairClientForeignKeys_(ss, sheetNames, entity, idMap, nameMap, dryRun, report) {
  var sheet = repairFindSheet_(ss, sheetNames);
  if (!sheet) return { entity: entity, found: false, changed: 0 };

  var table = repairReadTable_(sheet);
  var canonicalColumn = repairEnsureHeader_(table, 'ClienteID');
  var referenceColumns = repairFindHeaders_(table.headers, ['ClienteID', 'ClienteRef', 'IDCliente', 'Cliente ID']);
  var clientNameColumns = repairFindHeaders_(table.headers, ['Cliente', 'NombreCliente', 'Clientes']);
  var changed = 0;

  table.rows.forEach(function (row, index) {
    var oldReference = '';
    for (var i = 0; i < referenceColumns.length; i += 1) {
      oldReference = repairText_(row[referenceColumns[i]]);
      if (oldReference) break;
    }

    var canonical = oldReference ? idMap[repairKey_(oldReference)] : '';
    if (!canonical) {
      for (var j = 0; j < clientNameColumns.length; j += 1) {
        var clientName = repairText_(row[clientNameColumns[j]]);
        if (clientName && nameMap[repairKey_(clientName)]) {
          canonical = nameMap[repairKey_(clientName)];
          break;
        }
      }
    }

    if (!canonical) {
      report.push([entity, 'REVISAR', index + 2, '', oldReference, '', 'No se pudo relacionar con un cliente']);
      return;
    }

    if (repairText_(row[canonicalColumn]) !== canonical) {
      row[canonicalColumn] = canonical;
      changed += 1;
      report.push([entity, 'REPARAR', index + 2, '', oldReference, canonical, 'Se normalizó ClienteID']);
    }
  });

  if (!dryRun) repairWriteTable_(table);
  return { entity: entity, found: true, changed: changed };
}

function repairLocationIds_(ss, dryRun, report) {
  var locationsSheet = repairFindSheet_(ss, ['UbicacionesCliente', 'Ubicaciones Clientes', 'Ubicaciones']);
  var equipmentSheet = repairFindSheet_(ss, ['UbicacionesEquipo', 'Ubicaciones Equipo', 'EquipmentLocations']);
  if (!locationsSheet || !equipmentSheet) return { entity: 'UBICACION_EQUIPO', found: false, changed: 0 };

  var locations = repairReadTable_(locationsSheet);
  var locationIdColumn = repairEnsureHeader_(locations, 'UbicacionID');
  var rowIdColumn = repairFindHeader_(locations.headers, ['RowID', 'Row ID']);
  var legacyIdColumn = repairFindHeader_(locations.headers, ['ID']);
  var locationMap = {};
  var locationsChanged = 0;

  locations.rows.forEach(function (row, index) {
    var current = repairText_(row[locationIdColumn]);
    var rowId = rowIdColumn >= 0 ? repairText_(row[rowIdColumn]) : '';
    var legacyId = legacyIdColumn >= 0 ? repairText_(row[legacyIdColumn]) : '';
    var canonical = current || rowId || legacyId || Utilities.getUuid();

    if (!current) {
      row[locationIdColumn] = canonical;
      locationsChanged += 1;
      report.push(['UBICACION', 'REPARAR', index + 2, '', current || rowId || legacyId, canonical, 'Se completó UbicacionID']);
    }

    [current, rowId, legacyId, canonical].filter(Boolean).forEach(function (id) {
      locationMap[repairKey_(id)] = canonical;
    });
  });

  var equipment = repairReadTable_(equipmentSheet);
  var equipmentLocationColumn = repairEnsureHeader_(equipment, 'UbicacionID');
  var equipmentReferenceColumns = repairFindHeaders_(equipment.headers, ['UbicacionID', 'UbicacionRef', 'IDUbicacion', 'Ubicación ID']);
  var equipmentChanged = 0;

  equipment.rows.forEach(function (row, index) {
    var oldReference = '';
    for (var i = 0; i < equipmentReferenceColumns.length; i += 1) {
      oldReference = repairText_(row[equipmentReferenceColumns[i]]);
      if (oldReference) break;
    }
    var canonical = locationMap[repairKey_(oldReference)] || '';
    if (!canonical) return;
    if (repairText_(row[equipmentLocationColumn]) !== canonical) {
      row[equipmentLocationColumn] = canonical;
      equipmentChanged += 1;
      report.push(['UBICACION_EQUIPO', 'REPARAR', index + 2, '', oldReference, canonical, 'Se normalizó UbicacionID']);
    }
  });

  if (!dryRun) {
    repairWriteTable_(locations);
    repairWriteTable_(equipment);
  }

  return {
    entity: 'UBICACION_EQUIPO',
    found: true,
    locationsChanged: locationsChanged,
    equipmentChanged: equipmentChanged
  };
}

function repairReadTable_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var headers = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(repairText_) : [];
  var rows = lastRow > 1 && lastColumn ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  return { sheet: sheet, headers: headers, rows: rows };
}

function repairEnsureHeader_(table, header) {
  var index = repairFindHeader_(table.headers, [header]);
  if (index >= 0) return index;
  table.headers.push(header);
  table.rows.forEach(function (row) { row.push(''); });
  return table.headers.length - 1;
}

function repairFindHeader_(headers, names) {
  var indexes = repairFindHeaders_(headers, names);
  return indexes.length ? indexes[0] : -1;
}

function repairFindHeaders_(headers, names) {
  var wanted = names.map(repairKey_);
  var result = [];
  headers.forEach(function (header, index) {
    if (wanted.indexOf(repairKey_(header)) >= 0) result.push(index);
  });
  return result;
}

function repairWriteTable_(table) {
  var sheet = table.sheet;
  if (!table.headers.length) return;
  sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
  if (table.rows.length) sheet.getRange(2, 1, table.rows.length, table.headers.length).setValues(table.rows);
  sheet.setFrozenRows(1);
}

function repairWriteReport_(ss, rows, dryRun) {
  var name = dryRun ? 'ReparacionClientesPreview' : 'ReparacionClientesLog';
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var headers = ['Entidad', 'Accion', 'Fila', 'Nombre', 'ID anterior', 'ID canonical', 'Detalle'];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#b7131a').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
}

function repairFindSheet_(ss, names) {
  var wanted = names.map(repairKey_);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i += 1) {
    if (wanted.indexOf(repairKey_(sheets[i].getName())) >= 0) return sheets[i];
  }
  return null;
}

function repairClientsSpreadsheet_() {
  if (typeof ss_ === 'function') {
    try {
      var spreadsheet = ss_();
      if (spreadsheet) return spreadsheet;
    } catch (ignored) { /* Usa la propiedad configurada. */ }
  }

  var id = repairText_(PropertiesService.getScriptProperties().getProperty('DMS_SPREADSHEET_ID'));
  if (!id) throw new Error('Falta DMS_SPREADSHEET_ID en Propiedades del script.');
  return SpreadsheetApp.openById(id);
}

function repairKey_(value) {
  var text = repairText_(value).toLowerCase();
  if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function repairText_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function repairBlank_(value) {
  return value === null || value === undefined || repairText_(value) === '';
}
