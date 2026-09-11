const DEFAULT_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';
const DEFAULT_TIME_ZONE = 'America/Costa_Rica';
const MAX_EMAIL_BYTES = 17 * 1024 * 1024;
const DIRECT_EMAIL_ATTACHMENT_MODE = 'DIRECT';
const BRAND_RED = '#b90d19';
const BRAND_RED_DARK = '#8f0913';
const BRAND_GREEN = '#0f8a63';
const BRAND_TEXT = '#111827';
const BRAND_MUTED = '#6b7280';
const BRAND_BORDER = '#ead5d7';
const BRAND_BACKGROUND = '#fffafa';
const DMS_EMAIL_FROM_ALIAS = 'reportes@solutionsdms.com';
const DMS_EMAIL_FROM_NAME = 'DMS Boletas';
const APPS_SCRIPT_VERSION = '2026-09-11-V7.9-BOUNDED-CASE-UPLOADS';
const MAINTENANCE_ARCHIVE_DELIVERY_TYPE = 'MAINTENANCE_ARCHIVE';

/*
 * V6.1 integra el modo de archivo usado por la finalización escalonada:
 * - ScriptLock solo protege las propiedades de idempotencia, nunca Docs/Drive;
 * - MAINTENANCE_ARCHIVE fuerza PDF sin correo/encuesta/firma pendiente;
 * - el Google Docs temporal se elimina después de crear el PDF;
 * - las presentaciones reconocen la jerarquía Mantenimiento/Zonas/Tipo.
 */

/*
 * Protección de rendimiento.
 *
 * Render corta actualmente la espera HTTP alrededor de los 300 segundos en el
 * escenario que motivó esta versión. Apps Script permite ejecuciones más largas,
 * pero no conviene consumir todo ese margen en una única petición síncrona.
 */
const REQUEST_SOFT_DEADLINE_MS = 4.25 * 60 * 1000;
const REQUEST_LONG_CLEANUP_THRESHOLD_MS = 60 * 1000;
const IDEMPOTENCY_RUNNING_TTL_MS = 8 * 60 * 1000;
const IDEMPOTENCY_LOCK_WAIT_MS = 5000;
const DRIVE_TRANSIENT_RETRIES = 2;
const DRIVE_TRANSIENT_INITIAL_DELAY_MS = 350;

/*
 * Las fotos de teléfonos pueden pesar varios MB. Google Docs conserva el archivo
 * original aunque visualmente se reduzca el ancho. Para evitar PDFs gigantes y
 * conversiones de varios minutos, las imágenes de más de 3 MB se insertan en el
 * documento usando la miniatura administrada por Drive cuando está disponible.
 * El archivo ORIGINAL se conserva en Drive y, si corresponde enviar correo, se
 * adjunta el original.
 */
const REPORT_EMBED_ORIGINAL_MAX_BYTES = 3 * 1024 * 1024;
const REPORT_EMBED_THUMBNAIL_MIN_BYTES = 8 * 1024;

/*
 * El worker de presentaciones ya no mantiene ScriptLock durante varios minutos.
 * Usa una concesión (lease) breve y persistente para impedir workers solapados
 * sin bloquear las peticiones HTTP del Web App.
 */
const MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY = 'MAINTENANCE_SLIDES_WORKER_LEASE_V6';
const MAINTENANCE_SLIDES_WORKER_LEASE_MS = 6 * 60 * 1000;

/*
 * Cachés válidas únicamente durante una petición/ejecución.
 * Se reinician al entrar por doPost o por el worker.
 */
let REQUEST_STARTED_AT_ = 0;
let REQUEST_DRIVE_FILE_CACHE_ = {};
let REQUEST_DRIVE_BLOB_CACHE_ = {};
let REQUEST_DRIVE_THUMBNAIL_CACHE_ = {};
let REQUEST_BLOB_SIZE_CACHE_ = [];
let REQUEST_DMS_EMAIL_ALIAS_CACHE_ = null;
const MAINTENANCE_SLIDES_MAX_IMAGES_PER_SLIDE = 6;
const MAINTENANCE_SLIDES_MAX_RUN_MS = 4.5 * 60 * 1000;
const MAINTENANCE_SLIDES_DEVICES_PER_RUN = 18;
const MAINTENANCE_SLIDES_JOB_PREFIX = '_SLIDES_MANTENIMIENTO_';
const MAINTENANCE_SLIDES_PROPERTY_PREFIX = 'MAINTENANCE_SLIDES_JOB_';
const CUSTOMER_CASE_CREATED_ACTION = 'customer.case.created.send';
const CUSTOMER_CASE_ASSIGNED_ACTION = 'customer.case.assigned.send';
const CUSTOMER_CASE_EVIDENCE_UPLOAD_ACTION = 'customer.case.evidence.upload';
const CUSTOMER_CASE_EVIDENCE_GET_ACTION = 'customer.case.evidence.get';
const SIGNATURE_COMPLETION_ACTION = 'signature.completed.send';
const CUSTOMER_CASE_EVIDENCE_MAX_BYTES = 6 * 1024 * 1024;
const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
// Google limita cada valor de PropertiesService a 9 KB y el almacén completo
// a 500 KB. Estos límites internos dejan margen para configuraciones y para
// nuevas solicitudes durante finalizaciones grandes.
const IDEMPOTENCY_MAX_PROPERTIES = 60;
const IDEMPOTENCY_MAX_MANAGED_BYTES = 160 * 1024;
const IDEMPOTENCY_MAX_VALUE_BYTES = 7 * 1024;
const SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES = 400 * 1024;
const IDEMPOTENCY_LAST_CLEANUP_PROPERTY = 'IDEMPOTENCY_LAST_CLEANUP_AT';

/**
 * Endpoint de comprobación.
 */
function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'dms-boletas-apps-script',
    version: APPS_SCRIPT_VERSION,
    time: new Date().toISOString(),
  });
}


/**
 * Ejecuta esta función MANUALMENTE una vez desde el editor de Apps Script.
 *
 * Su propósito es abrir el flujo de autorización para Google Slides, Drive,
 * Docs, Sheets, correo y disparadores antes de que el Web App reciba peticiones
 * del backend. Los archivos temporales creados durante la prueba se envían a la
 * papelera automáticamente.
 */
function autorizarPermisosDMSV4() {
  const temporaryFileIds = [];

  try {
    const presentation = SlidesApp.create(
      'TEMP_AUTORIZACION_DMS_SLIDES',
    );
    temporaryFileIds.push(presentation.getId());
    presentation.saveAndClose();

    const document = DocumentApp.create(
      'TEMP_AUTORIZACION_DMS_DOCS',
    );
    temporaryFileIds.push(document.getId());
    document.saveAndClose();

    const spreadsheet = SpreadsheetApp.create(
      'TEMP_AUTORIZACION_DMS_SHEETS',
    );
    temporaryFileIds.push(spreadsheet.getId());

    DriveApp.getRootFolder().getName();
    MailApp.getRemainingDailyQuota();
    // GmailApp se usa para enviar desde el alias corporativo configurado.
    GmailApp.getAliases();
    ScriptApp.getProjectTriggers();
    PropertiesService.getScriptProperties().getProperties();

    temporaryFileIds.forEach(function (fileId) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (cleanupError) {
        console.warn(
          'No se pudo enviar a la papelera el archivo temporal '
          + fileId
          + ': '
          + cleanupError.message,
        );
      }
    });

    return {
      ok: true,
      version: APPS_SCRIPT_VERSION,
      message: 'Permisos de DMS autorizados correctamente.',
      scopes: [
        'Google Slides',
        'Google Drive',
        'Google Docs',
        'Google Sheets',
        'Envío de correo',
        'Disparadores de Apps Script',
      ],
    };
  } catch (error) {
    temporaryFileIds.forEach(function (fileId) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (cleanupError) {
        // La autorización puede fallar antes de que Drive esté disponible.
      }
    });

    throw new Error(
      'No se pudieron autorizar los permisos de DMS. '
      + 'Revise appsscript.json y vuelva a ejecutar autorizarPermisosDMSV4. '
      + 'Detalle: '
      + error.message,
    );
  }
}

/**
 * Endpoint principal usado por el backend de DMS Boletas.
 *
 * Acciones soportadas:
 * - ticket.report.deliver
 * - user.credentials.send
 * - maintenance.presentation.create
 * - agenda.notification.send
 * - customer.case.created.send
 * - customer.case.assigned.send
 * - customer.case.evidence.upload
 * - customer.case.evidence.get
 */
function doPost(event) {
  let propertyKey = '';
  let claimToken = '';

  resetRequestRuntime_();

  try {
    const payload = JSON.parse(
      (event && event.postData && event.postData.contents) || '{}',
    );

    validateSecret_(payload.secret);

    const action = clean_(payload.action);
    const supportedActions = [
      'ticket.report.deliver',
      'user.credentials.send',
      'maintenance.presentation.create',
      AGENDA_NOTIFICATION_ACTION,
      CUSTOMER_CASE_CREATED_ACTION,
      CUSTOMER_CASE_ASSIGNED_ACTION,
      CUSTOMER_CASE_EVIDENCE_UPLOAD_ACTION,
      'customer.case.evidence.init',
      'customer.case.evidence.chunk',
      CUSTOMER_CASE_EVIDENCE_GET_ACTION,
      SIGNATURE_COMPLETION_ACTION,
    ];

    if (supportedActions.indexOf(action) === -1) {
      throw new Error('Acción no soportada.');
    }

    const idempotencyKey = clean_(payload.idempotencyKey);
    const prefix = idempotencyPrefixForAction_(action);
    propertyKey = idempotencyKey
      ? `${prefix}${digest_(idempotencyKey)}`
      : '';

    if (
      actionRequiresIdempotency_(action)
      && !propertyKey
    ) {
      throw new Error(
        'Esta acción requiere una llave de idempotencia.',
      );
    }

    /*
     * IMPORTANTE:
     * El ScriptLock se usa únicamente durante unos milisegundos para reclamar
     * la llave de idempotencia. El trabajo pesado de Docs/Drive/Mail se ejecuta
     * FUERA del lock. La versión anterior retenía un lock global durante todo
     * el reporte, serializando solicitudes independientes.
     */
    if (propertyKey) {
      const claim = beginIdempotentRequest_(
        propertyKey,
        action,
      );

      if (claim.replay) {
        return jsonResponse_(claim.response);
      }

      if (claim.inProgress) {
        return jsonResponse_({
          ok: false,
          error: {
            code: 'APPS_SCRIPT_REQUEST_IN_PROGRESS',
            message: 'La misma solicitud ya se está procesando. Espere unos segundos antes de reintentar.',
            retryable: true,
          },
          scriptVersion: APPS_SCRIPT_VERSION,
        });
      }

      claimToken = claim.claimToken || '';
    }

    assertRequestBudget_('iniciar la acción solicitada', 15000);

    let result;

    if (action === 'user.credentials.send') {
      result = sendTemporaryCredentials_(payload);
    } else if (action === AGENDA_NOTIFICATION_ACTION) {
      result = sendAgendaNotification_(payload);
    } else if (action === 'maintenance.presentation.create') {
      result = createMaintenancePresentation_(payload);
    } else if (action === CUSTOMER_CASE_CREATED_ACTION) {
      result = sendCustomerCaseCreatedEmail_(payload);
    } else if (action === CUSTOMER_CASE_ASSIGNED_ACTION) {
      result = sendCustomerCaseAssignedEmail_(payload);
    } else if (action === 'customer.case.evidence.init') {
      result = initCustomerCaseResumable_(payload);
    } else if (action === 'customer.case.evidence.chunk') {
      result = chunkCustomerCaseResumable_(payload);
    } else if (action === CUSTOMER_CASE_EVIDENCE_UPLOAD_ACTION) {
      result = uploadCustomerCaseEvidence_(payload);
    } else if (action === CUSTOMER_CASE_EVIDENCE_GET_ACTION) {
      result = getCustomerCaseEvidence_(payload);
    } else if (action === SIGNATURE_COMPLETION_ACTION) {
      result = sendSignatureCompletionEmail_(payload);
    } else {
      result = createReportAndMaybeSend_(payload);
    }

    const response = {
      ok: true,
      data: result,
      meta: {
        scriptVersion: APPS_SCRIPT_VERSION,
        elapsedMs: requestElapsedMs_(),
      },
    };

    if (propertyKey) {
      completeIdempotentRequest_(
        propertyKey,
        claimToken,
        response,
      );
    }

    /*
     * La limpieza es administrativa y nunca debe empujar una petición larga
     * por encima del timeout del cliente HTTP.
     */
    maybeCleanupExpiredIdempotencyProperties_();

    return jsonResponse_(response);
  } catch (error) {
    if (propertyKey && claimToken) {
      releaseIdempotentClaimAfterError_(
        propertyKey,
        claimToken,
      );
    }

    console.error(error && error.stack ? error.stack : error);

    return jsonResponse_({
      ok: false,
      error: {
        code: error && error.code
          ? String(error.code)
          : 'APPS_SCRIPT_REQUEST_ERROR',
        message: String(error && error.message ? error.message : error),
        retryable: isTransientAppsScriptError_(error),
      },
      meta: {
        scriptVersion: APPS_SCRIPT_VERSION,
        elapsedMs: requestElapsedMs_(),
      },
    });
  }
}


/**
 * Reinicia caches y cronómetro de una ejecución.
 */
function resetRequestRuntime_(trackDeadline) {
  REQUEST_STARTED_AT_ = trackDeadline === false
    ? 0
    : Date.now();
  REQUEST_DRIVE_FILE_CACHE_ = {};
  REQUEST_DRIVE_BLOB_CACHE_ = {};
  REQUEST_DRIVE_THUMBNAIL_CACHE_ = {};
  REQUEST_BLOB_SIZE_CACHE_ = [];
  REQUEST_DMS_EMAIL_ALIAS_CACHE_ = null;
}

function requestElapsedMs_() {
  return REQUEST_STARTED_AT_
    ? Math.max(0, Date.now() - REQUEST_STARTED_AT_)
    : 0;
}

/**
 * Evita iniciar una nueva etapa costosa cuando ya queda poco margen antes del
 * timeout del cliente. No puede interrumpir una llamada individual de Google,
 * pero sí evita encadenar más trabajo después de una petición ya muy larga.
 */
function assertRequestBudget_(step, reserveMs) {
  if (!REQUEST_STARTED_AT_) return;

  const reserve = Math.max(0, Number(reserveMs || 0));
  const elapsed = requestElapsedMs_();

  if (elapsed + reserve >= REQUEST_SOFT_DEADLINE_MS) {
    const error = new Error(
      `La operación se detuvo antes del timeout mientras intentaba ${step}. `
      + `Tiempo consumido: ${Math.round(elapsed / 1000)} s. `
      + 'Puede reintentarse de forma segura con la misma llave de idempotencia.',
    );
    error.code = 'APPS_SCRIPT_SOFT_TIMEOUT';
    throw error;
  }
}

function isTransientAppsScriptError_(error) {
  const message = String(
    error && error.message ? error.message : error || '',
  ).toLowerCase();

  return [
    'timed out',
    'timeout',
    'internal error',
    'backend error',
    'temporarily',
    'try again',
    'service invoked too many times',
    'rate limit',
    'quota',
    'soft_timeout',
    'soft timeout',
  ].some(function (fragment) {
    return message.indexOf(fragment) !== -1;
  });
}

/**
 * Reintenta únicamente fallos que parecen transitorios.
 */
function withTransientRetry_(
  label,
  operation,
  options,
) {
  const settings = options || {};
  const attempts = Math.max(
    1,
    Number(settings.attempts || DRIVE_TRANSIENT_RETRIES),
  );
  const initialDelay = Math.max(
    0,
    Number(
      settings.initialDelayMs
      || DRIVE_TRANSIENT_INITIAL_DELAY_MS,
    ),
  );

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertRequestBudget_(label, 12000);

    try {
      return operation();
    } catch (error) {
      lastError = error;

      if (
        attempt >= attempts
        || !isTransientAppsScriptError_(error)
      ) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.warn(
        `${label} falló en intento ${attempt}/${attempts}: ${error.message}. `
        + `Se reintentará en ${delay} ms.`,
      );
      Utilities.sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Calcula bytes UTF-8 de forma compatible con Apps Script.
 * Se usa un cálculo conservador (llave + valor) para dejar margen real bajo
 * la cuota global de PropertiesService.
 */
function utf8ByteLength_(value) {
  const text = String(value == null ? '' : value);

  try {
    return Utilities.newBlob(text).getBytes().length;
  } catch (_) {
    // Fallback UTF-8 sin depender de APIs del navegador.
    let bytes = 0;

    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);

      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (
        code >= 0xD800
        && code <= 0xDBFF
        && index + 1 < text.length
      ) {
        const next = text.charCodeAt(index + 1);

        if (next >= 0xDC00 && next <= 0xDFFF) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }

    return bytes;
  }
}

function scriptPropertyEntryBytes_(key, value) {
  return utf8ByteLength_(key) + utf8ByteLength_(value);
}

function isPropertyStorageQuotaError_(error) {
  const message = String(
    error && error.message ? error.message : error,
  ).toLowerCase();

  return (
    message.indexOf('property storage quota') !== -1
    || message.indexOf('properties storage quota') !== -1
    || message.indexOf('property store') !== -1
    || (
      message.indexOf('quota') !== -1
      && message.indexOf('propert') !== -1
    )
    || (
      message.indexOf('storage') !== -1
      && message.indexOf('propert') !== -1
    )
  );
}

/**
 * Extrae solo campos necesarios para que un replay de DELIVERY siga teniendo
 * los mismos IDs/URLs que espera el backend, sin guardar estructuras grandes.
 */
function compactReportReplayData_(data) {
  const source = data && typeof data === 'object'
    ? data
    : {};
  const compact = {};
  const scalarKeys = [
    'documentId',
    'documentUrl',
    'pdfId',
    'pdfUrl',
    'pdfFileName',
    'folderId',
    'folderUrl',
    'evidenceCount',
    'visitCount',
    'templateId',
    'surveyUrl',
    'surveyIncluded',
    'signatureUrl',
    'signatureIncluded',
    'deliveryType',
    'archiveOnly',
    'scriptVersion',
    'ticketUid',
    'ticketNumber',
    'visitNumber',
  ];

  scalarKeys.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      compact[key] = source[key];
    }
  });

  if (Array.isArray(source.pdfFileNames)) {
    compact.pdfFileNames = source.pdfFileNames.slice(0, 100);
  }

  if (Array.isArray(source.ticketNumbers)) {
    compact.ticketNumbers = source.ticketNumbers.slice(0, 100);
  }

  if (Array.isArray(source.reports)) {
    compact.reports = source.reports.slice(0, 100).map(function (report) {
      return compactReportReplayData_(report);
    });
  }

  if (source.performance && typeof source.performance === 'object') {
    compact.performance = {};

    Object.keys(source.performance).forEach(function (key) {
      const value = source.performance[key];

      if (
        value == null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
      ) {
        compact.performance[key] = value;
      }
    });
  }

  if (source.email && typeof source.email === 'object') {
    const email = source.email;
    compact.email = {};
    [
      'sent',
      'skipped',
      'messageCount',
      'attachmentCount',
      'reportAttachmentCount',
      'evidenceAttachmentCount',
      'inlineImageCount',
      'allFilesAttachedDirectly',
      'driveAccessRequired',
      'surveyIncluded',
      'surveyUrl',
      'signatureIncluded',
      'signatureUrl',
      'signedDelivery',
      'remainingDailyQuota',
    ].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(email, key)) {
        compact.email[key] = email[key];
      }
    });

    if (Array.isArray(email.to)) {
      compact.email.to = email.to.slice(0, 50);
    }

    if (Array.isArray(email.cc)) {
      compact.email.cc = email.cc.slice(0, 50);
    }
  }

  return compact;
}

function compactIdempotentResponse_(propertyKey, response) {
  if (
    String(propertyKey || '').indexOf('DELIVERY_') === 0
    && response
    && response.ok === true
  ) {
    return {
      ok: true,
      data: compactReportReplayData_(response.data || {}),
      meta: response.meta || {},
    };
  }

  return response;
}

/**
 * Devuelve metadatos seguros de una propiedad administrada. Nunca expone el
 * valor de la propiedad ni secretos de configuración.
 */
function idempotencyPropertyMetadata_(key, raw, now) {
  let stored = null;
  let running = false;
  let timestamp = 0;
  let legacy = false;
  let status = 'LEGACY';

  try {
    stored = JSON.parse(raw);

    if (stored && stored.__dmsIdempotency === true) {
      running = stored.status === 'RUNNING';
      status = running ? 'RUNNING' : 'COMPLETE';
      timestamp = Number(
        stored.storedAt
        || stored.startedAt
        || 0,
      );
    } else {
      legacy = true;
    }
  } catch (_) {
    legacy = true;
  }

  return {
    key: key,
    bytes: scriptPropertyEntryBytes_(key, raw),
    valueBytes: utf8ByteLength_(raw),
    running: running,
    validRunning: Boolean(
      running
      && timestamp
      && now - timestamp < IDEMPOTENCY_RUNNING_TTL_MS
    ),
    staleRunning: Boolean(
      running
      && timestamp
      && now - timestamp >= IDEMPOTENCY_RUNNING_TTL_MS
    ),
    timestamp: timestamp,
    legacy: legacy,
    status: status,
  };
}

function idempotencyPrefixName_(key) {
  const prefixes = [
    'INVITATION_',
    'MAINTENANCE_PRESENTATION_',
    'AGENDA_NOTIFICATION_',
    'CUSTOMER_CASE_CREATED_',
    'CUSTOMER_CASE_ASSIGNED_',
    'CUSTOMER_CASE_EVIDENCE_',
    'SIGNATURE_NOTIFICATION_',
    'DELIVERY_',
  ];

  for (let index = 0; index < prefixes.length; index += 1) {
    if (String(key || '').indexOf(prefixes[index]) === 0) {
      return prefixes[index];
    }
  }

  return 'OTHER';
}

/**
 * Libera espacio ANTES de escribir una nueva propiedad idempotente.
 *
 * Nunca borra configuraciones ni solicitudes RUNNING vigentes. Cuando hace
 * falta espacio, elimina primero valores heredados/corruptos, luego COMPLETE
 * antiguos. Esto evita que una finalización de 50+ boletas se detenga a mitad.
 */
function ensureIdempotencyWriteCapacity_(propertyKey, serializedValue) {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  const now = Date.now();
  const incomingBytes = scriptPropertyEntryBytes_(
    propertyKey,
    serializedValue,
  );
  const existingBytes = Object.prototype.hasOwnProperty.call(all, propertyKey)
    ? scriptPropertyEntryBytes_(propertyKey, all[propertyKey])
    : 0;

  let totalBytes = 0;
  let managedBytes = 0;
  let managedCount = 0;
  const candidates = [];

  Object.keys(all).forEach(function (key) {
    const raw = all[key];
    const bytes = scriptPropertyEntryBytes_(key, raw);
    totalBytes += bytes;

    if (!isIdempotencyProperty_(key)) return;

    const item = idempotencyPropertyMetadata_(key, raw, now);
    managedBytes += item.bytes;
    managedCount += 1;

    if (key === propertyKey || item.validRunning) return;

    candidates.push(item);
  });

  // Reemplazar una llave existente no duplica sus bytes.
  let projectedTotal = totalBytes - existingBytes + incomingBytes;
  let projectedManagedBytes = managedBytes - existingBytes + incomingBytes;
  let projectedManagedCount = managedCount + (
    existingBytes ? 0 : 1
  );
  let deleted = 0;
  let deletedBytes = 0;

  candidates.sort(function (left, right) {
    if (left.staleRunning !== right.staleRunning) {
      return left.staleRunning ? -1 : 1;
    }

    if (left.legacy !== right.legacy) {
      return left.legacy ? -1 : 1;
    }

    return Number(left.timestamp || 0)
      - Number(right.timestamp || 0);
  });

  while (
    candidates.length
    && (
      projectedTotal > SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES
      || projectedManagedBytes > IDEMPOTENCY_MAX_MANAGED_BYTES
      || projectedManagedCount > IDEMPOTENCY_MAX_PROPERTIES
    )
  ) {
    const item = candidates.shift();
    properties.deleteProperty(item.key);
    projectedTotal -= item.bytes;
    projectedManagedBytes -= item.bytes;
    projectedManagedCount -= 1;
    deleted += 1;
    deletedBytes += item.bytes;
  }

  if (
    projectedTotal > SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES
    || projectedManagedBytes > IDEMPOTENCY_MAX_MANAGED_BYTES
    || projectedManagedCount > IDEMPOTENCY_MAX_PROPERTIES
  ) {
    const error = new Error(
      'No hay espacio seguro en Script Properties para continuar. '
      + 'Las propiedades idempotentes activas y/o la configuración ocupan demasiado almacenamiento. '
      + 'Ejecute dmsDiagnosePropertyQuota() para revisar el uso sin exponer secretos.',
    );
    error.code = 'APPS_SCRIPT_PROPERTY_STORAGE_FULL';
    throw error;
  }

  return {
    deleted: deleted,
    deletedBytes: deletedBytes,
    projectedTotalBytes: Math.max(0, projectedTotal),
    projectedManagedBytes: Math.max(0, projectedManagedBytes),
    projectedManagedCount: Math.max(0, projectedManagedCount),
  };
}

function setManagedPropertyWithQuotaRetry_(propertyKey, serializedValue) {
  const properties = PropertiesService.getScriptProperties();

  if (utf8ByteLength_(serializedValue) > IDEMPOTENCY_MAX_VALUE_BYTES) {
    const error = new Error(
      'La respuesta idempotente excede el tamaño seguro por propiedad.',
    );
    error.code = 'APPS_SCRIPT_IDEMPOTENCY_VALUE_TOO_LARGE';
    throw error;
  }

  ensureIdempotencyWriteCapacity_(
    propertyKey,
    serializedValue,
  );

  try {
    properties.setProperty(propertyKey, serializedValue);
    return true;
  } catch (error) {
    if (!isPropertyStorageQuotaError_(error)) throw error;

    // La cuota real puede incluir sobrecarga interna que no podemos medir.
    // Se fuerza una limpieza agresiva adicional y se intenta una sola vez más.
    pruneIdempotencyProperties_({
      removeLegacy: true,
      maxRetained: Math.min(40, IDEMPOTENCY_MAX_PROPERTIES),
      maxManagedBytes: Math.min(120 * 1024, IDEMPOTENCY_MAX_MANAGED_BYTES),
      maxTotalBytes: Math.min(360 * 1024, SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES),
      skipCleanupStamp: true,
      excludeKeys: [propertyKey],
    });

    ensureIdempotencyWriteCapacity_(
      propertyKey,
      serializedValue,
    );

    try {
      properties.setProperty(propertyKey, serializedValue);
      return true;
    } catch (retryError) {
      if (!isPropertyStorageQuotaError_(retryError)) throw retryError;

      const finalError = new Error(
        'Google Apps Script continúa sin espacio en Script Properties después de la limpieza automática. '
        + 'Ejecute dmsDiagnosePropertyQuota() y confirme que el backend usa esta misma implementación /exec.',
      );
      finalError.code = 'APPS_SCRIPT_PROPERTY_STORAGE_FULL';
      throw finalError;
    }
  }
}

/**
 * Reclama una llave idempotente utilizando ScriptLock solamente durante la
 * lectura/escritura de PropertiesService.
 */
function beginIdempotentRequest_(
  propertyKey,
  action,
) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(IDEMPOTENCY_LOCK_WAIT_MS)) {
    const error = new Error(
      'El servicio está procesando otra operación administrativa. Reintente en unos segundos.',
    );
    error.code = 'APPS_SCRIPT_IDEMPOTENCY_LOCK_BUSY';
    throw error;
  }

  try {
    const properties = PropertiesService
      .getScriptProperties();
    const raw = properties.getProperty(propertyKey);
    const now = Date.now();

    if (raw) {
      try {
        const parsed = JSON.parse(raw);

        if (
          parsed
          && parsed.__dmsIdempotency === true
          && parsed.response
        ) {
          return {
            replay: true,
            response: parsed.response,
          };
        }

        if (
          parsed
          && parsed.__dmsIdempotency !== true
          && Object.prototype.hasOwnProperty.call(parsed, 'ok')
        ) {
          return {
            replay: true,
            response: parsed,
          };
        }

        if (
          parsed
          && parsed.__dmsIdempotency === true
          && parsed.status === 'RUNNING'
        ) {
          const startedAt = Number(parsed.startedAt || 0);

          if (
            startedAt
            && now - startedAt < IDEMPOTENCY_RUNNING_TTL_MS
          ) {
            return {
              inProgress: true,
              startedAt: startedAt,
            };
          }
        }
      } catch (parseError) {
        console.warn(
          `La llave ${propertyKey} contenía un valor inválido y será reemplazada: ${parseError.message}`,
        );
      }
    }

    const claimToken = Utilities.getUuid();
    const serializedClaim = JSON.stringify({
      __dmsIdempotency: true,
      status: 'RUNNING',
      startedAt: now,
      action: clean_(action),
      claimToken: claimToken,
    });

    // V7.2: se libera espacio ANTES de crear la concesión. En V7.1 el intento
    // de setProperty ocurría primero y por eso la limpieza nunca alcanzaba a
    // ejecutarse cuando el almacén ya estaba lleno.
    setManagedPropertyWithQuotaRetry_(
      propertyKey,
      serializedClaim,
    );

    return {
      acquired: true,
      claimToken: claimToken,
    };
  } finally {
    lock.releaseLock();
  }
}

function completeIdempotentRequest_(
  propertyKey,
  claimToken,
  response,
) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(IDEMPOTENCY_LOCK_WAIT_MS)) {
    /*
     * El trabajo principal YA terminó. Un fallo de caché idempotente no debe
     * convertir una boleta/PDF correcto en error ni provocar duplicados.
     */
    try {
      saveIdempotentResponse_(propertyKey, response);
    } catch (error) {
      console.warn(
        `No se pudo guardar la caché idempotente ${propertyKey}, pero la operación principal terminó correctamente: ${error.message}`,
      );
      try {
        PropertiesService.getScriptProperties().deleteProperty(propertyKey);
      } catch (_) {
        // No-op.
      }
    }
    return;
  }

  try {
    const properties = PropertiesService
      .getScriptProperties();
    const raw = properties.getProperty(propertyKey);

    if (raw) {
      try {
        const parsed = JSON.parse(raw);

        if (
          parsed
          && parsed.status === 'RUNNING'
          && parsed.claimToken
          && claimToken
          && parsed.claimToken !== claimToken
        ) {
          console.warn(
            `No se sobrescribió ${propertyKey}: la concesión pertenece a otra ejecución.`,
          );
          return;
        }
      } catch (_) {
        // El valor se reemplaza por la respuesta final válida.
      }
    }

    try {
      saveIdempotentResponse_(
        propertyKey,
        response,
      );
    } catch (error) {
      console.warn(
        `No se pudo persistir la respuesta idempotente ${propertyKey}; se devuelve éxito para no duplicar el trabajo ya terminado: ${error.message}`,
      );

      try {
        properties.deleteProperty(propertyKey);
      } catch (_) {
        // No-op.
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function releaseIdempotentClaimAfterError_(
  propertyKey,
  claimToken,
) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    return;
  }

  try {
    const properties = PropertiesService
      .getScriptProperties();
    const raw = properties.getProperty(propertyKey);

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);

      if (
        parsed
        && parsed.__dmsIdempotency === true
        && parsed.status === 'RUNNING'
        && parsed.claimToken === claimToken
      ) {
        properties.deleteProperty(propertyKey);
      }
    } catch (_) {
      // No se elimina un valor que no podamos identificar con seguridad.
    }
  } finally {
    lock.releaseLock();
  }
}

function maybeCleanupExpiredIdempotencyProperties_() {
  if (
    requestElapsedMs_()
    > REQUEST_LONG_CLEANUP_THRESHOLD_MS
  ) {
    return;
  }

  cleanupExpiredIdempotencyProperties_();
}

/**
 * Lee una respuesta idempotente. Conserva compatibilidad con propiedades
 * antiguas que almacenaban la respuesta directamente.
 */
function getIdempotentResponse_(propertyKey) {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(propertyKey);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed
      && parsed.__dmsIdempotency === true
      && parsed.response
    ) {
      return parsed.response;
    }

    return parsed;
  } catch (error) {
    console.warn(
      `No se pudo interpretar la respuesta idempotente ${propertyKey}: ${error.message}`,
    );

    PropertiesService
      .getScriptProperties()
      .deleteProperty(propertyKey);

    return null;
  }
}

/**
 * Guarda una respuesta idempotente con fecha para permitir limpieza segura.
 */
function saveIdempotentResponse_(
  propertyKey,
  response,
) {
  const properties = PropertiesService.getScriptProperties();
  let compactResponse = compactIdempotentResponse_(
    propertyKey,
    response,
  );
  let serialized = JSON.stringify({
    __dmsIdempotency: true,
    status: 'COMPLETE',
    storedAt: Date.now(),
    response: compactResponse,
  });

  /*
   * Algunas lecturas de evidencia devuelven base64/dataUrl y no pueden caber
   * dentro del límite de 9 KB de una propiedad. Esas operaciones son seguras
   * de repetir; no se intenta cachear un cuerpo imposible de almacenar.
   */
  if (utf8ByteLength_(serialized) > IDEMPOTENCY_MAX_VALUE_BYTES) {
    const data = response && response.data;
    const containsBinaryPayload = Boolean(
      data
      && (
        data.base64
        || data.dataUrl
      )
    );

    if (containsBinaryPayload) {
      properties.deleteProperty(propertyKey);
      console.warn(
        `Se omitió la caché idempotente ${propertyKey}: contiene datos binarios demasiado grandes para PropertiesService.`,
      );
      return false;
    }

    // Último nivel de compactación para respuestas exitosas no binarias.
    compactResponse = {
      ok: Boolean(response && response.ok),
      data: response && response.data
        ? compactReportReplayData_(response.data)
        : {},
      meta: response && response.meta
        ? response.meta
        : {},
    };

    serialized = JSON.stringify({
      __dmsIdempotency: true,
      status: 'COMPLETE',
      storedAt: Date.now(),
      response: compactResponse,
    });
  }

  if (utf8ByteLength_(serialized) > IDEMPOTENCY_MAX_VALUE_BYTES) {
    properties.deleteProperty(propertyKey);
    console.warn(
      `Se omitió la caché idempotente ${propertyKey}: la respuesta compactada todavía supera el límite seguro.`,
    );
    return false;
  }

  setManagedPropertyWithQuotaRetry_(
    propertyKey,
    serialized,
  );

  return true;
}

/**
 * Identifica las propiedades de idempotencia administradas por este script.
 */
function isIdempotencyProperty_(key) {
  return [
    'INVITATION_',
    'MAINTENANCE_PRESENTATION_',
    'AGENDA_NOTIFICATION_',
    'CUSTOMER_CASE_CREATED_',
    'CUSTOMER_CASE_ASSIGNED_',
    'CUSTOMER_CASE_EVIDENCE_',
    'SIGNATURE_NOTIFICATION_',
    'DELIVERY_',
  ].some(function (prefix) {
    return String(key || '').indexOf(prefix) === 0;
  });
}

/**
 * Limpia únicamente propiedades de idempotencia administradas por DMS.
 *
 * Reglas:
 * - RUNNING vencidas se eliminan después del TTL de seguridad.
 * - COMPLETE se conserva como máximo 7 días.
 * - Se limita tanto la cantidad como los bytes de las llaves idempotentes.
 * - Las propiedades de configuración NO se tocan.
 * - Las propiedades heredadas pueden eliminarse de forma explícita mediante
 *   dmsCleanupPropertyQuotaNow(), útil si el proyecto ya alcanzó la cuota.
 */
