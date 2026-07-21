import { AppError } from '../core/errors.js';
import { asBool, pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';
import {
  ensureVisitGroupForTicket,
  ticketVisitNumber,
  visitGroupVersionKey,
} from './ticket-visit-group.service.js';
import { ticketPdfFileName } from './ticket-pdf-name.service.js';

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

function maintenanceSignaturePatch(maintenance = {}) {
  const fileId = clean(pick(maintenance, ['FirmaArchivoID', 'FirmaFileID']));
  const url = clean(pick(maintenance, ['FirmaURL', 'FirmaUrl', 'Firma']));
  if (!fileId && !url) return null;
  return {
    FirmaArchivoID: fileId,
    FirmaURL: url,
    FirmaMimeType: clean(maintenance.FirmaMimeType, 'image/png'),
    FirmaOrigen: clean(maintenance.FirmaOrigen, 'MANTENIMIENTO_GENERAL'),
    FirmaFecha: maintenance.FirmaFecha || maintenance.FechaActualizacion || '',
  };
}

/**
 * Las boletas automáticas deben usar la firma general del mantenimiento como
 * fuente de verdad. Esta combinación se realiza al construir el payload del
 * PDF, además de la sincronización persistente de las filas de Boletas, para
 * evitar que una lectura en caché o una boleta antigua genere un PDF sin firma.
 */
function withMaintenanceSignature(ticket = {}, maintenancesById = new Map()) {
  const maintenanceId = clean(ticket.OrigenMantenimientoID);
  if (!maintenanceId) return ticket;
  const maintenance = maintenancesById.get(maintenanceId);
  const patch = maintenanceSignaturePatch(maintenance);
  return patch ? { ...ticket, ...patch } : ticket;
}

function assignedFor(ticketId, assignments, usersById) {
  return assignments
    .filter((row) => String(row.BoletaUID) === String(ticketId) && row.Activo !== false)
    .map((row) => {
      const user = usersById.get(String(row.UsuarioID));
      return {
        UsuarioID: row.UsuarioID,
        Nombre: clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], row.NombreUsuarioSnapshot || row.UsuarioID)),
        NombreUsuario: clean(user?.NombreUsuario),
        Correo: clean(user?.Correo),
      };
    });
}

