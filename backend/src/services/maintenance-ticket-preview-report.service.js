import { AppError, badRequest } from '../core/errors.js';
import { asArray, pick, sha256 } from '../core/utils.js';
import { findById, readTables } from '../infra/sheets.repository.js';
import { getConfig } from '../modules/config.module.js';
import { audit } from './audit.service.js';
import { sendChatMessage } from './chat.service.js';
import { previewMaintenanceTickets } from './maintenance-ticket-generation.service.js';
import { maintenanceSignaturePatch } from './maintenance-signature-request.service.js';
import { ticketPdfFileName } from './ticket-pdf-name.service.js';

const DEFAULT_TEMPLATE_ID = '1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].includes(normalized(value));
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

function dateOnly(value, fallback = '') {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

function technicianIdsFor(device, maintenance) {
  const direct = asArray(device.TecnicoIDsJSON || device.TecnicoIDs || device.tecnicoIds)
    .map((value) => clean(value))
    .filter(Boolean);
  if (direct.length) return [...new Set(direct)].sort();

  const maintenanceIds = asArray(maintenance.ResponsableIDsJSON || maintenance.ResponsableIDs)
    .map((value) => clean(value))
    .filter(Boolean);
  if (maintenanceIds.length) return [...new Set(maintenanceIds)].sort();

  const fallback = clean(device.CreadoPor || maintenance.CreadoPor);
  return fallback ? [fallback] : [];
}

function workDateFor(device, maintenance) {
  return dateOnly(
    device.FechaTrabajo
      || device.FechaRegistroTrabajo
      || device.FechaCreacion,
    dateOnly(maintenance.Fecha, dateOnly(maintenance.FechaCreacion)),
  );
}

function groupKey(date, technicianIds) {
  return `${clean(date)}|${[...new Set((technicianIds || []).map(clean).filter(Boolean))].sort().join(',')}`;
}

function supervisorName(bundle) {
  const contacts = bundle.contacts
    .filter((contact) => active(contact) && String(contact.ClienteID) === String(bundle.maintenance.ClienteID));
  const supervisors = contacts.filter((contact) => asBoolean(contact.EsSupervisor, false) && asBoolean(contact.RecibeCorreo, true));
  const selected = supervisors.length
    ? supervisors
    : contacts.filter((contact) => asBoolean(contact.RecibeCorreo, true));
  const names = [...new Set(selected.map((contact) => clean(contact.Nombre)).filter(Boolean))];
  return names.join(', ')
    || clean(bundle.client?.Contacto)
    || clean(bundle.maintenance.Responsables)
    || 'Sin especificar';
}

async function loadBundle(maintenanceId) {
  const [maintenance, tables] = await Promise.all([
    findById('Mantenimiento', maintenanceId),
    readTables([
      'Evidencia_Mantenimientos',
      'Mantenimiento imagenes',
      'Usuarios',
      'Clientes',
      'ClienteContactos',
    ]),
  ]);

  const devices = tables.Evidencia_Mantenimientos
    .filter((device) => String(device.MantenimientoRef) === String(maintenanceId) && active(device));
  const deviceIds = new Set(devices.map((device) => String(device.EvidenciaMantenimientoID)));

  return {
    maintenance,
    devices,
    images: tables['Mantenimiento imagenes']
      .filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)) && active(image)),
    users: tables.Usuarios.filter(active),
    client: tables.Clientes.find((client) => String(client.ClienteID) === String(maintenance.ClienteID)) || null,
    contacts: tables.ClienteContactos,
  };
}

function buildDeviceGroups(bundle) {
  const groups = new Map();
  for (const device of bundle.devices) {
    const date = workDateFor(device, bundle.maintenance);
    const technicianIds = technicianIdsFor(device, bundle.maintenance);
    const key = groupKey(date, technicianIds);
    if (!groups.has(key)) groups.set(key, { date, technicianIds, devices: [] });
    groups.get(key).devices.push(device);
  }
  return groups;
}

function assignedFor(bundle, technicianIds) {
  const usersById = new Map(bundle.users.map((user) => [String(user.UsuarioID), user]));
  return technicianIds.map((id) => {
    const user = usersById.get(String(id));
    const name = clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], id));
    return {
      UsuarioID: id,
      Nombre: name,
      NombreCompleto: name,
      NombreUsuario: clean(user?.NombreUsuario),
      Correo: clean(user?.Correo),
    };
  });
}

