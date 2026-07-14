import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { escapeHtml } from '../core/utils.js';
import { downloadFileBuffer, extractDriveFileId } from '../infra/drive.repository.js';

let transporter;
function getTransporter() {
  if (!env.smtpHost) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transporter;
}

function uniqueEmails(values) {
  return [...new Set((Array.isArray(values) ? values : String(values || '').split(','))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

function nl2br(value) {
  return escapeHtml(value || '').replace(/\r?\n/g, '<br>');
}

function formatEvidenceRows(rows) {
  return rows.map((row, index) => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;vertical-align:top">${index + 1}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <strong>${escapeHtml(row.name)}</strong>
        ${row.note ? `<br><span style="color:#4b5563">${nl2br(row.note)}</span>` : ''}
        ${row.inlineCid ? `<div style="margin-top:10px"><img src="cid:${row.inlineCid}" alt="${escapeHtml(row.name)}" style="display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb"></div>` : ''}
      </td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        ${row.url ? `<a href="${escapeHtml(row.url)}">Abrir en Drive</a>` : 'Sin enlace'}
        ${row.attached ? '<br><small>Incluido como adjunto</small>' : ''}
      </td>
    </tr>`).join('');
}

export async function sendTemporaryCredentials(user, password) {
  const transport = getTransporter();
  if (!transport) return { sent: false, skipped: true, reason: 'SMTP no configurado.' };
  const name = user.NombreCompleto || user.NombreUsuario || 'Usuario';
  const link = env.appPublicUrl ? `<p><a href="${escapeHtml(env.appPublicUrl)}">Abrir DMS Boletas</a></p>` : '<p>El enlace será compartido posteriormente por el administrador.</p>';
  const info = await transport.sendMail({
    from: env.smtpFrom,
    to: user.Correo,
    subject: 'Tu acceso temporal a DMS Boletas',
    text: `Hola ${name}\n\nUsuario: ${user.NombreUsuario}\nContraseña temporal: ${password}\n${env.appPublicUrl || 'El enlace será compartido posteriormente.'}\n\nDebes cambiar la contraseña al iniciar sesión.`,
    html: `<div style="font-family:Arial;max-width:600px"><h2>DMS Boletas</h2><p>Hola ${escapeHtml(name)},</p><p>Se creó una cuenta para ti.</p><p><b>Usuario:</b> ${escapeHtml(user.NombreUsuario)}<br><b>Contraseña temporal:</b> <code>${escapeHtml(password)}</code></p>${link}<p>Debes cambiar la contraseña al iniciar sesión.</p></div>`,
  });
  return { sent: true, messageId: info.messageId, destination: user.Correo, linkConfigured: Boolean(env.appPublicUrl) };
}

export async function sendTicketReportEmail({ report, to, cc = [], testMode = false }) {
  const transport = getTransporter();
  if (!transport) {
    throw new AppError('SMTP_NOT_CONFIGURED', 'El correo SMTP no está configurado en el backend.', 503);
  }

  const recipients = uniqueEmails(to);
  if (!recipients.length) {
    throw new AppError('REPORT_EMAIL_MISSING', 'La boleta no tiene un correo de supervisor válido.', 400);
  }
  const copyRecipients = testMode ? [] : uniqueEmails(cc).filter((email) => !recipients.includes(email));
  const ticket = report.ticket;
  const maxBytes = Math.max(1, Number(process.env.MAX_EMAIL_ATTACHMENT_MB || 20)) * 1024 * 1024;
  const attachments = [{
    filename: report.pdfName,
    content: report.pdfBuffer,
    contentType: 'application/pdf',
  }];
  let accumulatedBytes = report.pdfBuffer.length;
  const evidenceRows = [];

  for (let index = 0; index < report.evidences.length; index += 1) {
    const evidence = report.evidences[index];
    const fileId = extractDriveFileId(evidence.ArchivoID || evidence.ArchivoURL);
    const name = String(evidence.Nombre || evidence.NombreArchivo || `Evidencia ${index + 1}`);
    const item = {
      name,
      note: String(evidence.Nota || ''),
      url: String(evidence.ArchivoURL || ''),
      attached: false,
      inlineCid: '',
    };

    if (fileId) {
      try {
        const file = await downloadFileBuffer(fileId, evidence.MimeType || 'application/octet-stream');
        if (accumulatedBytes + file.buffer.length <= maxBytes) {
          const cid = /^image\//i.test(file.mimeType) ? `evidence-${index + 1}-${ticket.BoletaUID}@dms` : undefined;
          attachments.push({
            filename: file.name || evidence.NombreArchivo || name,
            content: file.buffer,
            contentType: file.mimeType,
            cid,
            contentDisposition: cid ? 'inline' : 'attachment',
          });
          accumulatedBytes += file.buffer.length;
          item.attached = true;
          item.inlineCid = cid || '';
        }
      } catch {
        // El correo conserva el enlace aunque un archivo individual no pueda descargarse.
      }
    }
    evidenceRows.push(item);
  }

  const assignedNames = report.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
  const subject = `${testMode ? '[PRUEBA] ' : ''}Reporte técnico - Boleta #${ticket.BoletaID || ticket.BoletaUID} - ${ticket.Cliente || ''}`;
  const evidenceHtml = formatEvidenceRows(evidenceRows);
  const html = `
  <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:800px;margin:auto">
    <div style="background:#af101a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <h1 style="font-size:22px;margin:0">${testMode ? 'MODO PRUEBA · ' : ''}Reporte técnico DMS</h1>
      <p style="margin:6px 0 0">Boleta #${escapeHtml(ticket.BoletaID || ticket.BoletaUID)}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 10px 10px">
      ${testMode ? '<p style="padding:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px"><strong>Esta es una prueba.</strong> No se cambió el estado de la boleta ni se notificó al cliente.</p>' : ''}
      <h2 style="font-size:18px">${escapeHtml(ticket.Titulo || 'Reporte de visita')}</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px"><strong>Cliente</strong></td><td style="padding:6px">${escapeHtml(ticket.Cliente || '')}</td></tr>
        <tr><td style="padding:6px"><strong>Ubicación</strong></td><td style="padding:6px">${escapeHtml(ticket.Ubicacion || '')}</td></tr>
        <tr><td style="padding:6px"><strong>Ubicación del equipo</strong></td><td style="padding:6px">${escapeHtml(ticket.UbicacionEquipo || '')}</td></tr>
        <tr><td style="padding:6px"><strong>Supervisor</strong></td><td style="padding:6px">${escapeHtml(ticket.Supervisor || '')}</td></tr>
        <tr><td style="padding:6px"><strong>Fecha</strong></td><td style="padding:6px">${escapeHtml(ticket.Fecha || '')}</td></tr>
        <tr><td style="padding:6px"><strong>Horario</strong></td><td style="padding:6px">${escapeHtml(ticket.HoraInicio || '')} - ${escapeHtml(ticket.HoraFinal || '')} (${escapeHtml(ticket.HorasTotales || '0.00')} h)</td></tr>
        <tr><td style="padding:6px"><strong>Equipo</strong></td><td style="padding:6px">${escapeHtml([ticket.TipoDispositivo, ticket.Fabricante, ticket.Modelo, ticket.Serie].filter(Boolean).join(' · '))}</td></tr>
        <tr><td style="padding:6px"><strong>Técnicos</strong></td><td style="padding:6px">${escapeHtml(assignedNames)}</td></tr>
      </table>
      <h3>Razón de visita</h3><p>${nl2br(ticket.RazonVisita)}</p>
      <h3>Descripción</h3><p>${nl2br(ticket.Descripcion)}</p>
      <h3>Pruebas realizadas</h3><p>${nl2br(ticket.PruebasRealizadas)}</p>
      <h3>Resultado</h3><p>${nl2br(ticket.Resultado)}</p>
      <h3>Recomendaciones</h3><p>${nl2br(ticket.Recomendaciones)}</p>
      <p><a href="${escapeHtml(report.pdfUrl)}">Abrir PDF en Google Drive</a> · <a href="${escapeHtml(report.documentUrl)}">Abrir documento</a> · <a href="${escapeHtml(report.folderUrl)}">Abrir carpeta</a></p>
      <h3>Evidencias (${evidenceRows.length})</h3>
      ${evidenceRows.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:9px">#</th><th style="text-align:left;padding:9px">Evidencia</th><th style="text-align:left;padding:9px">Archivo</th></tr></thead><tbody>${evidenceHtml}</tbody></table>` : '<p>Sin evidencias.</p>'}
      <p style="margin-top:22px;color:#6b7280;font-size:12px">El PDF se adjunta a este correo. Las evidencias se incluyen hasta el límite permitido por el servidor de correo; todas conservan su enlace de Drive.</p>
    </div>
  </div>`;

  const text = [
    `${testMode ? 'MODO PRUEBA - ' : ''}Reporte técnico DMS`,
    `Boleta: ${ticket.BoletaID || ticket.BoletaUID}`,
    `Cliente: ${ticket.Cliente || ''}`,
    `Supervisor: ${ticket.Supervisor || ''}`,
    `Resultado: ${ticket.Resultado || ''}`,
    `PDF: ${report.pdfUrl}`,
    `Evidencias: ${evidenceRows.length}`,
  ].join('\n');

  const info = await transport.sendMail({
    from: env.smtpFrom,
    to: recipients.join(','),
    cc: copyRecipients.join(',') || undefined,
    subject,
    text,
    html,
    attachments,
  });

  return {
    sent: true,
    messageId: info.messageId,
    accepted: info.accepted || recipients,
    rejected: info.rejected || [],
    destination: recipients.join(','),
    cc: copyRecipients.join(','),
    attachmentCount: attachments.length,
  };
}
