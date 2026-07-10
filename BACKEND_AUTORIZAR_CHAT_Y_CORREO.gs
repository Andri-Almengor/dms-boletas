/**
 * PARCHE DMS - CONFIGURAR GOOGLE CHAT Y AUTORIZAR CORREO
 *
 * Copie este archivo al MISMO proyecto de Apps Script que está publicado
 * como Web App.
 *
 * Después ejecute desde el editor:
 * 1. configurarNotificacionesDMS(webhookBoletas, webhookPruebas)
 * 2. autorizarYProbarCorreoDMS()
 * 3. verificarNotificacionesDMS()
 */

/**
 * Guarda los webhooks en Script Properties.
 * Puede usar temporalmente el mismo webhook para operación y pruebas,
 * aunque se recomienda un espacio separado para pruebas.
 */
function configurarNotificacionesDMS(webhookBoletas, webhookPruebas) {
  var real = String(webhookBoletas || '').trim();
  var pruebas = String(webhookPruebas || '').trim();

  if (!real || real.indexOf('https://chat.googleapis.com/') !== 0) {
    throw new Error('El webhook de boletas no es válido.');
  }

  if (!pruebas) {
    pruebas = real;
  }

  if (pruebas.indexOf('https://chat.googleapis.com/') !== 0) {
    throw new Error('El webhook de pruebas no es válido.');
  }

  PropertiesService.getScriptProperties().setProperties({
    CHAT_WEBHOOK_BOLETAS: real,
    CHAT_WEBHOOK_PRUEBAS: pruebas
  }, false);

  Logger.log('Webhooks configurados correctamente.');
  Logger.log('Operación y pruebas usan destinos ' + (real === pruebas ? 'iguales.' : 'diferentes.'));

  return {
    ok: true,
    webhookBoletasConfigurado: true,
    webhookPruebasConfigurado: true,
    mismoDestino: real === pruebas
  };
}

/**
 * Fuerza la solicitud del permiso script.send_mail y envía un correo real
 * al correo de pruebas configurado.
 *
 * Ejecute esta función MANUALMENTE desde el editor de Apps Script y acepte
 * todos los permisos solicitados.
 */
function autorizarYProbarCorreoDMS() {
  var props = PropertiesService.getScriptProperties();
  var config = typeof getConfigMap_ === 'function' ? getConfigMap_() : {};
  var destino = String(
    props.getProperty('DMS_TEST_EMAIL') ||
    props.getProperty('TEST_EMAIL') ||
    config.TEST_EMAIL ||
    'andrick.almengor@solutionsdms.com'
  ).trim();

  if (!destino) {
    throw new Error('No existe un correo de prueba configurado.');
  }

  // Esta llamada obliga a Apps Script a solicitar script.send_mail.
  MailApp.sendEmail({
    to: destino,
    subject: 'Autorización de correo - DMS WebApp',
    htmlBody:
      '<p>El proyecto de Apps Script ya cuenta con autorización para enviar correos.</p>' +
      '<p>Fecha: ' + new Date().toISOString() + '</p>',
    name: 'DMS WebApp'
  });

  props.setProperty('DMS_TEST_EMAIL', destino);

  Logger.log('Correo de autorización enviado a: ' + destino);
  Logger.log('Cuota restante: ' + MailApp.getRemainingDailyQuota());

  return {
    ok: true,
    enviadoA: destino,
    cuotaRestante: MailApp.getRemainingDailyQuota()
  };
}

/**
 * Comprueba propiedades y realiza una llamada real al webhook de pruebas.
 */
function verificarNotificacionesDMS() {
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty('CHAT_WEBHOOK_BOLETAS');
  var pruebas = props.getProperty('CHAT_WEBHOOK_PRUEBAS');
  var testEmail = props.getProperty('DMS_TEST_EMAIL') || props.getProperty('TEST_EMAIL');

  var resultado = {
    ok: Boolean(real && pruebas && testEmail),
    chatBoletas: Boolean(real),
    chatPruebas: Boolean(pruebas),
    correoPruebas: testEmail || '',
    cuotaCorreoRestante: null,
    chatPruebaRespondio: false
  };

  try {
    resultado.cuotaCorreoRestante = MailApp.getRemainingDailyQuota();
  } catch (error) {
    resultado.errorCorreo = error.message;
  }

  if (pruebas) {
    try {
      var response = UrlFetchApp.fetch(pruebas, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          text: 'Prueba de configuración DMS WebApp - ' + new Date().toISOString()
        }),
        muteHttpExceptions: true
      });

      resultado.chatStatus = response.getResponseCode();
      resultado.chatPruebaRespondio = response.getResponseCode() >= 200 && response.getResponseCode() < 300;
      resultado.chatRespuesta = response.getContentText();
    } catch (error) {
      resultado.errorChat = error.message;
    }
  }

  resultado.ok = Boolean(
    resultado.chatBoletas &&
    resultado.chatPruebas &&
    resultado.correoPruebas &&
    resultado.chatPruebaRespondio &&
    resultado.cuotaCorreoRestante !== null
  );

  Logger.log(JSON.stringify(resultado));
  return resultado;
}

/**
 * Alternativa rápida: si CHAT_WEBHOOK_BOLETAS ya existe, lo reutiliza
 * como webhook de pruebas.
 */
function copiarWebhookBoletasComoPruebasDMS() {
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty('CHAT_WEBHOOK_BOLETAS');

  if (!real) {
    throw new Error('Primero debe configurar CHAT_WEBHOOK_BOLETAS.');
  }

  props.setProperty('CHAT_WEBHOOK_PRUEBAS', real);
  return { ok: true, mismoDestino: true };
}
