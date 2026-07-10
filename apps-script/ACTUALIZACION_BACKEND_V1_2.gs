/**
 * DMS WebApp - Actualización 1.2
 * Plantilla oficial y relaciones Dispositivo -> Fabricante -> Modelo.
 *
 * Después de copiar este archivo al proyecto Apps Script:
 * 1. Agregue las rutas indicadas abajo al objeto ROUTES.
 * 2. Ejecute instalarActualizacionBackendDMS_1_2().
 * 3. Cree una nueva versión de la implementación web.
 */

const DMS_TEMPLATE_OFICIAL_ID = '1BmxzuGmCbgB01OcJCW2pgOTXeztw3TW-_83HjT090RU';

/* AGREGAR DENTRO DE ROUTES:

'catalog.deviceManufacturers.list': {
  handler: apiDeviceManufacturersList_,
  permission: 'CATALOGOS_VER'
},
'catalog.deviceManufacturers.create': {
  handler: apiDeviceManufacturersCreate_,
  permission: 'CATALOGOS_GESTIONAR'
},
'catalog.deviceManufacturers.update': {
  handler: apiDeviceManufacturersUpdate_,
  permission: 'CATALOGOS_GESTIONAR'
},

*/

function instalarActualizacionBackendDMS_1_2() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DMS_TEMPLATE_BOLETA_ID', DMS_TEMPLATE_OFICIAL_ID);

  if (typeof repararEstructuraDriveDMS === 'function') {
    repararEstructuraDriveDMS();
  }
  if (typeof instalarParcheTiposFallaDMS === 'function') {
    instalarParcheTiposFallaDMS();
  }

  instalarTablaTipoDispositivoFabricantesDMS_();

  return verificarActualizacionBackendDMS_1_2();
}

function verificarActualizacionBackendDMS_1_2() {
  const props = PropertiesService.getScriptProperties();
  const templateId = props.getProperty('DMS_TEMPLATE_BOLETA_ID');
  let templateAccessible = false;
  let templateName = '';

  try {
    const file = DriveApp.getFileById(templateId);
    templateName = file.getName();
    templateAccessible = true;
  } catch (error) {
    templateAccessible = false;
  }

  const relationSheet = getSpreadsheet_().getSheetByName(
    'TipoDispositivoFabricantes'
  );

  const result = {
    ok:
      templateId === DMS_TEMPLATE_OFICIAL_ID &&
      templateAccessible &&
      Boolean(relationSheet),
    templateId,
    templateName,
    templateAccessible,
    relationTableInstalled: Boolean(relationSheet)
  };

  Logger.log(JSON.stringify(result));
  return result;
}

function instalarTablaTipoDispositivoFabricantesDMS_() {
  const ss = getSpreadsheet_();
  const sheetName = 'TipoDispositivoFabricantes';
  const headers = [
    'RelacionID',
    'TipoDispositivoID',
    'FabricanteID',
    'Activo',
    'CreadoPor',
    'FechaCreacion',
    'ActualizadoPor',
    'FechaActualizacion'
  ];

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF');

  // Migra relaciones que ya existen por medio de los modelos.
  const existing = {};
  getRows_(sheetName).forEach(function(row) {
    existing[row.TipoDispositivoID + '|' + row.FabricanteID] = true;
  });

  const now = new Date();
  getRows_('Modelos').forEach(function(model) {
    if (!model.TipoDispositivoID || !model.FabricanteID) return;

    const key = model.TipoDispositivoID + '|' + model.FabricanteID;
    if (existing[key]) return;

    insertObject_(sheetName, {
      RelacionID: Utilities.getUuid(),
      TipoDispositivoID: model.TipoDispositivoID,
      FabricanteID: model.FabricanteID,
      Activo: true,
      CreadoPor: 'MIGRACION',
      FechaCreacion: now,
      ActualizadoPor: 'MIGRACION',
      FechaActualizacion: now
    });

    existing[key] = true;
  });

  return {
    ok: true,
    table: sheetName,
    relations: getRows_(sheetName).length
  };
}

function apiDeviceManufacturersList_(ctx) {
  return listTable_('TipoDispositivoFabricantes', ctx.payload, {
    filterMap: {
      tipoDispositivoId: 'TipoDispositivoID',
      fabricanteId: 'FabricanteID',
      activo: 'Activo'
    }
  });
}

