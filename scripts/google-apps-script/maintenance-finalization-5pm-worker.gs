/*
 * DMS Boletas · Worker externo de mantenimientos (recordatorios 07:00/17:00 + finalización 17:00)
 *
 * Script Properties requeridas:
 *   DMS_APP_URL                      https://tu-app.onrender.com
 *   DMS_FINALIZATION_WAKE_SECRET     mismo valor que MAINTENANCE_FINALIZATION_WAKE_SECRET en Render
 *
 * Zona horaria recomendada del proyecto de Apps Script: America/Costa_Rica
 */

const DMS_PROGRESS_MORNING_HANDLER = 'wakeDmsMaintenanceProgressAtSeven';
const DMS_PROGRESS_MORNING_RETRY_HANDLER = 'retryDmsMaintenanceProgressAtSeven';
const DMS_PROGRESS_AFTERNOON_RETRY_HANDLER = 'retryDmsMaintenanceProgressAtFive';
const DMS_PROGRESS_SLOT_GUARD_PREFIX = 'DMS_MAINTENANCE_PROGRESS_SLOT_';
const DMS_PROGRESS_SLOT_RUNNING_TTL_MS = 10 * 60 * 1000;
const DMS_PROGRESS_SLOT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const DMS_FINALIZATION_DAILY_HANDLER = 'wakeDmsMaintenanceFinalizationsAtFive';
const DMS_FINALIZATION_RETRY_HANDLER = 'retryDmsMaintenanceFinalizations';
const DMS_PROPERTY_QUOTA_CLEANUP_HANDLER = 'dmsCleanupPropertyQuotaScheduled';
const DMS_FINALIZATION_MAX_EXECUTION_MS = 4 * 60 * 1000;
const DMS_FINALIZATION_WAKE_WAIT_MS = 25000;
const DMS_FINALIZATION_RETRY_AFTER_MS = 5 * 60 * 1000;
const DMS_IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DMS_IDEMPOTENCY_RUNNING_TTL_MS = 10 * 60 * 1000;
const DMS_IDEMPOTENCY_MAX_PROPERTIES = 80;
const DMS_IDEMPOTENCY_PREFIXES = Object.freeze([
  'INVITATION_',
  'MAINTENANCE_PRESENTATION_',
  'AGENDA_NOTIFICATION_',
  'CUSTOMER_CASE_CREATED_',
  'CUSTOMER_CASE_ASSIGNED_',
  'CUSTOMER_CASE_EVIDENCE_',
  'DELIVERY_',
]);

function dmsFinalizationProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const appUrl = String(properties.getProperty('DMS_APP_URL') || '').trim().replace(/\/+$/, '');
  const secret = String(properties.getProperty('DMS_FINALIZATION_WAKE_SECRET') || '').trim();
  if (!/^https:\/\//i.test(appUrl)) {
    throw new Error('Configure DMS_APP_URL con la URL HTTPS pública de DMS Boletas.');
  }
  if (!secret) {
    throw new Error('Configure DMS_FINALIZATION_WAKE_SECRET en Script Properties.');
  }
  return { appUrl: appUrl, secret: secret };
}

function dmsIsIdempotencyProperty_(key) {
  const name = String(key || '');
  return DMS_IDEMPOTENCY_PREFIXES.some(function(prefix) {
    return name.indexOf(prefix) === 0;
  });
}

