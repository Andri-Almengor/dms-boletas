import { AppError } from '../core/errors.js';
import { asBool, pick } from '../core/utils.js';
import { findById, readTables } from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';

const DEFAULT_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function splitEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(source
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function hasSignature(ticket = {}) {
  return Boolean(clean(pick(ticket, ['FirmaArchivoID', 'FirmaFileID', 'FirmaURL', 'FirmaUrl', 'Firma'])));
}

async function loadTicketBundle(ticketId) {
  const ticket = await findById('Boletas', ticketId);
  const tables = await readTables(['BoletaAsignados', 'Usuarios', 'EvidenciasBoleta', 'Clientes']);
  const usersById = new Map(tables.Usuarios.map((user) => [String(user.UsuarioID), user]));
  const assigned = tables.BoletaAsignados
    .filter((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && row.Activo !== false)
    .map((row) => {
      const user = usersById.get(String(row.UsuarioID));
      return {
        UsuarioID: row.UsuarioID,
        Nombre: clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], row.NombreUsuarioSnapshot || row.UsuarioID)),
        NombreUsuario: clean(user?.NombreUsuario),
        Correo: clean(user?.Correo),
      };
    });
  const evidences = tables.EvidenciasBoleta
    .filter((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && row.Activo !== false)
    .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
  const client = tables.Clientes.find((row) => String(row.ClienteID) === String(ticket.ClienteID)) || null;
  const creatorUser = usersById.get(String(ticket.CreadoPor));
  const creator = creatorUser ? {
    UsuarioID: creatorUser.UsuarioID,
    Nombre: clean(pick(creatorUser, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'])),
    NombreUsuario: clean(creatorUser.NombreUsuario),
    Correo: clean(creatorUser.Correo),
  } : null;
  return { ticket, assigned, evidences, client, creator };
}

function resolveRecipients(bundle, config, testMode, override = null) {
  if (override) {
    const to = splitEmails(override.to || []);
    const cc = splitEmails(override.cc || []).filter((email) => !to.includes(email));
    return { to, cc };
  }
  if (testMode) {
    const testEmail = clean(process.env.TEST_NOTIFICATION_EMAIL || config.TEST_EMAIL, 'andrick.almengor@solutionsdms.com');
    return { to: splitEmails(testEmail), cc: [] };
  }

  const supervisorEmails = splitEmails(bundle.ticket.CorreoSupervisor);
  const technicianEmails = splitEmails(bundle.assigned.map((item) => item.Correo));
  const to = supervisorEmails.length ? supervisorEmails : technicianEmails;
  const cc = [
    ...(supervisorEmails.length ? technicianEmails : []),
    ...splitEmails(config.DEFAULT_CC_EMAILS),
    ...splitEmails(bundle.ticket.CorreosCC),
    ...(asBool(bundle.ticket.EnviarCorreoCliente, false) ? splitEmails(bundle.ticket.CorreoCliente) : []),
  ].filter((email, index, all) => !to.includes(email) && all.indexOf(email) === index);
  return { to, cc };
}

function requestKey(ticket, testMode, sendEmail, deliveryType = '') {
  const version = ticket.Version || ticket.FechaActualizacion || ticket.FinalizadaEn || '1';
  if (testMode) return `test:${ticket.BoletaUID}:${Date.now()}`;
  if (deliveryType === 'SIGNED') return `signed:${ticket.BoletaUID}:${version}`;
  return `${sendEmail ? 'final' : 'pdf'}:${ticket.BoletaUID}:${version}`;
}

async function postAppsScript(url, payload) {
  const timeoutMs = Math.max(30_000, Number(process.env.APPS_SCRIPT_TIMEOUT_MS || 330_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError('APPS_SCRIPT_INVALID_RESPONSE', `Apps Script respondió con un formato inválido (${response.status}).`, 502, { preview: text.slice(0, 300) });
    }
    if (!response.ok || !parsed.ok) {
      throw new AppError(
        parsed?.error?.code || 'APPS_SCRIPT_REPORT_FAILED',
        parsed?.error?.message || `Apps Script rechazó la solicitud (${response.status}).`,
        502,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError('APPS_SCRIPT_TIMEOUT', 'Apps Script tardó demasiado en generar el reporte.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateTicketWithAppsScript({
  ticketId,
  testMode = false,
  sendEmail = true,
  survey = null,
  signatureRequest = null,
  recipientsOverride = null,
  deliveryType = '',
}) {
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET);
  if (!url) throw new AppError('APPS_SCRIPT_URL_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_URL en el backend.', 503);
  if (!secret) throw new AppError('APPS_SCRIPT_SECRET_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_SECRET en el backend.', 503);

  const [bundle, config] = await Promise.all([loadTicketBundle(ticketId), getConfig()]);
  const templateId = clean(process.env.TEMPLATE_BOLETA_ID || config.TEMPLATE_BOLETA_ID, DEFAULT_TEMPLATE_ID);
  const baseFolderId = clean(config.BOLETAS_FOLDER_ID || config.ROOT_FOLDER_ID || process.env.BOLETAS_FOLDER_ID);
  if (!baseFolderId) throw new AppError('REPORT_FOLDER_NOT_CONFIGURED', 'No está configurada la carpeta principal de boletas.', 503);

  const recipients = resolveRecipients(bundle, config, testMode, recipientsOverride);
  const surveyUrl = clean(survey?.url);
  const signatureUrl = !hasSignature(bundle.ticket) ? clean(signatureRequest?.url) : '';
  const ticketForDelivery = {
    ...bundle.ticket,
    EncuestaURL: surveyUrl,
    SurveyURL: surveyUrl,
    FirmaPublicaURL: signatureUrl,
    SignatureURL: signatureUrl,
  };
  const surveyPayload = surveyUrl ? {
    id: survey.id,
    url: surveyUrl,
    title: testMode ? 'Encuesta de prueba' : 'Califique nuestro servicio',
    buttonText: testMode ? 'Probar encuesta' : 'Responder encuesta',
    expiresAt: survey.expiresAt,
    type: survey.type || (testMode ? 'PRUEBA' : 'REAL'),
  } : null;
  const signaturePayload = signatureUrl ? {
    id: signatureRequest?.id || '',
    url: signatureUrl,
    title: 'Firma pendiente del cliente',
    buttonText: 'Firmar boleta',
    expiresAt: signatureRequest?.expiresAt || '',
    status: signatureRequest?.status || 'PENDIENTE',
  } : null;

  const data = await postAppsScript(url, {
    action: 'ticket.report.deliver',
    secret,
    idempotencyKey: requestKey(bundle.ticket, testMode, sendEmail, deliveryType),
    testMode,
    sendEmail,
    deliveryType,
    templateId,
    baseFolderId,
    ticket: ticketForDelivery,
    assigned: bundle.assigned,
    evidences: bundle.evidences,
    client: bundle.client,
    creator: bundle.creator,
    recipients,
    survey: surveyPayload,
    surveyUrl,
    signature: signaturePayload,
    signatureUrl,
  });

  return {
    ...bundle,
    ticket: ticketForDelivery,
    ...data,
    pdfName: `Boleta ${bundle.ticket.BoletaID || bundle.ticket.BoletaUID}.pdf`,
    testMode,
    deliveryType,
    recipients,
    survey: surveyPayload,
    signatureRequest: signaturePayload,
  };
}