function evidencesFor(bundle, devices, ticketUid) {
  const deviceIds = new Set(devices.map((device) => String(device.EvidenciaMantenimientoID)));
  const deviceById = new Map(devices.map((device) => [String(device.EvidenciaMantenimientoID), device]));
  return bundle.images
    .filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)))
    .map((image, index) => {
      const device = deviceById.get(String(image.DispositivoMantenimientoRef));
      return {
        ...image,
        EvidenciaID: `preview-evidence-${sha256(`${ticketUid}|${image.FotoDispositivoID}`).slice(0, 32)}`,
        BoletaUID: ticketUid,
        Nombre: `${clean(device?.NombreDispositivo, 'Dispositivo')} - ${clean(image.Tipo, 'Evidencia')}`,
        Nota: clean(image.Nota),
        ArchivoID: clean(image.DriveFileID),
        ArchivoURL: clean(image.DriveURL),
        NombreArchivo: clean(image.Nombre, `evidencia-${index + 1}`),
        MimeType: clean(image.MimeType, 'image/jpeg'),
        Orden: index + 1,
        Activo: true,
      };
    });
}

function previewTicket(bundle, previewGroup, deviceGroup, index, runId) {
  const maintenance = bundle.maintenance;
  const devices = deviceGroup.devices;
  const categories = [...new Set(devices.map((device) => clean(device.Categoria || device.TipoDispositivo)).filter(Boolean))];
  const names = devices.map((device) => clean(device.NombreDispositivo, 'Dispositivo'));
  const recommendations = devices
    .filter((device) => clean(device.Observacion))
    .map((device) => `${clean(device.NombreDispositivo, 'Dispositivo')}: ${clean(device.Observacion)}`)
    .join('\n');
  const ticketUid = `preview-mnt-${sha256(`${maintenance.MantenimientoID}|${previewGroup.date}|${previewGroup.technicianIds.join(',')}|${runId}|${index}`).slice(0, 32)}`;
  const ticketNumber = `PRUEBA-MNT-${clean(previewGroup.date).replace(/-/g, '')}-${index + 1}`;

  const ticket = {
    BoletaUID: ticketUid,
    BoletaID: ticketNumber,
    OrigenMantenimientoID: clean(maintenance.MantenimientoID),
    ...maintenanceSignaturePatch(maintenance),
    Titulo: clean(previewGroup.title, `Mantenimiento ${previewGroup.date}`),
    Estado: 'PRUEBA',
    Fecha: previewGroup.date,
    HoraInicio: '',
    HoraFinal: '',
    HorasTotales: 0,
    ClienteID: maintenance.ClienteID,
    Cliente: clean(maintenance.Cliente || bundle.client?.Nombre, 'Sin cliente'),
    UbicacionID: clean(maintenance.UbicacionID),
    Ubicacion: clean(maintenance.Ubicacion),
    UbicacionEquipo: [...new Set(devices.map((device) => clean(device.Zona)).filter(Boolean))].join(', '),
    Supervisor: supervisorName(bundle),
    Categoria: 'Mantenimiento',
    TipoFalla: 'Mantenimiento preventivo y revisión técnica',
    TipoDispositivo: categories.join(', '),
    Fabricante: [...new Set(devices.map((device) => clean(device.Fabricante)).filter(Boolean))].join(', '),
    Modelo: [...new Set(devices.map((device) => clean(device.Modelo)).filter(Boolean))].join(', '),
    Serie: devices.map((device) => clean(device.Serie)).filter(Boolean).join(', '),
    RazonVisita: clean(previewGroup.reason),
    Descripcion: `${devices.length} dispositivo${devices.length === 1 ? '' : 's'}: ${names.join(', ')}.`,
    PruebasRealizadas: clean(previewGroup.tests),
    Resultado: clean(previewGroup.result),
    Recomendaciones: recommendations,
    EnviarCorreoCliente: false,
    NumeroVisita: 1,
  };

  const pdfFileName = ticketPdfFileName(ticket);
  return {
    ...ticket,
    PDFFileName: pdfFileName,
    NombreArchivoPDF: pdfFileName,
  };
}

