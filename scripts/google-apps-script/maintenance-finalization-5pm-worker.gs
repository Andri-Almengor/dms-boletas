/*
 * DMS Boletas · Worker de finalización de mantenimientos a las 5:00 p. m.
 *
 * Script Properties requeridas:
 *   DMS_APP_URL                      https://tu-app.onrender.com
 *   DMS_FINALIZATION_WAKE_SECRET     mismo valor que MAINTENANCE_FINALIZATION_WAKE_SECRET en Render
 *
 * Zona horaria recomendada del proyecto de Apps Script: America/Costa_Rica
 */

const DMS_FINALIZATION_DAILY_HANDLER = 'wakeDmsMaintenanceFinalizationsAtFive';
const DMS_FINALIZATION_RETRY_HANDLER = 'retryDmsMaintenanceFinalizations';
const DMS_FINALIZATION_MAX_EXECUTION_MS = 4 * 60 * 1000;
const DMS_FINALIZATION_WAKE_WAIT_MS = 25000;
const DMS_FINALIZATION_RETRY_AFTER_MS = 5 * 60 * 1000;

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

function callDmsFinalizationWorker_() {
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
    if (handler === DMS_FINALIZATION_DAILY_HANDLER || handler === DMS_FINALIZATION_RETRY_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // nearMinute(0) puede ejecutarse aproximadamente ±15 minutos. Si ocurre
  // antes de las 17:00, el backend devuelve nextDueAt y se instala un retry exacto.
  ScriptApp.newTrigger(DMS_FINALIZATION_DAILY_HANDLER)
    .timeBased()
    .atHour(17)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('America/Costa_Rica')
    .create();

  return 'Trigger DMS de finalización instalado para las 17:00 America/Costa_Rica.';
}

function testDmsMaintenanceFinalizationWorker() {
  return callDmsFinalizationWorker_();
}
