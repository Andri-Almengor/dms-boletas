/**
 * Migra los datos creados por HistoricalMasterDataImport.gs hacia las
 * tablas que realmente consulta el backend DMS Boletas.
 *
 * Origen -> Destino
 * UbicacionesCliente -> ClienteUbicaciones
 * UbicacionesEquipo  -> ClienteUbicacionesEquipo
 * ContactosCliente   -> ClienteContactos
 *
 * Ejecute primero previewImportedClientRelationsMigration() y después
 * runImportedClientRelationsMigration(). No elimina las hojas de origen.
 */

function previewImportedClientRelationsMigration() {
  return migrateImportedClientRelations_(true);
}

function runImportedClientRelationsMigration() {
  return migrateImportedClientRelations_(false);
}

function migrateImportedClientRelations_(dryRun) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = importedRelationsSpreadsheet_();
    var report = [];
    var clients = importedClientMap_(ss);

    var locations = importedMigrateLocations_(ss, clients, report, dryRun);
    var contacts = importedMigrateContacts_(ss, clients, report, dryRun);
    var equipment = importedMigrateEquipment_(ss, locations.idMap, report, dryRun);

    importedWriteReport_(ss, report, dryRun);

    return {
      ok: true,
      mode: dryRun ? 'PREVIEW' : 'MIGRATION',
      locations: locations.summary,
      contacts: contacts,
      equipmentLocations: equipment,
      reportSheet: dryRun ? 'MigracionRelacionesPreview' : 'MigracionRelacionesLog'
    };
  } finally {
    lock.releaseLock();
  }
}

function importedMigrateLocations_(ss, clients, report, dryRun) {
  var source = importedRequireSheet_(ss, 'UbicacionesCliente');
  var target = importedGetTarget_(ss, 'ClienteUbicaciones', [
    'UbicacionID', 'ClienteID', 'Nombre', 'Direccion', 'Notas', 'Activo',
    'CreadoPor', 'FechaCreacion', 'ActualizadoPor', 'FechaActualizacion'
  ], dryRun);

  var sourceRows = importedRows_(source);
  var targetRows = importedRows_(target);
  var byId = {};
  var byKey = {};
  var idMap = {};
  var summary = { created: 0, updated: 0, skipped: 0, errors: 0 };

  targetRows.items.forEach(function (row, index) {
    if (row.UbicacionID) byId[importedKey_(row.UbicacionID)] = index;
    if (row.ClienteID && row.Nombre) byKey[String(row.ClienteID) + '|' + importedKey_(row.Nombre)] = index;
  });

  sourceRows.items.forEach(function (row, index) {
    var sourceId = importedText_(row.UbicacionID || row.ID || row.RowID) || Utilities.getUuid();
    var clientId = importedCanonicalClient_(row.ClienteID || row.ClienteRef, clients);
    var name = importedText_(row.Nombre || row.Ubicacion);

    if (!clientId || !name) {
      summary.errors += 1;
      report.push(['UBICACION', 'ERROR', index + 2, name, sourceId, '', 'ClienteID o Nombre faltante']);
      return;
    }

    var logicalKey = clientId + '|' + importedKey_(name);
    var targetIndex = byId[importedKey_(sourceId)];
    if (targetIndex === undefined) targetIndex = byKey[logicalKey];

    var values = {
      UbicacionID: sourceId,
      ClienteID: clientId,
      Nombre: name,
      Direccion: row.Direccion || '',
      Notas: row.Notas || row.Descripcion || '',
      Activo: importedBoolean_(row.Activo, true),
      CreadoPor: row.CreadoPor || 'importacion-historica',
      FechaCreacion: row.FechaCreacion || row.CreatedAt || new Date(),
      ActualizadoPor: row.ActualizadoPor || 'importacion-historica',
      FechaActualizacion: row.FechaActualizacion || row.UpdatedAt || new Date()
    };

    if (targetIndex === undefined) {
      targetRows.items.push(values);
      targetIndex = targetRows.items.length - 1;
      byId[importedKey_(sourceId)] = targetIndex;
      byKey[logicalKey] = targetIndex;
      summary.created += 1;
      report.push(['UBICACION', 'CREAR', index + 2, name, sourceId, sourceId, 'ClienteID: ' + clientId]);
    } else {
      var changed = importedComplete_(targetRows.items[targetIndex], values);
      summary[changed ? 'updated' : 'skipped'] += 1;
      report.push(['UBICACION', changed ? 'ACTUALIZAR' : 'OMITIR', index + 2, name, sourceId, targetRows.items[targetIndex].UbicacionID, changed ? 'Campos completados' : 'Ya existía']);
    }

    idMap[importedKey_(sourceId)] = targetRows.items[targetIndex].UbicacionID;
  });

  if (!dryRun) importedWriteRows_(target, targetRows.headers, targetRows.items);
  return { summary: summary, idMap: idMap };
}