async function reportRuntime() {
  const [config] = await Promise.all([getConfig()]);
  const url = clean(process.env.APPS_SCRIPT_REPORT_URL);
  const secret = clean(process.env.APPS_SCRIPT_REPORT_SECRET);
  const templateId = clean(process.env.TEMPLATE_BOLETA_ID || config.TEMPLATE_BOLETA_ID, DEFAULT_TEMPLATE_ID);
  const baseFolderId = clean(config.BOLETAS_FOLDER_ID || config.ROOT_FOLDER_ID || process.env.BOLETAS_FOLDER_ID);

  if (!url) throw new AppError('APPS_SCRIPT_URL_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_URL en el backend.', 503);
  if (!secret) throw new AppError('APPS_SCRIPT_SECRET_MISSING', 'Falta configurar APPS_SCRIPT_REPORT_SECRET en el backend.', 503);
  if (!baseFolderId) throw new AppError('REPORT_FOLDER_NOT_CONFIGURED', 'No está configurada la carpeta principal de boletas.', 503);

  return { config, url, secret, templateId, baseFolderId };
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
      throw new AppError('APPS_SCRIPT_TIMEOUT', 'Apps Script tardó demasiado en generar los documentos de prueba.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createOfficialPreviewReport(runtime, bundle, previewGroup, deviceGroup, index, runId, ctx) {
  const ticket = previewTicket(bundle, previewGroup, deviceGroup, index, runId);
  const assigned = assignedFor(bundle, deviceGroup.technicianIds);
  const evidences = evidencesFor(bundle, deviceGroup.devices, ticket.BoletaUID);
  const signatureIncluded = Boolean(clean(
    ticket.FirmaArchivoID
      || ticket.FirmaFileID
      || ticket.FirmaURL
      || ticket.Firma,
  ));
  const data = await postAppsScript(runtime.url, {
    action: 'ticket.report.deliver',
    secret: runtime.secret,
    idempotencyKey: `maintenance-preview:${ticket.BoletaUID}:${Date.now()}:${index}`,
    testMode: true,
    sendEmail: false,
    deliveryType: 'PREVIEW',
    templateId: runtime.templateId,
    baseFolderId: runtime.baseFolderId,
    ticket,
    assigned,
    evidences,
    client: bundle.client,
    creator: ctx.user ? {
      UsuarioID: ctx.user.UsuarioID,
      Nombre: clean(pick(ctx.user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'])),
      NombreUsuario: clean(ctx.user.NombreUsuario),
      Correo: clean(ctx.user.Correo),
    } : null,
    recipients: { to: [], cc: [] },
    survey: null,
    surveyUrl: '',
    signature: null,
    signatureUrl: '',
    signatureIncluded,
    visitGroup: null,
  });

  return {
    ticketUid: ticket.BoletaUID,
    ticketNumber: ticket.BoletaID,
    title: ticket.Titulo,
    date: ticket.Fecha,
    deviceCount: deviceGroup.devices.length,
    evidenceCount: evidences.length,
    signatureIncluded,
    documentId: clean(data.documentId),
    documentUrl: clean(data.documentUrl),
    pdfId: clean(data.pdfId),
    pdfUrl: clean(data.pdfUrl),
    folderId: clean(data.folderId),
    folderUrl: clean(data.folderUrl),
    pdfFileName: clean(data.pdfFileName),
    templateId: clean(data.templateId, runtime.templateId),
  };
}

function testWebhook(config = {}) {
  const candidates = [
    process.env.GOOGLE_CHAT_TEST_WEBHOOK,
    config.CHAT_TEST_WEBHOOK,
    config.CHAT_WEBHOOK_PRUEBAS,
    config.CHAT_TEST_MODE,
  ];
  return candidates
    .map((value) => clean(value))
    .find((value) => value.startsWith('https://chat.googleapis.com/')) || '';
}

function chatText(maintenance, groups) {
  return [
    '🧪 PRUEBA DE BOLETAS AUTOMÁTICAS DE MANTENIMIENTO',
    'Se crearon documentos y PDF usando la plantilla oficial.',
    `Mantenimiento: ${maintenance.TituloMantenimiento || maintenance.MantenimientoID}`,
    `Cliente: ${maintenance.Cliente || 'Sin cliente'}`,
    `Documentos creados: ${groups.length}`,
    '',
    ...groups.flatMap((group, index) => [
      `BOLETA DE PRUEBA ${index + 1} · ${group.ticketNumber}`,
      `Fecha: ${group.date}`,
      `Técnicos: ${(group.technicians || []).join(', ')}`,
      `Dispositivos: ${group.deviceCount}`,
      `Firma general: ${group.signatureIncluded ? 'incluida en el PDF' : 'no disponible; el mantenimiento todavía no tiene una firma real registrada'}`,
      `Título: ${group.title}`,
      `Documento: ${group.documentUrl}`,
      `PDF: ${group.pdfUrl}`,
      `Carpeta: ${group.folderUrl}`,
      group.geminiWarning ? `Advertencia: ${group.geminiWarning}` : '',
      '',
    ]),
    'Esta prueba creó únicamente archivos dentro de “Pruebas de boletas”. No creó boletas reales, no cambió el mantenimiento y no envió correos al cliente ni al supervisor.',
  ].filter(Boolean).join('\n');
}

async function sendReportsToTestChat(config, maintenance, groups) {
  const url = testWebhook(config);
  if (!url) throw new AppError('MAINTENANCE_TEST_CHAT_MISSING', 'No se configuró el Chat de pruebas.', 500);
  const text = chatText(maintenance, groups);
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && `${current}\n${line}`.length > 3600) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  for (let index = 0; index < chunks.length; index += 1) {
    await sendChatMessage(url, chunks.length > 1 ? `Parte ${index + 1} de ${chunks.length}\n\n${chunks[index]}` : chunks[index]);
  }
  return { destination: 'Chat de pruebas', parts: chunks.length };
}

export async function previewMaintenanceTicketsWithDocuments(ctx, maintenanceId) {
  const id = clean(maintenanceId);
  if (!id) throw badRequest('No se indicó el mantenimiento para probar las boletas.');

  const preview = await previewMaintenanceTickets(ctx, id, { sendTestChat: false });
  const [bundle, runtime] = await Promise.all([loadBundle(id), reportRuntime()]);
  const deviceGroups = buildDeviceGroups(bundle);
  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const reports = [];

  for (let index = 0; index < preview.groups.length; index += 1) {
    const previewGroup = preview.groups[index];
    const key = groupKey(previewGroup.date, previewGroup.technicianIds);
    const deviceGroup = deviceGroups.get(key);
    if (!deviceGroup?.devices?.length) {
      throw new AppError(
        'MAINTENANCE_PREVIEW_GROUP_NOT_FOUND',
        `No fue posible reconstruir el grupo de prueba del ${previewGroup.date}.`,
        500,
      );
    }
    const report = await createOfficialPreviewReport(runtime, bundle, previewGroup, deviceGroup, index, runId, ctx);
    reports.push({
      ...previewGroup,
      ...report,
    });
  }

  const chat = await sendReportsToTestChat(runtime.config, bundle.maintenance, reports);

  await audit(ctx, 'PROBAR_DOCUMENTOS_BOLETAS_AUTOMATICAS_MANTENIMIENTO', 'Mantenimiento', id, null, {
    EstadoCambiado: false,
    BoletasCreadas: false,
    DocumentosCreados: reports.length,
    FirmaGeneralDisponible: reports.some((report) => report.signatureIncluded),
    Reportes: reports.map((report) => ({
      BoletaPrueba: report.ticketNumber,
      FirmaIncluida: report.signatureIncluded,
      DocumentoURL: report.documentUrl,
      PDFURL: report.pdfUrl,
      CarpetaURL: report.folderUrl,
      PlantillaID: report.templateId,
    })),
  }).catch(() => {});

  const signedReports = reports.filter((report) => report.signatureIncluded).length;
  return {
    ...preview,
    documentsCreated: true,
    documentCount: reports.length,
    signatureIncludedCount: signedReports,
    chat,
    groups: reports,
    message: `Prueba completada: se crearon ${reports.length} documento${reports.length === 1 ? '' : 's'} y PDF con la plantilla oficial.${signedReports ? ` La firma general fue incluida en ${signedReports} PDF${signedReports === 1 ? '' : 's'}.` : ' El mantenimiento todavía no tiene una firma real registrada, por lo que los PDF se generaron sin firma.'} Los enlaces fueron enviados al Chat de pruebas. No se crearon boletas reales ni se cambió el estado del mantenimiento.`,
  };
}
