import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { escapeHtml } from '../core/utils.js';
import { downloadFileBuffer, extractDriveFileId, getDriveFile } from '../infra/drive.repository.js';

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
        // Check metadata BEFORE allocating: a 300 MB video would be rejected
        // by the attachment budget after download in the old implementation.
        const metadata = await getDriveFile(fileId);
        const fits = Number(metadata.size) > 0 && Number(metadata.size) <= maxBytes - accumulatedBytes;
        const file = fits ? await downloadFileBuffer(fileId, evidence.MimeType || 'application/octet-stream') : null;
        if (file && accumulatedBytes + file.buffer.length <= maxBytes) {
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


function parseMaintenanceAnswersForEmail(device = {}) {
  const raw = device.RespuestasJSON || device.respuestas || {};
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function maintenanceAnswerText(value) {
  if (value === undefined || value === null || value === '') return 'Sin respuesta';
  if (typeof value !== 'object' || Array.isArray(value)) return String(value);
  if (Object.prototype.hasOwnProperty.call(value, 'enabled') && Array.isArray(value.items)) {
    if (!value.enabled) return 'No';
    const details = value.items.map((item, index) => [
      item?.nombre || item?.NombreDispositivo || item?.categoria || item?.TipoDispositivo || `Componente ${index + 1}`,
      item?.fabricante || item?.Fabricante,
      item?.modelo || item?.Modelo,
      item?.serie || item?.Serie ? `Serie: ${item?.serie || item?.Serie}` : '',
      item?.macAddress || item?.DireccionMAC ? `MAC: ${item?.macAddress || item?.DireccionMAC}` : '',
    ].filter(Boolean).join(' · '));
    return ['Sí', ...details].join('\n');
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}

function maintenanceQuestionRows(device = {}) {
  const answers = parseMaintenanceAnswersForEmail(device);
  const snapshots = Array.isArray(answers.__preguntas) ? answers.__preguntas : [];
  const labels = new Map(snapshots.map((item) => [
    String(item?.key || item?.Clave || '').trim(),
    String(item?.label || item?.Pregunta || item?.key || '').trim(),
  ]).filter(([key]) => key));
  return Object.entries(answers)
    .filter(([key]) => key !== '__preguntas')
    .map(([key, value]) => ({
      key,
      label: labels.get(key) || key,
      value: maintenanceAnswerText(value),
    }));
}

export async function sendMaintenanceDeviceFaultEmail({ maintenance = {}, device = {}, to = [] } = {}) {
  const transport = getTransporter();
  if (!transport) {
    throw new AppError(
      'SMTP_NOT_CONFIGURED',
      'El dispositivo se guardó, pero el correo de avería no pudo enviarse porque SMTP no está configurado.',
      503,
    );
  }

  const recipients = uniqueEmails(to);
  if (!recipients.length) {
    throw new AppError(
      'MAINTENANCE_FAULT_EMAIL_MISSING',
      'El dispositivo se guardó, pero no hay un destinatario configurado para los avisos de avería.',
      400,
    );
  }

  const maintenanceId = String(maintenance.MantenimientoID || '').trim();
  const maintenanceType = String(maintenance.TipoMantenimiento || 'MANTENIMIENTO').trim().toUpperCase();
  const deviceName = String(device.NombreDispositivo || device.Nombre || 'Equipo').trim();
  const clientName = String(maintenance.Cliente || 'Cliente no especificado').trim();
  const publicBase = String(env.appPublicUrl || '').trim().replace(/\/+$/, '');
  const detailUrl = publicBase && maintenanceId
    ? `${publicBase}/mantenimientos/${encodeURIComponent(maintenanceId)}`
    : '';
  const questions = maintenanceQuestionRows(device);
  const subject = `AVERÍA REPORTADA · ${clientName} · ${deviceName}`;

  const maintenanceRows = [
    ['Tipo', maintenanceType === 'PROYECTO' ? 'Proyecto' : 'Mantenimiento'],
    ['Mantenimiento', maintenanceId],
    ['Título', maintenance.TituloMantenimiento],
    ['Cliente', clientName],
    ['Ubicación', maintenance.Ubicacion],
    ['Fecha', maintenance.Fecha],
    ['Estado', maintenance.Estado],
    ['Responsables', maintenance.Responsables],
    ['Descripción', maintenance.DescripcionGeneral],
  ];
  const deviceRows = [
    ['ID del dispositivo', device.EvidenciaMantenimientoID],
    ['Tipo de dispositivo', device.TipoDispositivo || device.Categoria],
    ['Nombre', deviceName],
    ['Ubicación del equipo', device.Zona || device.UbicacionEquipoNombre],
    ['Fabricante', device.Fabricante],
    ['Modelo', device.Modelo],
    ['Serie', device.Serie],
    ['MAC', device.DireccionMAC],
    ['Funcionamiento', device.Funcionamiento],
    ['En uso', device.EnUso],
    ['Estado', device.Estado],
    ['Técnicos', device.Tecnicos],
    ['Observación', device.Observacion],
  ];

  const text = [
    'DMS Boletas - Avería reportada en equipo',
    '',
    ...maintenanceRows.map(([label, value]) => `${label}: ${String(value || 'Sin especificar')}`),
    '',
    'Detalle del dispositivo',
    ...deviceRows.map(([label, value]) => `${label}: ${String(value || 'Sin especificar')}`),
    ...(questions.length ? ['', 'Respuestas del dispositivo', ...questions.map((row) => `${row.label}: ${row.value}`)] : []),
    ...(detailUrl ? ['', `Abrir mantenimiento: ${detailUrl}`] : []),
  ].join('\n');

  const html = `<!doctype html>
  <html><body style="margin:0;padding:24px;background:#fffafa;font-family:Arial,sans-serif;color:#111827">
    <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #ead5d7;border-radius:14px;overflow:hidden">
      <div style="background:#b90d19;color:#ffffff;padding:22px 24px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9">DMS Boletas</div>
        <h1 style="font-size:22px;margin:6px 0 0">Avería reportada en equipo</h1>
      </div>
      <div style="padding:24px;line-height:1.55">
        <p style="margin-top:0">Se guardó un dispositivo con la respuesta <strong>“Sí”</strong> en <strong>¿Se reporta avería en este equipo?</strong>.</p>
        <h2 style="font-size:17px;margin:24px 0 10px">Datos del mantenimiento</h2>
        <table style="width:100%;border-collapse:collapse">${maintenanceRows.map(([label, value]) => tableRow(label, nl2br(value))).join('')}</table>
        <h2 style="font-size:17px;margin:24px 0 10px">Detalle del dispositivo</h2>
        <table style="width:100%;border-collapse:collapse">${deviceRows.map(([label, value]) => tableRow(label, nl2br(value))).join('')}</table>
        ${questions.length ? `<h2 style="font-size:17px;margin:24px 0 10px">Respuestas del dispositivo</h2><table style="width:100%;border-collapse:collapse">${questions.map((row) => tableRow(row.label, nl2br(row.value))).join('')}</table>` : ''}
        ${detailUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(detailUrl)}" style="display:inline-block;background:#b90d19;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Abrir mantenimiento</a></p>` : ''}
        <p style="margin:24px 0 0;color:#6b7280;font-size:12px">Este aviso corresponde únicamente a la avería reportada en este dispositivo. No reenvía correos de boletas ni mensajes de Google Chat.</p>
      </div>
    </div>
  </body></html>`;

  let info;
  try {
    info = await transport.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: recipients.join(','),
      subject,
      text,
      html,
    });
  } catch (error) {
    throw new AppError(
      'MAINTENANCE_FAULT_EMAIL_FAILED',
      `El dispositivo se guardó, pero falló el envío del correo de avería: ${error.message}`,
      502,
    );
  }

  if (!info.accepted?.length) {
    throw new AppError(
      'MAINTENANCE_FAULT_EMAIL_REJECTED',
      'El dispositivo se guardó, pero el servidor de correo rechazó el aviso de avería.',
      502,
    );
  }

  return {
    sent: true,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected || [],
    destination: recipients.join(','),
  };
}