function pruneIdempotencyProperties_(options) {
  const settings = options || {};
  const properties = PropertiesService
    .getScriptProperties();
  const all = properties.getProperties();
  const now = Date.now();
  const maxRetained = Math.max(
    10,
    Number(
      settings.maxRetained
      || IDEMPOTENCY_MAX_PROPERTIES,
    ),
  );
  const maxManagedBytes = Math.max(
    32 * 1024,
    Number(
      settings.maxManagedBytes
      || IDEMPOTENCY_MAX_MANAGED_BYTES,
    ),
  );
  const maxTotalBytes = Math.max(
    128 * 1024,
    Number(
      settings.maxTotalBytes
      || SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES,
    ),
  );
  const removeLegacy = settings.removeLegacy === true;
  const excluded = new Set(
    Array.isArray(settings.excludeKeys)
      ? settings.excludeKeys.map(String)
      : [],
  );

  const retained = [];
  let deleted = 0;
  let deletedBytes = 0;
  let legacyDeleted = 0;
  let expiredDeleted = 0;
  let staleRunningDeleted = 0;
  let cappedDeleted = 0;
  let bytePressureDeleted = 0;
  let totalBytes = 0;
  let managedBytes = 0;
  let managedCount = 0;

  Object.keys(all).forEach(function (key) {
    const raw = all[key];
    const entryBytes = scriptPropertyEntryBytes_(key, raw);
    totalBytes += entryBytes;

    if (!isIdempotencyProperty_(key)) {
      return;
    }

    managedBytes += entryBytes;
    managedCount += 1;

    const item = idempotencyPropertyMetadata_(
      key,
      raw,
      now,
    );
    let remove = false;
    let reason = '';

    if (!excluded.has(key)) {
      if (item.staleRunning) {
        remove = true;
        reason = 'STALE_RUNNING';
      } else if (
        !item.running
        && item.timestamp
        && now - item.timestamp > IDEMPOTENCY_RETENTION_MS
      ) {
        remove = true;
        reason = 'EXPIRED';
      } else if (item.legacy && removeLegacy) {
        remove = true;
        reason = 'LEGACY';
      }
    }

    if (remove) {
      properties.deleteProperty(key);
      deleted += 1;
      deletedBytes += entryBytes;
      totalBytes -= entryBytes;
      managedBytes -= entryBytes;
      managedCount -= 1;

      if (reason === 'LEGACY') {
        legacyDeleted += 1;
      } else if (reason === 'STALE_RUNNING') {
        staleRunningDeleted += 1;
      } else {
        expiredDeleted += 1;
      }

      return;
    }

    retained.push(item);
  });

  const removable = retained
    .filter(function (item) {
      return !item.validRunning
        && !excluded.has(item.key);
    })
    .sort(function (left, right) {
      if (left.staleRunning !== right.staleRunning) {
        return left.staleRunning ? -1 : 1;
      }

      if (left.legacy !== right.legacy) {
        return left.legacy ? -1 : 1;
      }

      return Number(left.timestamp || 0)
        - Number(right.timestamp || 0);
    });

  while (
    removable.length
    && (
      managedCount > maxRetained
      || managedBytes > maxManagedBytes
      || totalBytes > maxTotalBytes
    )
  ) {
    const oldest = removable.shift();
    properties.deleteProperty(oldest.key);
    managedCount -= 1;
    managedBytes -= oldest.bytes;
    totalBytes -= oldest.bytes;
    deleted += 1;
    deletedBytes += oldest.bytes;

    if (managedCount >= maxRetained) {
      cappedDeleted += 1;
    } else {
      bytePressureDeleted += 1;
    }
  }

  // El marcador de limpieza es útil, pero jamás debe hacer fallar la limpieza.
  if (settings.skipCleanupStamp !== true) {
    try {
      properties.setProperty(
        IDEMPOTENCY_LAST_CLEANUP_PROPERTY,
        String(now),
      );
    } catch (error) {
      console.warn(
        `No se pudo actualizar ${IDEMPOTENCY_LAST_CLEANUP_PROPERTY}: ${error.message}`,
      );
    }
  }

  return {
    ok: true,
    deleted: deleted,
    deletedBytes: Math.max(0, deletedBytes),
    legacyDeleted: legacyDeleted,
    expiredDeleted: expiredDeleted,
    staleRunningDeleted: staleRunningDeleted,
    cappedDeleted: cappedDeleted,
    bytePressureDeleted: bytePressureDeleted,
    retained: Math.max(0, managedCount),
    retainedBytes: Math.max(0, managedBytes),
    totalStoreBytes: Math.max(0, totalBytes),
    maxRetained: maxRetained,
    maxManagedBytes: maxManagedBytes,
    maxTotalBytes: maxTotalBytes,
    retentionDays: Math.round(
      IDEMPOTENCY_RETENTION_MS
      / (24 * 60 * 60 * 1000),
    ),
  };
}

/**
 * Limpieza periódica normal.
 *
 * Respeta el intervalo de una hora. Los valores heredados se eliminan solo si
 * los límites de cantidad/bytes obligan a liberar espacio.
 */
function cleanupExpiredIdempotencyProperties_(
  force,
) {
  const properties = PropertiesService
    .getScriptProperties();
  const now = Date.now();
  const lastCleanup = Number(
    properties.getProperty(
      IDEMPOTENCY_LAST_CLEANUP_PROPERTY,
    ) || 0,
  );

  if (
    force !== true
    && lastCleanup
    && now - lastCleanup
      < IDEMPOTENCY_CLEANUP_INTERVAL_MS
  ) {
    return {
      ok: true,
      skipped: true,
      reason: 'CLEANUP_INTERVAL',
    };
  }

  return pruneIdempotencyProperties_({
    removeLegacy: false,
    maxRetained: IDEMPOTENCY_MAX_PROPERTIES,
    maxManagedBytes: IDEMPOTENCY_MAX_MANAGED_BYTES,
    maxTotalBytes: SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES,
  });
}


/**
 * Devuelve el prefijo de idempotencia correspondiente a cada acción.
 */
function idempotencyPrefixForAction_(action) {
  if (action === 'customer.case.evidence.init') return 'CUSTOMER_CASE_EVIDENCE_INIT_';
  if (action === 'user.credentials.send') {
    return 'INVITATION_';
  }

  if (action === 'maintenance.presentation.create') {
    return 'MAINTENANCE_PRESENTATION_';
  }

  if (action === AGENDA_NOTIFICATION_ACTION) {
    return 'AGENDA_NOTIFICATION_';
  }

  if (action === CUSTOMER_CASE_CREATED_ACTION) {
    return 'CUSTOMER_CASE_CREATED_';
  }

  if (action === CUSTOMER_CASE_ASSIGNED_ACTION) {
    return 'CUSTOMER_CASE_ASSIGNED_';
  }

  if (action === CUSTOMER_CASE_EVIDENCE_UPLOAD_ACTION) {
    return 'CUSTOMER_CASE_EVIDENCE_';
  }

  if (action === SIGNATURE_COMPLETION_ACTION) {
    return 'SIGNATURE_NOTIFICATION_';
  }

  return 'DELIVERY_';
}

/**
 * Indica si la acción corresponde a un correo del módulo de casos.
 */
function isCustomerCaseAction_(action) {
  return action === CUSTOMER_CASE_CREATED_ACTION
    || action === CUSTOMER_CASE_ASSIGNED_ACTION
    || action === CUSTOMER_CASE_EVIDENCE_UPLOAD_ACTION;
}

/**
 * Las acciones que generan correo externo deben ser idempotentes.
 * Así un reintento HTTP no duplica avisos ya enviados.
 */
function actionRequiresIdempotency_(action) {
  return action === 'customer.case.evidence.init' || isCustomerCaseAction_(action)
    || action === SIGNATURE_COMPLETION_ACTION;
}


/**
 * Valida el secreto compartido con el backend.
 */
function validateSecret_(received) {
  const expected = PropertiesService
    .getScriptProperties()
    .getProperty('REPORT_WEBHOOK_SECRET');

  if (!expected) {
    throw new Error(
      'Falta configurar REPORT_WEBHOOK_SECRET en las propiedades del script.',
    );
  }

  if (String(received || '') !== expected) {
    throw new Error('Credencial inválida para el servicio de reportes.');
  }
}

/**
 * Crea el documento, el PDF, la carpeta y opcionalmente envía el correo.
 */
function createReportAndMaybeSend_(payload) {
  const visitGroup = payload.visitGroup || {};
  const groupVisits = Array.isArray(visitGroup.visits)
    ? visitGroup.visits
    : [];

  if (groupVisits.length > 1) {
    return createVisitGroupReportAndMaybeSend_(payload);
  }

  const ticket = prepareTicketForReport_(payload.ticket || {}, payload);

  if (!ticket.BoletaUID) {
    throw new Error('La solicitud no incluye BoletaUID.');
  }

  const properties = PropertiesService.getScriptProperties();
  const templateId = clean_(
    payload.templateId
      || properties.getProperty('TEMPLATE_BOLETA_ID')
      || DEFAULT_TEMPLATE_ID,
  );
  const baseFolderId = clean_(
    payload.baseFolderId
      || properties.getProperty('BOLETAS_FOLDER_ID'),
  );

  if (!templateId) {
    throw new Error('No se configuró la plantilla de la boleta.');
  }

  if (!baseFolderId) {
    throw new Error('No se configuró la carpeta principal de boletas.');
  }

  const testMode = Boolean(payload.testMode);
  const deliveryType = clean_(payload.deliveryType).toUpperCase();
  const maintenanceArchive = isMaintenanceArchiveDelivery_(
    payload,
    ticket,
  );
  const sendEmail = maintenanceArchive
    ? false
    : resolveReportSendEmail_(payload, ticket);
  const assigned = Array.isArray(payload.assigned) ? payload.assigned : [];
  const evidences = Array.isArray(payload.evidences) ? payload.evidences : [];
  const creator = payload.creator || null;
  const client = payload.client || null;
  const surveyUrl = maintenanceArchive
    ? ''
    : resolveSurveyUrl_(payload, ticket, testMode);
  const signatureUrl = maintenanceArchive
    ? ''
    : resolveSignatureUrl_(payload, ticket);

  const assignedNames = assigned
    .map(function (item) {
      return clean_(
        item.Nombre
        || item.NombreCompleto
        || item.NombreUsuario,
      );
    })
    .filter(Boolean)
    .join(', ');

  const baseFolder = getDriveFolderByIdWithRetry_(baseFolderId);
  const parentFolder = testMode
    ? getOrCreateFolder_(baseFolder, 'Pruebas de boletas')
    : getOrCreateFolder_(
      baseFolder,
      safeName_(ticket.Cliente || 'Sin cliente'),
    );

  const folderName = [
    `Boleta ${ticket.BoletaID || ticket.BoletaUID}`,
    safeName_(ticket.Titulo || 'Reporte de visita'),
  ].join(' - ');

  const reportFolder = getOrCreateFolder_(parentFolder, folderName);
  const timestamp = Utilities.formatDate(
    new Date(),
    DEFAULT_TIME_ZONE,
    'yyyyMMdd-HHmmss',
  );

  const reportName = [
    testMode ? 'PRUEBA' : '',
    `Boleta ${ticket.BoletaID || ticket.BoletaUID}`,
    safeName_(ticket.Titulo || 'Reporte de visita'),
    testMode ? timestamp : '',
  ].filter(Boolean).join(' - ');

  assertRequestBudget_('copiar la plantilla de la boleta', 30000);
  const template = getDriveFileCached_(templateId);
  const documentFile = withTransientRetry_(
    'copiar la plantilla de la boleta',
    function () {
      return template.makeCopy(reportName, reportFolder);
    },
  );
  const document = withTransientRetry_(
    'abrir el documento de la boleta',
    function () {
      return DocumentApp.openById(documentFile.getId());
    },
  );
  const body = document.getBody();

  const signatureBlob = getDriveBlob_(
    ticket.FirmaArchivoID
    || ticket.FirmaFileID
    || ticket.FirmaURL,
  );

  let signatureInserted = false;
  if (signatureBlob) {
    signatureInserted = replaceMarkerWithImage_(
      body,
      '<<[Firma]>>',
      signatureBlob,
      180,
    ) || replaceMarkerWithImage_(
      body,
      '{{Firma}}',
      signatureBlob,
      180,
    );
  }

  replaceMarkers_(
    body,
    ticket,
    assignedNames,
    surveyUrl,
  );

  appendAnnexes_(
    body,
    signatureBlob,
    signatureInserted,
    evidences,
    {
      optimizeLargeImages: true,
    },
  );

  assertRequestBudget_('guardar el documento de la boleta', 30000);
  document.saveAndClose();
  Utilities.sleep(150);

  const pdfFileName = ticketPdfFileName_(ticket);

  /*
   * Se vuelve a obtener el archivo por ID para que la conversión lea la versión
   * ya cerrada del documento. El documento incorpora miniaturas para fotos
   * grandes, reduciendo de forma importante el peso que Docs debe convertir.
   */
  const pdfBlob = exportDocumentPdfWithRetry_(
    documentFile.getId(),
    pdfFileName,
  );

  assertRequestBudget_('guardar el PDF de la boleta', 15000);
  const pdfFile = withTransientRetry_(
    'guardar el PDF de la boleta',
    function () {
      return reportFolder.createFile(pdfBlob);
    },
  );
  const originalDocumentUrl = documentFile.getUrl();
  const pdfUrl = pdfFile.getUrl();
  const folderUrl = reportFolder.getUrl();

  /*
   * En modo de prueba el archivo que se comparte debe ser el PDF.
   * El Google Docs solo se utiliza temporalmente para completar la plantilla
   * y convertirla. Después de crear correctamente el PDF, se envía a la
   * papelera para que la carpeta de pruebas contenga únicamente el PDF.
   *
   * documentUrl apunta también al PDF para mantener compatibilidad con el
   * backend actual, que todavía muestra el primer enlace como "Documento".
   */
  let documentUrl = originalDocumentUrl;
  let returnedDocumentId = documentFile.getId();

  /*
   * En pruebas y en MAINTENANCE_ARCHIVE el Google Docs es únicamente un
   * artefacto temporal para completar la plantilla y convertirla a PDF.
   * El expediente final de mantenimiento conserva los PDF en su carpeta
   * Boletas; eliminar el Docs evita duplicar cientos de documentos temporales.
   */
  if (testMode || maintenanceArchive) {
    documentUrl = pdfUrl;
    returnedDocumentId = '';

    try {
      documentFile.setTrashed(true);
    } catch (error) {
      console.warn(
        `El PDF se creó correctamente, pero no fue posible enviar el documento temporal a la papelera: ${error.message}`,
      );
    }
  }

  let email = {
    sent: false,
    skipped: true,
    surveyIncluded: false,
  };

  if (sendEmail) {
    email = sendReportEmail_({
      ticket: ticket,
      assigned: assigned,
      evidences: evidences,
      creator: creator,
      client: client,
      recipients: payload.recipients || {},
      testMode: testMode,
      pdfBlob: pdfBlob,
      pdfUrl: pdfUrl,
      documentUrl: documentUrl,
      folderUrl: folderUrl,
      surveyUrl: surveyUrl,
      signatureUrl: signatureUrl,
      deliveryType: deliveryType,
      attachmentMode: clean_(
        payload.emailAttachmentMode
        || payload.attachmentMode,
        DIRECT_EMAIL_ATTACHMENT_MODE,
      ).toUpperCase(),
      includeDriveLinks: payload.emailIncludeDriveLinks === true,
    });
  }

  return {
    documentId: returnedDocumentId,
    documentUrl: documentUrl,
    pdfId: pdfFile.getId(),
    pdfUrl: pdfUrl,
    pdfFileName: pdfFileName,
    folderId: reportFolder.getId(),
    folderUrl: folderUrl,
    evidenceCount: evidences.length,
    templateId: templateId,
    surveyUrl: surveyUrl,
    surveyIncluded: Boolean(surveyUrl),
    signatureUrl: signatureUrl,
    signatureIncluded: Boolean(signatureUrl),
    deliveryType: deliveryType,
    archiveOnly: maintenanceArchive,
    scriptVersion: APPS_SCRIPT_VERSION,
    performance: {
      elapsedMs: requestElapsedMs_(),
      optimizedLargeImages: true,
      emailRequested: sendEmail,
      maintenanceArchive: maintenanceArchive,
      temporaryDocumentRemoved: Boolean(testMode || maintenanceArchive),
    },
    email: email,
  };
}


/**
 * Genera un único reporte para todas las visitas relacionadas.
 *
 * Cada visita conserva su boleta, horario, técnicos y evidencias, pero el
 * correo, el PDF, la encuesta y la solicitud de firma se envían una sola vez.
 */
function createVisitGroupReportAndMaybeSend_(payload) {
  const rootTicket = prepareTicketForReport_(payload.ticket || {}, payload);
  const visitGroup = payload.visitGroup || {};
  const visits = Array.isArray(visitGroup.visits)
    ? visitGroup.visits
    : [];

  if (!rootTicket.BoletaUID || visits.length < 2) {
    throw new Error(
      'El seguimiento relacionado no contiene suficientes visitas.',
    );
  }

  const testMode = Boolean(payload.testMode);
  const deliveryType = clean_(payload.deliveryType).toUpperCase();
  const maintenanceArchive = isMaintenanceArchiveDelivery_(
    payload,
    rootTicket,
  );
  const sendEmail = maintenanceArchive
    ? false
    : resolveReportSendEmail_(payload, rootTicket);
  const surveyUrl = maintenanceArchive
    ? ''
    : resolveSurveyUrl_(payload, rootTicket, testMode);
  const signatureUrl = maintenanceArchive
    ? ''
    : resolveSignatureUrl_(payload, rootTicket);
  const allEvidences = Array.isArray(payload.evidences)
    ? payload.evidences
    : [];
  const assigned = Array.isArray(payload.assigned)
    ? payload.assigned
    : [];

  const ticketNumbers = visits.map(function (visit, index) {
    const ticket = visit.ticket || {};
    return clean_(
      ticket.BoletaID || ticket.BoletaUID,
      String(index + 1),
    );
  });

  /*
   * Cada visita se genera con EXACTAMENTE la misma plantilla de boleta
   * utilizada por una boleta individual. No se borra ni se rediseña la
   * plantilla. La agrupación solo afecta el correo, la encuesta, la firma
   * compartida y el envío a los chats.
   */
  const reports = visits.map(function (visit, index) {
    const normalizedVisitTicket = prepareTicketForReport_(
      visit.ticket || {},
      Object.assign({}, payload, visit),
    );
    const ticket = Object.assign({}, normalizedVisitTicket, {
      EncuestaURL: surveyUrl,
      SurveyURL: surveyUrl,
      FirmaPublicaURL: signatureUrl,
      SignatureURL: signatureUrl,
    });

    const result = createReportAndMaybeSend_({
      action: payload.action,
      secret: payload.secret,
      testMode: testMode,
      sendEmail: false,
      deliveryType: deliveryType,
      templateId: payload.templateId,
      baseFolderId: payload.baseFolderId,
      ticket: ticket,
      assigned: Array.isArray(visit.assigned)
        ? visit.assigned
        : [],
      evidences: Array.isArray(visit.evidences)
        ? visit.evidences
        : [],
      client: payload.client || null,
      creator: payload.creator || null,
      recipients: payload.recipients || {},
      survey: payload.survey || null,
      surveyUrl: surveyUrl,
      signature: payload.signature || null,
      signatureUrl: signatureUrl,
      visitGroup: null,
    });

    return Object.assign({}, result, {
      ticketUid: ticket.BoletaUID,
      ticketNumber: ticket.BoletaID || ticket.BoletaUID,
      visitNumber: ticket.NumeroVisita || index + 1,
    });
  });

  const pdfBlobs = reports.map(function (report, index) {
    const visitTicket = visits[index] && visits[index].ticket
      ? visits[index].ticket
      : {};

    return DriveApp
      .getFileById(report.pdfId)
      .getBlob()
      .setName(
        report.pdfFileName
        || ticketPdfFileName_(visitTicket),
      );
  });

  let email = {
    sent: false,
    skipped: true,
    surveyIncluded: false,
    signatureIncluded: false,
  };

  if (sendEmail) {
    email = sendVisitGroupEmail_({
      ticket: rootTicket,
      visitGroup: visitGroup,
      visits: visits,
      assigned: assigned,
      evidences: allEvidences,
      creator: payload.creator || null,
      client: payload.client || null,
      recipients: payload.recipients || {},
      testMode: testMode,
      deliveryType: deliveryType,
      pdfBlobs: pdfBlobs,
      reports: reports,
      folderUrl: reports[0] ? reports[0].folderUrl : '',
      surveyUrl: surveyUrl,
      signatureUrl: signatureUrl,
      ticketNumbers: ticketNumbers,
      attachmentMode: clean_(
        payload.emailAttachmentMode
        || payload.attachmentMode,
        DIRECT_EMAIL_ATTACHMENT_MODE,
      ).toUpperCase(),
      includeDriveLinks: payload.emailIncludeDriveLinks === true,
    });
  }

  const primary = reports[0] || {};

  return {
    documentId: primary.documentId || '',
    documentUrl: primary.documentUrl || '',
    pdfId: primary.pdfId || '',
    pdfUrl: primary.pdfUrl || '',
    pdfFileName: primary.pdfFileName || '',
    pdfFileNames: reports.map(function (report) {
      return report.pdfFileName || '';
    }).filter(Boolean),
    folderId: primary.folderId || '',
    folderUrl: primary.folderUrl || '',
    reports: reports,
    evidenceCount: allEvidences.length,
    visitCount: visits.length,
    ticketNumbers: ticketNumbers,
    templateId: primary.templateId || payload.templateId || '',
    surveyUrl: surveyUrl,
    surveyIncluded: Boolean(surveyUrl),
    signatureUrl: signatureUrl,
    signatureIncluded: Boolean(signatureUrl),
    deliveryType: deliveryType,
    archiveOnly: maintenanceArchive,
    scriptVersion: APPS_SCRIPT_VERSION,
    email: email,
  };
}

/**
 * Encabezado del reporte conjunto.
 */
function appendVisitGroupHeader_(
  body,
  ticket,
  visits,
  ticketNumbers,
  testMode,
) {
  const title = body.appendParagraph(
    testMode
      ? 'PRUEBA · SEGUIMIENTO TÉCNICO'
      : 'SEGUIMIENTO TÉCNICO',
  );
  title
    .setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setForegroundColor(BRAND_RED)
    .setBold(true);

  body
    .appendParagraph(
      `${visits.length} visitas relacionadas · Boletas #${ticketNumbers.join(', #')}`,
    )
    .setForegroundColor(BRAND_MUTED)
    .setBold(true);

  const summary = body.appendTable([
    ['Cliente', clean_(ticket.Cliente, 'Sin especificar')],
    ['Servicio', clean_(ticket.Titulo, 'Reporte de visita')],
    ['Categoría', clean_(ticket.Categoria, 'Sin especificar')],
    ['Supervisor', clean_(ticket.Supervisor, 'Sin especificar')],
    ['Visitas incluidas', String(visits.length)],
    ['Boletas incluidas', ticketNumbers.map(function (number) {
      return `#${number}`;
    }).join(', ')],
  ]);

  styleReportTable_(summary);
  body.appendParagraph('');
}

/**
 * Agrega el detalle completo de una visita.
 */
function appendVisitReportSection_(body, visit, index) {
  const ticket = visit.ticket || {};
  const assigned = Array.isArray(visit.assigned)
    ? visit.assigned
    : [];
  const evidences = Array.isArray(visit.evidences)
    ? visit.evidences
    : [];
  const assignedNames = assigned.map(function (item) {
    return clean_(
      item.Nombre
      || item.NombreCompleto
      || item.NombreUsuario,
    );
  }).filter(Boolean).join(', ');

  if (index > 0) {
    body.appendPageBreak();
  }

  body
    .appendParagraph(
      `VISITA ${ticket.NumeroVisita || index + 1} · BOLETA #${ticket.BoletaID || ticket.BoletaUID}`,
    )
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
    .setForegroundColor(BRAND_RED)
    .setBold(true);

  body
    .appendParagraph(
      `${formatDate_(ticket.Fecha)} · ${clean_(ticket.HoraInicio, '—')} a ${clean_(ticket.HoraFinal, '—')} · ${formatHours_(ticket.HorasTotales)} horas`,
    )
    .setForegroundColor(BRAND_MUTED)
    .setBold(true);

  const detail = body.appendTable([
    ['Tipo de falla', clean_(ticket.TipoFalla, 'Sin especificar')],
    ['Ubicación', clean_(ticket.Ubicacion, 'Sin especificar')],
    ['Ubicación del equipo', clean_(ticket.UbicacionEquipo, 'Sin especificar')],
    ['Nombre del dispositivo', clean_(ticket.Descripcion, 'Sin especificar')],
    ['Tipo', clean_(ticket.TipoDispositivo, 'Sin especificar')],
    ['Fabricante', clean_(ticket.Fabricante, 'Sin especificar')],
    ['Modelo', clean_(ticket.Modelo, 'Sin especificar')],
    ['Serie', clean_(ticket.Serie, 'Sin especificar')],
    ['Razón de visita', clean_(ticket.RazonVisita, 'Sin especificar')],
    ['Pruebas realizadas', clean_(ticket.PruebasRealizadas, 'Sin especificar')],
    ['Resultado', clean_(ticket.Resultado, 'Sin especificar')],
    ['Recomendaciones', clean_(ticket.Recomendaciones, 'Sin recomendaciones')],
    ['Técnicos asignados', assignedNames || 'Sin especificar'],
  ]);

  styleReportTable_(detail);

  body
    .appendParagraph(`Evidencias de la visita ${ticket.NumeroVisita || index + 1}`)
    .setHeading(DocumentApp.ParagraphHeading.HEADING2)
    .setForegroundColor(BRAND_RED_DARK);

  if (!evidences.length) {
    body.appendParagraph('Sin evidencias asociadas a esta visita.');
    return;
  }

  evidences.forEach(function (evidence, evidenceIndex) {
    const name = clean_(
      evidence.Nombre || evidence.NombreArchivo,
      `Evidencia ${evidenceIndex + 1}`,
    );
    const note = clean_(evidence.Nota);

    body
      .appendParagraph(`${evidenceIndex + 1}. ${name}`)
      .setBold(true);

    if (note) {
      body.appendParagraph(note);
    }

    const blob = getDriveImageBlobForDocument_(
      evidence.ArchivoID
      || evidence.ArchivoFileID
      || evidence.DriveFileID
      || evidence.ArchivoURL,
    );

    if (blob && /^image\//i.test(blob.getContentType())) {
      const image = body
        .appendParagraph('')
        .appendInlineImage(blob);
      resizeInlineImage_(image, 450);
    } else if (evidence.ArchivoURL) {
      body.appendParagraph(`Archivo: ${evidence.ArchivoURL}`);
    }
  });
}

/**
 * Agrega la firma compartida y los enlaces al final del seguimiento.
 */
function appendVisitGroupClosing_(
  body,
  signatureBlob,
  surveyUrl,
  signatureUrl,
) {
  body.appendPageBreak();
  body
    .appendParagraph('CONFORMIDAD DEL SEGUIMIENTO')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
    .setForegroundColor(BRAND_RED)
    .setBold(true);

  body.appendParagraph(
    'La firma de esta sección aplica a todas las visitas relacionadas incluidas en el reporte.',
  );

  if (signatureBlob) {
    const image = body
      .appendParagraph('')
      .appendInlineImage(signatureBlob);
    resizeInlineImage_(image, 280);
  } else {
    body.appendParagraph('Firma pendiente del cliente.');
  }

  if (signatureUrl) {
    body.appendParagraph(`Enlace para firmar: ${signatureUrl}`);
  }

  if (surveyUrl) {
    body.appendParagraph(`Encuesta única del seguimiento: ${surveyUrl}`);
  }
}

/**
 * Busca la firma almacenada en cualquiera de las visitas.
 */
function getVisitGroupSignatureBlob_(ticket, visits) {
  const candidates = [ticket].concat(
    visits.map(function (visit) {
      return visit.ticket || {};
    }),
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index] || {};
    const blob = getDriveBlob_(
      current.FirmaArchivoID
      || current.FirmaFileID
      || current.FirmaURL
      || current.Firma,
    );
    if (blob) return blob;
  }

  return null;
}

/**
 * Aplica formato uniforme a tablas del reporte.
 */
function styleReportTable_(table) {
  for (let rowIndex = 0; rowIndex < table.getNumRows(); rowIndex += 1) {
    const row = table.getRow(rowIndex);
    for (let cellIndex = 0; cellIndex < row.getNumCells(); cellIndex += 1) {
      const cell = row.getCell(cellIndex);
      cell.setPaddingTop(7);
      cell.setPaddingBottom(7);
      cell.setPaddingLeft(8);
      cell.setPaddingRight(8);
      if (cellIndex === 0) {
        cell
          .setBackgroundColor('#f8e9eb')
          .setForegroundColor(BRAND_RED_DARK);
        cell.editAsText().setBold(true);
      }
    }
  }
}

/**
 * Envía un correo conjunto con el detalle de todas las visitas.
 */