function dmsPruneIdempotencyProperties_(options) {
  const settings = options || {};
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  const now = Date.now();
  const retained = [];
  let deleted = 0;
  let legacyDeleted = 0;
  let expiredDeleted = 0;
  let cappedDeleted = 0;

  Object.keys(all).forEach(function(key) {
    if (!dmsIsIdempotencyProperty_(key)) return;

    let parsed = null;
    let timestamp = 0;
    let running = false;
    let remove = false;
    let legacy = false;

    try {
      parsed = JSON.parse(all[key]);
      if (parsed && parsed.__dmsIdempotency === true) {
        running = parsed.status === 'RUNNING';
        timestamp = Number(parsed.storedAt || parsed.startedAt || 0);

        if (running && timestamp && now - timestamp > DMS_IDEMPOTENCY_RUNNING_TTL_MS) {
          remove = true;
        } else if (!running && timestamp && now - timestamp > DMS_IDEMPOTENCY_RETENTION_MS) {
          remove = true;
        }
      } else {
        // El formato histórico no tenía fecha y era la fuente del crecimiento ilimitado.
        legacy = true;
        remove = settings.keepLegacy !== true;
      }
    } catch (_) {
      legacy = true;
      remove = settings.keepLegacy !== true;
    }

    if (remove) {
      properties.deleteProperty(key);
      deleted += 1;
      if (legacy) legacyDeleted += 1;
      else expiredDeleted += 1;
      return;
    }

    retained.push({
      key: key,
      timestamp: timestamp || now,
      running: running,
    });
  });

  const completed = retained
    .filter(function(item) { return !item.running; })
    .sort(function(a, b) { return a.timestamp - b.timestamp; });
  let retainedCount = retained.length;

  while (retainedCount > DMS_IDEMPOTENCY_MAX_PROPERTIES && completed.length) {
    const oldest = completed.shift();
    properties.deleteProperty(oldest.key);
    retainedCount -= 1;
    deleted += 1;
    cappedDeleted += 1;
  }

  return {
    ok: true,
    deleted: deleted,
    legacyDeleted: legacyDeleted,
    expiredDeleted: expiredDeleted,
    cappedDeleted: cappedDeleted,
    retained: retainedCount,
    maxRetained: DMS_IDEMPOTENCY_MAX_PROPERTIES,
  };
}

/*
 * Ejecute esta función una vez después de instalar este archivo si el Web App
 * ya muestra "You have exceeded the property storage quota".
 *
 * Solo elimina propiedades de idempotencia conocidas. NO toca
 * REPORT_WEBHOOK_SECRET, TEMPLATE_BOLETA_ID, BOLETAS_FOLDER_ID,
 * DMS_APP_URL, DMS_FINALIZATION_WAKE_SECRET ni otras configuraciones.
 */
function dmsCleanupPropertyQuotaNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = dmsPruneIdempotencyProperties_({ keepLegacy: false });
    console.log('[DMS property quota cleanup] ' + JSON.stringify(result));
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) { /* no-op */ }
  }
}

function dmsCleanupPropertyQuotaScheduled() {
  try {
    return dmsCleanupPropertyQuotaNow();
  } catch (error) {
    console.error('[DMS property quota cleanup] ' + (error && error.stack ? error.stack : error));
    throw error;
  }
}

function dmsCleanupQuotaBeforeWake_() {
  try {
    return dmsPruneIdempotencyProperties_({ keepLegacy: false });
  } catch (error) {
    // La limpieza es una salvaguarda. Nunca debe impedir que Render sea despertado.
    console.warn('[DMS property quota pre-wake] ' + (error && error.message ? error.message : error));
    return null;
  }
}

function dmsMaintenanceProgressSlotPropertyKey_(slot, now) {
  const dateKey = Utilities.formatDate(
    now instanceof Date ? now : new Date(),
    'America/Costa_Rica',
    'yyyy-MM-dd',
  );
  const normalizedSlot = String(slot || '').trim().replace(/[^0-9]/g, '');
  return DMS_PROGRESS_SLOT_GUARD_PREFIX + dateKey + '_' + normalizedSlot;
}