async function loadTicketGroupBundle(ticketId) {
  const [group, tables] = await Promise.all([
    ensureVisitGroupForTicket(ticketId),
    readTables(['BoletaAsignados', 'Usuarios', 'EvidenciasBoleta', 'Clientes', 'Mantenimiento']),
  ]);
  const usersById = new Map(tables.Usuarios.map((user) => [String(user.UsuarioID), user]));
  const maintenancesById = new Map(
    tables.Mantenimiento.map((maintenance) => [String(maintenance.MantenimientoID), maintenance]),
  );
  const visits = group.visits.map((storedTicket) => {
    const ticket = withMaintenanceSignature(storedTicket, maintenancesById);
    const assigned = assignedFor(ticket.BoletaUID, tables.BoletaAsignados, usersById);
    const evidences = tables.EvidenciasBoleta
      .filter((row) => String(row.BoletaUID) === String(ticket.BoletaUID) && row.Activo !== false)
      .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0))
      .map((evidence) => ({
        ...evidence,
        NumeroVisita: ticketVisitNumber(ticket),
        BoletaID: ticket.BoletaID || ticket.BoletaUID,
      }));
    return {
      ticket: { ...ticket, NumeroVisita: ticketVisitNumber(ticket) },
      assigned,
      evidences,
    };
  });
  const assignedMap = new Map();
  visits.flatMap((visit) => visit.assigned).forEach((item) => {
    assignedMap.set(String(item.UsuarioID || item.Correo || item.Nombre), item);
  });
  const assigned = [...assignedMap.values()];
  const evidences = visits.flatMap((visit) => visit.evidences);
  const ticket = withMaintenanceSignature(group.root, maintenancesById);
  const client = tables.Clientes.find((row) => String(row.ClienteID) === String(ticket.ClienteID)) || null;
  const creatorUser = usersById.get(String(ticket.CreadoPor));
  const creator = creatorUser ? {
    UsuarioID: creatorUser.UsuarioID,
    Nombre: clean(pick(creatorUser, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'])),
    NombreUsuario: clean(creatorUser.NombreUsuario),
    Correo: clean(creatorUser.Correo),
  } : null;
  return {
    ticket,
    group,
    visits,
    assigned,
    evidences,
    client,
    creator,
  };
}

function resolveRecipients(bundle, config, testMode, override = null, forceClient = false) {
  if (override) {
    const to = splitEmails(override.to || []);
    const cc = splitEmails(override.cc || []).filter((email) => !to.includes(email));
    return { to, cc };
  }
  if (testMode) {
    const testEmail = clean(process.env.TEST_NOTIFICATION_EMAIL || config.TEST_EMAIL, 'andrick.almengor@solutionsdms.com');
    return { to: splitEmails(testEmail), cc: [] };
  }

  const supervisorEmails = splitEmails(bundle.visits.map((visit) => visit.ticket.CorreoSupervisor));
  const technicianEmails = splitEmails(bundle.assigned.map((item) => item.Correo));
  const clientEmails = splitEmails(bundle.ticket.CorreoCliente);
  const includeClient = forceClient || asBool(bundle.ticket.EnviarCorreoCliente, false);
  const to = supervisorEmails.length
    ? supervisorEmails
    : technicianEmails.length
      ? technicianEmails
      : includeClient
        ? clientEmails
        : [];
  const cc = [
    ...(supervisorEmails.length ? technicianEmails : []),
    ...splitEmails(config.DEFAULT_CC_EMAILS),
    ...splitEmails(bundle.ticket.CorreosCC),
    ...(includeClient ? clientEmails : []),
  ].filter((email, index, all) => !to.includes(email) && all.indexOf(email) === index);
  return { to, cc };
}

function signatureVersionKey(bundle) {
  const signatures = bundle.visits
    .map((visit) => clean(
      visit.ticket.FirmaArchivoID
      || visit.ticket.FirmaFileID
      || visit.ticket.FirmaURL,
    ))
    .filter(Boolean);
  return signatures.length ? [...new Set(signatures)].join('-').slice(0, 140) : 'sin-firma';
}

async function requestKey(bundle, testMode, sendEmail, deliveryType = '') {
  const version = await visitGroupVersionKey(bundle.group.rootId);
  const signatureVersion = signatureVersionKey(bundle);
  if (testMode) return `test-group:${bundle.group.id}:${signatureVersion}:${Date.now()}`;
  if (deliveryType === 'SIGNED') return `signed-group:${bundle.group.id}:${version}:${signatureVersion}`;
  return `${sendEmail ? 'final-group' : 'pdf-group'}:${bundle.group.id}:${version}:${signatureVersion}`;
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

  const [bundle, config] = await Promise.all([loadTicketGroupBundle(ticketId), getConfig()]);
  const templateId = clean(process.env.TEMPLATE_BOLETA_ID || config.TEMPLATE_BOLETA_ID, DEFAULT_TEMPLATE_ID);
  const baseFolderId = clean(config.BOLETAS_FOLDER_ID || config.ROOT_FOLDER_ID || process.env.BOLETAS_FOLDER_ID);
  if (!baseFolderId) throw new AppError('REPORT_FOLDER_NOT_CONFIGURED', 'No está configurada la carpeta principal de boletas.', 503);

  const surveyUrl = clean(survey?.url);
  const signatureUrl = clean(signatureRequest?.url);
  const forceClient = Boolean(signatureUrl) || deliveryType === 'SIGNED';
  const recipients = resolveRecipients(bundle, config, testMode, recipientsOverride, forceClient);
  const rootPdfName = ticketPdfFileName(bundle.ticket);
  const rootTicket = {
    ...bundle.ticket,
    EncuestaURL: surveyUrl,
    SurveyURL: surveyUrl,
    FirmaPublicaURL: signatureUrl,
    PDFFileName: rootPdfName,
    NombreArchivoPDF: rootPdfName,
  };
  const surveyPayload = surveyUrl ? {
    id: survey.id,
    url: surveyUrl,
    title: testMode ? 'Encuesta de prueba' : 'Califique nuestro servicio',
    buttonText: testMode ? 'Probar encuesta' : 'Responder encuesta',
    expiresAt: survey.expiresAt,
    type: survey.type || (testMode ? 'PRUEBA' : 'REAL'),
  } : null;

  const visitGroup = {
    id: bundle.group.id,
    rootId: bundle.group.rootId,
    count: bundle.visits.length,
    numbers: bundle.visits.map((visit) => visit.ticket.BoletaID || visit.ticket.BoletaUID),
    visits: bundle.visits.map((visit) => {
      const pdfFileName = ticketPdfFileName(visit.ticket);
      return {
        ticket: {
          ...visit.ticket,
          EncuestaURL: surveyUrl,
          SurveyURL: surveyUrl,
          FirmaPublicaURL: signatureUrl,
          PDFFileName: pdfFileName,
          NombreArchivoPDF: pdfFileName,
        },
        assigned: visit.assigned,
        evidences: visit.evidences,
      };
    }),
  };

  const data = await postAppsScript(url, {
    action: 'ticket.report.deliver',
    secret,
    idempotencyKey: await requestKey(bundle, testMode, sendEmail, deliveryType),
    testMode,
    sendEmail,
    deliveryType,
    templateId,
    baseFolderId,
    ticket: rootTicket,
    assigned: bundle.assigned,
    evidences: bundle.evidences,
    client: bundle.client,
    creator: bundle.creator,
    recipients,
    survey: surveyPayload,
    surveyUrl,
    signature: signatureRequest,
    signatureUrl,
    visitGroup,
  });

  return {
    ...bundle,
    ticket: rootTicket,
    ...data,
    pdfName: rootPdfName,
    pdfNames: bundle.visits.map((visit) => ticketPdfFileName(visit.ticket)),
    testMode,
    recipients,
    survey: surveyPayload,
    signatureRequest,
    signatureIncluded: Boolean(clean(rootTicket.FirmaArchivoID || rootTicket.FirmaURL)),
    visitGroup,
  };
}