function sendVisitGroupEmail_(data) {
  const to = uniqueEmails_(data.recipients.to || []);
  const cc = uniqueEmails_(data.recipients.cc || [])
    .filter(function (email) {
      return to.indexOf(email) === -1;
    });

  if (!to.length) {
    throw new Error(
      'No hay destinatarios válidos para enviar el seguimiento.',
    );
  }

  const surveyUrl = safeWebUrl_(data.surveyUrl);
  const signatureUrl = safeWebUrl_(data.signatureUrl);
  const signedDelivery = clean_(data.deliveryType).toUpperCase() === 'SIGNED';
  const reportBlobs = Array.isArray(data.pdfBlobs)
    ? data.pdfBlobs.filter(Boolean)
    : [];
  const evidenceParts = buildDirectEvidenceAttachments_(data.evidences);
  const attachments = reportBlobs.concat(evidenceParts.attachments);

  const subject = [
    data.testMode ? '[PRUEBA]' : '',
    signedDelivery ? '[SEGUIMIENTO FIRMADO]' : '',
    'Seguimiento técnico',
    `Boletas #${data.ticketNumbers.join(', #')}`,
    data.ticket.Cliente || '',
  ].filter(Boolean).join(' - ');

  const htmlBody = buildVisitGroupEmailHtml_({
    ticket: data.ticket,
    visits: data.visits,
    reports: data.reports || [],
    ticketNumbers: data.ticketNumbers,
    evidenceRows: evidenceParts.rows,
    testMode: data.testMode,
    signedDelivery: signedDelivery,
    folderUrl: data.folderUrl,
    surveyUrl: surveyUrl,
    signatureUrl: signatureUrl,
    directAttachments: true,
  });

  const plainBody = buildVisitGroupEmailPlainText_({
    ticket: data.ticket,
    visits: data.visits,
    reports: data.reports || [],
    ticketNumbers: data.ticketNumbers,
    testMode: data.testMode,
    signedDelivery: signedDelivery,
    folderUrl: data.folderUrl,
    surveyUrl: surveyUrl,
    signatureUrl: signatureUrl,
    directAttachments: true,
    attachmentCount: attachments.length,
  });

  const delivery = sendDirectAttachmentEmails_({
    to: to,
    cc: cc,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    attachments: attachments,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    to: to,
    cc: cc,
    messageCount: delivery.messageCount,
    attachmentCount: attachments.length,
    reportAttachmentCount: reportBlobs.length,
    evidenceAttachmentCount: evidenceParts.attachments.length,
    inlineImageCount: 0,
    allFilesAttachedDirectly: true,
    driveAccessRequired: false,
    visitCount: data.visits.length,
    surveyIncluded: Boolean(surveyUrl),
    surveyUrl: surveyUrl,
    signatureIncluded: Boolean(signatureUrl),
    signatureUrl: signatureUrl,
    signedDelivery: signedDelivery,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Texto plano del correo conjunto.
 */
function buildVisitGroupEmailPlainText_(data) {
  const lines = [
    data.signedDelivery
      ? 'Seguimiento técnico DMS firmado por el cliente'
      : 'Seguimiento técnico DMS',
    `Cliente: ${data.ticket.Cliente || ''}`,
    `Boletas: #${data.ticketNumbers.join(', #')}`,
    `Visitas: ${data.visits.length}`,
    `Servicio: ${data.ticket.Titulo || ''}`,
    '',
    'Los PDF de cada boleta y todas las evidencias disponibles se adjuntan directamente a este correo.',
    'No es necesario iniciar sesión en Google Drive ni solicitar permisos.',
    '',
  ];

  data.visits.forEach(function (visit, index) {
    const ticket = visit.ticket || {};
    lines.push(
      `Visita ${ticket.NumeroVisita || index + 1} · Boleta #${ticket.BoletaID || ticket.BoletaUID}`,
      `Fecha: ${formatDate_(ticket.Fecha)}`,
      `Horario: ${ticket.HoraInicio || '—'} a ${ticket.HoraFinal || '—'} · ${formatHours_(ticket.HorasTotales)} horas`,
      `Ubicación: ${ticket.Ubicacion || ''} · ${ticket.UbicacionEquipo || ''}`,
      `Razón: ${ticket.RazonVisita || ''}`,
      `Resultado: ${ticket.Resultado || ''}`,
      `Evidencias: ${(visit.evidences || []).length}`,
      '',
    );
  });

  if (data.testMode) {
    lines.push(
      '',
      'MODO DE PRUEBA: esta ejecución no cambió el estado de las boletas.',
    );
  }

  if (data.signatureUrl) {
    lines.push(
      '',
      'Todas las visitas comparten una sola firma pendiente.',
      `Firmar seguimiento: ${data.signatureUrl}`,
    );
  }

  if (data.signedDelivery) {
    lines.push(
      '',
      'La firma se aplicó a todas las visitas relacionadas.',
    );
  }

  if (data.surveyUrl) {
    lines.push(
      '',
      `Encuesta única del seguimiento: ${data.surveyUrl}`,
    );
  }

  return lines.join('\n');
}

/**
 * HTML responsivo del correo conjunto.
 */
function buildVisitGroupEmailHtml_(data) {
  const visitCards = data.visits.map(function (visit, index) {
    const ticket = visit.ticket || {};
    const assigned = Array.isArray(visit.assigned)
      ? visit.assigned
      : [];
    const assignedNames = assigned.map(function (item) {
      return clean_(
        item.Nombre
        || item.NombreCompleto
        || item.NombreUsuario,
      );
    }).filter(Boolean).join(', ');

    const rows = [
      ['Fecha', formatDate_(ticket.Fecha)],
      ['Horario', `${clean_(ticket.HoraInicio, '—')} a ${clean_(ticket.HoraFinal, '—')} · ${formatHours_(ticket.HorasTotales)} horas`],
      ['Tipo de falla', ticket.TipoFalla],
      ['Ubicación', ticket.Ubicacion],
      ['Ubicación del equipo', ticket.UbicacionEquipo],
      ['Dispositivo', ticket.Descripcion],
      ['Tipo / Fabricante / Modelo', [ticket.TipoDispositivo, ticket.Fabricante, ticket.Modelo].filter(Boolean).join(' · ')],
      ['Razón de visita', ticket.RazonVisita],
      ['Pruebas realizadas', ticket.PruebasRealizadas],
      ['Resultado', ticket.Resultado],
      ['Recomendaciones', ticket.Recomendaciones],
      ['Técnicos', assignedNames],
      ['Evidencias', String((visit.evidences || []).length)],
    ].map(function (row) {
      return [
        '<tr>',
        `<th style="width:29%;padding:9px;border:1px solid ${BRAND_BORDER};background:#f8f4f4;text-align:left;vertical-align:top">${escapeHtml_(row[0])}</th>`,
        `<td style="padding:9px;border:1px solid ${BRAND_BORDER};vertical-align:top;overflow-wrap:anywhere">${nl2br_(row[1])}</td>`,
        '</tr>',
      ].join('');
    }).join('');

    return [
      `<div style="margin:18px 0;padding:0;border:1px solid ${BRAND_BORDER};border-radius:14px;overflow:hidden;background:#ffffff">`,
      `<div style="padding:15px 17px;background:#fff2f3;border-bottom:1px solid ${BRAND_BORDER}">`,
      `<strong style="color:${BRAND_RED};font-size:18px">Visita ${escapeHtml_(ticket.NumeroVisita || index + 1)} · Boleta #${escapeHtml_(ticket.BoletaID || ticket.BoletaUID)}</strong>`,
      '</div>',
      `<table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>`,
      '</div>',
    ].join('');
  }).join('');

  const reportLinks = data.directAttachments
    ? [
      '<div style="padding:16px;border:1px solid #9fd5b6;border-radius:12px;background:#effaf4;color:#145c35;text-align:left">',
      '<strong>Archivos incluidos directamente:</strong> los PDF de todas las boletas y sus evidencias están adjuntos a este correo. No necesita acceso a Google Drive.',
      '</div>',
    ].join('')
    : (data.reports || []).map(function (report) {
      return buttonHtml_(
        report.pdfUrl,
        `Abrir boleta #${report.ticketNumber}`,
        BRAND_RED,
      );
    }).join('');

  const signatureBlock = data.signatureUrl
    ? [
      `<div style="margin:26px 0;padding:22px 18px;border:1px solid #e8b9be;border-left:5px solid ${BRAND_RED};border-radius:14px;background:#fff7f7;text-align:center">`,
      `<h2 style="margin:0;color:${BRAND_TEXT}">Firma única pendiente</h2>`,
      `<p style="line-height:1.55;color:${BRAND_MUTED}">Una sola firma se aplicará a las ${data.visits.length} visitas relacionadas.</p>`,
      buttonHtml_(data.signatureUrl, 'Firmar todas las visitas', BRAND_RED),
      `<p style="font-size:12px;overflow-wrap:anywhere"><a href="${escapeHtml_(data.signatureUrl)}" style="color:${BRAND_RED}">${escapeHtml_(data.signatureUrl)}</a></p>`,
      '</div>',
    ].join('')
    : '';

  const surveyBlock = data.surveyUrl
    ? [
      `<div style="margin:26px 0;padding:22px 18px;border:1px solid ${BRAND_BORDER};border-left:5px solid ${BRAND_RED};border-radius:14px;background:#fff7f7;text-align:center">`,
      `<h2 style="margin:0;color:${BRAND_TEXT}">${data.testMode ? 'Encuesta de prueba' : 'Encuesta única del seguimiento'}</h2>`,
      `<p style="line-height:1.55;color:${BRAND_MUTED}">${data.testMode ? 'Este enlace permite validar el funcionamiento sin finalizar las boletas.' : 'Una sola encuesta evalúa todo el trabajo realizado en las visitas relacionadas.'}</p>`,
      buttonHtml_(data.surveyUrl, data.testMode ? 'Probar encuesta' : 'Responder encuesta', BRAND_RED),
      '</div>',
    ].join('')
    : '';

  const statusNotice = data.signedDelivery
    ? '<div style="margin:18px 0;padding:14px;background:#effaf4;border:1px solid #9fd5b6;border-radius:10px;color:#145c35"><strong>Firma registrada:</strong> la misma firma fue aplicada a todas las visitas y se adjuntan nuevamente todas las boletas usando la plantilla oficial.</div>'
    : data.testMode
      ? '<div style="margin:18px 0;padding:14px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;color:#7c2d12"><strong>Modo de prueba:</strong> no se modificó el estado de ninguna boleta.</div>'
      : '';

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>',
    '@media only screen and (max-width:620px){',
    '.dms-shell{width:100%!important;border-radius:0!important}',
    '.dms-content{padding:18px 10px!important}',
    '.dms-actions a{display:block!important;margin:8px 0!important}',
    'th,td{display:block!important;width:auto!important}',
    'th{border-bottom:0!important}',
    '}',
    '</style>',
    '</head>',
    `<body style="margin:0;padding:20px 8px;background:${BRAND_BACKGROUND};font-family:Arial,sans-serif;color:${BRAND_TEXT}">`,
    `<div class="dms-shell" style="max-width:900px;margin:auto;border:1px solid ${BRAND_BORDER};border-radius:16px;overflow:hidden;background:#ffffff;box-shadow:0 8px 28px rgba(76,12,17,.08)">`,
    `<div style="background:${BRAND_RED};color:#ffffff;padding:24px 20px">`,
    `<h1 style="margin:0;font-size:25px">${data.signedDelivery ? 'Seguimiento firmado' : 'Seguimiento técnico DMS'}</h1>`,
    `<p style="margin:9px 0 0">Boletas #${escapeHtml_(data.ticketNumbers.join(', #'))} · ${data.visits.length} visitas</p>`,
    '</div>',
    '<div class="dms-content" style="padding:28px 22px">',
    `<p style="font-size:17px"><strong>Cliente:</strong> ${escapeHtml_(data.ticket.Cliente || '')}</p>`,
    `<p><strong>Servicio:</strong> ${escapeHtml_(data.ticket.Titulo || '')}</p>`,
    statusNotice,
    '<h2 style="margin:26px 0 8px">Detalle de las visitas</h2>',
    visitCards,
    `<div class="dms-actions" style="margin:24px 0;text-align:center">${reportLinks}</div>`,
    signatureBlock,
    surveyBlock,
    `<p style="margin-top:30px;color:${BRAND_MUTED};font-size:12px">Este mensaje fue generado automáticamente por DMS Boletas.</p>`,
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');
}


/**
 * Obtiene el enlace de encuesta creado por el backend.
 *
 * El backend puede enviarlo en cualquiera de estas propiedades:
 * - payload.surveyUrl
 * - payload.survey.url
 * - ticket.EncuestaURL
 * - ticket.SurveyURL
 *
 * En modo prueba también se incluye el enlace, pero corresponde a una
 * encuesta separada creada únicamente para validación administrativa.
 */
function resolveSurveyUrl_(payload, ticket, testMode) {
  if (isMaintenanceArchiveDelivery_(payload, ticket)) {
    return '';
  }

  const candidates = [
    payload.surveyUrl,
    payload.survey && payload.survey.url,
    ticket.EncuestaURL,
    ticket.SurveyURL,
    ticket.encuestaUrl,
    ticket.surveyUrl,
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const value = safeWebUrl_(candidates[index]);
    if (value) return value;
  }

  return '';
}

/**
 * Obtiene el enlace público para que el cliente firme la boleta.
 * El enlace solo se incluye cuando la boleta todavía no tiene firma.
 */
function resolveSignatureUrl_(payload, ticket) {
  if (isMaintenanceArchiveDelivery_(payload, ticket)) {
    return '';
  }

  const hasSignature = Boolean(
    clean_(
      ticket.FirmaArchivoID
      || ticket.FirmaFileID
      || ticket.FirmaURL
      || ticket.Firma,
    ),
  );

  if (hasSignature) return '';

  const candidates = [
    payload.signatureUrl,
    payload.signature && payload.signature.url,
    ticket.FirmaPublicaURL,
    ticket.SignatureURL,
    ticket.signatureUrl,
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const value = safeWebUrl_(candidates[index]);
    if (value) return value;
  }

  return '';
}



/**
 * Detecta el modo de archivo de mantenimiento.
 *
 * Este modo es deliberadamente más liviano que una boleta normal:
 * - genera el PDF con la plantilla oficial;
 * - no envía correo;
 * - no agrega enlaces de encuesta ni solicitudes de firma pendientes;
 * - el backend copia el PDF resultante al expediente del mantenimiento.
 */
function isMaintenanceArchiveDelivery_(
  payload,
  ticket,
) {
  const request = payload || {};
  const source = ticket || {};
  const deliveryType = clean_(
    request.deliveryType
    || request.DeliveryType,
  ).toUpperCase();

  if (deliveryType === MAINTENANCE_ARCHIVE_DELIVERY_TYPE) {
    return true;
  }

  /*
   * Compatibilidad defensiva: si el backend marca explícitamente archiveOnly,
   * se respeta aunque una versión intermedia no envíe deliveryType.
   */
  if (
    reportBoolean_(request.archiveOnly, false)
    || reportBoolean_(request.maintenanceArchive, false)
  ) {
    return true;
  }

  return false;
}


/**
 * Decide si corresponde enviar correo.
 *
 * Un mantenimiento automático puede declarar EnviarCorreoCliente=false. Esa
 * decisión prevalece incluso si un backend antiguo envía sendEmail=true, para
 * evitar una segunda lectura pesada de todas las evidencias y un correo que no
 * debía enviarse.
 */
function resolveReportSendEmail_(
  payload,
  ticket,
) {
  const request = payload || {};
  const source = ticket || {};

  if (isMaintenanceArchiveDelivery_(request, source)) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(request, 'sendEmail')
    && !reportBoolean_(request.sendEmail, true)
  ) {
    return false;
  }

  const maintenanceEmailFields = [
    'EnviarCorreoCliente',
    'EnviarCorreo',
    'SendClientEmail',
    'sendClientEmail',
  ];

  for (
    let index = 0;
    index < maintenanceEmailFields.length;
    index += 1
  ) {
    const key = maintenanceEmailFields[index];

    if (
      Object.prototype.hasOwnProperty.call(source, key)
      && !reportBoolean_(source[key], true)
    ) {
      return false;
    }
  }

  return true;
}

function reportBoolean_(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = clean_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized) return Boolean(fallback);

  if (
    ['0', 'false', 'no', 'off', 'desactivado'].indexOf(normalized)
    !== -1
  ) {
    return false;
  }

  if (
    ['1', 'true', 'si', 'yes', 'on', 'activado'].indexOf(normalized)
    !== -1
  ) {
    return true;
  }

  return Boolean(fallback);
}

/**
 * Prepara los campos narrativos antes de completar la plantilla, el correo
 * y el PDF. Conserva los textos ya redactados correctamente y solo reconstruye
 * aquellos que estén vacíos, contengan objetos sin serializar o utilicen el
 * formato técnico heredado "preguntas: [object Object]".
 */
function prepareTicketForReport_(ticket, context) {
  const source = Object.assign({}, ticket || {});
  const reportContext = context || {};
  const devices = collectMaintenanceReportDevices_(
    source,
    reportContext,
  );
  const isMaintenance = isMaintenanceReportTicket_(
    source,
    reportContext,
    devices,
  );

  const fields = [
    'RazonVisita',
    'Descripcion',
    'PruebasRealizadas',
    'Resultado',
    'Recomendaciones',
  ];

  if (!isMaintenance) {
    fields.forEach(function (field) {
      source[field] = readableReportValue_(source[field]);
    });
    return source;
  }

  const narrative = buildMaintenanceReportNarrative_(
    source,
    reportContext,
    devices,
  );

  fields.forEach(function (field) {
    const original = source[field];
    const cleaned = readableReportValue_(original);
    const fallback = narrative[field] || '';

    source[field] = reportTextNeedsRewrite_(original)
      ? fallback || cleaned
      : cleaned || fallback;
  });

  return source;
}

/**
 * Determina si la boleta corresponde a un mantenimiento generado
 * automáticamente.
 */
function isMaintenanceReportTicket_(ticket, context, devices) {
  const flags = [
    ticket.EsBoletaMantenimiento,
    ticket.OrigenMantenimientoID,
    ticket.MantenimientoID,
    context && context.maintenance,
    context && context.mantenimiento,
    devices && devices.length,
  ];

  if (flags.some(function (value) {
    return Boolean(value);
  })) {
    return true;
  }

  const searchable = [
    ticket.Categoria,
    ticket.TipoFalla,
    ticket.Titulo,
    ticket.Origen,
  ].map(reportNormalize_).join(' ');

  return searchable.indexOf('mantenimiento') !== -1;
}

/**
 * Obtiene dispositivos desde las distintas estructuras compatibles que puede
 * enviar el backend. También reconoce el texto heredado de las boletas que
 * incluía líneas como:
 * "1. Cámara 1 · Cámara · Oficina · Axis · Modelo. preguntas: ...".
 */
function collectMaintenanceReportDevices_(ticket, context) {
  const candidates = [
    context && context.devices,
    context && context.dispositivos,
    context && context.maintenanceDevices,
    context && context.mantenimientoDispositivos,
    context && context.maintenanceReport,
    context && context.reporteMantenimiento,
    context && context.maintenance,
    context && context.mantenimiento,
    ticket.Dispositivos,
    ticket.DispositivosJSON,
    ticket.Devices,
    ticket.DevicesJSON,
    ticket.MantenimientoDispositivos,
    ticket.MantenimientoDispositivosJSON,
  ];

  let devices = [];

  candidates.forEach(function (candidate) {
    devices = devices.concat(reportDeviceArray_(candidate));
  });

  if (!devices.length) {
    devices = parseLegacyMaintenanceDevices_(
      ticket.PruebasRealizadas,
    );
  }

  if (
    !devices.length
    && (
      clean_(ticket.TipoDispositivo)
      || clean_(ticket.Fabricante)
      || clean_(ticket.Modelo)
      || clean_(ticket.Serie)
    )
  ) {
    devices.push({
      NombreDispositivo: clean_(
        ticket.NombreDispositivo || ticket.Descripcion,
        'Dispositivo revisado',
      ),
      Categoria: ticket.TipoDispositivo || ticket.Categoria,
      Zona: ticket.UbicacionEquipo || ticket.Ubicacion,
      Fabricante: ticket.Fabricante,
      Modelo: ticket.Modelo,
      Serie: ticket.Serie,
      Estado: extractLegacyState_(
        ticket.PruebasRealizadas || ticket.Resultado,
      ),
      Observacion: ticket.Observacion,
    });
  }

  const unique = [];
  const seen = {};

  devices.forEach(function (device, index) {
    if (!device || typeof device !== 'object') return;

    const key = [
      clean_(
        device.EvidenciaMantenimientoID
        || device.DispositivoID
        || device.ID,
      ),
      clean_(
        device.NombreDispositivo
        || device.Nombre
        || device.name,
        `dispositivo-${index}`,
      ),
      clean_(
        device.UbicacionEquipoNombre
        || device.UbicacionEquipo
        || device.Zona
        || device.Ubicacion,
      ),
    ].join('|').toLowerCase();

    if (seen[key]) return;
    seen[key] = true;
    unique.push(device);
  });

  return unique;
}

/**
 * Convierte una estructura desconocida a una lista de dispositivos.
 */
function reportDeviceArray_(value) {
  const parsed = parseReportJson_(value);

  if (Array.isArray(parsed)) {
    return parsed.filter(function (item) {
      return item && typeof item === 'object';
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const keys = [
    'devices',
    'dispositivos',
    'maintenanceDevices',
    'mantenimientoDispositivos',
    'items',
    'rows',
  ];

  for (let index = 0; index < keys.length; index += 1) {
    const nested = parsed[keys[index]];
    if (Array.isArray(nested)) {
      return nested.filter(function (item) {
        return item && typeof item === 'object';
      });
    }
  }

  return [];
}

/**
 * Recupera nombre, categoría, ubicación, fabricante, modelo y estado desde
 * el texto heredado, aun cuando las preguntas se hayan convertido en
 * [object Object].
 */
function parseLegacyMaintenanceDevices_(value) {
  if (typeof value !== 'string') return [];

  const text = value
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return [];

  const entries = [];
  const expression = /(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=(?:\s+\d+\.\s+)|$)/g;
  let match;

  while ((match = expression.exec(text)) !== null) {
    entries.push(match[2]);
  }

  if (!entries.length && text.indexOf('·') !== -1) {
    entries.push(text);
  }

  return entries.map(function (entry) {
    const state = extractLegacyState_(entry);
    const observationMatch = entry.match(
      /Observaci[oó]n\s*:\s*([^;]+)/i,
    );
    const questionIndex = entry.search(
      /\.\s*(?:preguntas?|respuestas?)\s*:/i,
    );
    const stateIndex = entry.search(/;\s*Estado\s*:/i);
    let header = entry;

    if (questionIndex >= 0) {
      header = entry.substring(0, questionIndex);
    } else if (stateIndex >= 0) {
      header = entry.substring(0, stateIndex);
    }

    header = header
      .replace(/^\s*\d+\.\s*/, '')
      .replace(/[.;\s]+$/g, '')
      .trim();

    const parts = header.split(/\s*·\s*/).filter(Boolean);

    return {
      NombreDispositivo: parts[0] || 'Dispositivo revisado',
      Categoria: parts[1] || 'Dispositivo',
      Zona: parts[2] || '',
      Fabricante: parts[3] || '',
      Modelo: parts.slice(4).join(' · '),
      Estado: state,
      Observacion: observationMatch
        ? clean_(observationMatch[1])
        : '',
    };
  }).filter(function (device) {
    return clean_(device.NombreDispositivo);
  });
}

function extractLegacyState_(value) {
  const text = typeof value === 'string'
    ? value.replace(/\r?\n/g, ' ')
    : readableReportValue_(value);
  const match = text.match(/Estado\s*:\s*([^;,.]+)/i);
  return match ? clean_(match[1]) : '';
}

/**
 * Genera una redacción coherente y determinista. Gemini puede mejorar el
 * estilo desde el backend, pero este texto garantiza que el Apps Script nunca
 * imprima objetos sin serializar.
 */
function buildMaintenanceReportNarrative_(ticket, context, devices) {
  const assigned = Array.isArray(context && context.assigned)
    ? context.assigned
    : [];
  const technicians = assigned.map(function (item) {
    return clean_(
      item.Nombre
      || item.NombreCompleto
      || item.NombreUsuario,
    );
  }).filter(Boolean);
  const technicianText = technicians.length
    ? reportJoinNatural_(technicians)
    : clean_(ticket.AsignadoA, 'el equipo técnico asignado');
  const workVerb = technicians.length > 1
    ? 'realizaron'
    : 'realizó';
  const date = formatDate_(ticket.Fecha) || 'la fecha registrada';
  const client = clean_(ticket.Cliente, 'el cliente');
  const location = clean_(
    ticket.Ubicacion,
    clean_(ticket.UbicacionEquipo),
  );
  const amount = devices.length;
  const amountText = `${amount} ${
    amount === 1 ? 'dispositivo' : 'dispositivos'
  }`;
  const categories = reportUnique_(
    devices.map(function (device) {
      return clean_(
        device.Categoria
        || device.TipoDispositivo,
      );
    }).filter(Boolean),
  );

  const reason = [
    `Durante la jornada del ${date}, ${technicianText} ${workVerb}`,
    'labores de mantenimiento preventivo y revisión técnica',
    `sobre ${amountText} de ${client}`,
    location ? `en ${location}` : '',
  ].filter(Boolean).join(' ') + '.';

  const description = [
    categories.length
      ? `El alcance incluyó ${reportJoinNatural_(
        categories.map(function (category) {
          return category.toLowerCase();
        }),
      )}.`
      : 'El alcance incluyó los equipos registrados en el mantenimiento.',
    'Se documentaron las verificaciones funcionales, la condición de uso,',
    'las observaciones técnicas y las evidencias asociadas a cada dispositivo.',
  ].join(' ');

  const testLines = [
    `Durante la inspección se evaluaron ${amountText} y se registraron las pruebas efectuadas en cada equipo:`,
  ];
  const resultLines = [];
  const counts = {
    correct: 0,
    issue: 0,
    pending: 0,
    review: 0,
  };
  const recommendations = [];

  devices.forEach(function (device, index) {
    const checks = maintenanceDeviceChecksForReport_(device);
    const status = maintenanceDeviceReportStatus_(
      device,
      checks,
    );
    counts[status] += 1;

    testLines.push(
      `${index + 1}. ${maintenanceDeviceTestNarrative_(
        device,
        ticket,
        checks,
      )}`,
    );

    resultLines.push(
      `${index + 1}. ${maintenanceDeviceResultNarrative_(
        device,
        ticket,
        checks,
        status,
      )}`,
    );

    const observation = clean_(
      device.Observacion
      || device.Observaciones
      || device.Nota,
    );
    const name = maintenanceDeviceNameForReport_(device);
    const deviceLocation = maintenanceDeviceLocationForReport_(
      device,
      ticket,
    );

    if (observation) {
      recommendations.push(
        `${name}${deviceLocation ? ` (${deviceLocation})` : ''}: ${observation}.`,
      );
    } else if (status === 'pending') {
      recommendations.push(
        `Completar la revisión pendiente de ${name}${
          deviceLocation ? ` en ${deviceLocation}` : ''
        }.`,
      );
    } else if (status === 'issue') {
      recommendations.push(
        `Dar seguimiento técnico a ${name}${
          deviceLocation ? ` en ${deviceLocation}` : ''
        }.`,
      );
    }
  });

  const summaryParts = [];
  if (counts.correct) {
    summaryParts.push(
      counts.correct === 1
        ? '1 dispositivo quedó conforme'
        : `${counts.correct} dispositivos quedaron conformes`,
    );
  }
  if (counts.issue) {
    summaryParts.push(
      counts.issue === 1
        ? '1 dispositivo presentó una condición que requiere atención'
        : `${counts.issue} dispositivos presentaron condiciones que requieren atención`,
    );
  }
  if (counts.pending) {
    summaryParts.push(
      counts.pending === 1
        ? '1 dispositivo quedó pendiente'
        : `${counts.pending} dispositivos quedaron pendientes`,
    );
  }
  if (counts.review) {
    summaryParts.push(
      counts.review === 1
        ? '1 dispositivo quedó para revisión'
        : `${counts.review} dispositivos quedaron para revisión`,
    );
  }

  const summary = summaryParts.length
    ? `Como resultado de la jornada, ${reportJoinNatural_(summaryParts)}.`
    : 'No fue posible establecer un resultado automático con la información recibida.';

  if (!recommendations.length) {
    recommendations.push(
      'Mantener el programa de revisión preventiva y dar seguimiento a cualquier cambio detectado en la operación de los equipos.',
    );
  }

  return {
    RazonVisita: safeReportText_(reason),
    Descripcion: safeReportText_(description),
    PruebasRealizadas: safeReportText_(testLines.join('\n')),
    Resultado: safeReportText_(
      [summary].concat(resultLines).join('\n'),
    ),
    Recomendaciones: safeReportText_(
      recommendations.join('\n'),
    ),
  };
}

/**
 * Extrae las respuestas dinámicas de cada dispositivo sin importar si llegan
 * como JSON, arreglos, objetos o campos simples.
 */
function maintenanceDeviceChecksForReport_(device) {
  const pairs = [];

  addMaintenanceCheckPair_(
    pairs,
    'Funcionamiento general',
    device.Funcionamiento,
  );
  addMaintenanceCheckPair_(
    pairs,
    'Condición de uso',
    device.EnUso,
  );

  [
    device.RespuestasJSON,
    device.PreguntasJSON,
    device.Respuestas,
    device.Preguntas,
    device.ChecklistJSON,
    device.Checklist,
    device.answers,
    device.questions,
  ].forEach(function (candidate) {
    extractMaintenanceQuestionPairs_(
      candidate,
      pairs,
      0,
    );
  });

  const unique = [];
  const seen = {};

  pairs.forEach(function (pair) {
    const label = clean_(pair[0]);
    const answer = readableReportValue_(pair[1]);
    if (!label || !answer) return;

    const key = reportNormalize_(label);
    if (seen[key]) return;
    seen[key] = true;
    unique.push([label, answer]);
  });

  return unique;
}

function addMaintenanceCheckPair_(pairs, label, value) {
  const readable = readableReportValue_(value);
  if (clean_(label) && readable) {
    pairs.push([clean_(label), readable]);
  }
}

function extractMaintenanceQuestionPairs_(
  value,
  pairs,
  depth,
) {
  if (depth > 6 || value == null || value === '') return;

  const parsed = parseReportJson_(value);

  if (Array.isArray(parsed)) {
    parsed.forEach(function (item) {
      extractMaintenanceQuestionPairs_(
        item,
        pairs,
        depth + 1,
      );
    });
    return;
  }

  if (typeof parsed !== 'object') return;

  const containerKeys = [
    'preguntas',
    '__preguntas',
    'questions',
    'respuestas',
    'answers',
    'items',
    'campos',
    'checklist',
  ];

  let usedContainer = false;
  containerKeys.forEach(function (key) {
    if (parsed[key] != null) {
      usedContainer = true;
      extractMaintenanceQuestionPairs_(
        parsed[key],
        pairs,
        depth + 1,
      );
    }
  });

  const label = firstReportValue_(parsed, [
    'Pregunta',
    'pregunta',
    'label',
    'Label',
    'Nombre',
    'nombre',
    'Campo',
    'campo',
    'Titulo',
    'titulo',
  ]);
  const answer = firstReportValue_(parsed, [
    'Respuesta',
    'respuesta',
    'value',
    'Value',
    'Valor',
    'valor',
    'Estado',
    'estado',
    'Seleccion',
    'seleccion',
  ]);

  if (
    clean_(label)
    && answer != null
    && answer !== ''
    && typeof answer !== 'object'
  ) {
    addMaintenanceCheckPair_(
      pairs,
      label,
      answer,
    );
    return;
  }

  if (usedContainer) return;

  Object.keys(parsed).forEach(function (key) {
    if (isReportMetadataKey_(key)) return;
    const current = parsed[key];

    if (
      current == null
      || current === ''
    ) {
      return;
    }

    if (typeof current === 'object') {
      extractMaintenanceQuestionPairs_(
        current,
        pairs,
        depth + 1,
      );
      return;
    }

    addMaintenanceCheckPair_(
      pairs,
      humanizeReportKey_(key),
      current,
    );
  });
}

function firstReportValue_(object, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = object[keys[index]];
    if (value != null && value !== '') return value;
  }
  return '';
}

function isReportMetadataKey_(key) {
  const normalized = reportNormalize_(key);
  return /(^| )(id|uuid|activo|orden|fecha|creado|actualizado|metadata|metadatos|tipo respuesta|obligatoria)( |$)/.test(
    normalized,
  );
}

function humanizeReportKey_(value) {
  return clean_(value)
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, function (letter) {
      return letter.toUpperCase();
    });
}

function maintenanceDeviceReportStatus_(device, checks) {
  const state = reportNormalize_(
    device.Estado
    || device.EstadoDispositivo
    || device.Resultado,
  );

  if (state.indexOf('pendiente') !== -1) return 'pending';
  if (
    state.indexOf('falla') !== -1
    || state.indexOf('incorrect') !== -1
    || state.indexOf('no conforme') !== -1
    || state.indexOf('mal') !== -1
  ) {
    return 'issue';
  }
  if (
    state.indexOf('correct') !== -1
    || state.indexOf('conforme') !== -1
    || state.indexOf('operativo') !== -1
    || state.indexOf('finalizado') !== -1
  ) {
    return 'correct';
  }

  if (checks.some(function (pair) {
    return classifyMaintenanceReportAnswer_(pair[1]) === 'negative';
  })) {
    return 'issue';
  }

  if (checks.some(function (pair) {
    return classifyMaintenanceReportAnswer_(pair[1]) === 'pending';
  })) {
    return 'pending';
  }

  if (
    checks.length
    && checks.every(function (pair) {
      const classification = classifyMaintenanceReportAnswer_(
        pair[1],
      );
      return classification === 'positive'
        || classification === 'neutral';
    })
  ) {
    return 'correct';
  }

  return 'review';
}

function classifyMaintenanceReportAnswer_(value) {
  const normalized = reportNormalize_(value);

  if (!normalized) return 'neutral';
  if (
    normalized === 'n a'
    || normalized.indexOf('no aplica') !== -1
    || normalized.indexOf('sin dato') !== -1
  ) {
    return 'neutral';
  }
  if (
    normalized.indexOf('pendiente') !== -1
    || normalized.indexOf('sin verificar') !== -1
    || normalized.indexOf('por revisar') !== -1
    || normalized.indexOf('no revisado') !== -1
  ) {
    return 'pending';
  }
  if (
    normalized === 'no'
    || normalized === 'false'
    || normalized.indexOf('no funciona') !== -1
    || normalized.indexOf('incorrect') !== -1
    || normalized.indexOf('falla') !== -1
    || normalized.indexOf('danado') !== -1
    || normalized.indexOf('fuera de servicio') !== -1
    || normalized.indexOf('no conforme') !== -1
    || normalized === 'mal'
  ) {
    return 'negative';
  }
  if (
    normalized === 'si'
    || normalized === 'true'
    || normalized === 'ok'
    || normalized.indexOf('correct') !== -1
    || normalized.indexOf('conforme') !== -1
    || normalized.indexOf('funciona') !== -1
    || normalized.indexOf('operativo') !== -1
    || normalized.indexOf('en uso') !== -1
    || normalized.indexOf('guardado') !== -1
    || normalized === 'bien'
  ) {
    return 'positive';
  }

  return 'neutral';
}

function maintenanceDeviceTestNarrative_(
  device,
  ticket,
  checks,
) {
  const reference = maintenanceDeviceReferenceForReport_(
    device,
    ticket,
  );
  const positive = [];
  const negative = [];
  const pending = [];
  const details = [];

  checks.forEach(function (pair) {
    const classification = classifyMaintenanceReportAnswer_(
      pair[1],
    );

    if (classification === 'positive') {
      positive.push(pair[0]);
    } else if (classification === 'negative') {
      negative.push(pair[0]);
    } else if (classification === 'pending') {
      pending.push(pair[0]);
    } else {
      details.push(
        `${pair[0].toLowerCase()}: ${pair[1]}`,
      );
    }
  });

  const sentences = [`Se inspeccionó ${reference}.`];

  if (positive.length) {
    sentences.push(
      `Se verificaron satisfactoriamente los siguientes puntos: ${reportJoinNatural_(
        reportUnique_(positive).map(function (label) {
          return label.toLowerCase();
        }),
      )}.`,
    );
  }

  if (negative.length) {
    sentences.push(
      `Se detectaron condiciones no conformes en: ${reportJoinNatural_(
        reportUnique_(negative).map(function (label) {
          return label.toLowerCase();
        }),
      )}.`,
    );
  }

  if (pending.length) {
    sentences.push(
      `Quedaron pendientes de verificación: ${reportJoinNatural_(
        reportUnique_(pending).map(function (label) {
          return label.toLowerCase();
        }),
      )}.`,
    );
  }

  if (details.length) {
    sentences.push(
      `También se registraron estos datos: ${details.join('; ')}.`,
    );
  }

  if (!checks.length) {
    sentences.push(
      'Se revisaron las condiciones generales de funcionamiento, uso e instalación registradas durante el mantenimiento.',
    );
  }

  const observation = clean_(
    device.Observacion
    || device.Observaciones
    || device.Nota,
  );

  if (observation) {
    sentences.push(`Observación técnica: ${observation}.`);
  }

  return safeReportText_(sentences.join(' '));
}

function maintenanceDeviceResultNarrative_(
  device,
  ticket,
  checks,
  status,
) {
  const reference = maintenanceDeviceReferenceForReport_(
    device,
    ticket,
  );
  const capitalized = reference.charAt(0).toUpperCase()
    + reference.slice(1);
  const negative = [];
  const pending = [];

  checks.forEach(function (pair) {
    const classification = classifyMaintenanceReportAnswer_(
      pair[1],
    );
    if (classification === 'negative') negative.push(pair[0]);
    if (classification === 'pending') pending.push(pair[0]);
  });

  const observation = clean_(
    device.Observacion
    || device.Observaciones
    || device.Nota,
  );

  if (status === 'pending') {
    const reasons = [];

    if (pending.length) {
      reasons.push(
        `faltan por confirmar ${reportJoinNatural_(
          reportUnique_(pending).map(function (label) {
            return label.toLowerCase();
          }),
        )}`,
      );
    }

    if (negative.length) {
      reasons.push(
        `se detectaron observaciones en ${reportJoinNatural_(
          reportUnique_(negative).map(function (label) {
            return label.toLowerCase();
          }),
        )}`,
      );
    }

    if (observation) {
      reasons.push(
        `se registró la observación: ${observation}`,
      );
    }

    return safeReportText_(
      `${capitalized} quedó pendiente de seguimiento${
        reasons.length
          ? ` debido a que ${reportJoinNatural_(reasons)}`
          : ''
      }.`,
    );
  }

  if (status === 'issue') {
    const issueText = negative.length
      ? `requiere atención en ${reportJoinNatural_(
        reportUnique_(negative).map(function (label) {
          return label.toLowerCase();
        }),
      )}`
      : 'requiere atención técnica';

    return safeReportText_(
      `${capitalized} ${issueText}${
        observation
          ? `. Observación registrada: ${observation}`
          : ''
      }.`,
    );
  }

  if (status === 'correct') {
    return safeReportText_(
      `${capitalized} quedó operativo y con las verificaciones registradas en condición conforme${
        observation
          ? `. Se dejó como observación: ${observation}`
          : ''
      }.`,
    );
  }

  return safeReportText_(
    `${capitalized} quedó registrado para revisión posterior, ya que la información disponible no permite establecer una conclusión automática${
      observation ? `. Observación: ${observation}` : ''
    }.`,
  );
}

function maintenanceDeviceNameForReport_(device) {
  return clean_(
    device.NombreDispositivo
    || device.Nombre
    || device.name,
    'dispositivo sin nombre',
  );
}

function maintenanceDeviceLocationForReport_(
  device,
  ticket,
) {
  return clean_(
    device.UbicacionEquipoNombre
    || device.UbicacionEquipo
    || device.Zona
    || device.Ubicacion
    || ticket.UbicacionEquipo
    || ticket.Ubicacion,
  );
}

function maintenanceDeviceCategoryForReport_(device) {
  return clean_(
    device.Categoria
    || device.TipoDispositivo
    || device.Tipo,
    'dispositivo',
  );
}

function maintenanceDeviceReferenceForReport_(
  device,
  ticket,
) {
  const category = maintenanceDeviceCategoryForReport_(
    device,
  ).toLowerCase();
  const name = maintenanceDeviceNameForReport_(device);
  const location = maintenanceDeviceLocationForReport_(
    device,
    ticket,
  );
  const article = maintenanceDeviceArticleForReport_(
    category,
  );
  const details = [
    clean_(device.Fabricante)
      ? `fabricante ${clean_(device.Fabricante)}`
      : '',
    clean_(device.Modelo)
      ? `modelo ${clean_(device.Modelo)}`
      : '',
    clean_(device.Serie)
      ? `serie ${clean_(device.Serie)}`
      : '',
  ].filter(Boolean);
  const locationText = location
    ? `, ${article === 'la' ? 'ubicada' : 'ubicado'} en ${location}`
    : '';

  return `${article} ${category} “${name}”${locationText}${
    details.length ? ` (${details.join(', ')})` : ''
  }`;
}

function maintenanceDeviceArticleForReport_(category) {
  const normalized = reportNormalize_(category);
  return /^(camara|puerta|impresora|bocina|cerradura|fuente)/.test(
    normalized,
  )
    ? 'la'
    : 'el';
}

function reportJoinNatural_(values) {
  const items = (values || []).map(clean_).filter(Boolean);

  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;

  return `${items.slice(0, -1).join(', ')} y ${
    items[items.length - 1]
  }`;
}

function reportUnique_(values) {
  const result = [];
  const seen = {};

  (values || []).forEach(function (value) {
    const text = clean_(value);
    const key = reportNormalize_(text);
    if (!text || seen[key]) return;
    seen[key] = true;
    result.push(text);
  });

  return result;
}

/**
 * Convierte valores simples o estructurados en texto legible.
 */
function readableReportValue_(value) {
  const parsed = parseReportJson_(value);

  if (parsed == null) return '';

  if (typeof parsed === 'boolean') {
    return parsed ? 'Sí' : 'No';
  }

  if (
    typeof parsed === 'number'
    || typeof parsed === 'bigint'
  ) {
    return String(parsed);
  }

  if (Array.isArray(parsed)) {
    return parsed.map(function (item) {
      return readableReportValue_(item);
    }).filter(Boolean).join('; ');
  }

  if (typeof parsed === 'object') {
    const pairs = [];
    extractMaintenanceQuestionPairs_(
      parsed,
      pairs,
      0,
    );

    if (pairs.length) {
      return pairs.map(function (pair) {
        return `${pair[0]}: ${readableReportValue_(pair[1])}`;
      }).filter(function (item) {
        return item.indexOf('[object Object]') === -1;
      }).join('; ');
    }

    return '';
  }

  return safeReportText_(String(parsed));
}

function parseReportJson_(value) {
  if (typeof value !== 'string') return value;

  const text = value.trim();
  if (!text) return '';

  const first = text.charAt(0);
  const last = text.charAt(text.length - 1);
  const looksJson = (
    (first === '{' && last === '}')
    || (first === '[' && last === ']')
  );

  if (!looksJson) return value;

  try {
    return JSON.parse(text);
  } catch (_) {
    return value;
  }
}

function reportTextNeedsRewrite_(value) {
  if (
    Array.isArray(value)
    || (value && typeof value === 'object')
  ) {
    return true;
  }

  const text = String(value == null ? '' : value).trim();

  if (!text) return true;
  if (/\[object Object\]/i.test(text)) return true;
  if (/^(true|false)$/i.test(text)) return true;
  if (
    /preguntas?\s*:/i.test(text)
    && /Estado\s*:/i.test(text)
  ) {
    return true;
  }

  return false;
}

function safeReportText_(value) {
  return String(value == null ? '' : value)
    .replace(/\[object Object\]/gi, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,;])\s*\1+/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function reportNormalize_(value) {
  return clean_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Reemplaza los marcadores de la plantilla.
 */
function replaceMarkers_(body, ticket, assignedNames, surveyUrl) {
  const values = {
    '{{Titulo}}': ticket.Titulo,
    '{{BoletaID}}': ticket.BoletaID,
    '{{Fecha}}': formatDate_(ticket.Fecha),
    '{{HoraInicio}}': ticket.HoraInicio,
    '{{HoraFinal}}': ticket.HoraFinal,
    '{{HorasTotales}}': formatHours_(ticket.HorasTotales),
    '{{Cliente}}': ticket.Cliente,
    '{{Ubicacion}}': ticket.Ubicacion,
    '{{UbicacionEquipo}}': ticket.UbicacionEquipo,
    '{{Supervisor}}': ticket.Supervisor,
    '{{Categoria}}': ticket.Categoria,
    '{{TipoFalla}}': ticket.TipoFalla,
    '{{TipoDispositivo}}': ticket.TipoDispositivo,
    '{{Fabricante}}': ticket.Fabricante,
    '{{Modelo}}': ticket.Modelo,
    '{{Serie}}': ticket.Serie,
    '{{RazonVisita}}': ticket.RazonVisita,
    '{{Descripcion}}': ticket.Descripcion,
    '{{PruebasRealizadas}}': ticket.PruebasRealizadas,
    '{{Resultado}}': ticket.Resultado,
    '{{Recomendaciones}}': ticket.Recomendaciones,
    '{{AsignadoA}}': assignedNames,
    '{{EncuestaURL}}': surveyUrl,
    '{{SurveyURL}}': surveyUrl,

    '<<[ID]>>': ticket.BoletaID,
    '<<[Categoría]>>': ticket.Categoria,
    '<<[Fecha]>>': formatDate_(ticket.Fecha),
    '<<TEXT([Fecha], "DD/MM/YYYY")>>': formatDate_(ticket.Fecha),
    '<<[Cliente]>>': ticket.Cliente,
    '<<[Hora de inicio]>>': ticket.HoraInicio,
    '<<[Hora de Finalización]>>': ticket.HoraFinal,
    '<<[Ubicación]>>': ticket.Ubicacion,
    '<<[Supervisor]>>': ticket.Supervisor,
    '<<[Razon_visita]>>': ticket.RazonVisita,
    '<<[Descripción]>>': ticket.Descripcion,
    '<<[Fabricante]>>': ticket.Fabricante,
    '<<[Modelo]>>': ticket.Modelo,
    '<<[Serie]>>': ticket.Serie,
    '<<[Ubicacion_equipo]>>': ticket.UbicacionEquipo || ticket.Ubicacion,
    '<<[Pruebas realizadas]>>': ticket.PruebasRealizadas,
    '<<[Resultado]>>': ticket.Resultado,
    '<<[Recomendaciones ]>>': ticket.Recomendaciones,
    '<<[AsignadoA]>>': assignedNames,
    '<<[EncuestaURL]>>': surveyUrl,
    '<<[SurveyURL]>>': surveyUrl,
  };

  /*
   * body.replaceText() recorre el documento. Antes se ejecutaba para todos los
   * marcadores posibles aunque la plantilla no los utilizara. Leer el texto una
   * sola vez y reemplazar únicamente los marcadores presentes reduce llamadas a
   * DocumentApp.
   */
  const templateText = body.getText();

  Object.keys(values).forEach(function (marker) {
    if (templateText.indexOf(marker) === -1) {
      return;
    }

    body.replaceText(
      escapeRegex_(marker),
      clean_(values[marker]),
    );
  });
}

/**
 * Sustituye un marcador por una imagen.
 */
function replaceMarkerWithImage_(body, marker, blob, maxWidth) {
  const found = body.findText(escapeRegex_(marker));
  if (!found) return false;

  const text = found.getElement().asText();
  text.deleteText(
    found.getStartOffset(),
    found.getEndOffsetInclusive(),
  );

  let parent = text.getParent();
  while (
    parent
    && parent.getType() !== DocumentApp.ElementType.PARAGRAPH
  ) {
    parent = parent.getParent();
  }

  if (!parent) return false;

  const image = parent
    .asParagraph()
    .appendInlineImage(blob);

  resizeInlineImage_(image, maxWidth);
  return true;
}

/**
 * Indica si el documento realmente necesita una sección de anexos.
 *
 * La firma solo se considera anexo cuando existe y no pudo insertarse en el
 * marcador de la plantilla. Si no hay firma pendiente de insertar ni
 * evidencias, el PDF termina con la boleta y no agrega una página vacía.
 */
function hasAnnexContent_(
  signatureBlob,
  signatureInserted,
  evidences,
) {
  return Boolean(
    (signatureBlob && !signatureInserted)
    || (Array.isArray(evidences) && evidences.length),
  );
}

/**
 * Elimina saltos de página y párrafos vacíos al final de la plantilla.
 *
 * Algunas versiones de la plantilla conservan un salto de página después de
 * la tabla de firmas. Si se agrega otro salto sin limpiarlo, Google Docs
 * genera una página completamente en blanco antes de los anexos.
 */
function removeTrailingPageArtifacts_(body) {
  /*
   * Google Docs exige que la sección termine con un párrafo. El último
   * párrafo nunca debe eliminarse con removeFromParent(), aunque esté vacío.
   *
   * Esta función:
   * 1. Conserva siempre el último párrafo obligatorio.
   * 2. Elimina únicamente los saltos de página contenidos dentro de él.
   * 3. Limpia párrafos vacíos anteriores, sin tocar el último párrafo.
   */

  function removePageBreakChildren_(paragraph) {
    for (
      let childIndex = paragraph.getNumChildren() - 1;
      childIndex >= 0;
      childIndex -= 1
    ) {
      const paragraphChild = paragraph.getChild(childIndex);

      if (
        paragraphChild.getType()
        === DocumentApp.ElementType.PAGE_BREAK
      ) {
        paragraphChild.removeFromParent();
      }
    }
  }

  const initialCount = body.getNumChildren();
  if (!initialCount) return;

  /*
   * Se procesa el último elemento, pero nunca se elimina si es párrafo o
   * elemento de lista. Solo se quitan los saltos de página internos.
   */
  const lastIndex = body.getNumChildren() - 1;
  const lastChild = body.getChild(lastIndex);
  const lastType = lastChild.getType();

  if (
    lastType === DocumentApp.ElementType.PARAGRAPH
    || lastType === DocumentApp.ElementType.LIST_ITEM
  ) {
    const lastParagraph = lastType === DocumentApp.ElementType.PARAGRAPH
      ? lastChild.asParagraph()
      : lastChild.asListItem();

    removePageBreakChildren_(lastParagraph);
  }

  /*
   * Se revisan únicamente los elementos anteriores al último párrafo
   * obligatorio. Estos sí se pueden eliminar cuando están vacíos.
   */
  let index = body.getNumChildren() - 2;
  let safetyCounter = 0;

  while (index >= 0 && safetyCounter < 100) {
    safetyCounter += 1;

    const child = body.getChild(index);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PAGE_BREAK) {
      child.removeFromParent();
      index -= 1;
      continue;
    }

    if (
      type === DocumentApp.ElementType.PARAGRAPH
      || type === DocumentApp.ElementType.LIST_ITEM
    ) {
      const paragraph = type === DocumentApp.ElementType.PARAGRAPH
        ? child.asParagraph()
        : child.asListItem();

      removePageBreakChildren_(paragraph);

      if (!clean_(paragraph.getText())) {
        child.removeFromParent();
        index -= 1;
        continue;
      }
    }

    break;
  }
}


/**
 * Inserta un único salto antes de los anexos.
 *
 * Cuando la plantilla termina con el párrafo obligatorio vacío de Google Docs,
 * el salto se agrega dentro de ese mismo párrafo. Esto evita crear una
 * combinación de párrafo vacío + salto nuevo que puede producir una hoja
 * completamente en blanco.
 */
function appendSingleAnnexPageBreak_(body) {
  const count = body.getNumChildren();

  if (count > 0) {
    const lastChild = body.getChild(count - 1);

    if (
      lastChild.getType()
      === DocumentApp.ElementType.PARAGRAPH
    ) {
      const paragraph = lastChild.asParagraph();

      if (!clean_(paragraph.getText())) {
        paragraph.appendPageBreak();
        return;
      }
    }
  }

  body.appendPageBreak();
}

/**
 * Agrega firma y evidencias al documento únicamente cuando existen.
 */
function appendAnnexes_(
  body,
  signatureBlob,
  signatureInserted,
  evidences,
  options,
) {
  const settings = options || {};
  const annexEvidences = Array.isArray(evidences)
    ? evidences
    : [];

  if (!hasAnnexContent_(
    signatureBlob,
    signatureInserted,
    annexEvidences,
  )) {
    removeTrailingPageArtifacts_(body);
    return;
  }

  removeTrailingPageArtifacts_(body);
  appendSingleAnnexPageBreak_(body);
  body
    .appendParagraph('ANEXOS')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (signatureBlob && !signatureInserted) {
    body
      .appendParagraph('Firma del cliente')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    const image = body
      .appendParagraph('')
      .appendInlineImage(signatureBlob);

    resizeInlineImage_(image, 260);
  }

  if (!annexEvidences.length) {
    return;
  }

  body
    .appendParagraph('Evidencias fotográficas')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);

  annexEvidences.forEach(function (evidence, index) {
    assertRequestBudget_(
      `insertar la evidencia ${index + 1} en el documento`,
      20000,
    );

    const name = clean_(
      evidence.Nombre || evidence.NombreArchivo,
      `Evidencia ${index + 1}`,
    );
    const note = clean_(evidence.Nota);

    body
      .appendParagraph(`${index + 1}. ${name}`)
      .setBold(true);

    if (note) {
      body.appendParagraph(note);
    }

    const source = evidence.ArchivoID
      || evidence.ArchivoFileID
      || evidence.DriveFileID
      || evidence.ArchivoURL;

    const blob = settings.optimizeLargeImages === false
      ? getDriveBlob_(source)
      : getDriveImageBlobForDocument_(source);

    if (blob && /^image\//i.test(blob.getContentType())) {
      const image = body
        .appendParagraph('')
        .appendInlineImage(blob);

      resizeInlineImage_(image, 460);
    } else if (evidence.ArchivoURL) {
      body.appendParagraph(`Archivo: ${evidence.ArchivoURL}`);
    }
  });
}


/**
 * Crea una presentación de mantenimiento en formato collage.
 *
 * La presentación contiene:
 * - Una portada con cliente, fecha y resumen.
 * - Una o más diapositivas por dispositivo.
 * - Hasta seis fotografías por diapositiva.
 * - Etiquetas Antes, Después u Otra evidencia.
 * - Notas registradas en cada fotografía.
 *
 * Cuando existen muchos dispositivos, la presentación continúa llenándose
 * mediante un disparador temporal para evitar el límite de ejecución.
 */
function createMaintenancePresentation_(payload) {
  const maintenance = payload.maintenance
    || payload.mantenimiento
    || {};
  const devices = Array.isArray(payload.devices)
    ? payload.devices
    : Array.isArray(payload.dispositivos)
      ? payload.dispositivos
      : [];

  const maintenanceId = clean_(
    maintenance.MantenimientoID
    || maintenance.ID
    || maintenance.id,
  );

  if (!maintenanceId) {
    throw new Error(
      'La solicitud no incluye el identificador del mantenimiento.',
    );
  }

  if (!devices.length) {
    throw new Error(
      'El mantenimiento no contiene dispositivos para crear la presentación.',
    );
  }

  const properties = PropertiesService.getScriptProperties();
  const baseFolderId = clean_(
    payload.baseFolderId
    || properties.getProperty('MANTENIMIENTOS_REPORTS_FOLDER_ID')
    || properties.getProperty('REPORTES_MANTENIMIENTOS_FOLDER_ID')
    || properties.getProperty('REPORTES_FOLDER_ID')
    || properties.getProperty('BOLETAS_FOLDER_ID'),
  );

  if (!baseFolderId) {
    throw new Error(
      'No se configuró la carpeta de reportes de mantenimiento.',
    );
  }

  const client = clean_(
    maintenance.Cliente
    || maintenance.ClienteNombre,
    'Sin cliente',
  );
  const date = formatDate_(
    maintenance.Fecha
    || maintenance.FechaMantenimiento,
  ) || 'Sin fecha';
  const title = [
    'Mantenimiento DMS',
    safeName_(client),
    date.replace(/\//g, '-'),
  ].join(' - ');

  const presentation = SlidesApp.create(title);
  const defaultSlides = presentation.getSlides();

  if (defaultSlides.length) {
    defaultSlides[0].remove();
  }

  createMaintenanceCoverSlide_(
    presentation,
    maintenance,
    devices,
  );

  const presentationId = presentation.getId();
  const presentationUrl = presentation.getUrl();
  presentation.saveAndClose();

  const presentationFile = DriveApp.getFileById(presentationId);
  const baseFolder = DriveApp.getFolderById(baseFolderId);

  moveFileToFolder_(
    presentationFile,
    baseFolder,
  );

  const sortedDevices = devices.slice().sort(function (left, right) {
    return [
      clean_(left.Zona),
      clean_(left.Categoria || left.TipoDispositivo),
      clean_(left.NombreDispositivo),
    ].join('|').localeCompare([
      clean_(right.Zona),
      clean_(right.Categoria || right.TipoDispositivo),
      clean_(right.NombreDispositivo),
    ].join('|'), 'es');
  });

  const job = {
    jobId: `SLIDES_${Utilities.getUuid()}`,
    status: 'RUNNING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    presentationId: presentationId,
    presentationUrl: presentationUrl,
    presentationName: title,
    folderId: baseFolderId,
    folderUrl: baseFolder.getUrl(),
    maintenance: maintenance,
    devices: sortedDevices,
    deviceIndex: 0,
    totalDevices: sortedDevices.length,
    imageCount: 0,
    imageErrors: 0,
    errors: [],
  };

  const startedAt = Date.now();
  const slice = processMaintenancePresentationJobSlice_(
    job,
    startedAt,
  );

  const currentPresentation = SlidesApp.openById(presentationId);
  const currentSlideCount = currentPresentation.getSlides().length;
  currentPresentation.saveAndClose();

  if (slice.done) {
    job.status = 'DONE';
    job.finishedAt = new Date().toISOString();

    return maintenancePresentationResponse_(
      job,
      currentSlideCount,
      false,
    );
  }

  job.status = 'PENDING';
  job.updatedAt = new Date().toISOString();

  const jobFile = saveMaintenanceSlidesJobFile_(job);
  registerMaintenanceSlidesJob_(
    job.jobId,
    jobFile.getId(),
  );
  ensureMaintenanceSlidesWorker_();

  return maintenancePresentationResponse_(
    job,
    currentSlideCount,
    true,
  );
}

/**
 * Construye la respuesta estándar para el backend.
 */
function maintenancePresentationResponse_(
  job,
  slideCount,
  queued,
) {
  return {
    slidesId: job.presentationId,
    slidesUrl: job.presentationUrl,
    presentationId: job.presentationId,
    presentationUrl: job.presentationUrl,
    name: job.presentationName,
    folderId: job.folderId,
    folderUrl: job.folderUrl,
    slideCount: Number(slideCount || 0),
    deviceCount: Number(job.totalDevices || 0),
    processedDevices: Number(job.deviceIndex || 0),
    imageCount: Number(job.imageCount || 0),
    imageErrors: Number(job.imageErrors || 0),
    queued: Boolean(queued),
    jobId: queued ? job.jobId : '',
    scriptVersion: APPS_SCRIPT_VERSION,
    message: queued
      ? 'La presentación fue creada y continuará agregando dispositivos en segundo plano.'
      : 'La presentación fue creada completamente.',
  };
}

/**
 * Procesa una parte de la presentación sin superar el tiempo máximo.
 */
function processMaintenancePresentationJobSlice_(
  job,
  startedAt,
) {
  const presentation = SlidesApp.openById(
    job.presentationId,
  );
  let processedThisRun = 0;

  while (job.deviceIndex < job.devices.length) {
    if (
      Date.now() - startedAt
      > MAINTENANCE_SLIDES_MAX_RUN_MS
    ) {
      presentation.saveAndClose();
      return { job: job, done: false };
    }

    if (
      processedThisRun
      >= MAINTENANCE_SLIDES_DEVICES_PER_RUN
    ) {
      presentation.saveAndClose();
      return { job: job, done: false };
    }

    const device = job.devices[job.deviceIndex];

    try {
      const result = createMaintenanceDeviceSlides_(
        presentation,
        job.maintenance,
        device,
        job.deviceIndex + 1,
      );

      job.imageCount += result.imageCount;
      job.imageErrors += result.imageErrors;
    } catch (error) {
      job.errors.push(
        `Dispositivo ${job.deviceIndex + 1}: ${error.message}`,
      );

      console.error(
        error && error.stack
          ? error.stack
          : error,
      );
    }

    job.deviceIndex += 1;
    processedThisRun += 1;
  }

  presentation.saveAndClose();
  return { job: job, done: true };
}

/**
 * Worker que continúa las presentaciones pendientes.
 */
function processMaintenancePresentationQueue() {
  // El worker no depende del timeout HTTP de Render; solo reinicia cachés.
  resetRequestRuntime_(false);

  const leaseToken = acquireMaintenanceSlidesWorkerLease_();

  if (!leaseToken) {
    return;
  }

  const startedAt = Date.now();

  try {
    const jobs = getRegisteredMaintenanceSlidesJobs_();

    if (!jobs.length) {
      deleteMaintenanceSlidesWorker_();
      return;
    }

    const properties = PropertiesService
      .getScriptProperties();

    jobs.forEach(function (registered) {
      if (
        Date.now() - startedAt
        > MAINTENANCE_SLIDES_MAX_RUN_MS
      ) {
        return;
      }

      const job = readMaintenanceSlidesJobFile_(
        registered.fileId,
      );

      if (!job) {
        properties.deleteProperty(
          registered.key,
        );
        return;
      }

      if (job.status === 'DONE') {
        finishMaintenanceSlidesJob_(
          registered,
          job,
        );
        return;
      }

      job.status = 'RUNNING';
      job.updatedAt = new Date().toISOString();
      job.workerLeaseToken = leaseToken;

      saveMaintenanceSlidesJobFileById_(
        registered.fileId,
        job,
      );

      const slice = processMaintenancePresentationJobSlice_(
        job,
        startedAt,
      );

      job.updatedAt = new Date().toISOString();
      delete job.workerLeaseToken;

      if (slice.done) {
        job.status = 'DONE';
        job.finishedAt = new Date().toISOString();

        saveMaintenanceSlidesJobFileById_(
          registered.fileId,
          job,
        );

        finishMaintenanceSlidesJob_(
          registered,
          job,
        );
      } else {
        job.status = 'PENDING';

        saveMaintenanceSlidesJobFileById_(
          registered.fileId,
          job,
        );
      }
    });

    if (
      getRegisteredMaintenanceSlidesJobs_().length
    ) {
      ensureMaintenanceSlidesWorker_();
    } else {
      deleteMaintenanceSlidesWorker_();
    }
  } catch (error) {
    console.error(
      error && error.stack
        ? error.stack
        : error,
    );

    ensureMaintenanceSlidesWorker_();
  } finally {
    releaseMaintenanceSlidesWorkerLease_(
      leaseToken,
    );
  }
}

/**
 * Obtiene una concesión corta para impedir que dos disparadores de Slides
 * procesen simultáneamente la misma cola, sin mantener ScriptLock durante los
 * minutos que puede tardar la presentación.
 */
function acquireMaintenanceSlidesWorkerLease_() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    return '';
  }

  try {
    const properties = PropertiesService
      .getScriptProperties();
    const raw = properties.getProperty(
      MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
    );
    const now = Date.now();

    if (raw) {
      try {
        const lease = JSON.parse(raw);

        if (
          lease
          && Number(lease.expiresAt || 0) > now
        ) {
          return '';
        }
      } catch (_) {
        // Una concesión corrupta o antigua se reemplaza.
      }
    }

    const token = Utilities.getUuid();

    properties.setProperty(
      MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
      JSON.stringify({
        token: token,
        startedAt: now,
        expiresAt: now + MAINTENANCE_SLIDES_WORKER_LEASE_MS,
      }),
    );

    return token;
  } finally {
    lock.releaseLock();
  }
}

