/**
 * PARCHE BACKEND - PDF, CORREO, CHAT, PRUEBAS Y TIPOS DE FALLA
 *
 * 1. Pegue este archivo dentro del proyecto de Apps Script del backend.
 * 2. Agregue las rutas indicadas en ROUTES.
 * 3. Ejecute instalarParcheTiposFallaDMS() una sola vez.
 * 4. Actualice la implementación del Web App con una nueva versión.
 */

/**
 * RUTAS QUE DEBE AGREGAR DENTRO DE ROUTES:
 *
 * 'catalog.failureTypes.list': {
 *   handler: apiFailureTypesList_,
 *   permission: 'CATALOGOS_VER'
 * },
 *
 * 'catalog.failureTypes.create': {
 *   handler: apiFailureTypesCreate_,
 *   permission: 'BOLETAS_CREAR'
 * },
 *
 * 'catalog.failureTypes.update': {
 *   handler: apiFailureTypesUpdate_,
 *   permission: 'CATALOGOS_GESTIONAR'
 * },
 *
 * 'boletas.testFinalize': {
 *   handler: apiBoletasTestFinalize_,
 *   permission: 'NOTIFICACIONES_PRUEBA'
 * },
 */

function instalarParcheTiposFallaDMS() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('TiposFalla');

  if (!sheet) {
    sheet = ss.insertSheet('TiposFalla');
  }

  const headers = [
    'TipoFallaID',
    'Nombre',
    'Descripcion',
    'Activo',
    'CreadoPor',
    'FechaCreacion',
    'ActualizadoPor',
    'FechaActualizacion'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const currentHeaders = sheet
      .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getValues()[0];

    const isCompatible = headers.every(function(header, index) {
      return currentHeaders[index] === header;
    });

    if (!isCompatible) {
      throw new Error(
        'La hoja TiposFalla ya existe, pero sus encabezados no coinciden con la estructura requerida.'
      );
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF');

  const existing = getRows_('TiposFalla');
  if (existing.length === 0) {
    const now = new Date();
    [
      'Sin falla',
      'Falla de alimentación',
      'Falla de comunicación',
      'Daño físico',
      'Configuración',
      'Intermitencia',
      'Otro'
    ].forEach(function(nombre) {
      insertObject_('TiposFalla', {
        TipoFallaID: Utilities.getUuid(),
        Nombre: nombre,
        Descripcion: '',
        Activo: true,
        CreadoPor: 'INSTALACION',
        FechaCreacion: now,
        ActualizadoPor: 'INSTALACION',
        FechaActualizacion: now
      });
    });
  }

  return {
    ok: true,
    sheetName: 'TiposFalla',
    registros: getRows_('TiposFalla').length
  };
}

function apiFailureTypesList_(ctx) {
  return listTable_('TiposFalla', ctx.payload, {
    searchFields: ['Nombre', 'Descripcion'],
    filterMap: { activo: 'Activo' },
    defaultSortBy: 'Nombre'
  });
}

function apiFailureTypesCreate_(ctx) {
  const payload = ctx.payload || {};
  requireFields_(payload, ['nombre']);

  const nombre = String(payload.nombre).trim();
  const duplicate = findOne_('TiposFalla', function(row) {
    return String(row.Nombre || '').trim().toLowerCase() === nombre.toLowerCase() &&
      toBoolean_(row.Activo);
  });

  if (duplicate) {
    return stripInternalFields_(duplicate);
  }

  const now = new Date();
  const row = {
    TipoFallaID: Utilities.getUuid(),
    Nombre: nombre,
    Descripcion: payload.descripcion || '',
    Activo: payload.activo === undefined ? true : toBoolean_(payload.activo),
    CreadoPor: ctx.user.UsuarioID,
    FechaCreacion: now,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: now
  };

  insertObject_('TiposFalla', row);
  audit_(ctx.user, 'CREAR', 'TiposFalla', row.TipoFallaID, null, row, ctx.meta);
  return row;
}

function apiFailureTypesUpdate_(ctx) {
  return updateSimpleEntity_(ctx, {
    table: 'TiposFalla',
    idColumn: 'TipoFallaID',
    idValue: ctx.payload.tipoFallaId,
    fieldMap: {
      nombre: 'Nombre',
      descripcion: 'Descripcion',
      activo: 'Activo'
    }
  });
}

/**
 * Genera documento y PDF y los envía exclusivamente a los destinos de prueba.
 * No cambia el estado de la boleta y no escribe DocumentoURL/PDFURL en la boleta.
 */
function apiBoletasTestFinalize_(ctx) {
  const boletaUid = ctx.payload.boletaUid;
  const boleta = requireRecord_('Boletas', 'BoletaUID', boletaUid);

  validateBoletaForFinalization_(boleta);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const artifacts = generateBoletaArtifacts_(boleta, ctx.user);
    const notification = sendBoletaNotifications_(
      boleta,
      artifacts,
      {
        testMode: true,
        sendClientCopy: false,
        cc: []
      },
      ctx.user
    );

    audit_(
      ctx.user,
      'PRUEBA_FINALIZACION',
      'Boletas',
      boletaUid,
      null,
      {
        artifacts: artifacts,
        notification: notification
      },
      ctx.meta
    );

    if (!notification.ok) {
      throw apiError_(
        'TEST_NOTIFICATION_ERROR',
        notification.error || 'La prueba no pudo enviarse completamente.',
        502,
        notification
      );
    }

    return {
      testMode: true,
      boletaEstado: boleta.Estado,
      artifacts: artifacts,
      notification: notification
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Diagnóstico de configuración necesaria para finalizar boletas.
 */
function verificarConfiguracionFinalizacionDMS() {
  const props = PropertiesService.getScriptProperties();
  const keys = [
    'DMS_SPREADSHEET_ID',
    'DMS_TEMPLATE_BOLETA_ID',
    'DMS_BOLETAS_FOLDER_ID',
    'DMS_EVIDENCIAS_FOLDER_ID',
    'DMS_FIRMAS_FOLDER_ID',
    'DMS_TIMEZONE',
    'CHAT_WEBHOOK_BOLETAS',
    'CHAT_WEBHOOK_PRUEBAS'
  ];

  const result = {};
  keys.forEach(function(key) {
    result[key] = Boolean(props.getProperty(key));
  });

  const config = getConfigMap_();
  result.TEST_EMAIL = Boolean(config.TEST_EMAIL);
  result.DEFAULT_CC_EMAILS = Boolean(config.DEFAULT_CC_EMAILS);

  const missing = Object.keys(result).filter(function(key) {
    return result[key] !== true;
  });

  Logger.log(JSON.stringify({ ok: missing.length === 0, result: result, missing: missing }));

  return {
    ok: missing.length === 0,
    result: result,
    missing: missing
  };
}

/**
 * IMPORTANTE:
 * La ruta existente boletas.finalize ya debe apuntar a apiBoletasFinalize_.
 * Esa función genera Docs/PDF, actualiza la boleta y llama sendBoletaNotifications_.
 * No la reemplace por boletas.update al marcar FINALIZADO.
 */
