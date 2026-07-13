/**
 * DMS BOLETAS - ACCESO OPERATIVO E INVITACIONES
 *
 * Este archivo agrega:
 * - Lista segura de personal activo para los campos Asignado a/Responsables.
 * - Envío de credenciales temporales al crear un usuario.
 * - Configuración opcional del enlace de la aplicación para agregarlo después.
 *
 * Consulte BACKEND_TECHNICIAN_ACCESS.md para registrar las rutas y conectar
 * sendNewUserCredentialsEmail_ con apiUsersCreate_.
 */

function apiAssignableUsersList_(ctx) {
  var payload = ctx && ctx.payload ? ctx.payload : {};
  var search = String(payload.search || payload.q || '').trim().toLowerCase();
  var items = getRows_('Usuarios')
    .filter(function(user) {
      return String(user.Estado || 'ACTIVO').toUpperCase() === 'ACTIVO';
    })
    .map(function(user) {
      var safe = typeof sanitizeUser_ === 'function' ? sanitizeUser_(user) : {
        UsuarioID: user.UsuarioID,
        NombreCompleto: user.NombreCompleto,
        NombreUsuario: user.NombreUsuario,
        Correo: user.Correo,
        Estado: user.Estado,
        RolID: user.RolID
      };
      return safe;
    })
    .filter(function(user) {
      if (!search) return true;
      return [user.NombreCompleto, user.NombreUsuario, user.Correo]
        .join(' ')
        .toLowerCase()
        .indexOf(search) >= 0;
    })
    .sort(function(a, b) {
      return String(a.NombreCompleto || a.NombreUsuario || '')
        .localeCompare(String(b.NombreCompleto || b.NombreUsuario || ''), 'es');
    });

  return {
    items: items,
    total: items.length,
    page: 1,
    pageSize: items.length
  };
}

function sendNewUserCredentialsEmail_(user, temporaryPassword, createdByUserId) {
  var email = String(user && user.Correo || '').trim().toLowerCase();
  if (!email) {
    return { sent: false, skipped: true, reason: 'El usuario no tiene correo.' };
  }

  var appUrl = String(
    PropertiesService.getScriptProperties().getProperty('DMS_APP_URL') || ''
  ).trim();
  var name = String(user.NombreCompleto || user.NombreUsuario || 'Usuario');
  var username = String(user.NombreUsuario || email);
  var subject = 'Tu acceso temporal a DMS Boletas';
  var linkText = appUrl
    ? '\nEnlace de acceso: ' + appUrl
    : '\nEl enlace de acceso será compartido por el administrador.';
  var plainBody = [
    'Hola ' + name + ',',
    '',
    'Se creó una cuenta para ti en DMS Boletas.',
    'Usuario: ' + username,
    'Contraseña temporal: ' + temporaryPassword,
    linkText,
    '',
    'Por seguridad, al iniciar sesión deberás cambiar la contraseña temporal.',
    'No compartas estas credenciales con otras personas.',
    '',
    'Digital Management Systems DMS S.A.'
  ].join('\n');

  var linkHtml = appUrl
    ? '<p><a href="' + escapeUserInviteHtml_(appUrl) + '" style="display:inline-block;padding:12px 18px;background:#b7131a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Abrir DMS Boletas</a></p>'
    : '<p style="color:#5b403d">El enlace de acceso será compartido por el administrador.</p>';
  var htmlBody = [
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1a1c1c">',
    '<div style="background:#b7131a;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><strong>DMS Boletas</strong></div>',
    '<div style="border:1px solid #e4beb9;border-top:0;padding:24px;border-radius:0 0 12px 12px">',
    '<h2 style="margin-top:0">Hola ' + escapeUserInviteHtml_(name) + '</h2>',
    '<p>Se creó una cuenta para ti en DMS Boletas.</p>',
    '<div style="background:#f3f3f3;padding:16px;border-radius:10px">',
    '<p style="margin:0 0 8px"><strong>Usuario:</strong> ' + escapeUserInviteHtml_(username) + '</p>',
    '<p style="margin:0"><strong>Contraseña temporal:</strong> <code style="font-size:16px">' + escapeUserInviteHtml_(temporaryPassword) + '</code></p>',
    '</div>',
    linkHtml,
    '<p>Al iniciar sesión deberás cambiar la contraseña temporal.</p>',
    '<p style="font-size:12px;color:#5b403d">No compartas estas credenciales con otras personas.</p>',
    '</div></div>'
  ].join('');

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      name: 'DMS - Accesos'
    });

    logUserInviteNotification_(user, email, 'ENVIADA', '', createdByUserId, appUrl);
    return { sent: true, destination: email, linkConfigured: Boolean(appUrl) };
  } catch (error) {
    logUserInviteNotification_(user, email, 'FALLIDA', error.message, createdByUserId, appUrl);
    return {
      sent: false,
      destination: email,
      linkConfigured: Boolean(appUrl),
      error: error.message
    };
  }
}

function setDmsAppUrl(url) {
  var value = String(url || '').trim();
  if (value && !/^https:\/\//i.test(value)) {
    throw new Error('La URL de la aplicación debe comenzar con https://');
  }
  PropertiesService.getScriptProperties().setProperty('DMS_APP_URL', value);
  return { saved: true, appUrl: value };
}

function getDmsAppUrl() {
  return {
    appUrl: PropertiesService.getScriptProperties().getProperty('DMS_APP_URL') || ''
  };
}

function logUserInviteNotification_(user, email, status, error, createdByUserId, appUrl) {
  if (typeof logNotification_ !== 'function') return;
  try {
    logNotification_(
      'Usuarios',
      user.UsuarioID,
      'EMAIL',
      email,
      'CREDENCIALES_TEMPORALES',
      status,
      { linkConfigured: Boolean(appUrl) },
      error || '',
      createdByUserId || ''
    );
  } catch (ignored) {
    Logger.log('No se pudo registrar la notificación de acceso: ' + ignored.message);
  }
}

function escapeUserInviteHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