function releaseMaintenanceSlidesWorkerLease_(
  token,
) {
  if (!token) return;

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    return;
  }

  try {
    const properties = PropertiesService
      .getScriptProperties();
    const raw = properties.getProperty(
      MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
    );

    if (!raw) return;

    try {
      const lease = JSON.parse(raw);

      if (lease && lease.token === token) {
        properties.deleteProperty(
          MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
        );
      }
    } catch (_) {
      properties.deleteProperty(
        MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
      );
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Limpia el registro y el archivo de un trabajo terminado.
 */
function finishMaintenanceSlidesJob_(
  registered,
  job,
) {
  PropertiesService
    .getScriptProperties()
    .deleteProperty(registered.key);

  try {
    DriveApp
      .getFileById(registered.fileId)
      .setTrashed(true);
  } catch (error) {
    console.warn(
      `No se pudo eliminar el archivo temporal ${registered.fileId}: ${error.message}`,
    );
  }

  console.log(
    `Presentación ${job.presentationId} terminada: ${job.deviceIndex}/${job.totalDevices} dispositivos.`,
  );
}

/**
 * Guarda el estado del trabajo dentro de la carpeta de reportes.
 */
function saveMaintenanceSlidesJobFile_(job) {
  const folder = DriveApp.getFolderById(
    job.folderId,
  );
  const name = [
    MAINTENANCE_SLIDES_JOB_PREFIX,
    safeName_(job.jobId),
    '.json',
  ].join('');

  return folder.createFile(
    name,
    JSON.stringify(job, null, 2),
    MimeType.PLAIN_TEXT,
  );
}

function saveMaintenanceSlidesJobFileById_(
  fileId,
  job,
) {
  DriveApp
    .getFileById(fileId)
    .setContent(
      JSON.stringify(job, null, 2),
    );
}

function readMaintenanceSlidesJobFile_(fileId) {
  try {
    return JSON.parse(
      DriveApp
        .getFileById(fileId)
        .getBlob()
        .getDataAsString(),
    );
  } catch (error) {
    console.warn(
      `No se pudo leer el trabajo ${fileId}: ${error.message}`,
    );
    return null;
  }
}

function registerMaintenanceSlidesJob_(
  jobId,
  fileId,
) {
  PropertiesService
    .getScriptProperties()
    .setProperty(
      MAINTENANCE_SLIDES_PROPERTY_PREFIX + jobId,
      fileId,
    );
}

function getRegisteredMaintenanceSlidesJobs_() {
  const properties = PropertiesService
    .getScriptProperties()
    .getProperties();

  return Object.keys(properties)
    .filter(function (key) {
      return key.indexOf(
        MAINTENANCE_SLIDES_PROPERTY_PREFIX,
      ) === 0;
    })
    .map(function (key) {
      return {
        key: key,
        fileId: properties[key],
      };
    });
}

function ensureMaintenanceSlidesWorker_() {
  const exists = ScriptApp
    .getProjectTriggers()
    .some(function (trigger) {
      return trigger.getHandlerFunction()
        === 'processMaintenancePresentationQueue';
    });

  if (!exists) {
    ScriptApp
      .newTrigger(
        'processMaintenancePresentationQueue',
      )
      .timeBased()
      .everyMinutes(1)
      .create();
  }
}

function deleteMaintenanceSlidesWorker_() {
  ScriptApp
    .getProjectTriggers()
    .forEach(function (trigger) {
      if (
        trigger.getHandlerFunction()
        === 'processMaintenancePresentationQueue'
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
}

/**
 * Portada principal.
 */
function createMaintenanceCoverSlide_(
  presentation,
  maintenance,
  devices,
) {
  const slide = presentation.appendSlide(
    SlidesApp.PredefinedLayout.BLANK,
  );
  const client = clean_(
    maintenance.Cliente
    || maintenance.ClienteNombre,
    'Sin cliente',
  );
  const date = formatDate_(
    maintenance.Fecha
    || maintenance.FechaMantenimiento,
  ) || 'Sin fecha';
  const title = clean_(
    maintenance.TituloMantenimiento
    || maintenance.Titulo,
    'Mantenimiento',
  );
  const technicians = clean_(
    maintenance.Responsables
    || maintenance.Responsable
    || maintenance.Tecnicos
    || maintenance.AsignadoA,
    'No indicados',
  );
  const imageCount = devices.reduce(
    function (total, device) {
      return total + (
        Array.isArray(device.Imagenes)
          ? device.Imagenes.filter(function (image) {
            return image.Activo !== false;
          }).length
          : 0
      );
    },
    0,
  );

  const header = slide.insertShape(
    SlidesApp.ShapeType.RECTANGLE,
    0,
    0,
    720,
    82,
  );
  header
    .getFill()
    .setSolidFill(BRAND_RED);
  header
    .getBorder()
    .setTransparent();

  const headerText = slide.insertTextBox(
    'Reporte de Mantenimiento DMS',
    38,
    24,
    640,
    40,
  );
  headerText
    .getText()
    .getTextStyle()
    .setFontSize(26)
    .setBold(true)
    .setForegroundColor('#ffffff');

  slide.insertTextBox(
    title,
    40,
    108,
    640,
    44,
  )
    .getText()
    .getTextStyle()
    .setFontSize(22)
    .setBold(true)
    .setForegroundColor(BRAND_TEXT);

  const details = [
    `Cliente: ${client}`,
    `Fecha del mantenimiento: ${date}`,
    `Estado: ${clean_(maintenance.Estado, 'Sin estado')}`,
    `Técnicos responsables: ${technicians}`,
    `Dispositivos revisados: ${devices.length}`,
    `Fotografías registradas: ${imageCount}`,
  ];

  details.forEach(function (line, index) {
    slide.insertTextBox(
      line,
      42,
      172 + (index * 31),
      635,
      25,
    )
      .getText()
      .getTextStyle()
      .setFontSize(index < 2 ? 15 : 13);
  });

  slide.insertTextBox(
    `Generado: ${Utilities.formatDate(
      new Date(),
      DEFAULT_TIME_ZONE,
      'dd/MM/yyyy HH:mm',
    )}`,
    42,
    365,
    635,
    18,
  )
    .getText()
    .getTextStyle()
    .setFontSize(9)
    .setForegroundColor(BRAND_MUTED);
}

/**
 * Genera las diapositivas correspondientes a un dispositivo.
 */
function createMaintenanceDeviceSlides_(
  presentation,
  maintenance,
  device,
  index,
) {
  const images = collectMaintenanceSlideImages_(
    device,
  );
  const pages = images.length
    ? chunkMaintenanceSlidesArray_(
      images,
      MAINTENANCE_SLIDES_MAX_IMAGES_PER_SLIDE,
    )
    : [[]];

  let imageCount = 0;
  let imageErrors = 0;

  pages.forEach(function (pageImages, pageIndex) {
    const slide = presentation.appendSlide(
      SlidesApp.PredefinedLayout.BLANK,
    );

    const name = clean_(
      device.NombreDispositivo,
      `Dispositivo ${index}`,
    );
    const pageLabel = pages.length > 1
      ? ` (${pageIndex + 1}/${pages.length})`
      : '';
    const zone = clean_(device.Zona, 'N/A');
    const category = clean_(
      device.Categoria
      || device.TipoDispositivo,
      'N/A',
    );
    const folderUrl = safeWebUrl_(
      device.CarpetaDispositivoURL,
    ) || findMaintenanceDeviceFolderUrl_(
      maintenance,
      device,
    );

    const accent = slide.insertShape(
      SlidesApp.ShapeType.RECTANGLE,
      0,
      0,
      12,
      405,
    );
    accent
      .getFill()
      .setSolidFill(BRAND_RED);
    accent
      .getBorder()
      .setTransparent();

    slide.insertTextBox(
      name + pageLabel,
      30,
      16,
      470,
      30,
    )
      .getText()
      .getTextStyle()
      .setFontSize(20)
      .setBold(true)
      .setForegroundColor(BRAND_TEXT);

    slide.insertTextBox(
      [
        `Zona: ${zone}`,
        `Categoría: ${category}`,
        `Modelo: ${clean_(device.Modelo, 'N/A')}`,
        `Serie: ${clean_(device.Serie, 'N/A')}`,
      ].join('   |   '),
      30,
      49,
      660,
      22,
    )
      .getText()
      .getTextStyle()
      .setFontSize(9)
      .setForegroundColor(BRAND_MUTED);

    slide.insertTextBox(
      [
        `Funcionamiento: ${clean_(device.Funcionamiento, 'N/A')}`,
        `En uso: ${clean_(device.EnUso, 'N/A')}`,
        `Estado: ${clean_(device.Estado, 'N/A')}`,
      ].join('   |   '),
      30,
      72,
      660,
      22,
    )
      .getText()
      .getTextStyle()
      .setFontSize(9)
      .setBold(true);

    if (clean_(device.Observacion)) {
      slide.insertTextBox(
        `Observación: ${clean_(device.Observacion)}`,
        30,
        94,
        660,
        25,
      )
        .getText()
        .getTextStyle()
        .setFontSize(9);
    }

    if (folderUrl) {
      const folderBox = slide.insertTextBox(
        `Carpeta del dispositivo: ${folderUrl}`,
        30,
        115,
        660,
        14,
      );

      folderBox
        .getText()
        .getTextStyle()
        .setFontSize(6)
        .setForegroundColor('#1155cc');
    }

    if (!pageImages.length) {
      slide.insertTextBox(
        'Sin imágenes encontradas para este dispositivo.',
        205,
        205,
        330,
        36,
      )
        .getText()
        .getTextStyle()
        .setFontSize(13)
        .setForegroundColor(BRAND_MUTED);
      return;
    }

    const boxes = [
      { x: 30, y: 134, w: 205, h: 103 },
      { x: 257, y: 134, w: 205, h: 103 },
      { x: 484, y: 134, w: 205, h: 103 },
      { x: 30, y: 274, w: 205, h: 92 },
      { x: 257, y: 274, w: 205, h: 92 },
      { x: 484, y: 274, w: 205, h: 92 },
    ];

    pageImages.forEach(function (item, imageIndex) {
      const box = boxes[imageIndex];
      const caption = item.nota
        ? `${item.label} | Nota: ${item.nota}`
        : item.label;

      try {
        const image = slide.insertImage(
          item.blob,
        );

        fitMaintenanceSlideImageToBox_(
          image,
          box.x,
          box.y,
          box.w,
          box.h,
        );

        imageCount += 1;
      } catch (error) {
        imageErrors += 1;

        slide.insertTextBox(
          'No se pudo insertar la imagen',
          box.x,
          box.y + 38,
          box.w,
          24,
        )
          .getText()
          .getTextStyle()
          .setFontSize(8)
          .setForegroundColor(BRAND_RED);
      }

      slide.insertTextBox(
        caption,
        box.x,
        box.y + box.h + 4,
        box.w,
        imageIndex < 3 ? 31 : 28,
      )
        .getText()
        .getTextStyle()
        .setFontSize(item.nota ? 6 : 7)
        .setBold(!item.nota);
    });
  });

  return {
    imageCount: imageCount,
    imageErrors: imageErrors,
  };
}

/**
 * Convierte las fotografías del dispositivo en blobs de Drive.
 */
function collectMaintenanceSlideImages_(device) {
  const images = Array.isArray(device.Imagenes)
    ? device.Imagenes
    : Array.isArray(device.images)
      ? device.images
      : [];
  const counters = {
    ANTES: 0,
    DESPUES: 0,
    OTRO: 0,
  };
  const collected = [];

  images.forEach(function (image) {
    if (
      image.Activo === false
      || String(image.Activo).toLowerCase() === 'false'
    ) {
      return;
    }

    const type = normalizeMaintenanceSlideImageType_(
      image.Tipo
      || image.Estado
      || image.EstadoFoto
      || image.TipoFoto,
    );

    counters[type] += 1;

    const blob = getDriveImageBlobForDocument_(
      image.DriveFileID
      || image.ArchivoID
      || image.ArchivoFileID
      || image.DriveURL
      || image.ArchivoURL
      || image.Imagen,
    );

    if (!blob) {
      return;
    }

    const typeLabel = type === 'ANTES'
      ? 'Antes'
      : type === 'DESPUES'
        ? 'Después'
        : 'Otra evidencia';

    collected.push({
      type: type,
      order: counters[type],
      label: `${typeLabel} - Foto ${counters[type]}`,
      nota: clean_(image.Nota),
      blob: blob,
    });
  });

  const order = {
    ANTES: 0,
    DESPUES: 1,
    OTRO: 2,
  };

  return collected.sort(function (left, right) {
    return (
      order[left.type] - order[right.type]
      || left.order - right.order
    );
  });
}

function normalizeMaintenanceSlideImageType_(value) {
  const normalized = clean_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (
    normalized.indexOf('antes') !== -1
    || normalized === 'before'
  ) {
    return 'ANTES';
  }

  if (
    normalized.indexOf('despues') !== -1
    || normalized === 'after'
  ) {
    return 'DESPUES';
  }

  return 'OTRO';
}

function chunkMaintenanceSlidesArray_(
  items,
  size,
) {
  const chunks = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    chunks.push(
      items.slice(index, index + size),
    );
  }

  return chunks;
}

/**
 * Ajusta una fotografía dentro de su caja sin deformarla.
 */
function fitMaintenanceSlideImageToBox_(
  image,
  x,
  y,
  boxWidth,
  boxHeight,
) {
  const originalWidth = image.getWidth();
  const originalHeight = image.getHeight();

  if (!originalWidth || !originalHeight) {
    return;
  }

  const scale = Math.min(
    boxWidth / originalWidth,
    boxHeight / originalHeight,
  );
  const width = originalWidth * scale;
  const height = originalHeight * scale;

  image.setWidth(width);
  image.setHeight(height);
  image.setLeft(
    x + ((boxWidth - width) / 2),
  );
  image.setTop(
    y + ((boxHeight - height) / 2),
  );
}

/**
 * Busca la carpeta ya creada para el dispositivo.
 *
 * Estructura actual:
 * mantenimiento -> Zonas -> zona -> tipo de dispositivo -> dispositivo.
 *
 * También conserva compatibilidad con:
 * mantenimiento -> zona -> categoría -> dispositivo.
 */
function findMaintenanceDeviceFolderUrl_(
  maintenance,
  device,
) {
  const maintenanceFolderId = clean_(
    maintenance.CarpetaDriveID,
  );

  if (!maintenanceFolderId) {
    return '';
  }

  try {
    const maintenanceFolder = DriveApp.getFolderById(
      maintenanceFolderId,
    );

    /*
     * Estructura nueva del expediente:
     * Mantenimiento -> Zonas -> Zona -> Tipo de dispositivo -> Dispositivo.
     *
     * Si el mantenimiento fue creado por una versión anterior, se conserva
     * compatibilidad buscando la zona directamente en la carpeta raíz.
     */
    const zonesRoot = findMaintenanceSlidesSubfolder_(
      maintenanceFolder,
      'Zonas',
    ) || maintenanceFolder;

    const zoneFolder = findMaintenanceSlidesSubfolder_(
      zonesRoot,
      clean_(device.Zona, 'Zona sin nombre'),
    );

    if (!zoneFolder) {
      return '';
    }

    const typeFolder = findMaintenanceSlidesSubfolder_(
      zoneFolder,
      clean_(
        device.TipoDispositivo
        || device.Categoria,
        'Tipo de dispositivo sin nombre',
      ),
    ) || findMaintenanceSlidesSubfolder_(
      zoneFolder,
      clean_(
        device.Categoria
        || device.TipoDispositivo,
        'Categoría sin nombre',
      ),
    );

    if (!typeFolder) {
      return '';
    }

    const deviceFolder = findMaintenanceSlidesSubfolder_(
      typeFolder,
      clean_(
        device.NombreDispositivo
        || device.EvidenciaMantenimientoID,
        'Dispositivo',
      ),
    );

    return deviceFolder
      ? deviceFolder.getUrl()
      : '';
  } catch (error) {
    console.warn(
      `No se pudo localizar la carpeta del dispositivo: ${error.message}`,
    );
    return '';
  }
}

function findMaintenanceSlidesSubfolder_(
  parentFolder,
  name,
) {
  const safeFolderName = safeName_(name);
  let folders = parentFolder.getFoldersByName(
    safeFolderName,
  );

  if (folders.hasNext()) {
    return folders.next();
  }

  const wanted = safeFolderName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  folders = parentFolder.getFolders();

  while (folders.hasNext()) {
    const folder = folders.next();
    const current = folder.getName()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (current === wanted) {
      return folder;
    }
  }

  return null;
}

/**
 * Mueve un archivo a la carpeta indicada.
 */
function moveFileToFolder_(
  file,
  folder,
) {
  try {
    file.moveTo(folder);
    return;
  } catch (moveError) {
    console.warn(
      `moveTo no funcionó; se intentará el método compatible: ${moveError.message}`,
    );
  }

  try {
    folder.addFile(file);

    const parents = file.getParents();

    while (parents.hasNext()) {
      const parent = parents.next();

      if (parent.getId() !== folder.getId()) {
        parent.removeFile(file);
      }
    }
  } catch (error) {
    throw new Error(
      `No fue posible mover la presentación a la carpeta configurada: ${error.message}`,
    );
  }
}

/**
 * Limpia trabajos pendientes de presentaciones.
 */
function limpiarJobsPresentacionesMantenimiento() {
  const properties = PropertiesService
    .getScriptProperties();
  const all = properties.getProperties();

  Object.keys(all).forEach(function (key) {
    if (
      key.indexOf(
        MAINTENANCE_SLIDES_PROPERTY_PREFIX,
      ) !== 0
    ) {
      return;
    }

    try {
      DriveApp
        .getFileById(all[key])
        .setTrashed(true);
    } catch (_) {
      // El archivo temporal puede haber sido eliminado manualmente.
    }

    properties.deleteProperty(key);
  });

  properties.deleteProperty(
    MAINTENANCE_SLIDES_WORKER_LEASE_PROPERTY,
  );

  deleteMaintenanceSlidesWorker_();

  return 'Trabajos de presentaciones eliminados.';
}




/**
 * Guarda una evidencia de un caso utilizando la identidad del propietario de
 * la implementación del Web App. La implementación debe estar configurada
 * como "Ejecutar como yo" desde la cuenta propietaria de la implementación.
 */
function uploadCustomerCaseEvidence_(payload) {
  if (payload.evidence && payload.evidence.uploadedFileId) return adoptCustomerCaseResumable_(payload);
  const caseData = payload.case || payload.caseData || {};
  const evidence = payload.evidence || payload.evidencia || {};
  const caseId = clean_(caseData.CasoID || caseData.caseId);
  const caseNumber = clean_(caseData.CasoNumero || caseData.caseNumber, caseId);
  const client = clean_(caseData.Cliente || caseData.ClienteNombre, 'Cliente');
  const reason = clean_(caseData.RazonVisita || caseData.Caso, 'Solicitud técnica');
  const fileName = clean_(evidence.fileName || evidence.name, 'evidencia.jpg');
  const mimeType = clean_(evidence.mimeType || evidence.type, 'image/jpeg').toLowerCase();
  const encoded = normalizeCustomerCaseBase64_(evidence.base64 || evidence.dataUrl);

  if (!caseId) throw new Error('La evidencia no incluye CasoID.');
  if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(mimeType)) {
    throw new Error(`El archivo ${fileName} no es una imagen permitida.`);
  }
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error(`El archivo ${fileName} no contiene Base64 válido.`);
  }

  const bytes = Utilities.base64Decode(encoded);
  if (!bytes.length) throw new Error(`El archivo ${fileName} está vacío.`);
  if (bytes.length > CUSTOMER_CASE_EVIDENCE_MAX_BYTES) {
    throw new Error(`El archivo ${fileName} supera el límite de 6 MB.`);
  }

  const testMode = customerCaseBoolean_(
    payload.testMode || caseData.ModoPrueba || caseData.EsPrueba,
  );
  const root = customerCaseEvidenceRootFolder_(testMode);
  const clientFolder = getOrCreateFolder_(root, client);
  const caseFolder = getOrCreateFolder_(
    clientFolder,
    `${caseNumber} - ${reason}`,
  );
  const index = Math.max(1, Number(evidence.index || payload.index || 1));
  const storedName = `${String(index).padStart(2, '0')} - ${safeName_(fileName)}`;
  const blob = Utilities.newBlob(bytes, mimeType, storedName);
  const file = caseFolder.createFile(blob);
  // No se comparten automáticamente carpetas ni archivos. Compartir cada
  // elemento genera una notificación de Drive por evidencia y ralentiza el
  // formulario. El backend y los correos leen las imágenes a través de este
  // mismo Web App, por lo que no necesitan permisos directos sobre Drive.
  //
  // Tampoco se consulta Session.getEffectiveUser(): ese método requiere el
  // alcance userinfo.email y puede interrumpir la carga aun cuando el archivo
  // ya fue creado correctamente.
  const ownerEmail = clean_(
    PropertiesService.getScriptProperties().getProperty('DRIVE_OWNER_EMAIL'),
    'PROPIETARIO_APPS_SCRIPT',
  );

  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
    size: bytes.length,
    webViewLink: file.getUrl(),
    url: file.getUrl(),
    folderId: caseFolder.getId(),
    folderUrl: caseFolder.getUrl(),
    ownerEmail: ownerEmail,
    testMode: testMode,
    storage: 'APPS_SCRIPT_DRIVE',
    fingerprint: clean_(evidence.fingerprint),
    scriptVersion: APPS_SCRIPT_VERSION,
  };
}

/**
 * Lee una evidencia creada por Apps Script para mostrarla dentro del APP sin
 * depender de los permisos de la cuenta de servicio del backend.
 */
function getCustomerCaseEvidence_(payload) {
  const fileId = extractFileId_(payload.fileId || payload.DriveFileID);
  if (!fileId) throw new Error('No se indicó un archivo de evidencia válido.');
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  const mimeType = clean_(blob.getContentType() || payload.mimeType, 'image/jpeg');
  const base64 = Utilities.base64Encode(bytes);

  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
    size: bytes.length,
    base64: base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
    url: file.getUrl(),
    webViewLink: file.getUrl(),
    scriptVersion: APPS_SCRIPT_VERSION,
  };
}