function apiDeviceManufacturersCreate_(ctx) {
  const p = ctx.payload || {};
  requireFields_(p, ['tipoDispositivoId', 'fabricanteId']);

  requireRecord_(
    'TiposDispositivo',
    'TipoDispositivoID',
    p.tipoDispositivoId
  );
  requireRecord_(
    'Fabricantes',
    'FabricanteID',
    p.fabricanteId
  );

  const existing = findOne_(
    'TipoDispositivoFabricantes',
    function(row) {
      return row.TipoDispositivoID === p.tipoDispositivoId &&
        row.FabricanteID === p.fabricanteId;
    }
  );

  if (existing) {
    if (!toBoolean_(existing.Activo)) {
      updateById_(
        'TipoDispositivoFabricantes',
        'RelacionID',
        existing.RelacionID,
        {
          Activo: true,
          ActualizadoPor: ctx.user.UsuarioID,
          FechaActualizacion: new Date()
        }
      );
    }

    return requireRecord_(
      'TipoDispositivoFabricantes',
      'RelacionID',
      existing.RelacionID
    );
  }

  const now = new Date();
  const row = {
    RelacionID: Utilities.getUuid(),
    TipoDispositivoID: p.tipoDispositivoId,
    FabricanteID: p.fabricanteId,
    Activo: true,
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: now,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: now
  };

  insertObject_('TipoDispositivoFabricantes', row);
  audit_(
    ctx.user,
    'CREAR',
    'TipoDispositivoFabricantes',
    row.RelacionID,
    null,
    row,
    ctx.meta
  );

  return row;
}

function apiDeviceManufacturersUpdate_(ctx) {
  return updateSimpleEntity_(ctx, {
    table: 'TipoDispositivoFabricantes',
    idColumn: 'RelacionID',
    idValue: ctx.payload.relacionId,
    fieldMap: {
      activo: 'Activo'
    }
  });
}

/**
 * Reemplaza la creación de modelos para asegurar que la relación exista.
 */
function apiModelsCreate_(ctx) {
  const p = ctx.payload;
  requireFields_(p, ['tipoDispositivoId', 'fabricanteId', 'nombre']);

  requireRecord_(
    'TiposDispositivo',
    'TipoDispositivoID',
    p.tipoDispositivoId
  );
  requireRecord_(
    'Fabricantes',
    'FabricanteID',
    p.fabricanteId
  );

  const duplicate = findOne_('Modelos', function(row) {
    return row.TipoDispositivoID === p.tipoDispositivoId &&
      row.FabricanteID === p.fabricanteId &&
      String(row.Nombre || '').trim().toLowerCase() ===
        String(p.nombre).trim().toLowerCase();
  });

  if (duplicate) return stripInternalFields_(duplicate);

  apiDeviceManufacturersCreate_({
    payload: {
      tipoDispositivoId: p.tipoDispositivoId,
      fabricanteId: p.fabricanteId
    },
    user: ctx.user,
    meta: ctx.meta
  });

  const now = new Date();
  const row = {
    ModeloID: Utilities.getUuid(),
    TipoDispositivoID: p.tipoDispositivoId,
    FabricanteID: p.fabricanteId,
    Nombre: String(p.nombre).trim(),
    ImagenReferenciaURL: p.imagenReferenciaURL || '',
    Descripcion: p.descripcion || '',
    Activo: p.activo === undefined ? true : toBoolean_(p.activo),
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: now,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: now
  };

  insertObject_('Modelos', row);
  audit_(ctx.user, 'CREAR', 'Modelos', row.ModeloID, null, row, ctx.meta);
  return row;
}

/**
 * Generación del reporte usando la plantilla oficial de la boleta.
 * Reconoce marcadores de AppSheet y marcadores {{Campo}}.
 */