function beginDmsMaintenanceProgressSlot_(slot) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = dmsMaintenanceProgressSlotPropertyKey_(slot, new Date());
    const raw = properties.getProperty(key);
    const now = Date.now();

    if (raw) {
      try {
        const stored = JSON.parse(raw);
        if (stored && stored.status === 'COMPLETE') {
          return { acquired: false, key: key, reason: 'SCRIPT_SLOT_ALREADY_COMPLETE' };
        }
        if (
          stored
          && stored.status === 'RUNNING'
          && Number(stored.startedAt || 0)
          && now - Number(stored.startedAt || 0) < DMS_PROGRESS_SLOT_RUNNING_TTL_MS
        ) {
          return { acquired: false, key: key, reason: 'SCRIPT_SLOT_ALREADY_RUNNING' };
        }
      } catch (_) {
        // Guarda inválida: se reemplaza.
      }
    }

    const token = Utilities.getUuid();
    properties.setProperty(key, JSON.stringify({
      status: 'RUNNING',
      slot: String(slot || ''),
      startedAt: now,
      token: token,
    }));
    return { acquired: true, key: key, token: token };
  } finally {
    lock.releaseLock();
  }
}

function completeDmsMaintenanceProgressSlot_(claim, result) {
  if (!claim || !claim.acquired || !claim.key) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(claim.key);
    if (raw) {
      try {
        const stored = JSON.parse(raw);
        if (stored && stored.token && claim.token && stored.token !== claim.token) return;
      } catch (_) {
        // Se reemplaza por COMPLETE.
      }
    }

    properties.setProperty(claim.key, JSON.stringify({
      status: 'COMPLETE',
      slot: String(result && result.slot || ''),
      storedAt: Date.now(),
      sent: Number(result && result.sent || 0),
      skipped: Number(result && result.skipped || 0),
      failed: Number(result && result.failed || 0),
    }));
  } finally {
    lock.releaseLock();
  }
}

function releaseDmsMaintenanceProgressSlot_(claim) {
  if (!claim || !claim.acquired || !claim.key) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(claim.key);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw);
      if (!stored || !stored.token || !claim.token || stored.token === claim.token) {
        properties.deleteProperty(claim.key);
      }
    } catch (_) {
      properties.deleteProperty(claim.key);
    }
  } finally {
    lock.releaseLock();
  }
}

function cleanupDmsMaintenanceProgressSlotGuards_() {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  const now = Date.now();
  let deleted = 0;

  Object.keys(all).forEach(function(key) {
    if (key.indexOf(DMS_PROGRESS_SLOT_GUARD_PREFIX) !== 0) return;

    let timestamp = 0;
    try {
      const stored = JSON.parse(all[key]);
      timestamp = Number(stored.storedAt || stored.startedAt || 0);
    } catch (_) {
      timestamp = 0;
    }

    if (!timestamp || now - timestamp > DMS_PROGRESS_SLOT_RETENTION_MS) {
      properties.deleteProperty(key);
      deleted += 1;
    }
  });

  return deleted;
}

function callDmsMaintenanceProgressWorker_(slot) {
  const config = dmsFinalizationProperties_();
  const response = UrlFetchApp.fetch(config.appUrl + '/api/maintenance-progress/wake', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-dms-worker-secret': config.secret,
    },
    payload: JSON.stringify({
      slot: String(slot || ''),
      source: 'GOOGLE_APPS_SCRIPT_PROGRESS',
    }),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const status = response.getResponseCode();
  const raw = response.getContentText() || '';
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw new Error('El worker de progreso devolvió una respuesta no JSON. HTTP ' + status + ': ' + raw.slice(0, 500));
  }
  if (status < 200 || status >= 300 || body.ok !== true) {
    const message = body && body.error && body.error.message
      ? body.error.message
      : raw.slice(0, 500);
    throw new Error('El worker de progreso rechazó la solicitud. HTTP ' + status + ': ' + message);
  }
  return body.data || {};
}

function removeDmsProgressRetryTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleDmsProgressRetry_(handler) {
  removeDmsProgressRetryTriggers_(handler);
  ScriptApp.newTrigger(handler)
    .timeBased()
    .after(5 * 60 * 1000)
    .create();
}