function normalizeCustomerCaseBase64_(value) {
  const text = clean_(value).replace(/[\r\n\s]/g, '');
  const comma = text.indexOf(',');
  return comma >= 0 && text.substring(0, comma).indexOf('base64') !== -1
    ? text.substring(comma + 1)
    : text;
}

function customerCaseBoolean_(value) {
  if (value === true) return true;
  return ['1', 'true', 'si', 'sí', 'yes', 'prueba'].indexOf(
    clean_(value).toLowerCase(),
  ) !== -1;
}

function customerCaseEvidenceRootFolder_(testMode) {
  const configuredId = clean_(
    PropertiesService.getScriptProperties().getProperty(
      'CUSTOMER_CASES_FOLDER_ID',
    ),
  );
  let root;

  if (configuredId) {
    root = DriveApp.getFolderById(configuredId);
  } else {
    root = getOrCreateFolder_(
      DriveApp.getRootFolder(),
      'Casos de clientes DMS',
    );
  }

  return testMode
    ? getOrCreateFolder_(root, 'PRUEBAS')
    : root;
}

/**
 * Envía a coordinación el correo inicial de un caso creado por un cliente.
 *
 * Gemini redacta el asunto y el cuerpo en el backend. Apps Script se encarga
 * exclusivamente de validar destinatarios, leer evidencias de Drive y enviar
 * el correo mediante MailApp.
 */
function sendCustomerCaseCreatedEmail_(payload) {
  return sendCustomerCaseEmail_(
    payload,
    'CREATED',
  );
}

/**
 * Envía a los técnicos el correo de asignación de un caso.
 */
function sendCustomerCaseAssignedEmail_(payload) {
  return sendCustomerCaseEmail_(
    payload,
    'ASSIGNED',
  );
}

/**
 * Envía un correo del módulo de casos con adjuntos directos.
 */
