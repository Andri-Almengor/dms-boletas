import { createHash } from 'node:crypto';
import { badRequest } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { appendRows, ensureColumns, readTables } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';

const MAX_TICKETS = 1000;
const LEGACY_TICKET_COLUMNS = [
  'OrigenDatos',
  'ImportacionID',
  'BoletaIDLegacy',
  'FilaLegacy',
  'ClienteRefLegacy',
  'AsignadoALegacy',
  'FirmaLegacyURL',
  'EvidenciasLegacy',
];
const LEGACY_CLIENT_COLUMNS = ['OrigenDatos', 'ImportacionID'];
let importTail = Promise.resolve();

function clean(value, limit = 20000) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value, length = 24) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function safeId(value, fallback) {
  const current = clean(value, 140);
  if (/^[A-Za-z0-9._:-]{8,140}$/.test(current)) return `legacy:${current}`;
  return `legacy:${fallback}`;
}

function validUrl(value) {
  const current = clean(value, 3000);
  return /^https?:\/\//i.test(current) ? current : '';
}

function normalizeDate(value) {
  const current = clean(value, 32);
  if (!current) return '';
  const iso = current.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = current.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const parsed = new Date(current);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const current = clean(value, 20);
  const match = current.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function dateTime(date, time = '') {
  const day = normalizeDate(date);
  if (!day) return nowIso();
  const hour = normalizeTime(time) || '12:00';
  return `${day}T${hour}:00-06:00`;
}

function status(value) {
  const current = normalized(value);
  if (current.includes('final')) return 'FINALIZADA';
  if (current.includes('anul') || current.includes('cancel')) return 'ANULADA';
  return 'PENDIENTE';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeTicket(source, importId) {
  const sourceRow = Math.max(1, Math.trunc(number(source?.sourceRow, 1)));
  const fallback = `${importId.slice(0, 20)}:${sourceRow}`;
  const ticket = {
    sourceRow,
    legacyUid: clean(source?.legacyUid, 140),
    uid: safeId(source?.legacyUid, fallback),
    legacyNumber: Number.isFinite(Number(source?.legacyNumber)) ? Math.trunc(Number(source.legacyNumber)) : null,
    title: clean(source?.title, 1000),
    state: status(source?.status),
    reason: clean(source?.reason),
    assignedText: clean(source?.assignedText, 3000),
    legacyClientRef: clean(source?.legacyClientRef, 500),
    clientName: clean(source?.clientName, 1000),
    date: normalizeDate(source?.date),
    category: clean(source?.category, 500),
    signatureUrl: validUrl(source?.signatureUrl),
    result: clean(source?.result),
    totalHours: Math.max(0, number(source?.totalHours)),
    startTime: normalizeTime(source?.startTime),
    endTime: normalizeTime(source?.endTime),
    location: clean(source?.location, 1500),
    manufacturer: clean(source?.manufacturer, 500),
    model: clean(source?.model, 500),
    serial: clean(source?.serial, 500),
    supervisor: clean(source?.supervisor, 1000),
    tests: clean(source?.tests),
    recommendations: clean(source?.recommendations),
    description: clean(source?.description),
    equipmentLocation: clean(source?.equipmentLocation, 1500),
    documentUrl: validUrl(source?.documentUrl),
    pdfUrl: validUrl(source?.pdfUrl),
    clientEmail: clean(source?.clientEmail, 1000),
    failureType: clean(source?.failureType, 500),
    evidenceRefs: clean(source?.evidenceRefs, 10000),
  };
  if (!ticket.legacyUid || !ticket.title || !ticket.clientName) {
    throw badRequest(`La fila ${sourceRow} no contiene UID, título o cliente.`);
  }
  return ticket;
}

function sanitizeClient(source) {
  return {
    name: clean(source?.name, 1000),
    contact: clean(source?.contact, 1000),
    phone: clean(source?.phone, 500),
    email: clean(source?.email, 1000),
    address: clean(source?.address, 2000),
  };
}

function payload(ctx) {
  const importId = clean(ctx.payload?.importId, 128);
  if (!/^[a-f0-9]{32,128}$/i.test(importId)) throw badRequest('El identificador del archivo de importación no es válido.');
  const sourceTickets = Array.isArray(ctx.payload?.tickets) ? ctx.payload.tickets : [];
  if (!sourceTickets.length) throw badRequest('El archivo no contiene boletas para importar.');
  if (sourceTickets.length > MAX_TICKETS) throw badRequest(`La importación admite un máximo de ${MAX_TICKETS} boletas.`);
  const tickets = sourceTickets.map((ticket) => sanitizeTicket(ticket, importId));
  const uniqueUids = new Set(tickets.map((ticket) => ticket.uid));
  if (uniqueUids.size !== tickets.length) throw badRequest('El archivo contiene identificadores de boleta repetidos.');
  const clients = (Array.isArray(ctx.payload?.clients) ? ctx.payload.clients : []).map(sanitizeClient).filter((client) => client.name);
  return { importId, tickets, clients };
}

function clientNames(row = {}) {
  return [row.Nombre, row.RazonSocial, row.Cliente].map(normalized).filter(Boolean);
}

function userKeys(row = {}) {
  return [row.NombreCompleto, row.Nombre, row.NombreUsuario, row.Correo]
    .map(normalized)
    .filter(Boolean);
}

function assignedParts(value) {
  return [...new Set(clean(value, 3000).split(/[,;|]+/).map((part) => part.trim()).filter(Boolean))];
}

function findUser(part, userIndex) {
  const key = normalized(part);
  if (!key) return null;
  if (userIndex.has(key)) return userIndex.get(key);
  const candidates = [...userIndex.entries()].filter(([candidate]) => candidate.includes(key) || key.includes(candidate));
  const unique = [...new Set(candidates.map(([, user]) => user))];
  return unique.length === 1 ? unique[0] : null;
}

function buildIndexes(tables) {
  const clientIndex = new Map();
  (tables.Clientes || []).forEach((client) => clientNames(client).forEach((name) => {
    if (!clientIndex.has(name)) clientIndex.set(name, client);
  }));
  const userIndex = new Map();
  (tables.Usuarios || []).forEach((user) => userKeys(user).forEach((key) => {
    if (!userIndex.has(key)) userIndex.set(key, user);
  }));
  return { clientIndex, userIndex };
}

function allocateNumbers(tickets, currentTickets) {
  const used = new Set((currentTickets || []).map((row) => Math.trunc(number(row.BoletaID))).filter((value) => value > 0));
  let next = Math.max(0, ...used) + 1;
  const allocation = new Map();
  let renumbered = 0;
  tickets.forEach((ticket) => {
    const requested = ticket.legacyNumber;
    if (requested && requested > 0 && !used.has(requested)) {
      allocation.set(ticket.uid, requested);
      used.add(requested);
      return;
    }
    while (used.has(next)) next += 1;
    allocation.set(ticket.uid, next);
    used.add(next);
    next += 1;
    renumbered += 1;
  });
  return { allocation, renumbered };
}

function previewData(source, tables) {
  const existingByUid = new Map((tables.Boletas || []).map((row) => [clean(row.BoletaUID), row]));
  const pendingTickets = source.tickets.filter((ticket) => !existingByUid.has(ticket.uid));
  const indexes = buildIndexes(tables);
  const missingClientNames = [...new Set(pendingTickets.map((ticket) => ticket.clientName).filter((name) => !indexes.clientIndex.has(normalized(name))))];
  const unmatchedTechnicians = new Set();
  pendingTickets.forEach((ticket) => assignedParts(ticket.assignedText).forEach((part) => {
    if (!findUser(part, indexes.userIndex)) unmatchedTechnicians.add(part);
  }));
  const { renumbered } = allocateNumbers(pendingTickets, tables.Boletas || []);
  const finalCount = pendingTickets.filter((ticket) => ticket.state === 'FINALIZADA').length;
  const pendingCount = pendingTickets.filter((ticket) => ticket.state === 'PENDIENTE').length;
  return {
    importId: source.importId,
    received: source.tickets.length,
    newTickets: pendingTickets.length,
    alreadyImported: source.tickets.length - pendingTickets.length,
    finalTickets: finalCount,
    pendingTickets: pendingCount,
    numbersToReassign: renumbered,
    clientsToCreate: missingClientNames.length,
    missingClientNames: missingClientNames.slice(0, 50),
    unmatchedTechnicians: [...unmatchedTechnicians].slice(0, 100),
    canImport: pendingTickets.length > 0,
  };
}

async function preview(ctx) {
  const source = payload(ctx);
  const tables = await readTables(['Boletas', 'Clientes', 'Usuarios']);
  return previewData(source, tables);
}

async function commitInternal(ctx) {
  const source = payload(ctx);
  await ensureColumns('Boletas', LEGACY_TICKET_COLUMNS);
  await ensureColumns('Clientes', LEGACY_CLIENT_COLUMNS);
  const tables = await readTables(['Boletas', 'Clientes', 'Usuarios', 'BoletaAsignados'], { force: true });
  const previewResult = previewData(source, tables);
  const existingByUid = new Map((tables.Boletas || []).map((row) => [clean(row.BoletaUID), row]));
  const pendingTickets = source.tickets.filter((ticket) => !existingByUid.has(ticket.uid));
  const { clientIndex, userIndex } = buildIndexes(tables);
  const sourceClientIndex = new Map(source.clients.map((client) => [normalized(client.name), client]));
  const clientsToCreate = [];

  [...new Set(source.tickets.map((ticket) => ticket.clientName))].forEach((name) => {
    const key = normalized(name);
    if (!key || clientIndex.has(key)) return;
    const sourceClient = sourceClientIndex.get(key) || { name };
    const row = {
      ClienteID: `legacy-client:${hash(key)}`,
      Nombre: name,
      RazonSocial: name,
      Contacto: sourceClient.contact || '',
      Telefono: sourceClient.phone || '',
      CorreoGeneral: sourceClient.email || '',
      Direccion: sourceClient.address || '',
      Estado: 'ACTIVO',
      Activo: true,
      OrigenDatos: 'APPSHEET_ANTERIOR',
      ImportacionID: source.importId,
      CreadoPor: ctx.user.UsuarioID,
      FechaCreacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    };
    clientsToCreate.push(row);
    clientIndex.set(key, row);
  });

  if (clientsToCreate.length) await appendRows('Clientes', clientsToCreate);
  const { allocation, renumbered } = allocateNumbers(pendingTickets, tables.Boletas || []);
  const importedAt = nowIso();
  const ticketRows = pendingTickets.map((ticket) => {
    const client = clientIndex.get(normalized(ticket.clientName));
    const finalized = ticket.state === 'FINALIZADA';
    return {
      BoletaUID: ticket.uid,
      BoletaID: allocation.get(ticket.uid),
      Version: 1,
      Estado: ticket.state,
      Fecha: ticket.date,
      HoraInicio: ticket.startTime,
      HoraFinal: ticket.endTime,
      HorasTotales: ticket.totalHours,
      ClienteID: client?.ClienteID || '',
      Cliente: ticket.clientName,
      Ubicacion: ticket.location,
      UbicacionEquipo: ticket.equipmentLocation,
      Supervisor: ticket.supervisor,
      CorreoCliente: ticket.clientEmail,
      Categoria: ticket.category,
      Fabricante: ticket.manufacturer,
      Modelo: ticket.model,
      Serie: ticket.serial,
      RazonVisita: ticket.reason,
      Descripcion: ticket.description,
      PruebasRealizadas: ticket.tests,
      Resultado: ticket.result,
      Recomendaciones: ticket.recommendations,
      TipoFalla: ticket.failureType,
      AsignadoA: ticket.assignedText,
      FirmaURL: ticket.signatureUrl,
      FirmaOrigen: ticket.signatureUrl ? 'APPSHEET_ANTERIOR' : '',
      FirmaFecha: ticket.signatureUrl ? dateTime(ticket.date, ticket.endTime) : '',
      DocumentoURL: ticket.documentUrl,
      PDFURL: ticket.pdfUrl,
      EnviarCorreoCliente: false,
      CorreosCC: '',
      Activo: true,
      FinalizadaEn: finalized ? dateTime(ticket.date, ticket.endTime) : '',
      EstadoNotificacion: 'MIGRADO',
      UltimoErrorNotificacion: '',
      CreadoPor: ctx.user.UsuarioID,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaCreacion: dateTime(ticket.date, ticket.startTime),
      FechaActualizacion: importedAt,
      OrigenDatos: 'APPSHEET_ANTERIOR',
      ImportacionID: source.importId,
      BoletaIDLegacy: ticket.legacyNumber ?? '',
      FilaLegacy: ticket.sourceRow,
      ClienteRefLegacy: ticket.legacyClientRef,
      AsignadoALegacy: ticket.assignedText,
      FirmaLegacyURL: ticket.signatureUrl,
      EvidenciasLegacy: ticket.evidenceRefs,
    };
  });
  if (ticketRows.length) await appendRows('Boletas', ticketRows);

  const currentAssignments = new Set((tables.BoletaAsignados || []).map((row) => clean(row.BoletaAsignadoID)));
  const assignments = [];
  const unmatched = new Set();
  source.tickets.forEach((ticket) => {
    assignedParts(ticket.assignedText).forEach((part) => {
      const user = findUser(part, userIndex);
      if (!user) {
        unmatched.add(part);
        return;
      }
      const assignmentId = `legacy-assignment:${hash(`${ticket.uid}|${user.UsuarioID}`)}`;
      if (currentAssignments.has(assignmentId)) return;
      currentAssignments.add(assignmentId);
      assignments.push({
        BoletaAsignadoID: assignmentId,
        BoletaUID: ticket.uid,
        UsuarioID: user.UsuarioID,
        NombreUsuarioSnapshot: clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || part, 1000),
        Activo: true,
        CreadoPor: ctx.user.UsuarioID,
        FechaCreacion: importedAt,
      });
    });
  });
  if (assignments.length) await appendRows('BoletaAsignados', assignments);

  const result = {
    importId: source.importId,
    importedTickets: ticketRows.length,
    skippedTickets: source.tickets.length - ticketRows.length,
    importedClients: clientsToCreate.length,
    importedAssignments: assignments.length,
    renumberedTickets: renumbered,
    unmatchedTechnicians: [...unmatched],
    finalTickets: ticketRows.filter((ticket) => ticket.Estado === 'FINALIZADA').length,
    pendingTickets: ticketRows.filter((ticket) => ticket.Estado === 'PENDIENTE').length,
    message: ticketRows.length
      ? `Se importaron ${ticketRows.length} boletas históricas sin generar documentos, correos ni notificaciones.`
      : 'Todas las boletas de este archivo ya habían sido importadas.',
  };

  await audit(ctx, 'IMPORTAR_BOLETAS_HISTORICAS', 'Boletas', source.importId, null, {
    ...result,
    unmatchedTechnicians: result.unmatchedTechnicians.slice(0, 100),
    preview: previewResult,
  }).catch(() => {});
  return result;
}

async function commit(ctx) {
  const operation = importTail.then(() => commitInternal(ctx), () => commitInternal(ctx));
  importTail = operation.catch(() => {});
  return operation;
}

export const legacyTicketImportHandlers = {
  preview,
  commit,
};