function runDmsMaintenanceProgressSlot_(slot, retryHandler) {
  cleanupDmsMaintenanceProgressSlotGuards_();
  const claim = beginDmsMaintenanceProgressSlot_(slot);

  if (!claim.acquired) {
    removeDmsProgressRetryTriggers_(retryHandler);
    return {
      due: false,
      slot: String(slot || ''),
      skippedByAppsScript: true,
      reason: claim.reason,
    };
  }

  try {
    const result = callDmsMaintenanceProgressWorker_(slot);

    if (result && result.due === false && result.reason === 'TOO_EARLY') {
      releaseDmsMaintenanceProgressSlot_(claim);
      scheduleDmsProgressRetry_(retryHandler);
      return result;
    }

    if (Number(result && result.failed || 0) > 0) {
      releaseDmsMaintenanceProgressSlot_(claim);
      scheduleDmsProgressRetry_(retryHandler);
      return result;
    }

    completeDmsMaintenanceProgressSlot_(claim, result);
    removeDmsProgressRetryTriggers_(retryHandler);
    return result;
  } catch (error) {
    releaseDmsMaintenanceProgressSlot_(claim);
    console.error('[DMS maintenance progress ' + slot + '] ' + (error && error.stack ? error.stack : error));
    scheduleDmsProgressRetry_(retryHandler);
    throw error;
  }
}

function wakeDmsMaintenanceProgressAtSeven() {
  return runDmsMaintenanceProgressSlot_('07:00', DMS_PROGRESS_MORNING_RETRY_HANDLER);
}

function retryDmsMaintenanceProgressAtSeven() {
  removeDmsProgressRetryTriggers_(DMS_PROGRESS_MORNING_RETRY_HANDLER);
  return wakeDmsMaintenanceProgressAtSeven();
}

function retryDmsMaintenanceProgressAtFive() {
  removeDmsProgressRetryTriggers_(DMS_PROGRESS_AFTERNOON_RETRY_HANDLER);
  return runDmsMaintenanceProgressSlot_('17:00', DMS_PROGRESS_AFTERNOON_RETRY_HANDLER);
}

function callDmsFinalizationWorker_() {
  // Libera primero las propiedades heredadas para que el Apps Script de reportes
  // tenga espacio antes de que Render empiece a solicitar boletas y PDFs.
  dmsCleanupQuotaBeforeWake_();

  const config = dmsFinalizationProperties_();
  const response = UrlFetchApp.fetch(config.appUrl + '/api/maintenance-finalization/wake', {
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
  });

  const status = response.getResponseCode();
  const raw = response.getContentText() || '';
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw new Error('El worker devolvió una respuesta no JSON. HTTP ' + status + ': ' + raw.slice(0, 500));
  }
  if (status < 200 || status >= 300 || body.ok !== true) {
    const message = body && body.error && body.error.message
      ? body.error.message
      : raw.slice(0, 500);
    throw new Error('El worker rechazó la solicitud. HTTP ' + status + ': ' + message);
  }
  return body.data || {};
}

function removeDmsRetryTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DMS_FINALIZATION_RETRY_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleDmsRetryAt_(date) {
  removeDmsRetryTriggers_();
  const target = date instanceof Date ? date : new Date(date);
  if (isNaN(target.getTime())) return;
  const minimum = Date.now() + 60 * 1000;
  const safeTarget = new Date(Math.max(target.getTime(), minimum));
  ScriptApp.newTrigger(DMS_FINALIZATION_RETRY_HANDLER)
    .timeBased()
    .at(safeTarget)
    .create();
}

function scheduleDmsRetry_() {
  scheduleDmsRetryAt_(new Date(Date.now() + DMS_FINALIZATION_RETRY_AFTER_MS));
}

