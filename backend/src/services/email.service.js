import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { escapeHtml } from '../core/utils.js';

let transporter;
function getTransporter() {
  if (!env.smtpHost) return null;
  if (!transporter) transporter = nodemailer.createTransport({ host: env.smtpHost, port: env.smtpPort, secure: env.smtpSecure, auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined });
  return transporter;
}

export async function sendTemporaryCredentials(user, password) {
  const transport = getTransporter();
  if (!transport) return { sent: false, skipped: true, reason: 'SMTP no configurado.' };
  const name = user.NombreCompleto || user.NombreUsuario || 'Usuario';
  const link = env.appPublicUrl ? `<p><a href="${escapeHtml(env.appPublicUrl)}">Abrir DMS Boletas</a></p>` : '<p>El enlace será compartido posteriormente por el administrador.</p>';
  const info = await transport.sendMail({ from: env.smtpFrom, to: user.Correo, subject: 'Tu acceso temporal a DMS Boletas', text: `Hola ${name}\n\nUsuario: ${user.NombreUsuario}\nContraseña temporal: ${password}\n${env.appPublicUrl || 'El enlace será compartido posteriormente.'}\n\nDebes cambiar la contraseña al iniciar sesión.`, html: `<div style="font-family:Arial;max-width:600px"><h2>DMS Boletas</h2><p>Hola ${escapeHtml(name)},</p><p>Se creó una cuenta para ti.</p><p><b>Usuario:</b> ${escapeHtml(user.NombreUsuario)}<br><b>Contraseña temporal:</b> <code>${escapeHtml(password)}</code></p>${link}<p>Debes cambiar la contraseña al iniciar sesión.</p></div>` });
  return { sent: true, messageId: info.messageId, destination: user.Correo, linkConfigured: Boolean(env.appPublicUrl) };
}