function importedMigrateContacts_(ss, clients, report, dryRun) {
  var source = importedRequireSheet_(ss, 'ContactosCliente');
  var target = importedGetTarget_(ss, 'ClienteContactos', [
    'ContactoID', 'ClienteID', 'Nombre', 'Puesto', 'Correo', 'Telefono',
    'EsSupervisor', 'RecibeCorreo', 'Notas', 'Activo', 'CreadoPor',
    'FechaCreacion', 'ActualizadoPor', 'FechaActualizacion'
  ], dryRun);

  var sourceRows = importedRows_(source);
  var targetRows = importedRows_(target);
  var byId = {};
  var byKey = {};
  var summary = { created: 0, updated: 0, skipped: 0, errors: 0 };

  targetRows.items.forEach(function (row, index) {
    if (row.ContactoID) byId[importedKey_(row.ContactoID)] = index;
    if (row.ClienteID && row.Nombre) {
      byKey[String(row.ClienteID) + '|' + importedKey_(row.Nombre) + '|' + importedEmail_(row.Correo)] = index;
    }
  });

  sourceRows.items.forEach(function (row, index) {
    var sourceId = importedText_(row.ContactoID || row.ID || row.RowID) || Utilities.getUuid();
    var clientId = importedCanonicalClient_(row.ClienteID || row.ClienteRef, clients);
    var name = importedText_(row.Nombre || row.Contacto);
    var email = importedEmail_(row.Correo || row.Email);

    if (!clientId || !name) {
      summary.errors += 1;
      report.push(['CONTACTO', 'ERROR', index + 2, name, sourceId, '', 'ClienteID o Nombre faltante']);
      return;
    }

    var logicalKey = clientId + '|' + importedKey_(name) + '|' + email;
    var targetIndex = byId[importedKey_(sourceId)];
    if (targetIndex === undefined) targetIndex = byKey[logicalKey];

    var values = {
      ContactoID: sourceId,
      ClienteID: clientId,
      Nombre: name,
      Puesto: row.Puesto || row.Cargo || '',
      Correo: email,
      Telefono: row.Telefono || '',
      EsSupervisor: importedBoolean_(row.EsSupervisor, true),
      RecibeCorreo: importedBoolean_(row.RecibeCorreo, Boolean(email)),
      Notas: row.Notas || '',
      Activo: importedBoolean_(row.Activo, true),
      CreadoPor: row.CreadoPor || 'importacion-historica',
      FechaCreacion: row.FechaCreacion || row.CreatedAt || new Date(),
      ActualizadoPor: row.ActualizadoPor || 'importacion-historica',
      FechaActualizacion: row.FechaActualizacion || row.UpdatedAt || new Date()
    };

    if (targetIndex === undefined) {
      targetRows.items.push(values);
      targetIndex = targetRows.items.length - 1;
      byId[importedKey_(sourceId)] = targetIndex;
      byKey[logicalKey] = targetIndex;
      summary.created += 1;
      report.push(['CONTACTO', 'CREAR', index + 2, name, sourceId, sourceId, 'ClienteID: ' + clientId]);
    } else {
      var changed = importedComplete_(targetRows.items[targetIndex], values);
      summary[changed ? 'updated' : 'skipped'] += 1;
      report.push(['CONTACTO', changed ? 'ACTUALIZAR' : 'OMITIR', index + 2, name, sourceId, targetRows.items[targetIndex].ContactoID, changed ? 'Campos completados' : 'Ya existía']);
    }
  });

  if (!dryRun) importedWriteRows_(target, targetRows.headers, targetRows.items);
  return summary;
}