function sendCustomerCaseEmail_(
  payload,
  deliveryType,
) {
  const caseData = payload.case
    || payload.caseData
    || {};
  const message = payload.message
    || {};
  const evidences = Array.isArray(payload.evidences)
    ? payload.evidences
    : Array.isArray(payload.evidencias)
      ? payload.evidencias
      : [];
  const technicians = Array.isArray(payload.technicians)
    ? payload.technicians
    : Array.isArray(payload.tecnicos)
      ? payload.tecnicos
      : [];
  const recipients = payload.recipients
    || {};

  const caseId = clean_(
    caseData.CasoID
    || caseData.caseId,
  );
  const caseNumber = clean_(
    caseData.CasoNumero
    || caseData.caseNumber,
    caseId || 'Caso sin número',
  );
  const client = clean_(
    caseData.Cliente
    || caseData.ClienteNombre,
    'Cliente sin especificar',
  );
  const reason = clean_(
    caseData.RazonVisita
    || caseData.RazónVisita
    || caseData.Caso
    || caseData.case,
    'Solicitud técnica',
  );
  const problem = clean_(
    caseData.Problema
    || caseData.Descripcion
    || caseData.Descripción,
    'Sin descripción del problema.',
  );
  const assignedDelivery = deliveryType === 'ASSIGNED';
  const testMode = customerCaseBoolean_(
    payload.testMode || caseData.ModoPrueba || caseData.EsPrueba,
  );

  if (!caseId) {
    throw new Error(
      'El correo del caso no incluye CasoID.',
    );
  }

  const assignedRecipients = assignedDelivery
    ? technicians.map(function (technician) {
      return technician.Correo
        || technician.correo
        || technician.Email
        || technician.email;
    })
    : [];
  const requestedRecipients = customerCaseEmailValues_(recipients.to);

  const to = uniqueEmails_(
    requestedRecipients.concat(
      customerCaseEmailValues_(assignedRecipients),
    ),
  );
  const cc = uniqueEmails_(
    customerCaseEmailValues_(
      recipients.cc,
    ),
  ).filter(function (email) {
    return to.indexOf(email) === -1;
  });

  if (!to.length) {
    throw new Error(
      assignedDelivery
        ? 'Los técnicos asignados no tienen correos válidos.'
        : 'No hay destinatarios válidos para notificar el nuevo caso.',
    );
  }

  const generatedSubject = clean_(
    message.subject
    || payload.subject,
  );
  const generatedBody = clean_(
    message.body
    || payload.body,
  );
  const fallbackSubject = assignedDelivery
    ? `[ASIGNACIÓN ${caseNumber}] ${reason} - ${client}`
    : `[NUEVO CASO ${caseNumber}] ${reason} - ${client}`;
  const fallbackBody = assignedDelivery
    ? [
      `Se asignó el caso ${caseNumber} del cliente ${client}.`,
      `Razón de la visita: ${reason}.`,
      `Problema reportado: ${problem}.`,
      'Revise la boleta y las evidencias antes de realizar la visita.',
    ].join('\n')
    : [
      `Se recibió el caso ${caseNumber} del cliente ${client}.`,
      `Razón de la visita: ${reason}.`,
      `Problema reportado: ${problem}.`,
      'El caso ya fue creado en el APP de boletas.',
    ].join('\n');

  const rawSubject = generatedSubject
    || fallbackSubject;
  const subject = testMode && rawSubject.indexOf('[PRUEBA]') !== 0
    ? `[PRUEBA] ${rawSubject}`
    : rawSubject;
  const rawBody = generatedBody
    || fallbackBody;
  const body = testMode
    ? [
      'MODO DE PRUEBA DMS',
      'Este mensaje forma parte de una validación controlada.',
      '',
      rawBody,
    ].join('\n')
    : rawBody;
  const ticketUrl = safeWebUrl_(
    payload.ticketUrl
    || caseData.BoletaURL
    || caseData.TicketURL,
  );
  const folderUrl = safeWebUrl_(
    caseData.CarpetaDriveURL
    || caseData.FolderURL,
  );

  const evidenceParts = buildDirectEvidenceAttachments_(
    evidences,
  );
  const htmlBody = buildCustomerCaseEmailHtml_({
    deliveryType: deliveryType,
    caseData: caseData,
    caseId: caseId,
    caseNumber: caseNumber,
    client: client,
    reason: reason,
    problem: problem,
    generatedBody: body,
    technicians: technicians,
    evidenceRows: evidenceParts.rows,
    ticketUrl: ticketUrl,
    folderUrl: folderUrl,
  });
  const plainBody = buildCustomerCaseEmailPlainText_({
    deliveryType: deliveryType,
    caseData: caseData,
    caseId: caseId,
    caseNumber: caseNumber,
    client: client,
    reason: reason,
    problem: problem,
    generatedBody: body,
    technicians: technicians,
    evidenceCount: evidences.length,
    testMode: testMode,
    ticketUrl: ticketUrl,
    folderUrl: folderUrl,
  });

  const delivery = sendDirectAttachmentEmails_({
    to: to,
    cc: cc,
    subject: subject.substring(0, 180),
    body: plainBody,
    htmlBody: htmlBody,
    attachments: evidenceParts.attachments,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    action: assignedDelivery
      ? CUSTOMER_CASE_ASSIGNED_ACTION
      : CUSTOMER_CASE_CREATED_ACTION,
    deliveryType: deliveryType,
    caseId: caseId,
    caseNumber: caseNumber,
    to: to,
    cc: cc,
    messageCount: delivery.messageCount,
    attachmentCount: evidenceParts.attachments.length,
    evidenceCount: evidences.length,
    ticketUrl: ticketUrl,
    scriptVersion: APPS_SCRIPT_VERSION,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Convierte una entrada de correos a una lista compatible.
 */
function customerCaseEmailValues_(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value || '')
    .split(/[;,]/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

/**
 * Devuelve el nombre visible de los técnicos asignados.
 */
function customerCaseTechnicianNames_(technicians) {
  return (Array.isArray(technicians) ? technicians : [])
    .map(function (technician) {
      return clean_(
        technician.Nombre
        || technician.NombreCompleto
        || technician.NombreUsuario
        || technician.Correo,
      );
    })
    .filter(Boolean);
}

/**
 * Construye el texto plano del correo de un caso.
 */
function buildCustomerCaseEmailPlainText_(data) {
  const assignedDelivery = data.deliveryType === 'ASSIGNED';
  const requesterName = clean_(
    data.caseData.NombreSolicitante,
    'Sin especificar',
  );
  const requesterEmail = clean_(
    data.caseData.CorreoSolicitante,
    'Sin especificar',
  );
  const technicianNames = customerCaseTechnicianNames_(
    data.technicians,
  );
  const visitDate = clean_(
    data.caseData.FechaVisita,
  );
  const visitTime = clean_(
    data.caseData.HoraVisita,
  );
  const administratorMessage = clean_(
    data.caseData.MensajeAdministrador,
  );

  const lines = [
    data.generatedBody,
    '',
    assignedDelivery
      ? 'DATOS DE LA ASIGNACIÓN'
      : 'DATOS DEL CASO CREADO',
    `Caso: ${data.caseNumber}`,
    `Cliente: ${data.client}`,
    `Generado por: ${requesterName}`,
    `Correo del solicitante: ${requesterEmail}`,
    `Razón de la visita: ${data.reason}`,
    `Problema reportado: ${data.problem}`,
  ];

  if (assignedDelivery) {
    lines.push(
      `Técnicos asignados: ${
        technicianNames.length
          ? technicianNames.join(', ')
          : 'Sin especificar'
      }`,
      `Fecha de visita: ${visitDate || 'Sin especificar'}`,
      `Hora de visita: ${visitTime || 'Sin especificar'}`,
    );

    if (administratorMessage) {
      lines.push(
        `Mensaje del administrador: ${administratorMessage}`,
      );
    }

    if (data.ticketUrl) {
      lines.push(
        `Boleta en DMS: ${data.ticketUrl}`,
      );
    }
  } else {
    lines.push(
      '',
      'El caso ya fue creado en el APP de boletas y quedó en espera de revisión.',
    );
  }

  lines.push(
    `Evidencias adjuntas: ${data.evidenceCount}`,
  );

  if (data.folderUrl) {
    lines.push(
      `Carpeta de evidencias: ${data.folderUrl}`,
    );
  }

  lines.push(
    '',
    'Este mensaje fue generado automáticamente por DMS Boletas.',
  );

  return lines.join('\n');
}

/**
 * Construye el correo HTML del módulo de casos.
 */
function buildCustomerCaseEmailHtml_(data) {
  const assignedDelivery = data.deliveryType === 'ASSIGNED';
  const requesterName = clean_(
    data.caseData.NombreSolicitante,
    'Sin especificar',
  );
  const requesterEmail = clean_(
    data.caseData.CorreoSolicitante,
    'Sin especificar',
  );
  const technicianNames = customerCaseTechnicianNames_(
    data.technicians,
  );
  const visitDate = clean_(
    data.caseData.FechaVisita,
  );
  const visitTime = clean_(
    data.caseData.HoraVisita,
  );
  const administratorMessage = clean_(
    data.caseData.MensajeAdministrador,
  );
  const ticketNumber = clean_(
    data.caseData.BoletaID
    || data.caseData.BoletaUID,
  );

  const rows = [
    customerCaseTableRowHtml_(
      'Caso',
      data.caseNumber,
    ),
    customerCaseTableRowHtml_(
      'Cliente',
      data.client,
    ),
    customerCaseTableRowHtml_(
      'Generado por',
      requesterName,
    ),
    customerCaseTableRowHtml_(
      'Correo del solicitante',
      requesterEmail,
    ),
    customerCaseTableRowHtml_(
      'Razón de la visita',
      data.reason,
    ),
    customerCaseTableRowHtml_(
      'Problema reportado',
      data.problem,
    ),
  ];

  if (assignedDelivery) {
    rows.push(
      customerCaseTableRowHtml_(
        'Técnicos asignados',
        technicianNames.length
          ? technicianNames.join(', ')
          : 'Sin especificar',
      ),
      customerCaseTableRowHtml_(
        'Fecha programada',
        visitDate || 'Sin especificar',
      ),
      customerCaseTableRowHtml_(
        'Hora programada',
        visitTime || 'Sin especificar',
      ),
      customerCaseTableRowHtml_(
        'Boleta',
        ticketNumber || 'Pendiente',
      ),
    );

    if (administratorMessage) {
      rows.push(
        customerCaseTableRowHtml_(
          'Mensaje del administrador',
          administratorMessage,
        ),
      );
    }
  }

  const evidenceHtml = data.evidenceRows.length
    ? data.evidenceRows.map(function (evidence, index) {
      const driveUrl = safeWebUrl_(
        evidence.url,
      );
      const driveButton = driveUrl
        ? buttonHtml_(
          driveUrl,
          'Abrir en Drive',
          '#ffffff',
          BRAND_RED,
        )
        : '';

      return [
        `<div style="margin:12px 0;padding:14px;border:1px solid ${BRAND_BORDER};border-radius:12px;background:#ffffff">`,
        `<strong style="color:${BRAND_TEXT}">${index + 1}. ${escapeHtml_(evidence.name)}</strong>`,
        evidence.note
          ? `<p style="margin:8px 0;line-height:1.5">${nl2br_(evidence.note)}</p>`
          : '',
        '<p style="margin:8px 0 0;color:#145c35;font-size:13px"><strong>Adjunto directamente al correo.</strong></p>',
        driveButton,
        '</div>',
      ].join('');
    }).join('')
    : '<p style="margin:0;color:#6b7280">El cliente no adjuntó evidencias.</p>';

  const ticketButton = assignedDelivery && data.ticketUrl
    ? buttonHtml_(
      data.ticketUrl,
      'Abrir boleta en DMS',
      BRAND_RED,
    )
    : '';

  const folderButton = data.folderUrl
    ? buttonHtml_(
      data.folderUrl,
      'Abrir carpeta de evidencias',
      '#ffffff',
      BRAND_RED,
    )
    : '';

  const statusNotice = assignedDelivery
    ? [
      '<div style="margin:20px 0;padding:15px;border:1px solid #9fd5b6;border-radius:12px;background:#effaf4;color:#145c35">',
      '<strong>Asignación confirmada:</strong> el caso está en proceso y la boleta ya fue creada en DMS Boletas.',
      '</div>',
    ].join('')
    : [
      '<div style="margin:20px 0;padding:15px;border:1px solid #9fd5b6;border-radius:12px;background:#effaf4;color:#145c35">',
      '<strong>Caso registrado:</strong> el caso ya fue creado en el APP de boletas y quedó en espera de revisión.',
      '</div>',
    ].join('');

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>',
    '@media only screen and (max-width:620px){',
    '.dms-case-shell{width:100%!important;border-radius:0!important}',
    '.dms-case-content{padding:18px 10px!important}',
    '.dms-case-table th,.dms-case-table td{display:block!important;width:auto!important}',
    '.dms-case-table th{border-bottom:0!important}',
    '.dms-case-actions a{display:block!important;margin:8px 0!important}',
    '}',
    '</style>',
    '</head>',
    `<body style="margin:0;padding:20px 8px;background:${BRAND_BACKGROUND};font-family:Arial,sans-serif;color:${BRAND_TEXT}">`,
    `<div class="dms-case-shell" style="max-width:860px;margin:auto;border:1px solid ${BRAND_BORDER};border-radius:16px;overflow:hidden;background:#ffffff;box-shadow:0 8px 28px rgba(76,12,17,.08)">`,
    `<div style="background:${BRAND_RED};color:#ffffff;padding:24px 20px">`,
    `<h1 style="margin:0;font-size:25px">${
      assignedDelivery
        ? 'Caso asignado para visita'
        : 'Nuevo caso de cliente'
    }</h1>`,
    `<p style="margin:9px 0 0">Caso ${escapeHtml_(data.caseNumber)} · ${escapeHtml_(data.client)}</p>`,
    '</div>',
    '<div class="dms-case-content" style="padding:28px 22px">',
    `<div style="line-height:1.6">${nl2br_(data.generatedBody)}</div>`,
    statusNotice,
    `<table class="dms-case-table" style="width:100%;border-collapse:collapse;margin:20px 0">${rows.join('')}</table>`,
    `<div class="dms-case-actions" style="margin:22px 0;text-align:center">${ticketButton}${folderButton}</div>`,
    '<h2 style="margin:28px 0 12px;font-size:20px">Evidencias del caso</h2>',
    evidenceHtml,
    `<div style="margin-top:30px;padding-top:18px;border-top:1px solid ${BRAND_BORDER};color:${BRAND_MUTED};font-size:12px;line-height:1.5">Este mensaje fue generado automáticamente por DMS Boletas. Las evidencias se incluyen como adjuntos directos.</div>`,
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');
}

/**
 * Crea una fila segura para la tabla de detalles del caso.
 */
function customerCaseTableRowHtml_(
  label,
  value,
) {
  return [
    '<tr>',
    `<th style="width:29%;padding:10px;border:1px solid ${BRAND_BORDER};background:#f8f4f4;text-align:left;vertical-align:top;color:${BRAND_TEXT}">${escapeHtml_(label)}</th>`,
    `<td style="padding:10px;border:1px solid ${BRAND_BORDER};vertical-align:top;color:${BRAND_TEXT};overflow-wrap:anywhere">${nl2br_(clean_(value, 'Sin especificar'))}</td>`,
    '</tr>',
  ].join('');
}

/**
 * Envía las credenciales temporales de un usuario.
 */
function sendTemporaryCredentials_(payload) {
  const user = payload.user || {};
  const email = clean_(
    user.correo || user.Correo,
  ).toLowerCase();
  const username = clean_(
    user.nombreUsuario || user.NombreUsuario,
  );
  const name = clean_(
    user.nombre || user.Nombre || user.NombreCompleto,
    username || 'Usuario',
  );
  const temporaryPassword = String(
    payload.temporaryPassword || '',
  );

  const credentialType = clean_(
    payload.credentialType
      || (payload.isPasswordReset ? 'PASSWORD_RESET' : 'INVITATION'),
    'INVITATION',
  ).toUpperCase();

  const isPasswordReset = credentialType === 'PASSWORD_RESET';

  const propertyAppUrl = PropertiesService
    .getScriptProperties()
    .getProperty('APP_PUBLIC_URL');

  const appUrl = safeWebUrl_(
    payload.appUrl || propertyAppUrl,
  );

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('El usuario no tiene un correo válido.');
  }

  if (!username) {
    throw new Error('Falta el nombre de usuario.');
  }

  if (!temporaryPassword) {
    throw new Error('Falta la contraseña temporal.');
  }

  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error(
      'La cuota diaria de correo de Apps Script se agotó.',
    );
  }

  const subject = isPasswordReset
    ? 'Tu contraseña de DMS Boletas fue restablecida'
    : 'Tu acceso temporal a DMS Boletas';

  const introText = isPasswordReset
    ? 'Un administrador restableció la contraseña de tu cuenta en DMS Boletas.'
    : 'Se creó una cuenta para ti en DMS Boletas.';

  const securityText = isPasswordReset
    ? 'Las sesiones anteriores fueron cerradas. Por seguridad, debes cambiar esta contraseña temporal al iniciar sesión.'
    : 'Por seguridad, debes cambiar la contraseña al iniciar sesión por primera vez.';

  const headerSubtitle = isPasswordReset
    ? 'Contraseña restablecida'
    : 'Acceso temporal';

  const plainLink = appUrl
    || 'El enlace será compartido posteriormente por el administrador.';

  const body = [
    `Hola ${name},`,
    '',
    introText,
    `Usuario: ${username}`,
    `Contraseña temporal: ${temporaryPassword}`,
    `Aplicación: ${plainLink}`,
    '',
    securityText,
  ].join('\n');

  const linkHtml = appUrl
    ? buttonHtml_(
      appUrl,
      'Abrir DMS Boletas',
      BRAND_RED,
    )
    : '<p>El enlace será compartido posteriormente por el administrador.</p>';

  const htmlBody = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '</head>',
    `<body style="margin:0;padding:20px;background:${BRAND_BACKGROUND};font-family:Arial,sans-serif;color:${BRAND_TEXT}">`,
    `<div style="max-width:620px;margin:auto;border:1px solid ${BRAND_BORDER};border-radius:16px;overflow:hidden;background:#ffffff">`,
    `<div style="background:${BRAND_RED};color:#ffffff;padding:22px">`,
    '<h1 style="margin:0;font-size:24px">DMS Boletas</h1>',
    `<p style="margin:7px 0 0;opacity:.9">${escapeHtml_(headerSubtitle)}</p>`,
    '</div>',
    '<div style="padding:28px 22px">',
    `<p>Hola ${escapeHtml_(name)},</p>`,
    `<p>${escapeHtml_(introText)}</p>`,
    '<div style="background:#f8f4f4;border:1px solid #ead5d7;border-radius:12px;padding:17px;margin:20px 0">',
    `<p style="margin:0 0 10px"><strong>Usuario:</strong> ${escapeHtml_(username)}</p>`,
    `<p style="margin:0"><strong>Contraseña temporal:</strong> <code style="font-size:15px">${escapeHtml_(temporaryPassword)}</code></p>`,
    '</div>',
    linkHtml,
    `<p><strong>${escapeHtml_(securityText)}</strong></p>`,
    `<p style="color:${BRAND_MUTED};font-size:12px;margin-top:28px">Este mensaje fue generado automáticamente por DMS Boletas.</p>`,
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  sendDmsEmail_({
    to: email,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    destination: email,
    credentialType: credentialType,
    passwordReset: isPasswordReset,
    linkConfigured: Boolean(appUrl),
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Envía el correo final de la boleta.
 */
function sendReportEmail_(data) {
  const to = uniqueEmails_(data.recipients.to || []);
  const cc = uniqueEmails_(data.recipients.cc || [])
    .filter(function (email) {
      return to.indexOf(email) === -1;
    });

  if (!to.length) {
    throw new Error(
      'No hay destinatarios válidos para enviar el reporte.',
    );
  }

  const ticket = data.ticket;
  const surveyUrl = safeWebUrl_(data.surveyUrl);
  const signatureUrl = safeWebUrl_(data.signatureUrl);
  const signedDelivery = clean_(data.deliveryType).toUpperCase() === 'SIGNED';
  const evidenceParts = buildDirectEvidenceAttachments_(data.evidences);
  const attachments = [data.pdfBlob].concat(evidenceParts.attachments);

  const assignedNames = data.assigned
    .map(function (item) {
      return clean_(
        item.Nombre
        || item.NombreCompleto
        || item.NombreUsuario,
      );
    })
    .filter(Boolean)
    .join(', ');

  const creatorText = data.creator
    ? [
      escapeHtml_(
        data.creator.Nombre
        || data.creator.NombreUsuario
        || '',
      ),
      data.creator.Correo
        ? escapeHtml_(data.creator.Correo)
        : '',
    ].filter(Boolean).join(' · ')
    : 'Sin especificar';

  const subject = [
    data.testMode ? '[PRUEBA]' : '',
    signedDelivery ? '[BOLETA FIRMADA]' : '',
    'Reporte técnico',
    `Boleta #${ticket.BoletaID || ticket.BoletaUID}`,
    ticket.Cliente || '',
  ].filter(Boolean).join(' - ');

  const htmlBody = buildEmailHtml_({
    ticket: ticket,
    assignedNames: assignedNames,
    creatorText: creatorText,
    evidenceRows: evidenceParts.rows,
    testMode: data.testMode,
    pdfUrl: data.pdfUrl,
    documentUrl: data.documentUrl,
    folderUrl: data.folderUrl,
    surveyUrl: surveyUrl,
    signatureUrl: signatureUrl,
    signedDelivery: signedDelivery,
    directAttachments: true,
  });

  const plainBody = buildEmailPlainText_({
    ticket: ticket,
    testMode: data.testMode,
    pdfUrl: data.pdfUrl,
    documentUrl: data.documentUrl,
    folderUrl: data.folderUrl,
    surveyUrl: surveyUrl,
    signatureUrl: signatureUrl,
    signedDelivery: signedDelivery,
    directAttachments: true,
    attachmentCount: attachments.length,
  });

  const delivery = sendDirectAttachmentEmails_({
    to: to,
    cc: cc,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    attachments: attachments,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    to: to,
    cc: cc,
    messageCount: delivery.messageCount,
    attachmentCount: attachments.length,
    reportAttachmentCount: 1,
    evidenceAttachmentCount: evidenceParts.attachments.length,
    inlineImageCount: 0,
    allFilesAttachedDirectly: true,
    driveAccessRequired: false,
    surveyIncluded: Boolean(surveyUrl),
    surveyUrl: surveyUrl,
    signatureIncluded: Boolean(signatureUrl),
    signatureUrl: signatureUrl,
    signedDelivery: signedDelivery,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Construye el texto plano del correo.
 */
function buildEmailPlainText_(data) {
  const ticket = data.ticket;

  const lines = [
    data.signedDelivery
      ? 'Reporte técnico DMS - Boleta firmada por el cliente'
      : 'Reporte técnico DMS',
    `Boleta #${ticket.BoletaID || ticket.BoletaUID}`,
    `Cliente: ${ticket.Cliente || ''}`,
    `Título: ${ticket.Titulo || ''}`,
    '',
    'El PDF de la boleta y todas las evidencias disponibles se adjuntan directamente a este correo.',
    'No es necesario iniciar sesión en Google Drive ni solicitar permisos.',
  ];

  if (data.testMode) {
    lines.push(
      '',
      'MODO DE PRUEBA: esta ejecución no cambió el estado de la boleta.',
    );
  }

  if (data.signatureUrl) {
    lines.push(
      '',
      'La boleta todavía no cuenta con firma.',
      `Firmar boleta: ${data.signatureUrl}`,
      'Abra el enlace, dibuje la firma y presione Guardar firma.',
    );
  }

  if (data.signedDelivery) {
    lines.push(
      '',
      'La firma del cliente fue registrada correctamente.',
      'Este correo contiene la versión actualizada de la boleta con la firma incluida.',
    );
  }

  if (data.surveyUrl) {
    lines.push(
      '',
      data.testMode
        ? 'Esta es una encuesta de prueba para verificar el funcionamiento del enlace.'
        : 'Nos gustaría conocer su experiencia con el servicio recibido.',
      `${data.testMode ? 'Probar encuesta' : 'Responder encuesta'}: ${data.surveyUrl}`,
    );
  }

  return lines.join('\n');
}


/**
 * Obtiene todas las evidencias como adjuntos reales del correo.
 * No se usan enlaces de Drive como respaldo: si un archivo registrado no
 * puede leerse, el envío se detiene para no informar falsamente que fue adjunto.
 */
function buildDirectEvidenceAttachments_(evidences) {
  const attachments = [];
  const rows = [];
  const seen = {};

  (Array.isArray(evidences) ? evidences : []).forEach(function (evidence, index) {
    assertRequestBudget_(
      `preparar el adjunto ${index + 1}`,
      15000,
    );

    const name = clean_(
      evidence.Nombre || evidence.NombreArchivo,
      `Evidencia ${index + 1}`,
    );
    const note = clean_(evidence.Nota);
    const source = evidence.ArchivoID
      || evidence.ArchivoFileID
      || evidence.DriveFileID
      || evidence.ArchivoURL;
    const fileId = extractFileId_(source);

    if (!fileId) {
      throw new Error(
        `La evidencia "${name}" no contiene un archivo válido para adjuntar.`,
      );
    }

    if (seen[fileId]) return;

    const file = getDriveFileCached_(fileId);
    const blob = getDriveBlob_(fileId);

    if (!blob) {
      throw new Error(
        `No fue posible leer la evidencia "${name}" para adjuntarla al correo. Revise que la cuenta del Apps Script tenga acceso al archivo.`,
      );
    }

    const ticketNumber = clean_(evidence.BoletaID);
    const originalName = clean_(
      evidence.NombreArchivo || blob.getName(),
      name,
    );
    const attachmentName = [
      ticketNumber ? `Boleta ${ticketNumber}` : '',
      `Evidencia ${index + 1}`,
      originalName,
    ].filter(Boolean).join(' - ');

    let namedBlob = blob.copyBlob().setName(
      safeAttachmentName_(attachmentName),
    );

    /*
     * getSize() obtiene el tamaño desde metadatos de Drive y evita materializar
     * todos los bytes solo para medir el archivo.
     */
    let size = Number(file.getSize() || 0);

    if (!size) {
      size = blobSize_(namedBlob);
    } else {
      rememberBlobSize_(namedBlob, size);
    }

    if (size > MAX_EMAIL_BYTES) {
      const zipped = Utilities.zip(
        [namedBlob],
        `${safeAttachmentName_(attachmentName.replace(/\.[^.]+$/, ''))}.zip`,
      );
      const zippedSize = zipped.getBytes().length;
      rememberBlobSize_(zipped, zippedSize);

      if (zippedSize < size) {
        namedBlob = zipped;
        size = zippedSize;
      }
    }

    if (size > MAX_EMAIL_BYTES) {
      throw new Error(
        `La evidencia "${name}" supera el tamaño máximo permitido para un adjunto de correo. Reduzca el tamaño del archivo y vuelva a intentarlo.`,
      );
    }

    rememberBlobSize_(namedBlob, size);
    seen[fileId] = true;
    attachments.push(namedBlob);
    rows.push({
      name: name,
      note: note,
      attached: true,
      cid: '',
      url: safeWebUrl_(
        evidence.DriveURL
        || evidence.ArchivoURL,
      ),
    });
  });

  return {
    attachments: attachments,
    rows: rows,
  };
}

/**
 * Limpia el nombre de un adjunto sin eliminar su extensión.
 */
function safeAttachmentName_(value) {
  return clean_(value, 'Archivo')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .substring(0, 180);
}

/**
 * Divide los adjuntos en varios correos cuando el total supera el límite.
 * Así ninguna evidencia se reemplaza por un enlace privado de Drive.
 */
function splitDirectAttachmentBatches_(attachments) {
  const batches = [];
  let current = [];
  let currentBytes = 0;

  (attachments || []).forEach(function (blob) {
    if (!blob) return;
    const size = blobSize_(blob);
    if (size > MAX_EMAIL_BYTES) {
      throw new Error(
        `El archivo "${blob.getName()}" supera el tamaño máximo permitido para correo.`,
      );
    }

    if (current.length && currentBytes + size > MAX_EMAIL_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(blob);
    currentBytes += size;
  });

  if (current.length || !batches.length) batches.push(current);
  return batches;
}

/**
 * Envía uno o varios correos con todos los archivos adjuntos directamente.
 */
function sendDirectAttachmentEmails_(data) {
  const batches = splitDirectAttachmentBatches_(data.attachments || []);
  const recipientsPerMessage = data.to.length + data.cc.length;
  const requiredQuota = recipientsPerMessage * batches.length;

  if (MailApp.getRemainingDailyQuota() < requiredQuota) {
    throw new Error(
      `La cuota diaria de correo no alcanza para enviar ${batches.length} mensaje(s) con todos los adjuntos.`,
    );
  }

  batches.forEach(function (batch, index) {
    const multiple = batches.length > 1;
    const part = index + 1;
    const subject = multiple
      ? `${data.subject} - Archivos ${part}/${batches.length}`
      : data.subject;
    const body = index === 0
      ? data.body
      : [
        `Archivos adjuntos ${part} de ${batches.length}.`,
        'Este correo complementa el reporte enviado anteriormente.',
        'Los archivos se incluyen directamente y no requieren acceso a Google Drive.',
      ].join('\n');
    const htmlBody = index === 0
      ? data.htmlBody
      : buildDirectAttachmentContinuationHtml_(part, batches.length);

    sendDmsEmail_({
      to: data.to.join(','),
      cc: data.cc.join(',') || undefined,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: data.name || 'DMS Boletas',
      attachments: batch,
    });
  });

  return {
    messageCount: batches.length,
    attachmentCount: (data.attachments || []).length,
  };
}

function buildDirectAttachmentContinuationHtml_(part, total) {
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f7f3f3;font-family:Arial,sans-serif;color:#2f2526">',
    '<div style="max-width:680px;margin:auto;background:#fff;border:1px solid #ead5d7;border-radius:14px;overflow:hidden">',
    `<div style="padding:20px;background:${BRAND_RED};color:#fff"><h1 style="margin:0;font-size:22px">Archivos adjuntos ${part}/${total}</h1></div>`,
    '<div style="padding:24px;line-height:1.6">',
    '<p>Este correo complementa el reporte técnico enviado anteriormente.</p>',
    '<p><strong>Los archivos se encuentran adjuntos directamente.</strong> No necesita iniciar sesión en Google Drive ni solicitar permisos.</p>',
    '</div></div></body></html>',
  ].join('');
}

/**
 * Prepara adjuntos e imágenes incrustadas sin superar el límite.
 */
function buildEvidenceEmailParts_(evidences, startingBytes) {
  const attachments = [];
  const inlineImages = {};
  const rows = [];
  let bytes = Number(startingBytes || 0);

  evidences.forEach(function (evidence, index) {
    const name = clean_(
      evidence.Nombre || evidence.NombreArchivo,
      `Evidencia ${index + 1}`,
    );
    const note = clean_(evidence.Nota);
    const url = safeWebUrl_(evidence.ArchivoURL)
      || clean_(evidence.ArchivoURL);

    const blob = getDriveBlob_(
      evidence.ArchivoID
      || evidence.ArchivoFileID
      || evidence.DriveFileID
      || evidence.ArchivoURL,
    );

    let attached = false;
    let cid = '';

    if (blob) {
      const namedBlob = blob
        .copyBlob()
        .setName(
          clean_(
            evidence.NombreArchivo || blob.getName(),
            name,
          ),
        );

      const size = namedBlob.getBytes().length;
      const isImage = /^image\//i.test(
        namedBlob.getContentType(),
      );
      const extraInlineBytes = isImage && index < 8
        ? size
        : 0;

      if (
        bytes + size + extraInlineBytes
        <= MAX_EMAIL_BYTES
      ) {
        attachments.push(namedBlob);
        bytes += size;
        attached = true;

        if (isImage && index < 8) {
          cid = `evidence${index + 1}`;
          inlineImages[cid] = namedBlob;
          bytes += size;
        }
      }
    }

    rows.push({
      name: name,
      note: note,
      url: url,
      attached: attached,
      cid: cid,
    });
  });

  return {
    attachments: attachments,
    inlineImages: inlineImages,
    rows: rows,
  };
}

/**
 * Construye el correo HTML responsivo.
 */
function buildEmailHtml_(data) {
  const ticket = data.ticket;

  const rows = [
    ['Fecha', formatDate_(ticket.Fecha)],
    ['Cliente', ticket.Cliente],
    ['Categoría', ticket.Categoria],
    ['Tipo de falla', ticket.TipoFalla],
    ['Título', ticket.Titulo],
    ['Asignado a', data.assignedNames],
    ['Estado', data.testMode ? 'Prueba' : (data.signedDelivery ? 'Firmado por el cliente' : 'Finalizado')],
    ['Hora de inicio', ticket.HoraInicio],
    ['Hora de finalización', ticket.HoraFinal],
    ['Horas totales', formatHours_(ticket.HorasTotales)],
    ['Razón de visita', ticket.RazonVisita],
    ['Descripción', ticket.Descripcion],
    ['Pruebas realizadas', ticket.PruebasRealizadas],
    ['Resultado', ticket.Resultado],
    ['Recomendaciones', ticket.Recomendaciones],
    ['Creado por', data.creatorText],
  ].map(function (row) {
    return [
      '<tr>',
      `<th style="width:28%;padding:11px;border:1px solid ${BRAND_BORDER};background:#f8f4f4;text-align:left;vertical-align:top;color:${BRAND_TEXT}">${escapeHtml_(row[0])}</th>`,
      `<td style="padding:11px;border:1px solid ${BRAND_BORDER};vertical-align:top;color:${BRAND_TEXT};overflow-wrap:anywhere">${nl2br_(row[1])}</td>`,
      '</tr>',
    ].join('');
  }).join('');

  const evidenceHtml = data.evidenceRows.length
    ? data.evidenceRows.map(function (item, index) {
      const link = data.directAttachments
        ? '<span style="color:#145c35;font-weight:700">Archivo adjunto directamente</span>'
        : item.url
          ? `<a href="${escapeHtml_(item.url)}" style="color:${BRAND_RED};font-weight:700;text-decoration:none">Abrir en Drive</a>`
          : 'Sin enlace';

      const preview = item.cid
        ? `<img src="cid:${item.cid}" alt="${escapeHtml_(item.name)}" style="display:block;max-width:100%;height:auto;margin-top:12px;border-radius:10px;border:1px solid ${BRAND_BORDER}">`
        : '';

      return [
        `<div style="margin:16px 0;padding:15px;border:1px solid ${BRAND_BORDER};border-radius:12px;background:#ffffff">`,
        `<strong>${index + 1}. ${escapeHtml_(item.name)}</strong>`,
        item.note
          ? `<p style="line-height:1.55">${nl2br_(item.note)}</p>`
          : '',
        preview,
        `<p style="margin-bottom:0">${link}${item.attached ? ' · Adjunto al correo' : ''}</p>`,
        '</div>',
      ].join('');
    }).join('')
    : '<p>Sin evidencias asociadas.</p>';

  const signedNotice = data.signedDelivery
    ? [
      '<div style="margin:20px 0;padding:15px;background:#effaf4;border:1px solid #9fd5b6;border-radius:10px;color:#145c35">',
      '<strong>Firma registrada:</strong> esta es la versión actualizada de la boleta con la firma del cliente incluida.',
      '</div>',
    ].join('')
    : '';

  const testNotice = data.testMode
    ? [
      '<div style="margin:20px 0;padding:13px 15px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;color:#7c2d12">',
      '<strong>Modo de prueba:</strong> no se modificó el estado de la boleta. La encuesta incluida sirve únicamente para validar el flujo administrativo.',
      '</div>',
    ].join('')
    : '';

  const reportLinks = data.directAttachments
    ? [
      '<div style="padding:16px;border:1px solid #9fd5b6;border-radius:12px;background:#effaf4;color:#145c35;text-align:left">',
      '<strong>Archivos incluidos directamente:</strong> el PDF de la boleta y todas las evidencias están adjuntos a este correo. No necesita iniciar sesión en Google Drive ni solicitar permisos.',
      '</div>',
    ].join('')
    : [
      buttonHtml_(data.pdfUrl, 'Abrir PDF', BRAND_RED),
      buttonHtml_(data.documentUrl, 'Abrir documento', '#374151'),
      buttonHtml_(data.folderUrl, 'Abrir carpeta', '#ffffff', BRAND_RED),
    ].join('');

  const signatureBlock = data.signatureUrl
    ? [
      `<div style="margin:28px 0 6px;padding:24px 18px;border:1px solid #e8b9be;border-left:5px solid ${BRAND_RED};border-radius:14px;background:#fff7f7;text-align:center">`,
      `<div style="font-size:38px;line-height:1;margin-bottom:10px;color:${BRAND_RED}">✍</div>`,
      `<h2 style="margin:0;color:${BRAND_TEXT};font-size:22px">Firma pendiente</h2>`,
      `<p style="margin:10px auto 20px;max-width:560px;color:${BRAND_MUTED};line-height:1.55">Esta boleta todavía no cuenta con firma. Abra el enlace, firme dentro del recuadro y presione <strong>Guardar firma</strong>. Recibirá automáticamente la boleta actualizada.</p>`,
      buttonHtml_(
        data.signatureUrl,
        'Firmar boleta',
        BRAND_RED,
      ),
      `<p style="margin:15px 0 0;color:${BRAND_MUTED};font-size:12px;overflow-wrap:anywhere">También puede abrir este enlace:<br><a href="${escapeHtml_(data.signatureUrl)}" style="color:${BRAND_RED}">${escapeHtml_(data.signatureUrl)}</a></p>`,
      '</div>',
    ].join('')
    : '';

  const surveyBlock = data.surveyUrl
    ? [
      `<div style="margin:28px 0 6px;padding:24px 18px;border:1px solid ${BRAND_BORDER};border-left:5px solid ${BRAND_RED};border-radius:14px;background:#fff7f7;text-align:center">`,
      `<div style="font-size:38px;line-height:1;margin-bottom:10px;color:${BRAND_RED}">★</div>`,
      `<h2 style="margin:0;color:${BRAND_TEXT};font-size:22px">${data.testMode ? 'Encuesta de prueba' : '¿Cómo fue nuestro servicio?'}</h2>`,
      `<p style="margin:10px auto 20px;max-width:560px;color:${BRAND_MUTED};line-height:1.55">${data.testMode ? 'Utilice este enlace para comprobar la encuesta antes del envío real al cliente.' : 'Su opinión nos ayuda a mejorar. La encuesta toma menos de un minuto y está relacionada únicamente con esta boleta.'}</p>`,
      buttonHtml_(
        data.surveyUrl,
        data.testMode ? 'Probar encuesta' : 'Responder encuesta',
        BRAND_RED,
      ),
      `<p style="margin:15px 0 0;color:${BRAND_MUTED};font-size:12px;overflow-wrap:anywhere">También puede abrir este enlace:<br><a href="${escapeHtml_(data.surveyUrl)}" style="color:${BRAND_RED}">${escapeHtml_(data.surveyUrl)}</a></p>`,
      '</div>',
    ].join('')
    : '';

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>',
    '@media only screen and (max-width:620px){',
    '.dms-shell{width:100%!important;border-radius:0!important}',
    '.dms-content{padding:20px 12px!important}',
    '.dms-table th,.dms-table td{display:block!important;width:auto!important}',
    '.dms-table th{border-bottom:0!important}',
    '.dms-actions a{display:block!important;margin:8px 0!important}',
    '}',
    '</style>',
    '</head>',
    `<body style="margin:0;padding:20px 8px;background:${BRAND_BACKGROUND};font-family:Arial,sans-serif;color:${BRAND_TEXT}">`,
    `<div class="dms-shell" style="max-width:890px;margin:auto;border:1px solid ${BRAND_BORDER};border-radius:16px;overflow:hidden;background:#ffffff;box-shadow:0 8px 28px rgba(76,12,17,.08)">`,
    `<div style="background:${BRAND_RED};color:#ffffff;padding:22px 20px">`,
    '<h1 style="margin:0;font-size:25px">Reporte Técnico DMS</h1>',
    `<p style="margin:9px 0 0">Boleta #${escapeHtml_(ticket.BoletaID || ticket.BoletaUID)}</p>`,
    '</div>',
    '<div class="dms-content" style="padding:28px 20px">',
    '<p>Estimado/a,</p>',
    `<p style="line-height:1.6">${data.signedDelivery ? 'Adjunto encontrará la versión actualizada del reporte técnico con la firma del cliente incluida.' : 'Adjunto encontrará el reporte técnico correspondiente a la gestión realizada.'}</p>`,
    signedNotice,
    testNotice,
    `<table class="dms-table" style="width:100%;border-collapse:collapse;margin-top:20px">${rows}</table>`,
    `<div class="dms-actions" style="margin:22px 0 6px;text-align:center">${reportLinks}</div>`,
    signatureBlock,
    surveyBlock,
    '<h2 style="margin-top:30px">Evidencias fotográficas</h2>',
    evidenceHtml,
    `<div style="margin-top:30px;padding-top:18px;border-top:1px solid ${BRAND_BORDER};color:${BRAND_MUTED};font-size:12px;line-height:1.5">Este mensaje fue generado automáticamente por DMS Boletas. Los reportes y evidencias se incluyen como adjuntos directos para que el destinatario no necesite acceso a Google Drive.</div>`,
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');
}

/**
 * Genera un botón compatible con clientes de correo.
 */
function buttonHtml_(url, label, background, textColor) {
  const safeUrl = safeWebUrl_(url);
  if (!safeUrl) return '';

  const bg = background || BRAND_RED;
  const color = textColor || '#ffffff';

  return [
    `<a href="${escapeHtml_(safeUrl)}"`,
    ` style="display:inline-block;margin:6px 4px;background:${bg};color:${color};text-decoration:none;padding:13px 20px;border-radius:10px;border:1px solid ${BRAND_RED};font-weight:bold;line-height:1.2">`,
    escapeHtml_(label),
    '</a>',
  ].join('');
}

/**
 * Obtiene un archivo de Drive como Blob.
 */
function getDriveFileCached_(value) {
  const fileId = extractFileId_(value);
  if (!fileId) return null;

  if (REQUEST_DRIVE_FILE_CACHE_[fileId]) {
    return REQUEST_DRIVE_FILE_CACHE_[fileId];
  }

  const file = withTransientRetry_(
    `leer metadatos de Drive ${fileId}`,
    function () {
      return DriveApp.getFileById(fileId);
    },
  );

  REQUEST_DRIVE_FILE_CACHE_[fileId] = file;
  return file;
}

/**
 * Obtiene un archivo de Drive como Blob y lo reutiliza dentro de la ejecución.
 */
function getDriveBlob_(value) {
  const fileId = extractFileId_(value);
  if (!fileId) return null;

  if (REQUEST_DRIVE_BLOB_CACHE_[fileId]) {
    return REQUEST_DRIVE_BLOB_CACHE_[fileId];
  }

  try {
    const file = getDriveFileCached_(fileId);
    if (!file) return null;

    const blob = withTransientRetry_(
      `leer contenido de Drive ${fileId}`,
      function () {
        return file.getBlob();
      },
    );

    REQUEST_DRIVE_BLOB_CACHE_[fileId] = blob;

    const fileSize = Number(file.getSize() || 0);
    if (fileSize) rememberBlobSize_(blob, fileSize);

    return blob;
  } catch (error) {
    console.warn(
      `No fue posible leer el archivo ${fileId}: ${error.message}`,
    );
    return null;
  }
}

/**
 * Devuelve una imagen apropiada para incrustar en Docs/Slides.
 *
 * Para archivos grandes se intenta usar getThumbnail(), soportado por DriveApp.
 * El original NO se modifica ni se elimina y sigue siendo el archivo utilizado
 * cuando se adjunta al correo.
 */
function getDriveImageBlobForDocument_(value) {
  const fileId = extractFileId_(value);
  if (!fileId) return null;

  try {
    const file = getDriveFileCached_(fileId);
    if (!file) return null;

    const mimeType = clean_(file.getMimeType()).toLowerCase();
    const fileSize = Number(file.getSize() || 0);

    if (
      /^image\//i.test(mimeType)
      && fileSize > REPORT_EMBED_ORIGINAL_MAX_BYTES
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          REQUEST_DRIVE_THUMBNAIL_CACHE_,
          fileId,
        )
      ) {
        return REQUEST_DRIVE_THUMBNAIL_CACHE_[fileId]
          || getDriveBlob_(fileId);
      }

      const thumbnail = withTransientRetry_(
        `obtener miniatura de Drive ${fileId}`,
        function () {
          return file.getThumbnail();
        },
      );

      if (thumbnail) {
        const thumbnailSize = thumbnail.getBytes().length;

        if (thumbnailSize >= REPORT_EMBED_THUMBNAIL_MIN_BYTES) {
          REQUEST_DRIVE_THUMBNAIL_CACHE_[fileId] = thumbnail;
          rememberBlobSize_(thumbnail, thumbnailSize);

          console.log(
            `Evidencia ${fileId}: se incrusta miniatura de ${thumbnailSize} bytes `
            + `en lugar del original de ${fileSize} bytes.`,
          );

          return thumbnail;
        }
      }

      REQUEST_DRIVE_THUMBNAIL_CACHE_[fileId] = null;
    }

    return getDriveBlob_(fileId);
  } catch (error) {
    console.warn(
      `No fue posible preparar la imagen ${fileId}: ${error.message}`,
    );
    return getDriveBlob_(fileId);
  }
}

function getDriveFolderByIdWithRetry_(folderId) {
  return withTransientRetry_(
    `abrir carpeta de Drive ${folderId}`,
    function () {
      return DriveApp.getFolderById(folderId);
    },
  );
}

function exportDocumentPdfWithRetry_(
  documentId,
  pdfFileName,
) {
  assertRequestBudget_(
    'convertir el documento a PDF',
    25000,
  );

  return withTransientRetry_(
    'convertir el documento a PDF',
    function () {
      /*
       * Se obtiene una referencia nueva después de saveAndClose() para evitar
       * convertir una versión todavía asociada al objeto File anterior.
       */
      return DriveApp
        .getFileById(documentId)
        .getAs(MimeType.PDF)
        .setName(pdfFileName);
    },
    {
      attempts: 2,
      initialDelayMs: 700,
    },
  );
}

function rememberBlobSize_(blob, size) {
  if (!blob) return;

  for (
    let index = 0;
    index < REQUEST_BLOB_SIZE_CACHE_.length;
    index += 1
  ) {
    if (REQUEST_BLOB_SIZE_CACHE_[index].blob === blob) {
      REQUEST_BLOB_SIZE_CACHE_[index].size = Number(size || 0);
      return;
    }
  }

  REQUEST_BLOB_SIZE_CACHE_.push({
    blob: blob,
    size: Number(size || 0),
  });
}

function blobSize_(blob) {
  if (!blob) return 0;

  for (
    let index = 0;
    index < REQUEST_BLOB_SIZE_CACHE_.length;
    index += 1
  ) {
    if (REQUEST_BLOB_SIZE_CACHE_[index].blob === blob) {
      return Number(
        REQUEST_BLOB_SIZE_CACHE_[index].size || 0,
      );
    }
  }

  const size = blob.getBytes().length;
  rememberBlobSize_(blob, size);
  return size;
}

/**
 * Extrae un ID de Drive desde un ID o URL.
 */
function extractFileId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const match = text.match(/[-\w]{20,}/);
  return match ? match[0] : '';
}

/**
 * Busca una carpeta por nombre o la crea.
 */
function getOrCreateFolder_(parent, name) {
  const safeFolderName = safeName_(name);
  const folders = parent.getFoldersByName(safeFolderName);

  return folders.hasNext()
    ? folders.next()
    : parent.createFolder(safeFolderName);
}

/**
 * Ajusta una imagen conservando su proporción.
 */
function resizeInlineImage_(image, maxWidth) {
  const width = image.getWidth();
  const height = image.getHeight();

  if (width <= maxWidth) return;

  const ratio = maxWidth / width;
  image.setWidth(Math.round(width * ratio));
  image.setHeight(Math.round(height * ratio));
}

/**
 * Formatea una fecha para Costa Rica.
 */
function formatDate_(value) {
  if (!value) return '';

  let date;

  if (value instanceof Date) {
    date = value;
  } else {
    const text = String(value).trim();

    // Una fecha como 2026-07-15 representa un día civil, no un instante UTC.
    // new Date('2026-07-15') crea medianoche UTC y, al formatearla en Costa Rica,
    // puede convertirse en 14/07/2026. Se crea al mediodía UTC para conservar el día.
    const dateOnly = text.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00(?::00(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/,
    );

    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]) - 1;
      const day = Number(dateOnly[3]);
      date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    } else {
      date = new Date(text);
    }
  }

  if (isNaN(date.getTime())) {
    return String(value);
  }

  return Utilities.formatDate(
    date,
    DEFAULT_TIME_ZONE,
    'dd/MM/yyyy',
  );
}

/**
 * Formatea las horas con dos decimales.
 */
function formatHours_(value) {
  const number = Number(value || 0);
  return isNaN(number)
    ? String(value || '')
    : number.toFixed(2);
}

/**
 * Limpia nombres usados en Drive.
 */
function safeName_(value) {
  return clean_(value, 'Reporte')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/\s+/g, ' ')
    .substring(0, 100);
}

/**
 * Construye el nombre visible del PDF:
 * Nombre del cliente-Número de boleta-Título de la boleta.pdf
 */
function ticketPdfFileName_(ticket) {
  const source = ticket || {};
  const provided = clean_(
    source.PDFFileName || source.NombreArchivoPDF,
  );

  if (provided) {
    const withoutExtension = provided.replace(/\.pdf$/i, '');
    return `${safePdfNamePart_(withoutExtension, 'Boleta', 230)}.pdf`;
  }

  const client = safePdfNamePart_(
    source.Cliente || source.ClienteNombre,
    'Sin cliente',
    80,
  );
  const rawNumber = safePdfNamePart_(
    source.BoletaID || source.BoletaUID,
    'Sin numero',
    40,
  );
  const number = rawNumber
    .replace(/^boleta\s*#?\s*/i, '')
    .trim()
    || 'Sin numero';
  const title = safePdfNamePart_(
    source.Titulo || source.Título || source.TituloBoleta,
    'Boleta de servicio',
    120,
  );

  return `${client}-Boleta ${number}-${title}`
    .substring(0, 230)
    .replace(/[-.\s]+$/g, '')
    + '.pdf';
}

/**
 * Limpia una parte del nombre para que sea compatible con Drive,
 * Gmail, Windows, Android y otros sistemas.
 */
function safePdfNamePart_(value, fallback, maxLength) {
  const cleaned = clean_(value, fallback)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '');

  return (cleaned || clean_(fallback, 'Sin dato'))
    .substring(0, Number(maxLength || 100));
}

/**
 * Notifica a los usuarios asignados cuando el cliente completa una firma.
 *
 * La firma ya fue persistida por el backend antes de llamar esta acción. Este
 * correo es deliberadamente liviano: no adjunta PDF ni evidencias y nunca
 * modifica el estado de la boleta/mantenimiento.
 */
function sendSignatureCompletionEmail_(payload) {
  const recipients = uniqueEmails_(payload.recipients || payload.to || []);

  if (!recipients.length) {
    return {
      sent: false,
      skipped: true,
      reason: 'No se encontraron correos válidos entre los usuarios asignados.',
      recipientCount: 0,
      channel: 'APPS_SCRIPT',
    };
  }

  if (MailApp.getRemainingDailyQuota() < recipients.length) {
    throw new Error(
      'La cuota diaria de correo de Apps Script no alcanza para notificar a todos los usuarios asignados.',
    );
  }

  const subjectType = clean_(payload.subjectType, 'ticket').toLowerCase();
  const isMaintenance = subjectType === 'maintenance';
  const label = isMaintenance ? 'mantenimiento' : 'boleta';
  const labelCapitalized = isMaintenance ? 'Mantenimiento' : 'Boleta';
  const reference = clean_(payload.reference, 'Sin referencia');
  const title = clean_(payload.title);
  const clientName = clean_(payload.clientName, 'Cliente');
  const targetUrl = safeWebUrl_(payload.targetUrl);
  const signedAtRaw = clean_(payload.signedAt);
  let signedAtText = signedAtRaw;

  if (signedAtRaw) {
    const signedDate = new Date(signedAtRaw);
    if (!isNaN(signedDate.getTime())) {
      signedAtText = Utilities.formatDate(
        signedDate,
        DEFAULT_TIME_ZONE,
        'dd/MM/yyyy HH:mm',
      );
    }
  }

  const subject = isMaintenance
    ? `DMS Boletas - Mantenimiento firmado - ${title || reference}`
    : `DMS Boletas - Boleta ${reference} firmada por el cliente`;
  const buttonLabel = isMaintenance
    ? 'Ver mantenimiento firmado'
    : 'Ver boleta firmada';

  const plain = [
    `${labelCapitalized} firmada por el cliente`,
    '',
    `El cliente completó y guardó correctamente la firma ${isMaintenance ? 'del mantenimiento' : 'de la boleta'}.`,
    `${labelCapitalized}: ${reference}`,
    title ? `Título: ${title}` : '',
    `Cliente: ${clientName}`,
    signedAtText ? `Fecha de firma: ${signedAtText}` : '',
    targetUrl ? `${buttonLabel}: ${targetUrl}` : '',
    '',
    `Este correo es una notificación automática para los usuarios asignados al ${label}.`,
  ].filter(Boolean).join('\n');

  const button = targetUrl
    ? [
      '<p style="margin:24px 0 8px">',
      '<a href="',
      escapeHtml_(targetUrl),
      '" style="display:inline-block;background:',
      BRAND_RED,
      ';color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">',
      escapeHtml_(buttonLabel),
      '</a></p>',
    ].join('')
    : '';

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:',
    BRAND_BACKGROUND,
    ';font-family:Arial,sans-serif;color:',
    BRAND_TEXT,
    '">',
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid:',
    BRAND_BORDER,
    ';border-radius:14px;overflow:hidden">',
    '<div style="background:',
    BRAND_RED,
    ';color:#fff;padding:22px 24px">',
    '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9">DMS Boletas</div>',
    '<h1 style="font-size:22px;margin:6px 0 0">',
    escapeHtml_(labelCapitalized),
    ' firmada por el cliente</h1></div>',
    '<div style="padding:24px;line-height:1.55">',
    '<p style="margin-top:0">El cliente completó y guardó correctamente la firma ',
    isMaintenance ? 'del mantenimiento' : 'de la boleta',
    '.</p>',
    '<table style="width:100%;border-collapse:collapse;margin:18px 0">',
    '<tr><td style="padding:9px 8px;border-bottom:1px solid #eee;font-weight:700">',
    escapeHtml_(labelCapitalized),
    '</td><td style="padding:9px 8px;border-bottom:1px solid #eee">',
    escapeHtml_(reference),
    '</td></tr>',
    title
      ? '<tr><td style="padding:9px 8px;border-bottom:1px solid #eee;font-weight:700">Título</td><td style="padding:9px 8px;border-bottom:1px solid #eee">' + escapeHtml_(title) + '</td></tr>'
      : '',
    '<tr><td style="padding:9px 8px;border-bottom:1px solid #eee;font-weight:700">Cliente</td><td style="padding:9px 8px;border-bottom:1px solid #eee">',
    escapeHtml_(clientName),
    '</td></tr>',
    signedAtText
      ? '<tr><td style="padding:9px 8px;border-bottom:1px solid #eee;font-weight:700">Fecha de firma</td><td style="padding:9px 8px;border-bottom:1px solid #eee">' + escapeHtml_(signedAtText) + '</td></tr>'
      : '',
    '</table>',
    button,
    '<p style="margin:24px 0 0;color:',
    BRAND_MUTED,
    ';font-size:12px">Este aviso se envía únicamente a los usuarios asignados al ',
    escapeHtml_(label),
    '. No incluye PDF ni evidencias.</p>',
    '</div></div></body></html>',
  ].join('');

  sendDmsEmail_({
    to: recipients.join(','),
    subject: subject,
    body: plain,
    htmlBody: htmlBody,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    skipped: false,
    recipientCount: recipients.length,
    destination: recipients.join(','),
    targetUrl: targetUrl,
    channel: 'APPS_SCRIPT',
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Devuelve una URL web válida.
 */
function safeWebUrl_(value) {
  const text = clean_(value);
  if (!text) return '';

  return /^https?:\/\/[^\s]+$/i.test(text)
    ? text
    : '';
}

/**
 * Limpia texto.
 */

/**
 * Devuelve el alias corporativo que se usará como remitente visible.
 *
 * GmailApp solo permite usar `from` cuando la dirección está configurada y
 * verificada en Gmail como "Enviar correo como". No se hace fallback silencioso
 * a la cuenta personal para evitar que un aviso de DMS exponga ese remitente.
 */
function getDmsEmailFromAlias_() {
  if (REQUEST_DMS_EMAIL_ALIAS_CACHE_ !== null) {
    return REQUEST_DMS_EMAIL_ALIAS_CACHE_;
  }

  const desired = DMS_EMAIL_FROM_ALIAS.toLowerCase();
  const effectiveEmail = String(
    Session.getEffectiveUser().getEmail() || '',
  ).trim().toLowerCase();

  /*
   * Si la propia cuenta ejecutora ya es reportes@solutionsdms.com no hace falta
   * indicar `from`: Gmail enviará naturalmente desde esa dirección.
   */
  if (effectiveEmail === desired) {
    REQUEST_DMS_EMAIL_ALIAS_CACHE_ = '';
    return '';
  }

  const aliases = GmailApp.getAliases()
    .map(function (email) {
      return String(email || '').trim();
    })
    .filter(Boolean);

  for (let index = 0; index < aliases.length; index += 1) {
    if (aliases[index].toLowerCase() === desired) {
      REQUEST_DMS_EMAIL_ALIAS_CACHE_ = aliases[index];
      return aliases[index];
    }
  }

  const error = new Error(
    `El alias ${DMS_EMAIL_FROM_ALIAS} no está disponible para la cuenta que ejecuta este Apps Script. `
    + 'Configure y verifique ese alias en Gmail > Configuración > Cuentas e importación > Enviar correo como, '
    + 'y luego vuelva a autorizar el proyecto.',
  );
  error.code = 'DMS_EMAIL_ALIAS_NOT_CONFIGURED';
  throw error;
}

/**
 * Envío centralizado de todos los correos de DMS.
 *
 * Conserva la misma estructura de opciones usada anteriormente con MailApp,
 * pero utiliza GmailApp para poder establecer el remitente `from`.
 */
function sendDmsEmail_(options) {
  const data = options || {};
  const to = String(data.to || '').trim();

  if (!to) {
    throw new Error('No hay destinatarios válidos para enviar el correo.');
  }

  const fromAlias = getDmsEmailFromAlias_();
  const gmailOptions = {
    name: clean_(data.name, DMS_EMAIL_FROM_NAME),
  };

  if (fromAlias) {
    gmailOptions.from = fromAlias;
    gmailOptions.replyTo = clean_(
      data.replyTo,
      DMS_EMAIL_FROM_ALIAS,
    );
  } else if (data.replyTo) {
    gmailOptions.replyTo = clean_(data.replyTo);
  }

  if (data.cc) gmailOptions.cc = data.cc;
  if (data.bcc) gmailOptions.bcc = data.bcc;
  if (data.htmlBody) gmailOptions.htmlBody = data.htmlBody;
  if (data.attachments) gmailOptions.attachments = data.attachments;
  if (data.inlineImages) gmailOptions.inlineImages = data.inlineImages;
  if (data.noReply === true) gmailOptions.noReply = true;

  GmailApp.sendEmail(
    to,
    String(data.subject || ''),
    String(data.body || ''),
    gmailOptions,
  );
}

/**
 * Diagnóstico manual seguro del remitente corporativo.
 *
 * No envía ningún correo y no expone secretos del proyecto.
 */
function dmsDiagnoseEmailAlias() {
  const effectiveEmail = String(
    Session.getEffectiveUser().getEmail() || '',
  ).trim();
  const aliases = GmailApp.getAliases().map(function (email) {
    return String(email || '').trim();
  }).filter(Boolean);
  const desired = DMS_EMAIL_FROM_ALIAS.toLowerCase();
  const isPrimary = effectiveEmail.toLowerCase() === desired;
  const aliasMatch = aliases.some(function (email) {
    return email.toLowerCase() === desired;
  });

  const result = {
    ok: isPrimary || aliasMatch,
    scriptVersion: APPS_SCRIPT_VERSION,
    desiredFrom: DMS_EMAIL_FROM_ALIAS,
    effectiveUser: effectiveEmail,
    aliasConfigured: aliasMatch,
    primaryMatchesAlias: isPrimary,
    configuredAliasCount: aliases.length,
    message: isPrimary || aliasMatch
      ? `DMS enviará los correos como ${DMS_EMAIL_FROM_ALIAS}.`
      : `Falta configurar ${DMS_EMAIL_FROM_ALIAS} como alias de envío en la cuenta que ejecuta el Web App.`,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}


function clean_(value, fallback) {
  const text = String(
    value == null ? '' : value,
  ).trim();

  return text || String(fallback || '');
}

/**
 * Normaliza y elimina correos duplicados.
 */
function uniqueEmails_(values) {
  const source = Array.isArray(values)
    ? values
    : String(values || '').split(/[;,]/);

  const seen = {};

  return source
    .map(function (value) {
      return String(value || '')
        .trim()
        .toLowerCase();
    })
    .filter(function (email) {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || seen[email]
      ) {
        return false;
      }

      seen[email] = true;
      return true;
    });
}

/**
 * Escapa una cadena para usarla como expresión regular.
 */
function escapeRegex_(value) {
  return String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapa HTML.
 */
function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convierte saltos de línea en <br>.
 */
function nl2br_(value) {
  return escapeHtml_(value)
    .replace(/\r?\n/g, '<br>');
}

/**
 * Crea un SHA-256 para las llaves de idempotencia.
 */
function digest_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  );

  return bytes.map(function (byte) {
    return (`0${(byte & 255).toString(16)}`).slice(-2);
  }).join('');
}

/**
 * Respuesta JSON estándar.
 */
function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
 * AGENDA DMS BOLETAS
 * Integración con la misma hoja de datos usada por la aplicación.
 * ========================================================================== */

const AGENDA_NOTIFICATION_ACTION = 'agenda.notification.send';
const AGENDA_DATA_SHEET_PROPERTY = 'DMS_DATA_SPREADSHEET_ID';
const AGENDA_REMINDER_HANDLER = 'processAgendaMissingTicketReminders';
const AGENDA_REMINDER_DAILY_HANDLER = 'processAgendaMissingTicketRemindersAtFive';
const AGENDA_REMINDER_LAST_RUN_PROPERTY = 'DMS_AGENDA_REMINDER_LAST_RUN';
const AGENDA_REMINDER_LAST_RESULT_PROPERTY = 'DMS_AGENDA_REMINDER_LAST_RESULT';
const AGENDA_REMINDER_LAST_ERROR_PROPERTY = 'DMS_AGENDA_REMINDER_LAST_ERROR';
const AGENDA_TIMEZONE = 'America/Costa_Rica';
const AGENDA_PRIMARY_RECIPIENTS_KEY = 'CORREOS_CASOS_PRINCIPALES';
const AGENDA_CC_RECIPIENTS_KEY = 'CORREOS_CASOS_CC';
const AGENDA_REMINDER_CATCHUP_DAYS = 7;
const AGENDA_TICKET_EXCEPTIONS_CONFIG_KEY = 'AGENDA_BOLETA_EXCEPCIONES';
const AGENDA_DEFAULT_TICKET_EXCEPTIONS = [
  'Oficina',
  'Oficinas',
  'Office',
  'RN',
  'Zona Franca La Lima',
];

const AGENDA_HEADERS = [
  'AgendaID',
  'AgendaOrigenID',
  'Fecha',
  'HoraInicio',
  'HoraFin',
  'Detalle',
  'ClienteID',
  'ClienteNombre',
  'Estado',
  'RequiereBoleta',
  'BoletaUID',
  'RecordatorioEnviado',
  'RecordatorioEnviadoEn',
  'RecordatorioDia',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
];

const AGENDA_ASSIGNEE_HEADERS = [
  'AgendaAsignadoID',
  'AgendaID',
  'UsuarioID',
  'Activo',
  'FechaAsignacion',
  'FechaDesasignacion',
];

/**
 * Acción HTTP invocada por el backend cuando un administrador crea o modifica
 * una agenda. Los datos ya están guardados en el spreadsheet principal; aquí
 * únicamente se notifican los usuarios y se garantiza el trigger de las 5 p. m.
 */
function setConfigScriptPropertyWithQuotaRecovery_(key, value) {
  const propertyKey = clean_(key);
  const propertyValue = clean_(value);
  if (!propertyKey) {
    throw new Error('La propiedad de configuración no puede estar vacía.');
  }

  const properties = PropertiesService.getScriptProperties();
  const current = clean_(properties.getProperty(propertyKey));
  if (current === propertyValue) {
    return false;
  }

  try {
    properties.setProperty(propertyKey, propertyValue);
    return true;
  } catch (error) {
    if (!isPropertyStorageQuotaError_(error)) throw error;

    pruneIdempotencyProperties_({
      removeLegacy: true,
      maxRetained: Math.min(40, IDEMPOTENCY_MAX_PROPERTIES),
      maxManagedBytes: Math.min(120 * 1024, IDEMPOTENCY_MAX_MANAGED_BYTES),
      maxTotalBytes: Math.min(360 * 1024, SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES),
      skipCleanupStamp: true,
    });

    properties.setProperty(propertyKey, propertyValue);
    return true;
  }
}

function sendAgendaNotification_(payload) {
  const spreadsheetId = clean_(payload.dataSpreadsheetId);
  if (spreadsheetId) {
    setConfigScriptPropertyWithQuotaRecovery_(
      AGENDA_DATA_SHEET_PROPERTY,
      spreadsheetId,
    );
  }

  ensureAgendaReminderTrigger_();

  const deliveries = Array.isArray(payload.deliveries)
    ? payload.deliveries
    : [];
  const mode = clean_(payload.mode, 'CREATED').toUpperCase();
  const appUrl = safeWebUrl_(
    payload.appUrl
      || PropertiesService.getScriptProperties().getProperty('APP_PUBLIC_URL'),
  );

  /*
   * Modo de prueba administrativo del correo de boleta pendiente.
   *
   * Reutiliza exactamente el mismo generador que el worker automático, pero
   * NO modifica RecordatorioEnviado, RecordatorioEnviadoEn, RecordatorioDia ni
   * BoletaUID. Sirve para validar destinatarios, alias, formato y cuota antes
   * de esperar al procesamiento automático de las 5:00 p. m.
   */
  if (mode === 'PENDING_TEST') {
    return sendAgendaPendingReminderTest_(payload);
  }

  let sent = 0;
  const errors = [];

  deliveries.forEach(function (delivery) {
    const email = clean_(delivery.correo).toLowerCase();
    const agendas = Array.isArray(delivery.agendas)
      ? delivery.agendas
      : [];

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !agendas.length
    ) {
      return;
    }

    try {
      sendAgendaDeliveryEmail_(
        email,
        clean_(delivery.nombre, 'Técnico'),
        agendas,
        mode,
        appUrl,
      );
      sent += 1;
    } catch (error) {
      errors.push({
        email: email,
        message: String(error && error.message ? error.message : error),
      });
    }
  });

  if (errors.length && !sent) {
    throw new Error(
      `No fue posible enviar las notificaciones de agenda: ${errors[0].message}`,
    );
  }

  return {
    sent: sent > 0,
    sentCount: sent,
    errorCount: errors.length,
    errors: errors,
    reminderTriggerReady: true,
  };
}

/**
 * Envía manualmente, en modo de prueba, el MISMO correo utilizado por el
 * recordatorio automático de boleta pendiente.
 *
 * La prueba nunca escribe en las hojas de Agenda. El backend selecciona la
 * agenda y los asignados; Apps Script vuelve a leer únicamente la configuración
 * de destinatarios/copias para conservar exactamente el comportamiento real.
 */
function sendAgendaPendingReminderTest_(payload) {
  const request = payload.pendingReminderTest || {};
  const agenda = request.agenda || payload.agenda || {};
  const assignedUsers = Array.isArray(request.assignedUsers)
    ? request.assignedUsers
    : Array.isArray(payload.assignedUsers)
      ? payload.assignedUsers
      : [];
  const agendaId = clean_(agenda.AgendaID);

  if (!agendaId) {
    throw new Error(
      'La prueba de boleta pendiente no incluye AgendaID.',
    );
  }

  if (!agendaTruthy_(agenda.RequiereBoleta)) {
    throw new Error(
      'La agenda seleccionada no requiere boleta y no corresponde enviar el recordatorio.',
    );
  }

  const spreadsheet = getAgendaDataSpreadsheet_();
  ensureAgendaSheets_(spreadsheet);
  const configTable = readAgendaTable_(
    spreadsheet,
    'Configuracion',
  );

  const delivery = sendMissingAgendaTicketEmail_(
    agenda,
    assignedUsers,
    configTable.rows,
    {
      testMode: true,
    },
  );

  return Object.assign({}, delivery, {
    sent: true,
    testMode: true,
    stateChanged: false,
    agendaId: agendaId,
    scriptVersion: APPS_SCRIPT_VERSION,
  });
}

/**
 * Correo de creación/modificación para un usuario asignado.
 */
function sendAgendaDeliveryEmail_(email, name, agendas, mode, appUrl) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('La cuota diaria de correo de Apps Script se agotó.');
  }

  if (clean_(mode).toUpperCase() === 'TICKET_CREATED_PENDING') {
    return sendAgendaTicketCreatedPendingEmail_(
      email,
      name,
      agendas,
      appUrl,
    );
  }

  const created = mode !== 'UPDATED';
  const active = agendas.filter(function (agenda) {
    return agenda.assigned !== false;
  });
  const removed = agendas.filter(function (agenda) {
    return agenda.assigned === false;
  });

  const subject = created
    ? (
      agendas.length === 1
        ? `Nueva agenda DMS - ${formatAgendaDate_(agendas[0].fecha)}`
        : `Nuevas agendas DMS (${agendas.length})`
    )
    : (
      agendas.length === 1
        ? `Agenda DMS modificada - ${formatAgendaDate_(agendas[0].fecha)}`
        : `Agendas DMS modificadas (${agendas.length})`
    );

  const plainLines = [
    `Hola ${name},`,
    '',
    created
      ? 'Se registró una nueva agenda para usted en DMS Boletas.'
      : 'Se modificó una agenda relacionada con usted en DMS Boletas.',
    '',
  ];

  agendas.forEach(function (agenda, index) {
    plainLines.push(
      `${index + 1}. ${formatAgendaDate_(agenda.fecha)} · ${clean_(agenda.horaInicio, '07:00')} - ${clean_(agenda.horaFin, '17:00')}`,
    );
    plainLines.push(`   ${clean_(agenda.detalle, 'Sin detalle')}`);
    if (agenda.assigned === false) {
      plainLines.push('   Ya no está asignado a esta visita.');
    }
  });

  if (appUrl) {
    plainLines.push('', `Agenda: ${appUrl.replace(/\/+$/, '')}/agenda`);
  }

  const cards = agendas.map(function (agenda) {
    const assigned = agenda.assigned !== false;
    const statusHtml = assigned
      ? ''
      : [
        '<div style="margin-top:10px;padding:8px 10px;border-radius:10px;',
        'background:#fff3dc;color:#8a4f00;font-weight:700;">',
        'Ya no está asignado a esta visita.',
        '</div>',
      ].join('');

    return [
      '<div style="margin:0 0 12px;padding:14px;border:1px solid ',
      BRAND_BORDER,
      ';border-radius:14px;background:#ffffff;">',
      '<div style="font-size:13px;color:',
      BRAND_MUTED,
      ';font-weight:700;">',
      escapeHtml_(formatAgendaDate_(agenda.fecha)),
      ' · ',
      escapeHtml_(clean_(agenda.horaInicio, '07:00')),
      ' - ',
      escapeHtml_(clean_(agenda.horaFin, '17:00')),
      '</div>',
      '<div style="margin-top:6px;font-size:16px;line-height:1.45;color:',
      BRAND_TEXT,
      ';font-weight:700;">',
      nl2br_(clean_(agenda.detalle, 'Sin detalle')),
      '</div>',
      statusHtml,
      '</div>',
    ].join('');
  }).join('');

  const openButton = appUrl
    ? buttonHtml_(
      `${appUrl.replace(/\/+$/, '')}/agenda`,
      'Abrir agenda en DMS Boletas',
      BRAND_RED,
    )
    : '';

  const intro = created
    ? 'Se registró una nueva visita en su agenda.'
    : (
      removed.length && !active.length
        ? 'Su asignación fue actualizada.'
        : 'Se modificó una visita de su agenda.'
    );

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:0;background:',
    BRAND_BACKGROUND,
    ';font-family:Arial,sans-serif;color:',
    BRAND_TEXT,
    ';">',
    '<div style="max-width:650px;margin:0 auto;padding:28px 16px;">',
    '<div style="background:',
    BRAND_RED,
    ';color:#fff;padding:20px 22px;border-radius:18px 18px 0 0;">',
    '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">DMS Boletas</div>',
    '<h1 style="margin:5px 0 0;font-size:24px;">',
    created ? 'Nueva agenda' : 'Agenda modificada',
    '</h1></div>',
    '<div style="padding:22px;background:#fff;border:1px solid ',
    BRAND_BORDER,
    ';border-top:0;border-radius:0 0 18px 18px;">',
    '<p style="margin-top:0;">Hola <strong>',
    escapeHtml_(name),
    '</strong>,</p>',
    '<p>',
    escapeHtml_(intro),
    '</p>',
    cards,
    openButton,
    '<p style="margin:20px 0 0;font-size:12px;color:',
    BRAND_MUTED,
    ';">Horario operativo de la agenda: 7:00 a. m. a 5:00 p. m.</p>',
    '</div></div></body></html>',
  ].join('');

  sendDmsEmail_({
    to: email,
    subject: subject,
    body: plainLines.join('\n'),
    htmlBody: htmlBody,
    name: 'DMS Boletas',
  });
}


