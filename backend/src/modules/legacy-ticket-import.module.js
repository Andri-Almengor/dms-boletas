import { createHash } from 'node:crypto';
import { badRequest } from '../core/errors.js';
import { nowIso } from '../core/utils.js';
import { env } from '../config/env.js';
import {
  appendRows,
  ensureColumns,
  getHeaders,
  invalidateTableCache,
  readTables,
} from '../infra/sheets.repository.js';
import { sheetsApi } from '../infra/google.js';
import { audit } from '../services/audit.service.js';

const MAX_TICKETS = 1000;
const LEGACY_TICKET_COLUMNS = [
  'OrigenDatos',
  'ImportacionID',
  'ImportacionEstado',
  'ImportacionRevertidaEn',
  'ImportacionRevertidaPor',
  'BoletaIDLegacy',
  'FilaLegacy',
  'ClienteRefLegacy',
  'AsignadoALegacy',
  'CreadorLegacy',
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

function activeRecord(row = {}) {
  return row.Activo !== false && normalized(row.Activo || 'true') !== 'false';
}

function revertedImport(row = {}) {
  return normalized(row.ImportacionEstado) === 'revertida' || Boolean(clean(row.ImportacionRevertidaEn));
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
    creatorText: clean(source?.creatorText, 1000),
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
    throw badRequest(`La fila ${sourceRow} no contiene identificador, título o cliente.`);
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

function validatedImportId(value) {
  const importId = clean(value, 128);
  if (!/^[a-f0-9]{32,128}$/i.test(importId)) throw badRequest('El identificador del archivo de importación no es válido.');
  return importId;
}

function payload(ctx) {
  const importId = validatedImportId(ctx.payload?.importId);
  const sourceTickets = Array.isArray(ctx.payload?.tickets) ? ctx.payload.tickets : [];
  if (!sourceTickets.length) throw badRequest('El archivo no contiene boletas para importar.');
  if (sourceTickets.length > MAX_TICKETS) throw badRequest(`La importación admite un máximo de ${MAX_TICKETS} boletas.`);
  const tickets = sourceTickets.map((ticket) => sanitizeTicket(ticket, importId));
  const uniqueUids = new Set(tickets.map((ticket) => ticket.uid));
  if (uniqueUids.size !== tickets.length) throw badRequest('El archivo contiene identificadores de boleta repetidos.');
  const clients = (Array.isArray(ctx.payload?.clients) ? ctx.payload.clients : []).map(sanitizeClient).filter((client) => client.name);
  return { importId, tickets, clients };
}

function rollbackPayload(ctx) {
  return { importId: validatedImportId(ctx.payload?.importId) };
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
  (tables.Clientes || []).filter(activeRecord).forEach((client) => clientNames(client).forEach((name) => {
    if (!clientIndex.has(name)) clientIndex.set(name, client);
  }));
  const userIndex = new Map();
  (tables.Usuarios || []).filter(activeRecord).forEach((user) => userKeys(user).forEach((key) => {
    if (!userIndex.has(key)) userIndex.set(key, user);
  }));
  return { clientIndex, userIndex };
}

function reservingTickets(rows = []) {
  return rows.filter((row) => !revertedImport(row));
}

function allocateNumbers(tickets, currentTickets) {
  const used = new Set(reservingTickets(currentTickets)
    .map((row) => Math.trunc(number(row.BoletaID)))
    .filter((value) => value > 0));
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
  const currentTickets = reservingTickets(tables.Boletas || []);
  const existingByUid = new Map(currentTickets.map((row) => [clean(row.BoletaUID), row]));
  const pendingTickets = source.tickets.filter((ticket) => !existingByUid.has(ticket.uid));
  const indexes = buildIndexes(tables);
  const missingClientNames = [...new Set(pendingTickets.map((ticket) => ticket.clientName).filter((name) => !indexes.clientIndex.has(normalized(name))))];
  const unmatchedTechnicians = new Set();
  pendingTickets.forEach((ticket) => assignedParts(ticket.assignedText).forEach((part) => {
    if (!findUser(part, indexes.userIndex)) unmatchedTechnicians.add(part);
  }));
  const { renumbered } = allocateNumbers(pendingTickets, currentTickets);
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

function rollbackPreviewData(importId, tables) {
  const allImportedTickets = (tables.Boletas || []).filter((row) => (
    clean(row.ImportacionID) === importId
    && normalized(row.OrigenDatos) === 'appsheet anterior'
  ));
  const activeTickets = allImportedTickets.filter((row) => activeRecord(row) && !revertedImport(row));
  const ticketIds = new Set(activeTickets.map((row) => clean(row.BoletaUID)).filter(Boolean));
  const activeAssignments = (tables.BoletaAsignados || []).filter((row) => (
    ticketIds.has(clean(row.BoletaUID)) && activeRecord(row)
  ));
  const importedClients = (tables.Clientes || []).filter((row) => (
    clean(row.ImportacionID) === importId
    && normalized(row.OrigenDatos) === 'appsheet anterior'
    && activeRecord(row)
  ));

  return {
    importId,
    foundTickets: allImportedTickets.length,
    activeTickets: activeTickets.length,
    activeAssignments: activeAssignments.length,
    importedClients: importedClients.length,
    alreadyReverted: allImportedTickets.length - activeTickets.length,
    canRollback: activeTickets.length > 0,
  };
}

function operationName(ctx) {
  return normalized(ctx.payload?.operation || ctx.payload?.mode || ctx.payload?.accion);
}

async function preview(ctx) {
  if (operationName(ctx) === 'rollback' || operationName(ctx) === 'revertir') {
    const { importId } = rollbackPayload(ctx);
    const tables = await readTables(['Boletas', 'Clientes', 'BoletaAsignados']);
    return rollbackPreviewData(importId, tables);
  }
  const source = payload(ctx);
  const tables = await readTables(['Boletas', 'Clientes', 'Usuarios']);
  return previewData(source, tables);
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function writable(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function batchPatchRows(sheetName, rows, changes, idColumn) {
  if (!changes.length) return 0;
  const headers = await getHeaders(sheetName, true);
  const rowById = new Map(rows.map((row) => [clean(row[idColumn]), row]));
  const data = [];

  changes.forEach(({ id, patch }) => {
    const current = rowById.get(clean(id));
    if (!current?.__rowNumber) return;
    Object.entries(patch || {}).forEach(([header, value]) => {
      const columnIndex = headers.indexOf(header);
      if (columnIndex < 0) return;
      data.push({
        range: `${quote(sheetName)}!${columnLetter(columnIndex)}${current.__rowNumber}`,
        values: [[writable(value)]],
      });
    });
  });

  const chunkSize = 450;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: env.sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: data.slice(offset, offset + chunkSize),
      },
    });
  }
  invalidateTableCache(sheetName);
  return changes.length;
}

async function commitInternal(ctx) {
  const source = payload(ctx);
  await ensureColumns('Boletas', LEGACY_TICKET_COLUMNS);
  await ensureColumns('Clientes', LEGACY_CLIENT_COLUMNS);
  const tables = await readTables(['Boletas', 'Clientes', 'Usuarios', 'BoletaAsignados'], { force: true });
  const previewResult = previewData(source, tables);
  const currentTickets = reservingTickets(tables.Boletas || []);
  const existingByUid = new Map(currentTickets.map((row) => [clean(row.BoletaUID), row]));
  const pendingTickets = source.tickets.filter((ticket) => !existingByUid.has(ticket.uid));
  const { clientIndex, userIndex } = buildIndexes(tables);
  const sourceClientIndex = new Map(source.clients.map((client) => [normalized(client.name), client]));
  const clientsToCreate = [];

  [...new Set(pendingTickets.map((ticket) => ticket.clientName))].forEach((name) => {
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
  const { allocation, renumbered } = allocateNumbers(pendingTickets, currentTickets);
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
      ImportacionEstado: 'ACTIVA',
      ImportacionRevertidaEn: '',
      ImportacionRevertidaPor: '',
      BoletaIDLegacy: ticket.legacyNumber ?? '',
      FilaLegacy: ticket.sourceRow,
      ClienteRefLegacy: ticket.legacyClientRef,
      AsignadoALegacy: ticket.assignedText,
      CreadorLegacy: ticket.creatorText,
      FirmaLegacyURL: ticket.signatureUrl,
      EvidenciasLegacy: ticket.evidenceRefs,
    };
  });
  if (ticketRows.length) await appendRows('Boletas', ticketRows);

  const currentAssignments = new Set((tables.BoletaAsignados || []).map((row) => clean(row.BoletaAsignadoID)));
  const assignments = [];
  const unmatched = new Set();
  pendingTickets.forEach((ticket) => {
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

async function rollbackInternal(ctx) {
  const { importId } = rollbackPayload(ctx);
  await ensureColumns('Boletas', LEGACY_TICKET_COLUMNS);
  const tables = await readTables(['Boletas', 'Clientes', 'BoletaAsignados'], { force: true });
  const previewResult = rollbackPreviewData(importId, tables);
  const tickets = (tables.Boletas || []).filter((row) => (
    clean(row.ImportacionID) === importId
    && normalized(row.OrigenDatos) === 'appsheet anterior'
    && activeRecord(row)
    && !revertedImport(row)
  ));

  if (!tickets.length) {
    return {
      importId,
      revertedTickets: 0,
      revertedAssignments: 0,
      preservedClients: previewResult.importedClients,
      message: 'Esta importación ya estaba deshecha o no se encontró activa.',
    };
  }

  const revertedAt = nowIso();
  const ticketIds = new Set(tickets.map((row) => clean(row.BoletaUID)));
  const assignments = (tables.BoletaAsignados || []).filter((row) => (
    ticketIds.has(clean(row.BoletaUID)) && activeRecord(row)
  ));

  await batchPatchRows('Boletas', tables.Boletas || [], tickets.map((row) => ({
    id: row.BoletaUID,
    patch: {
      Activo: false,
      ImportacionEstado: 'REVERTIDA',
      ImportacionRevertidaEn: revertedAt,
      ImportacionRevertidaPor: ctx.user.UsuarioID,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: revertedAt,
    },
  })), 'BoletaUID');

  await batchPatchRows('BoletaAsignados', tables.BoletaAsignados || [], assignments.map((row) => ({
    id: row.BoletaAsignadoID,
    patch: { Activo: false },
  })), 'BoletaAsignadoID');

  const result = {
    importId,
    revertedTickets: tickets.length,
    revertedAssignments: assignments.length,
    preservedClients: previewResult.importedClients,
    message: `Se deshicieron ${tickets.length} boletas de la importación seleccionada. Los clientes se conservaron para evitar romper referencias y poder reutilizarlos en la versión depurada.`,
  };

  await audit(ctx, 'REVERTIR_IMPORTACION_BOLETAS_HISTORICAS', 'Boletas', importId, null, {
    ...result,
    preview: previewResult,
  }).catch(() => {});
  return result;
}

async function commit(ctx) {
  const runner = operationName(ctx) === 'rollback' || operationName(ctx) === 'revertir'
    ? rollbackInternal
    : commitInternal;
  const operation = importTail.then(() => runner(ctx), () => runner(ctx));
  importTail = operation.catch(() => {});
  return operation;
}

export const legacyTicketImportHandlers = {
  preview,
  commit,
};