function generateBoletaArtifacts_(boleta, user) {
  const templateId = DMS_TEMPLATE_OFICIAL_ID;
  PropertiesService.getScriptProperties()
    .setProperty('DMS_TEMPLATE_BOLETA_ID', templateId);

  const baseFolder = getDmsFolderWithRepair_('DMS_BOLETAS_FOLDER_ID');
  const clientFolder = getOrCreateFolderApi_(
    baseFolder,
    sanitizeFileName_(boleta.Cliente || 'Sin cliente')
  );
  const boletaFolder = getOrCreateFolderApi_(
    clientFolder,
    'Boleta_' + boleta.BoletaID + '_' +
      sanitizeFileName_(boleta.Titulo || 'Reporte')
  );

  const templateFile = DriveApp.getFileById(templateId);
  const docCopy = templateFile.makeCopy(
    'Reporte Técnico - ' + boleta.Titulo +
      ' - Boleta ' + boleta.BoletaID,
    boletaFolder
  );

  const doc = DocumentApp.openById(docCopy.getId());
  const body = doc.getBody();
  const assignedNames = getAssignedUsers_(boleta.BoletaUID)
    .map(function(item) { return item.NombreCompleto; })
    .join(', ');

  const values = {
    ID: boleta.BoletaID,
    BoletaID: boleta.BoletaID,
    Categoria: boleta.Categoria,
    Fecha: formatDateApi_(boleta.Fecha, 'dd/MM/yyyy'),
    Cliente: boleta.Cliente,
    Ubicacion: boleta.Ubicacion,
    'Ubicación': boleta.Ubicacion,
    Supervisor: boleta.Supervisor,
    Razon_visita: boleta.RazonVisita,
    RazonVisita: boleta.RazonVisita,
    'Descripción': boleta.Descripcion,
    Descripcion: boleta.Descripcion,
    Fabricante: boleta.Fabricante,
    Modelo: boleta.Modelo,
    Serie: boleta.Serie,
    Ubicacion_equipo: boleta.UbicacionEquipo,
    UbicacionEquipo: boleta.UbicacionEquipo,
    'Pruebas realizadas': boleta.PruebasRealizadas,
    PruebasRealizadas: boleta.PruebasRealizadas,
    Resultado: boleta.Resultado,
    Recomendaciones: boleta.Recomendaciones,
    AsignadoA: assignedNames,
    'Hora de inicio': String(boleta.HoraInicio || ''),
    'Hora de finalización': String(boleta.HoraFinal || ''),
    Titulo: boleta.Titulo,
    TipoFalla: boleta.TipoFalla
  };

  Object.keys(values).forEach(function(key) {
    const value = String(values[key] || '');
    body.replaceText(
      escapeRegex_('{{' + key + '}}'),
      value
    );
    body.replaceText(
      escapeRegex_('<<[' + key + ']>>'),
      value
    );
  });

  body.replaceText(
    escapeRegex_('<<TEXT([Fecha], "DD/MM/YYYY")>>'),
    String(values.Fecha || '')
  );

  insertarFirmaEnPlantillaDMS_(body, boleta.FirmaArchivoID);
  doc.saveAndClose();

  const pdfBlob = docCopy.getBlob()
    .getAs(MimeType.PDF)
    .setName(
      'Reporte Técnico - ' + boleta.Titulo +
      ' - Boleta ' + boleta.BoletaID + '.pdf'
    );
  const pdfFile = boletaFolder.createFile(pdfBlob);

  registerFile_(
    'BOLETA',
    boleta.BoletaUID,
    'DOCUMENTO',
    docCopy,
    user.UsuarioID
  );
  registerFile_(
    'BOLETA',
    boleta.BoletaUID,
    'PDF',
    pdfFile,
    user.UsuarioID
  );

  return {
    documentId: docCopy.getId(),
    documentUrl: docCopy.getUrl(),
    pdfId: pdfFile.getId(),
    pdfUrl: pdfFile.getUrl(),
    folderId: boletaFolder.getId(),
    folderUrl: boletaFolder.getUrl()
  };
}

function insertarFirmaEnPlantillaDMS_(body, fileId) {
  const markers = ['<<[Firma]>>', '{{Firma}}'];
  let inserted = false;

  markers.forEach(function(marker) {
    if (inserted) return;
    const found = body.findText(escapeRegex_(marker));
    if (!found) return;

    const text = found.getElement().asText();
    text.deleteText(found.getStartOffset(), found.getEndOffsetInclusive());

    if (fileId) {
      try {
        text.getParent()
          .appendInlineImage(DriveApp.getFileById(fileId).getBlob())
          .setWidth(150);
        inserted = true;
      } catch (error) {
        Logger.log('No se pudo insertar la firma: ' + error.message);
      }
    }
  });
}