function importedMigrateEquipment_(ss, locationIdMap, report, dryRun) {
  var source = importedRequireSheet_(ss, 'UbicacionesEquipo');
  var target = importedGetTarget_(ss, 'ClienteUbicacionesEquipo', [
    'UbicacionEquipoID', 'UbicacionID', 'Nombre', 'Descripcion', 'Activo',
    'CreadoPor', 'FechaCreacion', 'ActualizadoPor', 'FechaActualizacion'
  ], dryRun);

  var sourceRows = importedRows_(source);
  var targetRows = importedRows_(target);
  var byId = {};
  var byKey = {};
  var summary = { created: 0, updated: 0, skipped: 0, errors: 0 };

  targetRows.items.forEach(function (row, index) {
    if (row.UbicacionEquipoID) byId[importedKey_(row.UbicacionEquipoID)] = index;
    if (row.UbicacionID && row.Nombre) byKey[String(row.UbicacionID) + '|' + importedKey_(row.Nombre)] = index;
  });

  sourceRows.items.forEach(function (row, index) {
    var sourceId = importedText_(row.UbicacionEquipoID || row.ID || row.RowID) || Utilities.getUuid();
    var oldLocationId = importedText_(row.UbicacionID || row.UbicacionRef);
    var locationId = locationIdMap[importedKey_(oldLocationId)] || oldLocationId;
    var name = importedText_(row.Nombre || row.UbicacionEquipo);

    if (!locationId || !name) {
      summary.errors += 1;
      report.push(['UBICACION_EQUIPO', 'ERROR', index + 2, name, sourceId, '', 'UbicacionID o Nombre faltante']);
      return;
    }

    var logicalKey = locationId + '|' + importedKey_(name);
    var targetIndex = byId[importedKey_(sourceId)];
    if (targetIndex === undefined) targetIndex = byKey[logicalKey];

    var values = {
      UbicacionEquipoID: sourceId,
      UbicacionID: locationId,
      Nombre: name,
      Descripcion: row.Descripcion || '',
      Activo: importedBoolean_(row.Activo, true),
      CreadoPor: row.CreadoPor || 'importacion-historica',
      FechaCreacion: row.FechaCreacion || row.CreatedAt || new Date(),
      ActualizadoPor: row.ActualizadoPor || 'importacion-historica',
      FechaActualizacion: row.FechaActualizacion || row.UpdatedAt || new Date()
    };

    if (targetIndex === undefined) {
      targetRows.items.push(values);
      targetIndex = targetRows.items.length - 1;
      byId[importedKey_(sourceId)] = targetIndex;
      byKey[logicalKey] = targetIndex;
      summary.created += 1;
      report.push(['UBICACION_EQUIPO', 'CREAR', index + 2, name, sourceId, sourceId, 'UbicacionID: ' + locationId]);
    } else {
      var changed = importedComplete_(targetRows.items[targetIndex], values);
      summary[changed ? 'updated' : 'skipped'] += 1;
      report.push(['UBICACION_EQUIPO', changed ? 'ACTUALIZAR' : 'OMITIR', index + 2, name, sourceId, targetRows.items[targetIndex].UbicacionEquipoID, changed ? 'Campos completados' : 'Ya existía']);
    }
  });

  if (!dryRun) importedWriteRows_(target, targetRows.headers, targetRows.items);
  return summary;
}

function importedClientMap_(ss) {
  var table = importedRows_(importedRequireSheet_(ss, 'Clientes'));
  var map = {};
  table.items.forEach(function (row) {
    var canonical = importedText_(row.ClienteID || row.RowID || row.ID);
    if (!canonical) return;
    [row.ClienteID, row.RowID, row.ID].forEach(function (id) {
      if (id) map[importedKey_(id)] = canonical;
    });
  });
  return map;
}

function importedCanonicalClient_(value, map) {
  var text = importedText_(value);
  return text ? (map[importedKey_(text)] || text) : '';
}

function importedRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.__virtual
    ? sheet.__headers.slice()
    : (lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(importedText_) : []);
  var values = sheet.__virtual
    ? []
    : (lastRow > 1 && lastColumn ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : []);
  var items = values.map(function (row) {
    var object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  });
  return { headers: headers, items: items };
}

function importedGetTarget_(ss, name, headers, dryRun) {
  var sheet = ss.getSheetByName(name);
  if (!sheet && dryRun) {
    return { __virtual: true, __headers: headers, getLastRow: function () { return 1; }, getLastColumn: function () { return headers.length; } };
  }
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function importedWriteRows_(sheet, baseHeaders, items) {
  var headers = baseHeaders.slice();
  items.forEach(function (item) {
    Object.keys(item).forEach(function (header) {
      if (headers.indexOf(header) < 0) headers.push(header);
    });
  });
  var values = items.map(function (item) {
    return headers.map(function (header) { return item[header] === undefined ? '' : item[header]; });
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function importedComplete_(target, source) {
  var changed = false;
  Object.keys(source).forEach(function (key) {
    if (importedBlank_(target[key]) && !importedBlank_(source[key])) {
      target[key] = source[key];
      changed = true;
    }
  });
  return changed;
}

function importedWriteReport_(ss, rows, dryRun) {
  var name = dryRun ? 'MigracionRelacionesPreview' : 'MigracionRelacionesLog';
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var headers = ['Entidad', 'Accion', 'Fila origen', 'Nombre', 'ID origen', 'ID destino', 'Detalle'];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#b7131a').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
}

function importedRequireSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('No se encontró la hoja ' + name + '.');
  return sheet;
}

function importedRelationsSpreadsheet_() {
  if (typeof ss_ === 'function') {
    try {
      var current = ss_();
      if (current) return current;
    } catch (ignored) {}
  }
  var id = importedText_(PropertiesService.getScriptProperties().getProperty('DMS_SPREADSHEET_ID'));
  if (!id) throw new Error('Falta DMS_SPREADSHEET_ID en Propiedades del script.');
  return SpreadsheetApp.openById(id);
}

function importedBoolean_(value, fallback) {
  if (importedBlank_(value)) return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].indexOf(importedText_(value).toLowerCase()) >= 0;
}

function importedEmail_(value) {
  return importedText_(value).toLowerCase().replace(/\s+/g, '');
}

function importedKey_(value) {
  var text = importedText_(value).toLowerCase();
  if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function importedText_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function importedBlank_(value) {
  return value === null || value === undefined || importedText_(value) === '';
}
