import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { escapeHtml } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';

let transporter;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').trim().toLowerCase() !== 'false';
}

function validEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function uniqueEmails(values = []) {
  return [...new Set(values.map(validEmail).filter(Boolean))];
}

function parseIds(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => clean(item, 200)).filter(Boolean))];
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parseIds(parsed);
    } catch {
      // Compatibilidad con datos históricos separados por coma/punto y coma.
    }
    return [...new Set(text.split(/[;,\n\r]+/).map((item) => clean(item, 200)).filter(Boolean))];
  }
  return [clean(value, 200)].filter(Boolean);
}

function getTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPass },
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 15000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 45000),
    });
  }
  return transporter;
}

function formatSignedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value, 100);
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function sendSignatureCompletedEmail({
  recipients = [],
  subjectType = 'ticket',
  reference = '',
  title = '',
  clientName = '',
  signedAt = '',
} = {}) {
  const emails = uniqueEmails(recipients);
  if (!emails.length) {
    return {
      sent: false,
      skipped: true,
      reason: 'No se encontraron correos válidos entre los usuarios asignados.',
      recipientCount: 0,
    };
  }

  const transport = getTransporter();
  if (!transport) {
    return {
      sent: false,
      skipped: true,
      reason: 'SMTP no configurado.',
      recipientCount: emails.length,
    };
  }

  const isMaintenance = subjectType === 'maintenance';
  const label = isMaintenance ? 'mantenimiento' : 'boleta';
  const labelCapitalized = isMaintenance ? 'Mantenimiento' : 'Boleta';
  const safeReference = clean(reference, 500) || 'sin referencia';
  const safeTitle = clean(title, 500);
  const safeClient = clean(clientName, 500) || 'Cliente';
  const signedAtText = formatSignedAt(signedAt);
  const appUrl = clean(env.appPublicUrl, 2000).replace(/\/+$/, '');
  const subject = isMaintenance
    ? `Mantenimiento firmado por el cliente - ${safeTitle || safeReference}`
    : `Boleta ${safeReference} firmada por el cliente`;

  const text = [
    `El cliente ya firmó ${isMaintenance ? 'el mantenimiento' : 'la boleta'} correspondiente.`,
    `${labelCapitalized}: ${safeReference}`,
    safeTitle ? `Título: ${safeTitle}` : '',
    `Cliente: ${safeClient}`,
    signedAtText ? `Fecha de firma: ${signedAtText}` : '',
    appUrl ? `Abrir DMS Boletas: ${appUrl}` : '',
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
  <html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9dde3;border-radius:10px;overflow:hidden">
      <div style="background:#242424;color:#ffffff;padding:20px 24px">
        <h1 style="font-size:21px;margin:0">${escapeHtml(labelCapitalized)} firmado por el cliente</h1>
      </div>
      <div style="padding:24px">
        <p style="margin-top:0">El cliente completó y guardó correctamente la firma ${isMaintenance ? 'del mantenimiento' : 'de la boleta'}.</p>
        <table style="width:100%;border-collapse:collapse;margin:18px 0">
          <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(labelCapitalized)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(safeReference)}</td></tr>
          ${safeTitle ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Título</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(safeTitle)}</td></tr>` : ''}
          <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Cliente</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(safeClient)}</td></tr>
          ${signedAtText ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Fecha de firma</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(signedAtText)}</td></tr>` : ''}
        </table>
        ${appUrl ? `<p><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#242424;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:6px">Abrir DMS Boletas</a></p>` : ''}
        <p style="margin-bottom:0;color:#6b7280;font-size:12px">Este correo es una notificación automática para los usuarios asignados al ${escapeHtml(label)}.</p>
      </div>
    </div>
  </body></html>`;

  let info;
  try {
    info = await transport.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: emails.join(','),
      subject,
      text,
      html,
    });
  } catch (error) {
    throw new AppError(
      'SIGNATURE_NOTIFICATION_EMAIL_FAILED',
      `La firma fue guardada, pero no fue posible notificar a los asignados por correo: ${error.message}`,
      502,
    );
  }

  if (!info.accepted?.length) {
    throw new AppError(
      'SIGNATURE_NOTIFICATION_EMAIL_REJECTED',
      'La firma fue guardada, pero el servidor SMTP rechazó todos los destinatarios asignados.',
      502,
    );
  }

  return {
    sent: true,
    skipped: false,
    messageId: info.messageId,
    recipientCount: emails.length,
    acceptedCount: info.accepted.length,
    rejectedCount: info.rejected?.length || 0,
  };
}

export async function notifyTicketSignatureCompleted({ group, signedAt = '' } = {}) {
  const visits = Array.isArray(group?.visits) && group.visits.length
    ? group.visits
    : group?.root ? [group.root] : [];
  const ticketIds = new Set(visits.map((ticket) => clean(ticket.BoletaUID, 200)).filter(Boolean));
  if (!ticketIds.size) {
    return { sent: false, skipped: true, reason: 'No se pudo identificar la boleta firmada.', recipientCount: 0 };
  }

  const tables = await readTables(['BoletaAsignados', 'Usuarios']);
  const usersById = new Map((tables.Usuarios || [])
    .filter(active)
    .map((user) => [clean(user.UsuarioID, 200), user]));
  const recipients = (tables.BoletaAsignados || [])
    .filter((assignment) => active(assignment) && ticketIds.has(clean(assignment.BoletaUID, 200)))
    .map((assignment) => validEmail(usersById.get(clean(assignment.UsuarioID, 200))?.Correo))
    .filter(Boolean);
  const reference = visits
    .map((ticket) => clean(ticket.BoletaID || ticket.BoletaUID, 200))
    .filter(Boolean)
    .join(', ');
  const root = group?.root || visits[0] || {};

  return sendSignatureCompletedEmail({
    recipients,
    subjectType: 'ticket',
    reference,
    title: root.Titulo,
    clientName: root.Cliente,
    signedAt: signedAt || root.FirmaFecha,
  });
}

export async function notifyMaintenanceSignatureCompleted({ maintenance, signedAt = '' } = {}) {
  const responsibleIds = new Set(parseIds(
    maintenance?.ResponsableIDsJSON
      || maintenance?.ResponsableIDs
      || maintenance?.responsables,
  ));
  if (!responsibleIds.size) {
    return { sent: false, skipped: true, reason: 'El mantenimiento no tiene responsables asignados.', recipientCount: 0 };
  }

  const { Usuarios = [] } = await readTables(['Usuarios']);
  const recipients = Usuarios
    .filter((user) => active(user) && responsibleIds.has(clean(user.UsuarioID, 200)))
    .map((user) => validEmail(user.Correo))
    .filter(Boolean);

  return sendSignatureCompletedEmail({
    recipients,
    subjectType: 'maintenance',
    reference: maintenance?.MantenimientoID,
    title: maintenance?.TituloMantenimiento,
    clientName: maintenance?.Cliente,
    signedAt: signedAt || maintenance?.FirmaFecha,
  });
}