function runDmsFinalizationWorker_() {
  const started = Date.now();
  let last = null;

  do {
    last = callDmsFinalizationWorker_();

    // Si Google ejecutó el trigger diario unos minutos antes de las 17:00,
    // el backend devuelve la próxima hora exacta y programamos una ejecución
    // de una sola vez justo después de esa hora.
    if (Number(last.pending || 0) === 0 && last.nextDueAt) {
      scheduleDmsRetryAt_(new Date(new Date(last.nextDueAt).getTime() + 30 * 1000));
      return last;
    }

    if (Number(last.pending || 0) === 0) {
      removeDmsRetryTriggers_();
      return last;
    }

    Utilities.sleep(2500);
  } while (Date.now() - started < DMS_FINALIZATION_MAX_EXECUTION_MS);

  if (last && Number(last.pending || 0) > 0) {
    scheduleDmsRetry_();
  }
  return last;
}

function wakeDmsMaintenanceFinalizationsAtFive() {
  // El mismo wake-up de las 17:00 garantiza primero el recordatorio de progreso.
  // Si Render estaba dormido, esta llamada lo despierta antes de la finalización.
  try {
    runDmsMaintenanceProgressSlot_('17:00', DMS_PROGRESS_AFTERNOON_RETRY_HANDLER);
  } catch (_) {
    // El progreso tiene su propio retry. Nunca bloquea la finalización programada.
  }

  try {
    return runDmsFinalizationWorker_();
  } catch (error) {
    console.error('[DMS finalization 17:00] ' + (error && error.stack ? error.stack : error));
    scheduleDmsRetry_();
    throw error;
  }
}

function retryDmsMaintenanceFinalizations() {
  removeDmsRetryTriggers_();
  return wakeDmsMaintenanceFinalizationsAtFive();
}

function installDmsMaintenanceFinalizationTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (
      handler === DMS_PROGRESS_MORNING_HANDLER
      || handler === DMS_PROGRESS_MORNING_RETRY_HANDLER
      || handler === DMS_PROGRESS_AFTERNOON_RETRY_HANDLER
      || handler === DMS_FINALIZATION_DAILY_HANDLER
      || handler === DMS_FINALIZATION_RETRY_HANDLER
      || handler === DMS_PROPERTY_QUOTA_CLEANUP_HANDLER
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Google puede ejecutar nearMinute(0) unos minutos antes o después.
  // El backend nunca envía el recordatorio antes de su hora nominal y estos
  // handlers crean un retry corto cuando el disparo ocurrió anticipadamente.
  ScriptApp.newTrigger(DMS_PROGRESS_MORNING_HANDLER)
    .timeBased()
    .atHour(7)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('America/Costa_Rica')
    .create();

  ScriptApp.newTrigger(DMS_FINALIZATION_DAILY_HANDLER)
    .timeBased()
    .atHour(17)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('America/Costa_Rica')
    .create();

  // La idempotencia del Apps Script de reportes queda acotada aunque haya
  // muchas boletas durante varios días. La instalación también limpia ahora.
  ScriptApp.newTrigger(DMS_PROPERTY_QUOTA_CLEANUP_HANDLER)
    .timeBased()
    .everyHours(1)
    .create();

  const cleanup = dmsCleanupPropertyQuotaNow();
  const progressGuardsDeleted = cleanupDmsMaintenanceProgressSlotGuards_();
  return 'Triggers DMS instalados para recordatorios de mantenimiento a las 07:00 y 17:00, '
    + 'más finalización a las 17:00 America/Costa_Rica. Cada slot tiene guarda persistente. '
    + 'Protección de cuota instalada cada hora. Propiedades antiguas eliminadas: '
    + cleanup.deleted + '. Guardas antiguas eliminadas: ' + progressGuardsDeleted + '.';
}

function testDmsMaintenanceFinalizationWorker() {
  return callDmsFinalizationWorker_();
}

function testDmsMaintenanceProgressMorning() {
  return callDmsMaintenanceProgressWorker_('07:00');
}

function testDmsMaintenanceProgressAfternoon() {
  return callDmsMaintenanceProgressWorker_('17:00');
}
