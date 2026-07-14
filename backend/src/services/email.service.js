import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { escapeHtml } from '../core/utils.js';
import { downloadFileBuffer, extractDriveFileId } from '../infra/drive.repository.js';

let transporter;
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

function uniqueEmails(values) {
  return [...new Set((Array.isArray(values) ? values : String(values || '').split(','))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

function nl2br(value) {
  return escapeHtml(value || '').replace(/\r?\n/g, '<br>');
}

function tableRow(label, value) {
  return `<tr>
    <td style="width:28%;padding:10px;border:1px solid #d9dde3;background:#f3f4f6;font-weight:700;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:10px;border:1px solid #d9dde3;vertical-align:top">${value || 'Sin especificar'}</td>
  </tr>`;
}

function formatEvidenceRows(rows) {
  return rows.map((row, index) => `
    <tr>
      <td style="padding:10px;border:1px solid #d9dde3;vertical-align:top">${index + 1}</td>
      <td style="padding:10px;border:1px solid #d9dde3;vertical-align:top">
        <strong>${escapeHtml(row.name)}</strong>
        ${row.note ? `<br><span style="color:#4b5563">${nl2br(row.note)}</span>` : ''}
        ${row.inlineCid ? `<div style="margin-top:10px"><img src="cid:${row.inlineCid}" alt="${escapeHtml(row.name)}" style="display:block;max-width:100%;height:auto;border-radius:6px;border:1px solid #d9dde3"></div>` : ''}
      </td>
      <td style="padding:10px;border:1px solid #d9dde3;vertical-align:top">
        ${row.url ? `<a href="${escapeHtml(row.url)}">Abrir en Drive</a>` : 'Sin enlace'}
        ${row.attached ? '<br><small>Adjunta al correo</small>' : ''}
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
    throw new AppError(
      'SMTP_NOT_CONFIGURED',
      'Faltan SMTP_HOST, SMTP_USER o SMTP_PASS en el backend. El Chat puede funcionar aunque el correo no esté configurado.',
      503,
    );
  }

  const recipients = uniqueEmails(to);
  if (!recipients.length) {
    throw new AppError('REPORT_EMAIL_MISSING', 'No se encontró un correo válido del supervisor ni de los técnicos asignados.', 400);
  }
  const copyRecipients = testMode ? [] : uniqueEmails(cc).filter((email) => !recipients.includes(email));
  const ticket = report.ticket;
  const maxBytes = Math.max(1, Number(process.env.MAX_EMAIL_ATTACHMENT_MB || 20)) * 1024 * 1024;
  const attachments = [{ filename: report.pdfName, content: report.pdfBuffer, contentType: 'application/pdf' }];
  let accumulatedBytes = report.pdfBuffer.length;
  const evidenceRows = [];

  for (let index = 0; index < report.evidences.length; index += 1) {
    const evidence = report.evidences[index];
    const fileId = extractDriveFileId(evidence.ArchivoID || evidence.ArchivoURL);
    const name = String(evidence.Nombre || evidence.NombreArchivo || `Evidencia ${index + 1}`);
    const item = { name, note: String(evidence.Nota || ''), url: String(evidence.ArchivoURL || ''), attached: false, inlineCid: '' };
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
      } catch (error) {
        console.warn(`[ticket-email] No se pudo adjuntar la evidencia ${name}: ${error.message}`);
      }
    }
    evidenceRows.push(item);
  }

  const assignedNames = report.assigned.map((item) => item.Nombre).filter(Boolean).join(', ');
  const creator = report.creator || {};
  const creatorValue = creator.Correo
    ? `<a href="mailto:${escapeHtml(creator.Correo)}">${escapeHtml(creator.Correo)}</a>`
    : escapeHtml(creator.Nombre || creator.NombreCompleto || ticket.CreadoPor || '');
  const subject = `${testMode ? '[PRUEBA] ' : ''}Reporte técnico DMS - Boleta #${ticket.BoletaID || ticket.BoletaUID}`;
  const evidenceHtml = formatEvidenceRows(evidenceRows);
  const rows = [
    tableRow('Fecha', escapeHtml(ticket.Fecha || '')),
    tableRow('Cliente', escapeHtml(ticket.Cliente || '')),
    tableRow('Categoría', escapeHtml(ticket.Categoria || '')),
    tableRow('Tipo de falla', escapeHtml(ticket.TipoFalla || '')),
    tableRow('Título', escapeHtml(ticket.Titulo || '')),
    tableRow('Asignado a', escapeHtml(assignedNames)),
    tableRow('Estado', testMode ? 'Prueba' : 'Finalizado'),
    tableRow('Hora de inicio', escapeHtml(ticket.HoraInicio || '')),
    tableRow('Hora de finalización', escapeHtml(ticket.HoraFinal || '')),
    tableRow('Horas totales', escapeHtml(ticket.HorasTotales || '0.00')),
    tableRow('Razón de visita', nl2br(ticket.RazonVisita)),
    tableRow('Descripción', nl2br(ticket.Descripcion)),
    tableRow('Pruebas realizadas', nl2br(ticket.PruebasRealizadas)),
    tableRow('Resultado', nl2br(ticket.Resultado)),
    tableRow('Recomendaciones', nl2br(ticket.Recomendaciones)),
    tableRow('Creado por', creatorValue),
  ].join('');

  const html = `<!doctype html>
  <html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;color:#111827">
    <div style="max-width:900px;margin:0 auto;border:1px solid #d9dde3">
      <div style="background:#242424;color:#ffffff;padding:20px 16px">
        <h1 style="font-size:24px;margin:0 0 12px">${testMode ? 'PRUEBA · ' : ''}Reporte Técnico DMS</h1>
        <p style="margin:0;font-size:15px">Boleta #${escapeHtml(ticket.BoletaID || ticket.BoletaUID)}</p>
      </div>
      <div style="padding:26px 16px">
        ${testMode ? '<p style="padding:10px;background:#fff7ed;border:1px solid #fdba74"><strong>Esta es una prueba.</strong> No se cambió el estado ni se notificó al cliente.</p>' : ''}
        <p>Estimado/a,</p>
        <p>Adjunto encontrará el reporte técnico correspondiente a la gestión realizada.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:18px">${rows}</table>
        <p style="margin:20px 0">
          <a href="${escapeHtml(report.pdfUrl)}">Abrir PDF</a> ·
          <a href="${escapeHtml(report.documentUrl)}">Abrir documento</a> ·
          <a href="${escapeHtml(report.folderUrl)}">Abrir carpeta</a>
        </p>
        <h2 style="font-size:19px;margin-top:28px">Evidencias fotográficas (${evidenceRows.length})</h2>
        ${evidenceRows.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:10px;border:1px solid #d9dde3;text-align:left">#</th><th style="padding:10px;border:1px solid #d9dde3;text-align:left">Evidencia</th><th style="padding:10px;border:1px solid #d9dde3;text-align:left">Archivo</th></tr></thead><tbody>${evidenceHtml}</tbody></table>` : '<p>Sin evidencias.</p>'}
        <p style="margin-top:22px;color:#6b7280;font-size:12px">El PDF y las evidencias permitidas por el límite del servidor se adjuntan al correo. Todos los archivos conservan su enlace de Drive.</p>
      </div>
    </div>
  </body></html>`;

  const text = [
    `${testMode ? 'PRUEBA - ' : ''}Reporte Técnico DMS`,
    `Boleta #${ticket.BoletaID || ticket.BoletaUID}`,
    `Cliente: ${ticket.Cliente || ''}`,
    `Asignado a: ${assignedNames}`,
    `Resultado: ${ticket.Resultado || ''}`,
    `PDF: ${report.pdfUrl}`,
    `Evidencias: ${evidenceRows.length}`,
  ].join('\n');

  let info;
  try {
    info = await transport.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: recipients.join(','),
      cc: copyRecipients.join(',') || undefined,
      subject,
      text,
      html,
      attachments,
    });
  } catch (error) {
    throw new AppError('SMTP_SEND_FAILED', `No fue posible enviar el correo: ${error.message}`, 502);
  }

  if (!info.accepted?.length) {
    throw new AppError('SMTP_REJECTED', `El servidor SMTP rechazó todos los destinatarios: ${(info.rejected || []).join(', ')}`, 502);
  }

  return {
    sent: true,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected || [],
    destination: recipients.join(','),
    cc: copyRecipients.join(','),
    attachmentCount: attachments.length,
  };
}
