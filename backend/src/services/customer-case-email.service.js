import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { escapeHtml } from '../core/utils.js';
import { downloadFileBuffer } from '../infra/drive.repository.js';

const DEFAULT_ADMIN_RECIPIENTS = Object.freeze([
  'yehuda.karmona@solutionsdms.com',
  'raul.mayorga@solutionsdms.com',
  'alejandra.umana@solutionsdms.com',
]);

let transporter = null;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(source
    .map((item) => clean(item, 320).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function adminRecipients() {
  const configured = validEmails(process.env.CUSTOMER_CASE_ADMIN_EMAILS || '');
  return configured.length ? configured : [...DEFAULT_ADMIN_RECIPIENTS];
}

function mailTransport() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    throw new AppError(
      'SMTP_NOT_CONFIGURED',
      'El caso fue creado, pero el correo no pudo enviarse porque SMTP no está configurado.',
      503,
    );
  }
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

function bodyHtml(body) {
  return clean(body)
    .split(/\r?\n/)
    .map((line) => line.trim() ? `<p style="margin:0 0 12px;line-height:1.55">${escapeHtml(line)}</p>` : '<div style="height:6px"></div>')
    .join('');
}

function detailRow(label, value) {
  return `<tr>
    <td style="width:30%;padding:10px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:700;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:10px;border:1px solid #e5e7eb;vertical-align:top">${escapeHtml(clean(value, 5000) || 'Sin especificar')}</td>
  </tr>`;
}

async function evidenceAttachments(evidences = []) {
  const maxBytes = Math.max(1, Number(process.env.CUSTOMER_CASE_EMAIL_ATTACHMENT_MB || 18)) * 1024 * 1024;
  let accumulated = 0;
  const attachments = [];
  const rows = [];

  for (let index = 0; index < evidences.length; index += 1) {
    const evidence = evidences[index];
    const name = clean(evidence.NombreArchivo || `Evidencia ${index + 1}`, 200);
    const item = {
      name,
      url: clean(evidence.DriveURL, 1000),
      attached: false,
      note: clean(evidence.Nota, 1000),
    };
    const fileId = clean(evidence.DriveFileID, 200);
    if (fileId) {
      try {
        const file = await downloadFileBuffer(fileId, evidence.MimeType || 'application/octet-stream');
        if (accumulated + file.buffer.length <= maxBytes) {
          attachments.push({
            filename: file.name || name,
            content: file.buffer,
            contentType: file.mimeType,
          });
          accumulated += file.buffer.length;
          item.attached = true;
        }
      } catch (error) {
        console.warn(`[customer-case-email] No se pudo adjuntar ${name}: ${error.message}`);
      }
    }
    rows.push(item);
  }

  return { attachments, rows };
}

function evidenceHtml(rows = []) {
  if (!rows.length) return '<p style="color:#6b7280">El cliente no adjuntó evidencias.</p>';
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="padding:9px;border:1px solid #e5e7eb;text-align:left">Archivo</th><th style="padding:9px;border:1px solid #e5e7eb;text-align:left">Acceso</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td style="padding:9px;border:1px solid #e5e7eb"><strong>${escapeHtml(row.name)}</strong>${row.note ? `<br><small>${escapeHtml(row.note)}</small>` : ''}</td>
      <td style="padding:9px;border:1px solid #e5e7eb">${row.url ? `<a href="${escapeHtml(row.url)}">Abrir en Drive</a>` : 'Sin enlace'}${row.attached ? '<br><small>También se adjunta al correo</small>' : ''}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function caseEmailHtml({ heading, message, caseData, evidences, ticketUrl = '' }) {
  const rows = [
    detailRow('Caso', caseData.CasoNumero || caseData.CasoID),
    detailRow('Cliente', caseData.Cliente),
    detailRow('Generado por', `${caseData.NombreSolicitante || ''}${caseData.CorreoSolicitante ? ` · ${caseData.CorreoSolicitante}` : ''}`),
    detailRow('Razón de visita', caseData.RazonVisita),
    detailRow('Problema reportado', caseData.Problema),
    caseData.FechaVisita ? detailRow('Fecha programada', `${caseData.FechaVisita}${caseData.HoraVisita ? ` · ${caseData.HoraVisita}` : ''}`) : '',
    caseData.TecnicoNombres ? detailRow('Técnicos', caseData.TecnicoNombres) : '',
    caseData.MensajeAdministrador ? detailRow('Mensaje del administrador', caseData.MensajeAdministrador) : '',
  ].filter(Boolean).join('');

  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
    <div style="max-width:820px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
      <header style="background:#202020;color:#ffffff;padding:22px 24px;border-bottom:5px solid #ff5c70">
        <h1 style="margin:0;font-size:23px">${escapeHtml(heading)}</h1>
        <p style="margin:8px 0 0;color:#f3f4f6">DMS Boletas · Gestión de casos</p>
      </header>
      <main style="padding:24px">
        ${bodyHtml(message)}
        <table style="width:100%;border-collapse:collapse;margin:20px 0">${rows}</table>
        ${ticketUrl ? `<p style="margin:18px 0"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;padding:11px 16px;border-radius:9px;background:#ff5c70;color:#ffffff;text-decoration:none;font-weight:700">Abrir boleta en DMS</a></p>` : ''}
        <h2 style="font-size:18px;margin:26px 0 12px">Evidencias del caso (${evidences.length})</h2>
        ${evidenceHtml(evidences)}
      </main>
      <footer style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px">Mensaje generado por DMS Boletas. Verifique la boleta antes de ejecutar la visita.</footer>
    </div>
  </body></html>`;
}

async function sendCaseEmail({ to, subject, body, caseData, evidences = [], heading, ticketUrl = '' }) {
  const recipients = validEmails(to);
  if (!recipients.length) throw new AppError('CASE_EMAIL_MISSING', 'No hay destinatarios válidos para el correo del caso.', 400);
  const evidence = await evidenceAttachments(evidences);
  const transport = mailTransport();
  let info;
  try {
    info = await transport.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: recipients.join(','),
      subject: clean(subject, 180),
      text: clean(body),
      html: caseEmailHtml({
        heading,
        message: body,
        caseData,
        evidences: evidence.rows,
        ticketUrl,
      }),
      attachments: evidence.attachments,
    });
  } catch (error) {
    throw new AppError('CASE_EMAIL_SEND_FAILED', `No fue posible enviar el correo del caso: ${error.message}`, 502);
  }
  if (!info.accepted?.length) {
    throw new AppError('CASE_EMAIL_REJECTED', 'El servidor SMTP rechazó todos los destinatarios.', 502);
  }
  return {
    sent: true,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected || [],
    attachmentCount: evidence.attachments.length,
  };
}

export function sendNewCustomerCaseEmail({ caseData, evidences, message }) {
  return sendCaseEmail({
    to: adminRecipients(),
    subject: message.subject,
    body: message.body,
    caseData,
    evidences,
    heading: 'Nuevo caso de cliente',
  });
}

export function sendAssignedCustomerCaseEmail({ caseData, evidences, message, technicians, ticketUrl }) {
  return sendCaseEmail({
    to: (technicians || []).map((item) => item.Correo),
    subject: message.subject,
    body: message.body,
    caseData,
    evidences,
    heading: 'Caso asignado para visita',
    ticketUrl,
  });
}

export const CUSTOMER_CASE_ADMIN_RECIPIENTS = DEFAULT_ADMIN_RECIPIENTS;