/**
 * Informa a un técnico que la boleta correspondiente a su agenda ya fue creada
 * por un administrador y quedó en Pendientes.
 */
function sendAgendaTicketCreatedPendingEmail_(
  email,
  name,
  agendas,
  appUrl,
) {
  const agenda = (Array.isArray(agendas) && agendas[0]) || {};
  const ticketUid = clean_(agenda.boletaUid);
  const ticketNumber = clean_(
    agenda.boletaNumero || ticketUid,
    'sin número',
  );
  const clientName = clean_(
    agenda.clienteNombre,
    'cliente sin especificar',
  );
  const detail = clean_(
    agenda.detalle,
    'visita programada',
  );
  const ticketUrl = appUrl && ticketUid
    ? `${appUrl.replace(/\/+$/, '')}/boletas/${encodeURIComponent(ticketUid)}`
    : '';

  const subject = [
    'DMS Boletas',
    `Boleta #${ticketNumber} creada y pendiente`,
    clientName,
  ].filter(Boolean).join(' - ');

  const plain = [
    `Hola ${clean_(name, 'Técnico')},`,
    '',
    `La boleta #${ticketNumber} correspondiente a su agenda para la visita al cliente ${clientName} ya fue creada y se encuentra en Pendientes.`,
    `Visita: ${detail}`,
    `Fecha: ${formatAgendaDate_(agenda.fecha)}`,
    `Horario: ${clean_(agenda.horaInicio, '07:00')} - ${clean_(agenda.horaFin, '17:00')}`,
    '',
    'Complete la información del trabajo y finalice la boleta antes de las 5:00 p. m.',
    ticketUrl ? `Abrir boleta: ${ticketUrl}` : null,
    '',
    'Este aviso fue generado automáticamente por DMS Boletas.',
  ].filter(function (line) {
    return line !== null;
  }).join('\n');

  const openButton = ticketUrl
    ? buttonHtml_(
      ticketUrl,
      `Abrir boleta #${ticketNumber}`,
      BRAND_RED,
    )
    : '';

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:0;background:',
    BRAND_BACKGROUND,
    ';font-family:Arial,sans-serif;color:',
    BRAND_TEXT,
    ';">',
    '<div style="max-width:650px;margin:0 auto;padding:28px 16px;">',
    '<div style="background:',
    BRAND_RED,
    ';color:#fff;padding:20px 22px;border-radius:18px 18px 0 0;">',
    '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">DMS Boletas</div>',
    '<h1 style="margin:5px 0 0;font-size:24px;">Boleta de agenda creada</h1>',
    '</div>',
    '<div style="padding:22px;background:#fff;border:1px solid ',
    BRAND_BORDER,
    ';border-top:0;border-radius:0 0 18px 18px;">',
    '<p style="margin-top:0;">Hola <strong>',
    escapeHtml_(clean_(name, 'Técnico')),
    '</strong>,</p>',
    '<p style="font-size:17px;line-height:1.55;">La <strong>boleta #',
    escapeHtml_(ticketNumber),
    '</strong> de su agenda ya fue creada y quedó en <strong>Pendientes</strong>.</p>',
    '<div style="margin:18px 0;padding:14px;border-radius:14px;background:#fff3dc;">',
    '<div><strong>Cliente:</strong> ',
    escapeHtml_(clientName),
    '</div>',
    '<div style="margin-top:6px;"><strong>Visita:</strong> ',
    nl2br_(detail),
    '</div>',
    '<div style="margin-top:6px;"><strong>Fecha:</strong> ',
    escapeHtml_(formatAgendaDate_(agenda.fecha)),
    '</div>',
    '<div style="margin-top:6px;"><strong>Horario:</strong> ',
    escapeHtml_(clean_(agenda.horaInicio, '07:00')),
    ' - ',
    escapeHtml_(clean_(agenda.horaFin, '17:00')),
    '</div>',
    '</div>',
    '<p><strong>Debe completar y finalizar esta boleta antes de las 5:00 p. m.</strong></p>',
    openButton,
    '<p style="margin:20px 0 0;font-size:12px;color:',
    BRAND_MUTED,
    ';">Si la boleta continúa sin finalizar después de las 5:00 p. m., DMS Boletas enviará el recordatorio automático.</p>',
    '</div></div></body></html>',
  ].join('');

  sendDmsEmail_({
    to: email,
    subject: subject,
    body: plain,
    htmlBody: htmlBody,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    to: [email],
    subject: subject,
    ticketUid: ticketUid,
    ticketNumber: ticketNumber,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}

/**
 * Se ejecuta automáticamente cada 5 minutos. Antes de las 5:00 p. m. no hace
 * nada. A partir de esa hora revisa las visitas del día y vincula una boleta
 * disponible por visita. Una misma boleta nunca satisface dos agendas.
 */
function agendaReminderBelongsToDate_(agenda) {
  if (!agendaTruthy_(agenda.RecordatorioEnviado)) {
    return false;
  }

  const agendaDay = agendaDateKey_(agenda.Fecha);
  const explicitDay = agendaDateKey_(agenda.RecordatorioDia);
  const sentAtDay = agendaDateKey_(agenda.RecordatorioEnviadoEn);

  if (explicitDay) {
    return explicitDay === agendaDay;
  }

  if (sentAtDay) {
    return sentAtDay === agendaDay;
  }

  return true;
}

function agendaReminderDueDate_(dateKey, today, currentHour, cutoffDate) {
  if (!dateKey || dateKey < cutoffDate || dateKey > today) {
    return false;
  }

  if (dateKey < today) {
    return true;
  }

  return currentHour >= 17;
}

/**
 * Se ejecuta automáticamente cada 5 minutos. Las agendas del día se revisan
 * a partir de las 5:00 p. m. y, además, se recuperan recordatorios pendientes
 * de los últimos días si un trigger, una cuota o una caída temporal impidió
 * procesarlos en su fecha original.
 */
function processAgendaMissingTicketReminders() {
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(20000);

  if (!locked) {
    return {
      processed: false,
      reason: 'REMINDER_WORKER_ALREADY_RUNNING',
      date: Utilities.formatDate(new Date(), AGENDA_TIMEZONE, 'yyyy-MM-dd'),
      reminders: 0,
    };
  }

  const properties = PropertiesService.getScriptProperties();
  const startedAt = new Date();
  try {
    properties.setProperty(
      AGENDA_REMINDER_LAST_RUN_PROPERTY,
      startedAt.toISOString(),
    );

    const result = processAgendaMissingTicketRemindersCore_();

    properties.setProperty(
      AGENDA_REMINDER_LAST_RESULT_PROPERTY,
      JSON.stringify({
        at: new Date().toISOString(),
        processed: result.processed !== false,
        reason: clean_(result.reason),
        date: clean_(result.date),
        agendas: Number(result.agendas || 0),
        linked: Number(result.linked || 0),
        reminders: Number(result.reminders || 0),
        skippedAlreadySent: Number(result.skippedAlreadySent || 0),
        errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
      }),
    );
    properties.deleteProperty(AGENDA_REMINDER_LAST_ERROR_PROPERTY);
    return result;
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    try {
      properties.setProperty(
        AGENDA_REMINDER_LAST_ERROR_PROPERTY,
        JSON.stringify({
          at: new Date().toISOString(),
          message: message,
        }),
      );
    } catch (propertyError) {
      Logger.log(
        '[Agenda reminder] No se pudo guardar el diagnóstico de error: '
          + propertyError,
      );
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Núcleo del worker. Se mantiene separado para que todos los disparadores
 * automáticos compartan exactamente la misma lógica y el mismo bloqueo.
 */
function processAgendaMissingTicketRemindersCore_() {
  const now = new Date();
  const currentHour = Number(
    Utilities.formatDate(now, AGENDA_TIMEZONE, 'H'),
  );
  const today = Utilities.formatDate(
    now,
    AGENDA_TIMEZONE,
    'yyyy-MM-dd',
  );
  const cutoffDate = Utilities.formatDate(
    new Date(
      now.getTime()
      - Math.max(0, AGENDA_REMINDER_CATCHUP_DAYS - 1) * 24 * 60 * 60 * 1000,
    ),
    AGENDA_TIMEZONE,
    'yyyy-MM-dd',
  );

  const spreadsheet = getAgendaDataSpreadsheet_();
  ensureAgendaSheets_(spreadsheet);

  const agendaTable = readAgendaTable_(spreadsheet, 'Agendas');
  const assignedTable = readAgendaTable_(spreadsheet, 'AgendaAsignados');
  const userTable = readAgendaTable_(spreadsheet, 'Usuarios');
  const ticketTable = readAgendaTable_(spreadsheet, 'Boletas');
  const ticketAssignedTable = readAgendaTable_(spreadsheet, 'BoletaAsignados');
  const configTable = readAgendaTable_(spreadsheet, 'Configuracion');
  const ticketExceptions = agendaTicketExceptionsFromConfig_(configTable.rows);

  const agendas = agendaTable.rows.filter(function (row) {
    const dateKey = agendaDateKey_(row.Fecha);
    return agendaReminderDueDate_(
      dateKey,
      today,
      currentHour,
      cutoffDate,
    ) && normalizeAgendaText_(row.Estado || 'ACTIVA') !== 'cancelada';
  });

  if (!agendas.length) {
    return {
      processed: true,
      reason: currentHour < 17 ? 'NO_DUE_AGENDAS_BEFORE_5_PM' : 'NO_DUE_AGENDAS',
      date: today,
      fromDate: cutoffDate,
      agendas: 0,
      reminders: 0,
    };
  }

  const activeAgendaAssignments = assignedTable.rows.filter(
    agendaActiveAssignment_,
  );
  const activeTicketAssignments = ticketAssignedTable.rows.filter(
    agendaActiveAssignment_,
  );

  const agendaUsers = groupIdsByReference_(
    activeAgendaAssignments,
    'AgendaID',
    'UsuarioID',
  );
  const ticketUsers = groupIdsByReference_(
    activeTicketAssignments,
    'BoletaUID',
    'UsuarioID',
  );
  const usersById = indexBy_(userTable.rows, 'UsuarioID');
  const dueDates = {};
  agendas.forEach(function (agenda) {
    const key = agendaDateKey_(agenda.Fecha);
    if (key) dueDates[key] = true;
  });

  const allValidTickets = ticketTable.rows.filter(function (ticket) {
    return !agendaTruthy_(ticket.Anulada)
      && normalizeAgendaText_(ticket.Estado) !== 'anulada';
  });
  const validTickets = allValidTickets.filter(function (ticket) {
    const dateKey = agendaDateKey_(ticket.Fecha);
    return Boolean(dueDates[dateKey]);
  });

  /*
   * V7.9: cuando Agenda.BoletaUID existe, esa relación explícita prevalece
   * incluso si el administrador ajustó la fecha dentro del formulario completo.
   * El filtro por fecha se conserva únicamente para el vínculo heredado.
   */
  const ticketsById = indexBy_(allValidTickets, 'BoletaUID');
  const reservedTicketIds = {};
  const matches = {};

  agendas.forEach(function (agenda) {
    const existingId = clean_(agenda.BoletaUID);
    if (
      existingId
      && ticketsById[existingId]
      && !reservedTicketIds[existingId]
    ) {
      matches[clean_(agenda.AgendaID)] = ticketsById[existingId];
      reservedTicketIds[existingId] = true;
    }
  });

  agendas
    .slice()
    .sort(function (a, b) {
      const dateCompare = agendaDateKey_(a.Fecha)
        .localeCompare(agendaDateKey_(b.Fecha));
      if (dateCompare) return dateCompare;
      return clean_(a.FechaCreacion).localeCompare(clean_(b.FechaCreacion));
    })
    .forEach(function (agenda) {
      const agendaId = clean_(agenda.AgendaID);
      const agendaDate = agendaDateKey_(agenda.Fecha);

      if (
        matches[agendaId]
        || !agendaRequiresTicket_(agenda.Detalle, ticketExceptions)
      ) {
        return;
      }

      const assignedIds = agendaUsers[agendaId] || [];
      if (!assignedIds.length) {
        return;
      }

      const candidates = validTickets.filter(function (ticket) {
        const ticketId = clean_(ticket.BoletaUID);
        if (
          !ticketId
          || reservedTicketIds[ticketId]
          || agendaDateKey_(ticket.Fecha) !== agendaDate
        ) {
          return false;
        }

        const relatedUsers = ticketUsers[ticketId] || [];
        const belongsToAssignedUser = assignedIds.some(function (userId) {
          return relatedUsers.indexOf(userId) !== -1;
        }) || assignedIds.indexOf(clean_(ticket.CreadoPor)) !== -1;

        if (!belongsToAssignedUser) {
          return false;
        }

        /*
         * V7.8: compartir técnico y fecha NO es suficiente. Si la Agenda tiene
         * un cliente asignado, la boleta debe tener ese mismo ClienteID. Para
         * agendas antiguas sin cliente se conserva el respaldo textual de V7.7.
         */
        return agendaTicketMatchScore_(agenda, ticket) > 0;
      });

      candidates.sort(function (left, right) {
        const rightScore = agendaTicketMatchScore_(agenda, right);
        const leftScore = agendaTicketMatchScore_(agenda, left);
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return clean_(left.FechaCreacion)
          .localeCompare(clean_(right.FechaCreacion));
      });

      if (candidates.length) {
        const selected = candidates[0];
        matches[agendaId] = selected;
        reservedTicketIds[clean_(selected.BoletaUID)] = true;
      }
    });

  let linked = 0;
  let reminders = 0;
  let skippedAlreadySent = 0;
  const errors = [];

  agendas.forEach(function (agenda) {
    const agendaId = clean_(agenda.AgendaID);
    const agendaDay = agendaDateKey_(agenda.Fecha);
    const matched = matches[agendaId];

    if (matched) {
      const matchedId = clean_(matched.BoletaUID);
      if (matchedId && clean_(agenda.BoletaUID) !== matchedId) {
        writeAgendaCell_(
          agendaTable.sheet,
          agendaTable.headers,
          agenda.__rowNumber,
          'BoletaUID',
          matchedId,
        );
      }
      linked += 1;

      /*
       * V7.9: tener una boleta creada ya no completa la agenda. La visita se
       * considera cumplida únicamente cuando esa boleta está FINALIZADA.
       */
      if (normalizeAgendaText_(matched.Estado) === 'finalizada') {
        return;
      }
    }

    if (!agendaRequiresTicket_(agenda.Detalle, ticketExceptions)) {
      if (String(agenda.RequiereBoleta) !== 'false') {
        writeAgendaCell_(
          agendaTable.sheet,
          agendaTable.headers,
          agenda.__rowNumber,
          'RequiereBoleta',
          false,
        );
      }
      return;
    }

    if (agendaReminderBelongsToDate_(agenda)) {
      skippedAlreadySent += 1;
      return;
    }

    const assignedIds = agendaUsers[agendaId] || [];
    const assignedUsers = assignedIds
      .map(function (userId) {
        return usersById[userId];
      })
      .filter(Boolean);

    try {
      sendMissingAgendaTicketEmail_(
        agenda,
        assignedUsers,
        configTable.rows,
        matched
          ? {
            ticket: matched,
          }
          : {},
      );

      writeAgendaCell_(
        agendaTable.sheet,
        agendaTable.headers,
        agenda.__rowNumber,
        'RecordatorioEnviado',
        true,
      );
      writeAgendaCell_(
        agendaTable.sheet,
        agendaTable.headers,
        agenda.__rowNumber,
        'RecordatorioEnviadoEn',
        now,
      );
      writeAgendaCell_(
        agendaTable.sheet,
        agendaTable.headers,
        agenda.__rowNumber,
        'RecordatorioDia',
        agendaDay,
      );
      reminders += 1;
    } catch (error) {
      errors.push({
        agendaId: agendaId,
        agendaDate: agendaDay,
        message: String(error && error.message ? error.message : error),
      });
    }
  });

  return {
    processed: true,
    date: today,
    fromDate: cutoffDate,
    currentHour: currentHour,
    agendas: agendas.length,
    linked: linked,
    reminders: reminders,
    skippedAlreadySent: skippedAlreadySent,
    errors: errors,
  };
}

/**
 * Handler diario dedicado de las 5:00 p. m. Costa Rica.
 *
 * Apps Script puede ejecutar los triggers de hora dentro de una pequeña ventana
 * alrededor de la hora indicada. El worker valida la hora de Costa Rica y el
 * trigger de respaldo de cada 5 minutos recupera cualquier ejecución tardía.
 */
function processAgendaMissingTicketRemindersAtFive() {
  return processAgendaMissingTicketReminders();
}

/**
 * Envía el recordatorio usando exclusivamente la configuración existente
 * Destinatarios/Copias y los usuarios asignados a la visita.
 */
function sendMissingAgendaTicketEmail_(
  agenda,
  assignedUsers,
  configRows,
  options,
) {
  const settings = options || {};
  const testMode = settings.testMode === true;
  const ticket = settings.ticket || null;
  const hasLinkedTicket = Boolean(
    ticket && clean_(ticket.BoletaUID),
  );
  const ticketNumber = hasLinkedTicket
    ? clean_(
      ticket.BoletaID
        || ticket.BoletaNumero
        || ticket.BoletaUID,
    )
    : '';

  const config = {};
  configRows.forEach(function (row) {
    const key = clean_(row.Clave);
    if (key) {
      config[key] = row.Valor;
    }
  });

  const configuredTo = parseAgendaEmails_(
    config[AGENDA_PRIMARY_RECIPIENTS_KEY],
  );
  const configuredCc = parseAgendaEmails_(
    config[AGENDA_CC_RECIPIENTS_KEY],
  );
  const assignedEmails = assignedUsers
    .map(function (user) {
      return clean_(user.Correo).toLowerCase();
    })
    .filter(function (email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    });

  const to = uniqueEmails_(
    configuredTo.concat(assignedEmails),
  );
  const cc = uniqueEmails_(configuredCc).filter(function (email) {
    return to.indexOf(email) === -1;
  });

  if (!to.length) {
    throw new Error(
      'No hay destinatarios válidos para el recordatorio de agenda.',
    );
  }

  if (MailApp.getRemainingDailyQuota() < to.length + cc.length) {
    throw new Error(
      'La cuota diaria de correo de Apps Script no alcanza para enviar el recordatorio.',
    );
  }

  const detail = clean_(agenda.Detalle, 'visita programada');
  const clientName = clean_(
    hasLinkedTicket
      ? ticket.Cliente
      : agenda.ClienteNombre,
  );
  const assignedNames = assignedUsers
    .map(function (user) {
      return clean_(
        user.NombreCompleto
          || user.Nombre
          || user.NombreUsuario
          || user.Correo,
      );
    })
    .filter(Boolean);

  const dateLabel = formatAgendaDate_(agenda.Fecha);
  const subjectBase = hasLinkedTicket
    ? `DMS Boletas - Boleta #${ticketNumber} no finalizada - ${clientName || detail}`
    : `DMS Boletas - Recordatorio de boleta pendiente - ${detail}`;
  const subject = testMode
    ? `[PRUEBA] ${subjectBase}`
    : subjectBase;

  const plain = [
    testMode
      ? 'PRUEBA · Recordatorio de boleta pendiente'
      : hasLinkedTicket
        ? `Boleta #${ticketNumber} no finalizada`
        : 'Recordatorio de boleta pendiente',
    '',
    testMode
      ? 'Este correo es una prueba administrativa. No modifica la agenda ni marca el recordatorio como enviado.'
      : '',
    testMode ? '' : null,
    hasLinkedTicket
      ? `La boleta #${ticketNumber}, correspondiente a la visita al cliente ${clientName || 'sin especificar'}, no fue finalizada antes de las 5:00 p. m.`
      : `Recordar que no se realizó una boleta de la visita a: ${detail}.`,
    hasLinkedTicket ? `Visita: ${detail}` : null,
    clientName ? `Cliente relacionado: ${clientName}` : null,
    `Fecha de la visita: ${dateLabel}`,
    `Personas asignadas: ${assignedNames.join(', ') || 'Sin asignados'}`,
    '',
    testMode
      ? `Remitente esperado: ${DMS_EMAIL_FROM_ALIAS}`
      : 'Este aviso fue generado automáticamente por DMS Boletas a partir de la agenda del día.',
  ].filter(function (line) {
    return line !== null;
  }).join('\n');

  const testNotice = testMode
    ? [
      '<div style="margin:0 0 18px;padding:12px 14px;border-radius:12px;',
      'background:#eef6ff;border:1px solid #b8d7ff;color:#124f8c;">',
      '<strong>Modo de prueba:</strong> este correo no modifica la agenda, ',
      'no marca RecordatorioEnviado y puede ejecutarse antes de las 5:00 p. m.',
      '</div>',
    ].join('')
    : '';

  const mainMessage = hasLinkedTicket
    ? [
      '<strong>La boleta #',
      escapeHtml_(ticketNumber),
      ' no fue finalizada antes de las 5:00 p. m.</strong><br>',
      'Visita: ',
      nl2br_(detail),
    ].join('')
    : [
      '<strong>Recordar que no se realizó una boleta de la visita a:</strong><br>',
      nl2br_(detail),
    ].join('');

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:0;background:',
    BRAND_BACKGROUND,
    ';font-family:Arial,sans-serif;color:',
    BRAND_TEXT,
    ';">',
    '<div style="max-width:650px;margin:0 auto;padding:28px 16px;">',
    '<div style="background:',
    BRAND_RED,
    ';color:#fff;padding:20px 22px;border-radius:18px 18px 0 0;">',
    '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">DMS Boletas</div>',
    '<h1 style="margin:5px 0 0;font-size:24px;">',
    testMode
      ? 'Prueba · Boleta pendiente'
      : hasLinkedTicket
        ? 'Boleta no finalizada'
        : 'Boleta pendiente',
    '</h1>',
    '</div>',
    '<div style="padding:22px;background:#fff;border:1px solid ',
    BRAND_BORDER,
    ';border-top:0;border-radius:0 0 18px 18px;">',
    testNotice,
    '<p style="margin-top:0;font-size:17px;line-height:1.55;">',
    mainMessage,
    '</p>',
    '<div style="margin:18px 0;padding:14px;border-radius:14px;background:#fff3dc;">',
    clientName
      ? '<div><strong>Cliente:</strong> ' + escapeHtml_(clientName) + '</div>'
      : '',
    '<div style="margin-top:6px;"><strong>Fecha:</strong> ',
    escapeHtml_(dateLabel),
    '</div>',
    '<div style="margin-top:6px;"><strong>Personas asignadas:</strong> ',
    escapeHtml_(assignedNames.join(', ') || 'Sin asignados'),
    '</div>',
    '</div>',
    '<p style="margin-bottom:0;font-size:12px;color:',
    BRAND_MUTED,
    ';">',
    testMode
      ? 'Prueba manual de Agenda DMS. El proceso automático real conserva su horario y sus reglas.'
      : hasLinkedTicket
        ? 'Aviso automático generado porque la boleta vinculada a la Agenda continúa sin finalizar después de las 5:00 p. m.'
        : 'Aviso automático generado a partir de la Agenda DMS después de las 5:00 p. m.',
    '</p>',
    '</div></div></body></html>',
  ].join('');

  sendDmsEmail_({
    to: to.join(','),
    cc: cc.join(','),
    subject: subject,
    body: plain,
    htmlBody: htmlBody,
    name: 'DMS Boletas',
  });

  return {
    sent: true,
    testMode: testMode,
    to: to,
    cc: cc,
    configuredTo: configuredTo,
    configuredCc: configuredCc,
    assignedEmails: uniqueEmails_(assignedEmails),
    assignedNames: assignedNames,
    subject: subject,
    sender: DMS_EMAIL_FROM_ALIAS,
    ticketUid: hasLinkedTicket ? clean_(ticket.BoletaUID) : '',
    ticketNumber: ticketNumber,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  };
}


/**
 * Garantiza que las dos hojas nuevas existan en el spreadsheet principal.
 * No reemplaza ni borra datos; únicamente crea hojas/columnas faltantes.
 */
function ensureAgendaSheets_(spreadsheet) {
  ensureAgendaSheet_(
    spreadsheet,
    'Agendas',
    AGENDA_HEADERS,
  );
  ensureAgendaSheet_(
    spreadsheet,
    'AgendaAsignados',
    AGENDA_ASSIGNEE_HEADERS,
  );
}

function ensureAgendaSheet_(spreadsheet, name, expectedHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const lastColumn = Math.max(1, sheet.getLastColumn());
  const values = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function (value) {
      return clean_(value);
    });

  const current = values.filter(Boolean);
  if (!current.length) {
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return;
  }

  const missing = expectedHeaders.filter(function (header) {
    return current.indexOf(header) === -1;
  });

  if (missing.length) {
    sheet
      .getRange(
        1,
        current.length + 1,
        1,
        missing.length,
      )
      .setValues([missing]);
  }

  sheet.setFrozenRows(1);
}

/**
 * Crea el trigger una sola vez. Puede ejecutarse manualmente si se desea,
 * aunque también se llama automáticamente al enviar la primera agenda.
 */
function setupAgendaReminderDMS() {
  const spreadsheet = getAgendaDataSpreadsheet_();
  ensureAgendaSheets_(spreadsheet);
  const triggerStatus = ensureAgendaReminderTrigger_();

  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    trigger: AGENDA_REMINDER_HANDLER,
    dailyTrigger: AGENDA_REMINDER_DAILY_HANDLER,
    timezone: AGENDA_TIMEZONE,
    triggerStatus: triggerStatus,
  };
}

/**
 * Garantiza dos mecanismos complementarios:
 * 1) un trigger diario explícito para las 17:00 America/Costa_Rica;
 * 2) un trigger de respaldo cada 5 minutos para recuperación automática.
 *
 * También elimina duplicados de estos handlers para evitar dobles envíos.
 */
function ensureAgendaReminderTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  const fallbackTriggers = triggers.filter(function (trigger) {
    return trigger.getHandlerFunction() === AGENDA_REMINDER_HANDLER;
  });
  const dailyTriggers = triggers.filter(function (trigger) {
    return trigger.getHandlerFunction() === AGENDA_REMINDER_DAILY_HANDLER;
  });

  fallbackTriggers.slice(1).forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  dailyTriggers.slice(1).forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  if (!fallbackTriggers.length) {
    ScriptApp
      .newTrigger(AGENDA_REMINDER_HANDLER)
      .timeBased()
      .everyMinutes(5)
      .create();
  }

  if (!dailyTriggers.length) {
    ScriptApp
      .newTrigger(AGENDA_REMINDER_DAILY_HANDLER)
      .timeBased()
      .atHour(17)
      .nearMinute(0)
      .everyDays(1)
      .inTimezone(AGENDA_TIMEZONE)
      .create();
  }

  return {
    fallbackEvery5Minutes: true,
    dailyAtFiveCostaRica: true,
    timezone: AGENDA_TIMEZONE,
  };
}

/**
 * Permite configurar manualmente el spreadsheet si todavía no se ha creado una
 * agenda desde el frontend.
 */
function setDmsAgendaDataSpreadsheetId(spreadsheetId) {
  const id = clean_(spreadsheetId);
  if (!id) {
    throw new Error('Debe indicar el ID del spreadsheet principal de DMS Boletas.');
  }

  SpreadsheetApp.openById(id);

  setConfigScriptPropertyWithQuotaRecovery_(
    AGENDA_DATA_SHEET_PROPERTY,
    id,
  );

  return setupAgendaReminderDMS();
}

function getAgendaDataSpreadsheet_() {
  const id = clean_(
    PropertiesService
      .getScriptProperties()
      .getProperty(AGENDA_DATA_SHEET_PROPERTY),
  );

  if (!id) {
    throw new Error(
      'La Agenda todavía no conoce el spreadsheet principal. Cree una agenda desde DMS Boletas o configure DMS_DATA_SPREADSHEET_ID.',
    );
  }

  return SpreadsheetApp.openById(id);
}

function parseJsonSafeAgenda_(value) {
  const text = clean_(value);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function dmsDiagnoseAgendaReminders() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = clean_(
    properties.getProperty(AGENDA_DATA_SHEET_PROPERTY),
  );
  const triggers = ScriptApp.getProjectTriggers();
  const reminderTriggers = triggers.filter(function (trigger) {
    return trigger.getHandlerFunction() === AGENDA_REMINDER_HANDLER;
  });
  const dailyReminderTriggers = triggers.filter(function (trigger) {
    return trigger.getHandlerFunction() === AGENDA_REMINDER_DAILY_HANDLER;
  });
  const now = new Date();
  const currentHour = Number(
    Utilities.formatDate(now, AGENDA_TIMEZONE, 'H'),
  );
  const today = Utilities.formatDate(now, AGENDA_TIMEZONE, 'yyyy-MM-dd');

  const result = {
    ok: true,
    scriptVersion: APPS_SCRIPT_VERSION,
    timezone: AGENDA_TIMEZONE,
    today: today,
    currentHour: currentHour,
    spreadsheetConfigured: Boolean(spreadsheetId),
    reminderTriggerCount: reminderTriggers.length,
    reminderTriggerInstalled: reminderTriggers.length > 0,
    dailyReminderTriggerCount: dailyReminderTriggers.length,
    dailyReminderTriggerInstalled: dailyReminderTriggers.length > 0,
    lastAutomaticRun: clean_(
      properties.getProperty(AGENDA_REMINDER_LAST_RUN_PROPERTY),
    ),
    lastAutomaticResult: parseJsonSafeAgenda_(
      properties.getProperty(AGENDA_REMINDER_LAST_RESULT_PROPERTY),
    ),
    lastAutomaticError: parseJsonSafeAgenda_(
      properties.getProperty(AGENDA_REMINDER_LAST_ERROR_PROPERTY),
    ),
    remainingDailyMailQuota: MailApp.getRemainingDailyQuota(),
    catchupDays: AGENDA_REMINDER_CATCHUP_DAYS,
    dueAgendas: 0,
    pendingWithoutTicket: 0,
    pendingWithoutReminder: 0,
    assignedUsersWithoutEmail: 0,
    errors: [],
  };

  if (!spreadsheetId) {
    result.ok = false;
    result.errors.push('Falta DMS_DATA_SPREADSHEET_ID en Script Properties.');
    return result;
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    ensureAgendaSheets_(spreadsheet);
    const agendaTable = readAgendaTable_(spreadsheet, 'Agendas');
    const assignedTable = readAgendaTable_(spreadsheet, 'AgendaAsignados');
    const userTable = readAgendaTable_(spreadsheet, 'Usuarios');
    const ticketTable = readAgendaTable_(spreadsheet, 'Boletas');
    const ticketAssignedTable = readAgendaTable_(spreadsheet, 'BoletaAsignados');
    const configTable = readAgendaTable_(spreadsheet, 'Configuracion');
    const exceptions = agendaTicketExceptionsFromConfig_(configTable.rows);
    const cutoffDate = Utilities.formatDate(
      new Date(now.getTime() - Math.max(0, AGENDA_REMINDER_CATCHUP_DAYS - 1) * 86400000),
      AGENDA_TIMEZONE,
      'yyyy-MM-dd',
    );
    const agendaUsers = groupIdsByReference_(
      assignedTable.rows.filter(agendaActiveAssignment_),
      'AgendaID',
      'UsuarioID',
    );
    const usersById = indexBy_(userTable.rows, 'UsuarioID');
    const ticketUsers = groupIdsByReference_(
      ticketAssignedTable.rows.filter(agendaActiveAssignment_),
      'BoletaUID',
      'UsuarioID',
    );

    const due = agendaTable.rows.filter(function (agenda) {
      return normalizeAgendaText_(agenda.Estado || 'ACTIVA') !== 'cancelada'
        && agendaReminderDueDate_(agendaDateKey_(agenda.Fecha), today, currentHour, cutoffDate)
        && agendaRequiresTicket_(agenda.Detalle, exceptions);
    });
    result.dueAgendas = due.length;

    due.forEach(function (agenda) {
      const agendaId = clean_(agenda.AgendaID);
      const agendaDay = agendaDateKey_(agenda.Fecha);
      const assignedIds = agendaUsers[agendaId] || [];
      assignedIds.forEach(function (userId) {
        const user = usersById[userId];
        if (user && !clean_(user.Correo)) result.assignedUsersWithoutEmail += 1;
      });

      let hasTicket = false;
      const explicit = clean_(agenda.BoletaUID);
      if (explicit) {
        hasTicket = ticketTable.rows.some(function (ticket) {
          return clean_(ticket.BoletaUID) === explicit && !agendaTruthy_(ticket.Anulada);
        });
      }
      if (!hasTicket && assignedIds.length) {
        hasTicket = ticketTable.rows.some(function (ticket) {
          if (agendaDateKey_(ticket.Fecha) !== agendaDay || agendaTruthy_(ticket.Anulada)) return false;
          const ticketId = clean_(ticket.BoletaUID);
          const related = ticketUsers[ticketId] || [];
          const belongsToAssignedUser = assignedIds.some(function (userId) {
            return related.indexOf(userId) !== -1;
          }) || assignedIds.indexOf(clean_(ticket.CreadoPor)) !== -1;
          return belongsToAssignedUser
            && agendaTicketMatchScore_(agenda, ticket) > 0;
        });
      }

      if (!hasTicket) {
        result.pendingWithoutTicket += 1;
        if (!agendaReminderBelongsToDate_(agenda)) {
          result.pendingWithoutReminder += 1;
        }
      }
    });
  } catch (error) {
    result.ok = false;
    result.errors.push(String(error && error.message ? error.message : error));
  }

  return result;
}

function instalarDMSV73Completo() {
  const quota = dmsCleanupPropertyQuotaNow();
  const agenda = setupAgendaReminderDMS();
  const finalization = installDmsMaintenanceFinalizationTrigger();

  return {
    ok: true,
    scriptVersion: APPS_SCRIPT_VERSION,
    quota: quota,
    agenda: agenda,
    finalization: finalization,
  };
}

/**
 * Instalador recomendado para V7.7.
 *
 * Reinstala/garantiza el recordatorio diario de las 17:00 Costa Rica y su
 * respaldo cada 5 minutos, manteniendo los demás workers existentes.
 */
function instalarDMSV77Completo() {
  const quota = dmsCleanupPropertyQuotaNow();
  const agenda = setupAgendaReminderDMS();
  const finalization = installDmsMaintenanceFinalizationTrigger();

  return {
    ok: true,
    scriptVersion: APPS_SCRIPT_VERSION,
    quota: quota,
    agenda: agenda,
    finalization: finalization,
    message: (
      'DMS V7.7 instalado. Recordatorio de boleta pendiente: trigger diario '
      + '17:00 America/Costa_Rica + respaldo cada 5 minutos.'
    ),
  };
}

/**
 * Instalador recomendado para V7.8.
 *
 * Mantiene los triggers robustos de V7.7 y garantiza además las columnas
 * ClienteID / ClienteNombre usadas para relacionar Agenda y boleta.
 */
function instalarDMSV78Completo() {
  const result = instalarDMSV77Completo();
  const spreadsheet = SpreadsheetApp.openById(getAgendaDataSpreadsheetId_());
  ensureAgendaSheets_(spreadsheet);

  return Object.assign({}, result, {
    scriptVersion: APPS_SCRIPT_VERSION,
    message: (
      'DMS V7.8 instalado. Agenda preparada para vincular boletas por ClienteID '
      + 'y recordatorio automático 17:00 America/Costa_Rica con respaldo.'
    ),
  });
}

function readAgendaTable_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    return {
      sheet: null,
      headers: [],
      rows: [],
    };
  }

  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return {
      sheet: sheet,
      headers: [],
      rows: [],
    };
  }

  const headers = values.shift().map(function (value) {
    return clean_(value);
  });

  const rows = values
    .map(function (row, index) {
      const item = {
        __rowNumber: index + 2,
      };

      headers.forEach(function (header, columnIndex) {
        if (header) {
          item[header] = row[columnIndex];
        }
      });

      return item;
    })
    .filter(function (row) {
      return headers.some(function (header) {
        const value = row[header];
        return value !== ''
          && value != null;
      });
    });

  return {
    sheet: sheet,
    headers: headers,
    rows: rows,
  };
}

function writeAgendaCell_(sheet, headers, rowNumber, header, value) {
  if (!sheet) {
    return;
  }

  const index = headers.indexOf(header);
  if (index === -1) {
    return;
  }

  sheet
    .getRange(rowNumber, index + 1)
    .setValue(value);
}

function agendaActiveAssignment_(row) {
  return !clean_(row.FechaDesasignacion)
    && ![
      'false',
      '0',
      'no',
      'inactivo',
    ].includes(normalizeAgendaText_(row.Activo));
}

function agendaTicketExceptionsFromConfig_(configRows) {
  const rows = Array.isArray(configRows) ? configRows : [];
  let raw = '';

  rows.some(function (row) {
    if (clean_(row.Clave) !== AGENDA_TICKET_EXCEPTIONS_CONFIG_KEY) {
      return false;
    }
    raw = clean_(row.Valor);
    return true;
  });

  let values = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        values = parsed;
      }
    } catch (error) {
      values = raw.split(/[;\n\r]+/);
    }
  }

  const normalized = [];
  const used = {};
  (values.length ? values : AGENDA_DEFAULT_TICKET_EXCEPTIONS).forEach(
    function (item) {
      const display = clean_(item);
      const key = normalizeAgendaText_(display);
      if (!key || used[key]) {
        return;
      }
      used[key] = true;
      normalized.push(display);
    },
  );

  return normalized.length
    ? normalized
    : AGENDA_DEFAULT_TICKET_EXCEPTIONS.slice();
}

function agendaRequiresTicket_(detail, exceptions) {
  const text = normalizeAgendaText_(detail);
  if (!text) {
    return true;
  }

  const source = Array.isArray(exceptions) && exceptions.length
    ? exceptions
    : AGENDA_DEFAULT_TICKET_EXCEPTIONS;

  return !source.some(function (item) {
    const exception = normalizeAgendaText_(item);
    if (!exception) {
      return false;
    }
    return text === exception
      || text.indexOf(`${exception} `) === 0
      || text.lastIndexOf(` ${exception}`) === text.length - exception.length - 1
      || text.indexOf(` ${exception} `) !== -1;
  });
}

function normalizeAgendaText_(value) {
  return clean_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function agendaDateKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(
      value,
      AGENDA_TIMEZONE,
      'yyyy-MM-dd',
    );
  }

  const text = clean_(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return Utilities.formatDate(
    parsed,
    AGENDA_TIMEZONE,
    'yyyy-MM-dd',
  );
}

function formatAgendaDate_(value) {
  const key = agendaDateKey_(value);
  if (!key) {
    return clean_(value, 'Sin fecha');
  }

  const parts = key.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function agendaTruthy_(value) {
  if (value === true || value === 1) {
    return true;
  }

  return [
    'true',
    '1',
    'si',
    'sí',
    'yes',
  ].indexOf(clean_(value).toLowerCase()) !== -1;
}

function groupIdsByReference_(rows, referenceKey, userKey) {
  const result = {};

  rows.forEach(function (row) {
    const reference = clean_(row[referenceKey]);
    const userId = clean_(row[userKey]);

    if (!reference || !userId) {
      return;
    }

    if (!result[reference]) {
      result[reference] = [];
    }

    if (result[reference].indexOf(userId) === -1) {
      result[reference].push(userId);
    }
  });

  return result;
}

function indexBy_(rows, key) {
  const result = {};

  rows.forEach(function (row) {
    const id = clean_(row[key]);
    if (id) {
      result[id] = row;
    }
  });

  return result;
}

function agendaTicketTextScore_(agenda, ticket) {
  const agendaTokens = agendaKeywordSet_(agenda.Detalle);
  const ticketTokens = agendaKeywordSet_([
    ticket.Titulo,
    ticket.Cliente,
    ticket.ClienteNombre,
    ticket.NombreCliente,
    ticket.RazonVisita,
    ticket.TrabajoRealizado,
    ticket.Pendientes,
  ].filter(Boolean).join(' '));

  let score = 0;
  Object.keys(agendaTokens).forEach(function (token) {
    if (ticketTokens[token]) {
      score += 1;
    }
  });

  return score;
}

/**
 * V7.8: determina si una boleta corresponde a una Agenda.
 *
 * - Con ClienteID en Agenda: exige el mismo ClienteID en la boleta.
 * - Si una boleta histórica no trae ClienteID, permite el nombre exacto como
 *   respaldo solamente cuando la Agenda también guarda ClienteNombre.
 * - Sin cliente en Agenda (registros antiguos): usa la coincidencia textual
 *   de V7.7, pero nunca fecha+técnico por sí solos.
 */
function agendaTicketMatchScore_(agenda, ticket) {
  const agendaClientId = clean_(agenda.ClienteID);
  const agendaClientName = normalizeAgendaText_(agenda.ClienteNombre);
  const ticketClientId = clean_(ticket.ClienteID);
  const ticketClientName = normalizeAgendaText_(
    ticket.Cliente || ticket.ClienteNombre || ticket.NombreCliente,
  );
  const textScore = agendaTicketTextScore_(agenda, ticket);

  if (agendaClientId) {
    if (ticketClientId) {
      return agendaClientId === ticketClientId ? 1000 + textScore : 0;
    }

    if (agendaClientName && ticketClientName) {
      return agendaClientName === ticketClientName ? 700 + textScore : 0;
    }

    return 0;
  }

  if (agendaClientName) {
    return agendaClientName === ticketClientName ? 700 + textScore : 0;
  }

  return textScore;
}

function agendaKeywordSet_(value) {
  const result = {};

  normalizeAgendaText_(value)
    .split(' ')
    .filter(function (token) {
      return token.length >= 4;
    })
    .forEach(function (token) {
      result[token] = true;
    });

  return result;
}

function parseAgendaEmails_(value) {
  if (Array.isArray(value)) {
    return uniqueEmails_(value);
  }

  const text = clean_(value);
  if (!text) {
    return [];
  }

  if (text.charAt(0) === '[') {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return uniqueEmails_(parsed);
      }
    } catch (error) {
      // Continúa con el formato separado por coma/punto y coma.
    }
  }

  return uniqueEmails_(
    text.split(/[\n,;]+/),
  );
}
/* ========================================================================== */
/* DMS · FINALIZACIÓN DE MANTENIMIENTOS · AHORA / 17:00 COSTA RICA           */
/* ========================================================================== */

/*
 * Este worker NO reemplaza la lógica de finalización del backend.
 *
 * El APP puede:
 * - iniciar la finalización inmediatamente ("Finalizar ahora"); o
 * - dejarla PROGRAMADA para las 17:00 ("Finalizar a las 5:00 p. m.").
 *
 * Cuando un mantenimiento está programado, Apps Script despierta el worker
 * persistente del backend. El backend continúa usando la misma finalización
 * escalonada, los mismos permisos y el mismo estado persistido.
 *
 * Script Properties requeridas:
 *
 * DMS_APP_URL
 *   URL HTTPS pública de DMS Boletas en Render.
 *
 * DMS_FINALIZATION_WAKE_SECRET
 *   Debe ser exactamente igual a MAINTENANCE_FINALIZATION_WAKE_SECRET
 *   configurado en Render.
 */
const DMS_FINALIZATION_DAILY_HANDLER = 'wakeDmsMaintenanceFinalizationsAtFive';
const DMS_FINALIZATION_RETRY_HANDLER = 'retryDmsMaintenanceFinalizations';
const DMS_PROPERTY_QUOTA_CLEANUP_HANDLER = 'dmsCleanupPropertyQuotaScheduled';
const DMS_FINALIZATION_MAX_EXECUTION_MS = 4 * 60 * 1000;
const DMS_FINALIZATION_WAKE_WAIT_MS = 25000;
const DMS_FINALIZATION_RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * Lee y valida la configuración usada para despertar el backend.
 */
function dmsFinalizationProperties_() {
  const properties = PropertiesService
    .getScriptProperties();

  const appUrl = String(
    properties.getProperty('DMS_APP_URL')
    || '',
  )
    .trim()
    .replace(/\/+$/, '');

  const secret = String(
    properties.getProperty(
      'DMS_FINALIZATION_WAKE_SECRET',
    )
    || '',
  ).trim();

  if (!/^https:\/\//i.test(appUrl)) {
    throw new Error(
      'Configure DMS_APP_URL con la URL HTTPS pública de DMS Boletas.',
    );
  }

  if (!secret) {
    throw new Error(
      'Configure DMS_FINALIZATION_WAKE_SECRET en Script Properties.',
    );
  }

  return {
    appUrl: appUrl,
    secret: secret,
  };
}

/**
 * Diagnóstico seguro del consumo de Script Properties.
 * No devuelve valores ni secretos; únicamente nombres, conteos y tamaños.
 */
function dmsDiagnosePropertyQuota() {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  const now = Date.now();
  const byPrefix = {};
  const largestManaged = [];
  let totalBytes = 0;
  let managedBytes = 0;
  let managedCount = 0;
  let configBytes = 0;
  let configCount = 0;

  Object.keys(all).forEach(function (key) {
    const raw = all[key];
    const bytes = scriptPropertyEntryBytes_(key, raw);
    totalBytes += bytes;

    if (isIdempotencyProperty_(key)) {
      managedBytes += bytes;
      managedCount += 1;
      const prefix = idempotencyPrefixName_(key);

      if (!byPrefix[prefix]) {
        byPrefix[prefix] = {
          count: 0,
          bytes: 0,
        };
      }

      byPrefix[prefix].count += 1;
      byPrefix[prefix].bytes += bytes;

      const item = idempotencyPropertyMetadata_(key, raw, now);
      largestManaged.push({
        key: key,
        prefix: prefix,
        status: item.status,
        bytes: bytes,
        valueBytes: item.valueBytes,
        timestamp: item.timestamp || 0,
      });
    } else {
      configBytes += bytes;
      configCount += 1;
    }
  });

  largestManaged.sort(function (left, right) {
    return right.bytes - left.bytes;
  });

  const result = {
    ok: true,
    scriptVersion: APPS_SCRIPT_VERSION,
    limits: {
      googleValueBytes: 9 * 1024,
      googleStoreBytes: 500 * 1024,
      dmsSafeTotalBytes: SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES,
      dmsManagedBytes: IDEMPOTENCY_MAX_MANAGED_BYTES,
      dmsManagedCount: IDEMPOTENCY_MAX_PROPERTIES,
    },
    usage: {
      totalCount: Object.keys(all).length,
      totalBytes: totalBytes,
      approxGoogleStorePercent: Math.round(
        totalBytes / (500 * 1024) * 1000,
      ) / 10,
      managedCount: managedCount,
      managedBytes: managedBytes,
      configCount: configCount,
      configBytes: configBytes,
    },
    byPrefix: byPrefix,
    largestManaged: largestManaged.slice(0, 15),
  };

  console.log(
    '[DMS property quota diagnose V7.2] '
    + JSON.stringify(result),
  );

  return result;
}

/**
 * Limpieza manual de emergencia de PropertiesService.
 *
 * Elimina SOLAMENTE propiedades con prefijos idempotentes conocidos:
 * INVITATION_, MAINTENANCE_PRESENTATION_, AGENDA_NOTIFICATION_,
 * CUSTOMER_CASE_CREATED_, CUSTOMER_CASE_ASSIGNED_,
 * CUSTOMER_CASE_EVIDENCE_ y DELIVERY_.
 *
 * No toca REPORT_WEBHOOK_SECRET, plantillas, carpetas ni secretos.
 */
function dmsCleanupPropertyQuotaNow() {
  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    // Limpieza deliberadamente agresiva para recuperar proyectos que ya están
    // pegados a la cuota. Solo toca prefijos idempotentes conocidos.
    const result = pruneIdempotencyProperties_({
      removeLegacy: true,
      maxRetained: 40,
      maxManagedBytes: 120 * 1024,
      maxTotalBytes: 360 * 1024,
    });

    console.log(
      '[DMS property quota cleanup V7.2] '
      + JSON.stringify(result),
    );

    return result;
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // No-op.
    }
  }
}

/**
 * Handler del trigger de limpieza.
 */
function dmsCleanupPropertyQuotaScheduled() {
  try {
    return dmsCleanupPropertyQuotaNow();
  } catch (error) {
    console.error(
      '[DMS property quota cleanup] '
      + (
        error && error.stack
          ? error.stack
          : error
      ),
    );

    throw error;
  }
}

/**
 * Salvaguarda previa a despertar Render.
 *
 * Si la limpieza falla no impide que se intente despertar el backend.
 */
function dmsCleanupQuotaBeforeWake_() {
  try {
    return pruneIdempotencyProperties_({
      removeLegacy: true,
      maxRetained: IDEMPOTENCY_MAX_PROPERTIES,
      maxManagedBytes: IDEMPOTENCY_MAX_MANAGED_BYTES,
      maxTotalBytes: SCRIPT_PROPERTIES_SAFE_TOTAL_BYTES,
    });
  } catch (error) {
    console.warn(
      '[DMS property quota pre-wake] '
      + (
        error && error.message
          ? error.message
          : error
      ),
    );

    return null;
  }
}

/**
 * Llama al endpoint protegido del worker de finalización del backend.
 */
function callDmsFinalizationWorker_() {
  dmsCleanupQuotaBeforeWake_();

  const config = dmsFinalizationProperties_();

  const response = UrlFetchApp.fetch(
    config.appUrl
      + '/api/maintenance-finalization/wake',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-dms-worker-secret': config.secret,
      },
      payload: JSON.stringify({
        waitMs: DMS_FINALIZATION_WAKE_WAIT_MS,
        source: 'GOOGLE_APPS_SCRIPT_1700',
      }),
      muteHttpExceptions: true,
      followRedirects: true,
    },
  );

  const status = response.getResponseCode();
  const raw = response.getContentText() || '';
  let body = {};

  try {
    body = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      'El worker devolvió una respuesta no JSON. '
      + 'HTTP '
      + status
      + ': '
      + raw.slice(0, 500),
    );
  }

  if (
    status < 200
    || status >= 300
    || body.ok !== true
  ) {
    const message = (
      body
      && body.error
      && body.error.message
    )
      ? body.error.message
      : raw.slice(0, 500);

    throw new Error(
      'El worker rechazó la solicitud. '
      + 'HTTP '
      + status
      + ': '
      + message,
    );
  }

  return body.data || {};
}

/**
 * Elimina únicamente reintentos de finalización creados por este worker.
 */
function removeDmsRetryTriggers_() {
  ScriptApp
    .getProjectTriggers()
    .forEach(function (trigger) {
      if (
        trigger.getHandlerFunction()
        === DMS_FINALIZATION_RETRY_HANDLER
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
}

/**
 * Programa un reintento único.
 */
function scheduleDmsRetryAt_(date) {
  removeDmsRetryTriggers_();

  const target = date instanceof Date
    ? date
    : new Date(date);

  if (isNaN(target.getTime())) {
    return;
  }

  /*
   * Apps Script no permite crear de forma confiable un trigger para un instante
   * que ya pasó. Se deja al menos un minuto de margen.
   */
  const minimum = Date.now() + 60 * 1000;
  const safeTarget = new Date(
    Math.max(
      target.getTime(),
      minimum,
    ),
  );

  ScriptApp
    .newTrigger(DMS_FINALIZATION_RETRY_HANDLER)
    .timeBased()
    .at(safeTarget)
    .create();
}

/**
 * Reintenta cinco minutos después si todavía queda trabajo.
 */
function scheduleDmsRetry_() {
  scheduleDmsRetryAt_(
    new Date(
      Date.now()
      + DMS_FINALIZATION_RETRY_AFTER_MS,
    ),
  );
}

/**
 * Ejecuta el worker durante una ventana segura de Apps Script.
 */
function runDmsFinalizationWorker_() {
  const started = Date.now();
  let last = null;

  do {
    last = callDmsFinalizationWorker_();

    /*
     * Los triggers con nearMinute pueden dispararse algunos minutos antes de
     * las 17:00. En ese caso el backend devuelve nextDueAt y se instala un
     * reintento de una sola vez justo después de la hora real programada.
     */
    if (
      Number(last.pending || 0) === 0
      && last.nextDueAt
    ) {
      const nextDue = new Date(
        last.nextDueAt,
      );

      if (!isNaN(nextDue.getTime())) {
        scheduleDmsRetryAt_(
          new Date(
            nextDue.getTime()
            + 30 * 1000,
          ),
        );
      }

      return last;
    }

    if (Number(last.pending || 0) === 0) {
      removeDmsRetryTriggers_();
      return last;
    }

    Utilities.sleep(2500);
  } while (
    Date.now() - started
    < DMS_FINALIZATION_MAX_EXECUTION_MS
  );

  if (
    last
    && Number(last.pending || 0) > 0
  ) {
    scheduleDmsRetry_();
  }

  return last;
}

/**
 * Handler diario de las 17:00 Costa Rica.
 */
function wakeDmsMaintenanceFinalizationsAtFive() {
  try {
    return runDmsFinalizationWorker_();
  } catch (error) {
    console.error(
      '[DMS finalization 17:00] '
      + (
        error && error.stack
          ? error.stack
          : error
      ),
    );

    scheduleDmsRetry_();
    throw error;
  }
}

/**
 * Handler de reintento.
 */
function retryDmsMaintenanceFinalizations() {
  removeDmsRetryTriggers_();
  return wakeDmsMaintenanceFinalizationsAtFive();
}

/**
 * Instala o reinstala los triggers de DMS necesarios para:
 * - despertar finalizaciones programadas a las 17:00 Costa Rica;
 * - reintentar automáticamente si Render o Google tardan;
 * - limpiar propiedades idempotentes cada hora.
 *
 * Ejecute esta función UNA SOLA VEZ después de pegar/desplegar V7.1.
 */
function installDmsMaintenanceFinalizationTrigger() {
  ScriptApp
    .getProjectTriggers()
    .forEach(function (trigger) {
      const handler = trigger
        .getHandlerFunction();

      if (
        handler === DMS_FINALIZATION_DAILY_HANDLER
        || handler === DMS_FINALIZATION_RETRY_HANDLER
        || handler
          === DMS_PROPERTY_QUOTA_CLEANUP_HANDLER
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });

  ScriptApp
    .newTrigger(
      DMS_FINALIZATION_DAILY_HANDLER,
    )
    .timeBased()
    .atHour(17)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(DEFAULT_TIME_ZONE)
    .create();

  ScriptApp
    .newTrigger(
      DMS_PROPERTY_QUOTA_CLEANUP_HANDLER,
    )
    .timeBased()
    .everyHours(1)
    .create();

  const cleanup = dmsCleanupPropertyQuotaNow();

  return {
    ok: true,
    version: APPS_SCRIPT_VERSION,
    timeZone: DEFAULT_TIME_ZONE,
    finalizationHour: '17:00',
    cleanup: cleanup,
    message: (
      'Worker DMS instalado para las 17:00 '
      + DEFAULT_TIME_ZONE
      + '. La limpieza de cuota se ejecutará cada hora.'
    ),
  };
}

/**
 * Prueba manual del enlace Apps Script -> backend.
 *
 * No cambia la hora programada. El backend decide qué mantenimientos están
 * vencidos o en proceso y continúa únicamente esos trabajos.
 */
function testDmsMaintenanceFinalizationWorker() {
  return callDmsFinalizationWorker_();
}

/**
 * Instalador recomendado de esta versión completa.
 *
 * Mantiene el nombre separado de autorizarPermisosDMSV4() para no modificar
 * flujos existentes. Primero autorice permisos con la función histórica y
 * después ejecute esta instalación.
 */
function instalarDMSV71Finalizacion() {
  return installDmsMaintenanceFinalizationTrigger();
}


// Bounded upload transport. Uses the SAME deployment owner as legacy uploads.
// No sharing changes, no image conversion, no base64 for the complete file.
const CUSTOMER_CASE_CHUNK_BYTES = 256 * 1024;
function caseDriveRequest_(url, options) {
  try {
    const response = UrlFetchApp.fetch(url, Object.assign({muteHttpExceptions:true,followRedirects:false}, options, {
      headers:Object.assign({Authorization:'Bearer ' + ScriptApp.getOAuthToken()}, options.headers || {}),
    }));
    return response;
  } catch (_error) { throw new Error('No se pudo contactar Drive para transferir la evidencia.'); }
}
function caseDriveJson_(url, options) {
  const response=caseDriveRequest_(url,options);
  if (response.getResponseCode()<200 || response.getResponseCode()>=300) throw new Error('Drive rechazó los metadatos de la evidencia ('+response.getResponseCode()+').');
  return JSON.parse(response.getContentText());
}
function caseUploadMetadata_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(fileId || ''))) throw new Error('Archivo de carga no válido.');
  return caseDriveJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id,name,size,mimeType,appProperties,trashed&supportsAllDrives=true',{method:'get'});
}
function initCustomerCaseResumable_(payload) {
  const evidence=payload.evidence || {}, caseData=payload.case || {};
  const size=Number(evidence.size), mimeType=clean_(evidence.mimeType).toLowerCase(), uploadId=clean_(payload.uploadId);
  if (!Number.isInteger(size) || size<=0 || size>CUSTOMER_CASE_EVIDENCE_MAX_BYTES || !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mimeType)) throw new Error('La evidencia debe ser una imagen de hasta 6 MB.');
  if (!/^[a-f0-9]{64}$/.test(uploadId) || !clean_(caseData.ClienteID)) throw new Error('Falta el contexto de carga.');
  const testMode=customerCaseBoolean_(caseData.ModoPrueba);
  const folder=getOrCreateFolder_(customerCaseEvidenceRootFolder_(testMode),'Cargas pendientes');
  const ids=caseDriveJson_('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{method:'get'});
  const fileId=ids.ids[0];
  const response=caseDriveRequest_('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,mimeType',{
    method:'post',contentType:'application/json',headers:{'X-Upload-Content-Type':mimeType,'X-Upload-Content-Length':String(size)},
    payload:JSON.stringify({id:fileId,name:safeName_(clean_(evidence.fileName,'evidencia.jpg')),mimeType:mimeType,parents:[folder.getId()],appProperties:{dmsCaseUploadId:uploadId,dmsCaseClientId:String(caseData.ClienteID),dmsCaseTestMode:String(testMode)}}),
  });
  const headers=response.getAllHeaders();
  const location=Object.keys(headers).find(key=>key.toLowerCase()==='location');
  if (response.getResponseCode()!==200 || !location) throw new Error('Drive no devolvió una sesión de carga.');
  return {sessionUrl:String(headers[location]),fileId:fileId,chunkBytes:CUSTOMER_CASE_CHUNK_BYTES};
}
function chunkCustomerCaseResumable_(payload) {
  const sessionUrl=String(payload.sessionUrl || ''), size=Number(payload.size), offset=Number(payload.offset), encoded=String(payload.base64 || '');
  if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable(?:&|$)/.test(sessionUrl)) throw new Error('Sesión Drive no válida.');
  if (!Number.isInteger(size) || size<=0 || size>CUSTOMER_CASE_EVIDENCE_MAX_BYTES || !Number.isInteger(offset) || offset<0 || offset>=size) throw new Error('Posición de carga no válida.');
  if (!encoded || encoded.length>Math.ceil(CUSTOMER_CASE_CHUNK_BYTES/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Bloque de carga no válido.');
  const bytes=Utilities.base64Decode(encoded), end=offset+bytes.length;
  if (!bytes.length || bytes.length>CUSTOMER_CASE_CHUNK_BYTES || end>size || (end<size && bytes.length%CUSTOMER_CASE_CHUNK_BYTES!==0)) throw new Error('Tamaño de bloque no válido.');
  // A restarted browser begins at zero. Ask Drive for its persisted offset
  // before re-sending so an ambiguous response cannot duplicate or skip bytes.
  if (offset===0) {
    const progress=caseDriveRequest_(sessionUrl,{method:'put',payload:'',headers:{'Content-Range':'bytes */'+size}});
    if (progress.getResponseCode()===308) {
      const h=progress.getAllHeaders(), k=Object.keys(h).find(key=>key.toLowerCase()==='range');
      const range=String(k ? h[k] : '').match(/bytes=0-(\d+)/);
      const next=range ? Number(range[1])+1 : 0;
      if (next>0 && next<size) return {complete:false,nextOffset:next};
    } else {
      let done;
      try { done=caseUploadMetadata_(payload.fileId); } catch (_error) { throw new Error('No se pudo recuperar la sesión de Drive. Inicie una carga nueva.'); }
      if (!done.trashed && Number(done.size)===size && done.appProperties?.dmsCaseUploadId===payload.uploadId) return {complete:true,nextOffset:size,file:{id:done.id,size:size}};
      throw new Error('La sesión de Drive no está disponible. Inicie una carga nueva.');
    }
  }
  const response=caseDriveRequest_(sessionUrl,{method:'put',contentType:payload.mimeType,payload:bytes,headers:{'Content-Range':'bytes '+offset+'-'+(end-1)+'/'+size}});
  const status=response.getResponseCode();
  if (status===308) {
    const headers=response.getAllHeaders(), key=Object.keys(headers).find(k=>k.toLowerCase()==='range');
    const match=String(key ? headers[key] : '').match(/bytes=0-(\d+)/);
    if (!match) throw new Error('Drive no confirmó la posición recibida.');
    return {complete:false,nextOffset:Number(match[1])+1};
  }
  // A timed-out final block can have completed in Drive. The preallocated ID
  // lets the next attempt recover metadata without re-uploading/duplicating.
  let file;
  try { file=caseUploadMetadata_(payload.fileId); } catch (_error) { throw new Error('Drive no pudo confirmar el bloque ('+status+').'); }
  if (file.trashed || Number(file.size)!==size || file.appProperties?.dmsCaseUploadId!==payload.uploadId) throw new Error('Drive no confirmó el archivo original completo.');
  return {complete:true,nextOffset:size,file:{id:file.id,size:Number(file.size)}};
}
function adoptCustomerCaseResumable_(payload) {
  const caseData=payload.case || {}, evidence=payload.evidence || {};
  const testMode=customerCaseBoolean_(caseData.ModoPrueba || caseData.EsPrueba);
  const metadata=caseUploadMetadata_(evidence.uploadedFileId);
  const tags=metadata.appProperties || {};
  if (metadata.trashed || tags.dmsCaseUploadId!==evidence.uploadId || tags.dmsCaseClientId!==String(caseData.ClienteID) || tags.dmsCaseTestMode!==String(testMode)) throw new Error('La evidencia no pertenece a este cliente y modo.');
  if (Number(metadata.size)!==Number(evidence.size) || Number(metadata.size)>CUSTOMER_CASE_EVIDENCE_MAX_BYTES || metadata.mimeType!==evidence.mimeType) throw new Error('Los metadatos de la evidencia no coinciden.');
  if (!clean_(caseData.CasoID)) throw new Error('La evidencia no incluye CasoID.');
  const root=customerCaseEvidenceRootFolder_(testMode);
  const clientFolder=getOrCreateFolder_(root,clean_(caseData.Cliente || caseData.ClienteNombre,'Cliente'));
  const caseFolder=getOrCreateFolder_(clientFolder,clean_(caseData.CasoNumero,caseData.CasoID)+' - '+clean_(caseData.RazonVisita || caseData.Caso,'Solicitud técnica'));
  const file=DriveApp.getFileById(metadata.id);
  file.moveTo(caseFolder);
  file.setName(String(Math.max(1,Number(evidence.index || 1))).padStart(2,'0')+' - '+safeName_(clean_(evidence.fileName,'evidencia.jpg')));
  return {id:file.getId(),name:file.getName(),mimeType:metadata.mimeType,size:Number(metadata.size),webViewLink:file.getUrl(),url:file.getUrl(),folderId:caseFolder.getId(),folderUrl:caseFolder.getUrl(),ownerEmail:clean_(PropertiesService.getScriptProperties().getProperty('DRIVE_OWNER_EMAIL'),'PROPIETARIO_APPS_SCRIPT'),testMode:testMode,storage:'APPS_SCRIPT_DRIVE',fingerprint:clean_(evidence.fingerprint),scriptVersion:APPS_SCRIPT_VERSION};
}
