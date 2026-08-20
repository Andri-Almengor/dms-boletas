import { badRequest } from '../core/errors.js';
import { asArray, nowIso, pick, sha256 } from '../core/utils.js';
import {
  appendRows,
  findById,
  readTables,
  updateRow,
  updateRows,
} from '../infra/sheets.repository.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { audit } from './audit.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';
import { buildMaintenanceTicketDraft } from './maintenance-ticket-report.service.js';
import { MAINTENANCE_TICKET_COLUMNS } from './maintenance-ticket-generation.service.js';

const TICKET_ORIGIN_COLUMNS = [
  'OrigenMantenimientoID',
  'OrigenMantenimientoGrupo',
  'OrigenMantenimientoFecha',
  'OrigenMantenimientoTecnicosJSON',
  'OrigenMantenimientoHash',
  'EsBoletaMantenimiento',
];

const EVIDENCE_ORIGIN_COLUMNS = [
  'OrigenMantenimientoID',
  'OrigenMantenimientoDispositivoID',
  'OrigenMantenimientoImagenID',
];

// Sheets admite 50.000 caracteres por celda. Se deja margen suficiente para
// conversiones, compatibilidad y ediciones posteriores sin rozar el límite.
export const MAINTENANCE_TICKET_SAFE_CELL_CHARS = 40_000;
const DELIVERY_CONCURRENCY = 2;
const UPDATE_BATCH_ROWS = 40;
const APPEND_BATCH_ROWS = 80;

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

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].includes(normalized(value));
}

function splitEmails(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source
    .flatMap((item) => String(item || '').split(/[;,\n\r]/))
    .map((item) => clean(item).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function dateOnly(value, fallback = '') {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

export function fitMaintenanceTicketCell(value, max = MAINTENANCE_TICKET_SAFE_CELL_CHARS) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  const suffix = '\n\n[Contenido resumido para compatibilidad con Google Sheets. Consulte el mantenimiento y la carpeta de evidencias para el detalle completo.]';
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function technicianIdsFor(device, maintenance) {
  const direct = asArray(device.TecnicoIDsJSON || device.TecnicoIDs || device.tecnicoIds)
    .map(clean)
    .filter(Boolean);
  if (direct.length) return [...new Set(direct)].sort();

  const maintenanceIds = asArray(maintenance.ResponsableIDsJSON || maintenance.ResponsableIDs)
    .map(clean)
    .filter(Boolean);
  if (maintenanceIds.length) return [...new Set(maintenanceIds)].sort();

  const fallback = clean(device.CreadoPor || maintenance.CreadoPor);
  return fallback ? [fallback] : [];
}

function workDateFor(device, maintenance) {
  return dateOnly(
    device.FechaTrabajo || device.FechaRegistroTrabajo || device.FechaCreacion,
    dateOnly(maintenance.Fecha, dateOnly(maintenance.FechaCreacion)),
  );
}

function buildGroups(bundle) {
  const usersById = new Map(bundle.users.map((user) => [clean(user.UsuarioID), user]));
  const groups = new Map();

  for (const device of bundle.devices) {
    const date = workDateFor(device, bundle.maintenance);
    const technicianIds = technicianIdsFor(device, bundle.maintenance);
    if (!date) throw badRequest(`El dispositivo ${clean(device.NombreDispositivo, device.EvidenciaMantenimientoID)} no tiene fecha de trabajo.`);
    if (!technicianIds.length) throw badRequest(`El dispositivo ${clean(device.NombreDispositivo, device.EvidenciaMantenimientoID)} no tiene técnicos asignados.`);

    const key = `${date}|${technicianIds.join(',')}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        date,
        technicianIds,
        technicians: technicianIds.map((id) => {
          const user = usersById.get(id);
          return {
            id,
            name: clean(pick(user, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], id)),
            email: clean(user?.Correo),
          };
        }),
        devices: [],
      });
    }
    groups.get(key).devices.push(device);
  }

  return [...groups.values()].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    return byDate || left.technicians.map((item) => item.name).join(', ').localeCompare(
      right.technicians.map((item) => item.name).join(', '),
      'es',
    );
  });
}

function supervisorFor(bundle) {
  const contacts = bundle.contacts
    .filter((contact) => active(contact) && String(contact.ClienteID) === String(bundle.maintenance.ClienteID));
  const supervisors = contacts.filter((contact) => asBoolean(contact.EsSupervisor, false) && asBoolean(contact.RecibeCorreo, true));
  const selected = supervisors.length
    ? supervisors
    : contacts.filter((contact) => asBoolean(contact.RecibeCorreo, true));

  const emails = splitEmails(selected.map((contact) => contact.Correo));
  const names = [...new Set(selected.map((contact) => clean(contact.Nombre)).filter(Boolean))];
  if (!emails.length) emails.push(...splitEmails(bundle.client?.CorreoGeneral || bundle.client?.Correo));
  if (!names.length && clean(bundle.client?.Contacto)) names.push(clean(bundle.client.Contacto));
  return { id: clean(selected[0]?.ContactoID), names, emails };
}

function catalogMatch(rows, terms) {
  const expected = terms.map(normalized);
  return rows.find((row) => expected.includes(normalized(row.Nombre)))
    || rows.find((row) => expected.some((term) => normalized(row.Nombre).includes(term)))
    || null;
}

function generatedTicketUid(maintenanceId, groupKey) {
  return `mnt-${sha256(maintenanceId).slice(0, 12)}-${sha256(groupKey).slice(0, 20)}`;
}

function generatedEvidenceId(ticketId, imageId) {
  return `mnt-evidence-${sha256(`${ticketId}|${imageId}`).slice(0, 32)}`;
}

async function loadBundle(maintenanceId) {
  const tables = await readTables([
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'Mantenimiento imagenes',
    'Usuarios',
    'Clientes',
    'ClienteContactos',
    'Categorias',
    'TiposFalla',
    'Boletas',
    'EvidenciasBoleta',
  ]);
  const maintenance = tables.Mantenimiento.find((row) => String(row.MantenimientoID) === String(maintenanceId));
  if (!maintenance) throw badRequest('No se encontró el mantenimiento que se desea finalizar.');

  const devices = tables.Evidencia_Mantenimientos
    .filter((device) => String(device.MantenimientoRef) === String(maintenanceId) && active(device));
  if (!devices.length) throw badRequest('Debe registrar al menos un dispositivo antes de generar las boletas.');
  const deviceIds = new Set(devices.map((device) => String(device.EvidenciaMantenimientoID)));

  return {
    maintenance,
    devices,
    images: tables['Mantenimiento imagenes'].filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)) && active(image)),
    users: tables.Usuarios.filter(active),
    client: tables.Clientes.find((client) => String(client.ClienteID) === String(maintenance.ClienteID)) || null,
    contacts: tables.ClienteContactos,
    categories: tables.Categorias,
    failureTypes: tables.TiposFalla,
    ticketsById: new Map(tables.Boletas.map((ticket) => [String(ticket.BoletaUID), ticket])),
    evidenceRows: tables.EvidenciasBoleta,
  };
}

function sourceHashFor(bundle, group) {
  const deviceIds = new Set(group.devices.map((device) => String(device.EvidenciaMantenimientoID)));
  return sha256(JSON.stringify({
    group: group.key,
    devices: group.devices.map((device) => ({
      id: device.EvidenciaMantenimientoID,
      name: device.NombreDispositivo,
      zone: device.Zona,
      answers: device.RespuestasJSON,
      funcionamiento: device.Funcionamiento,
      enUso: device.EnUso,
      estado: device.Estado,
      observacion: device.Observacion,
    })),
    images: bundle.images
      .filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)))
      .map((image) => image.FotoDispositivoID),
  }));
}

async function updateRowsInChunks(sheetName, updates, idColumn) {
  for (let index = 0; index < updates.length; index += UPDATE_BATCH_ROWS) {
    await updateRows(sheetName, updates.slice(index, index + UPDATE_BATCH_ROWS), idColumn);
  }
}

async function syncTicketEvidencesFast(ctx, bundle, ticketId, maintenanceId, devices) {
  const deviceIds = new Set(devices.map((device) => String(device.EvidenciaMantenimientoID)));
  const selectedImages = bundle.images.filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)));
  const current = bundle.evidenceRows.filter((item) => String(item.BoletaUID) === String(ticketId));
  const currentById = new Map(current.map((item) => [String(item.EvidenciaID), item]));
  const expectedIds = new Set();
  const updates = [];
  const creates = [];
  const timestamp = nowIso();

  selectedImages.forEach((image, index) => {
    const evidenceId = generatedEvidenceId(ticketId, image.FotoDispositivoID);
    expectedIds.add(evidenceId);
    const device = devices.find((item) => String(item.EvidenciaMantenimientoID) === String(image.DispositivoMantenimientoRef));
    const row = {
      BoletaUID: ticketId,
      Nombre: `${clean(device?.NombreDispositivo, 'Dispositivo')} - ${clean(image.Tipo, 'Evidencia')}`,
      Nota: clean(image.Nota),
      ArchivoID: clean(image.DriveFileID),
      ArchivoURL: clean(image.DriveURL),
      NombreArchivo: clean(image.Nombre, `evidencia-${index + 1}`),
      MimeType: clean(image.MimeType, 'image/jpeg'),
      Orden: index + 1,
      Activo: true,
      OrigenMantenimientoID: maintenanceId,
      OrigenMantenimientoDispositivoID: clean(image.DispositivoMantenimientoRef),
      OrigenMantenimientoImagenID: clean(image.FotoDispositivoID),
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: timestamp,
    };
    if (currentById.has(evidenceId)) {
      updates.push({ idValue: evidenceId, patch: row });
    } else {
      creates.push({
        EvidenciaID: evidenceId,
        ...row,
        CreadoPor: ctx.user.UsuarioID,
        FechaCreacion: timestamp,
      });
    }
  });

  current
    .filter((item) => clean(item.OrigenMantenimientoID) === maintenanceId && active(item) && !expectedIds.has(String(item.EvidenciaID)))
    .forEach((item) => updates.push({
      idValue: item.EvidenciaID,
      patch: {
        Activo: false,
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: timestamp,
      },
    }));

  if (updates.length) await updateRowsInChunks('EvidenciasBoleta', updates, 'EvidenciaID');
  if (creates.length) await appendRows('EvidenciasBoleta', creates, { chunkSize: APPEND_BATCH_ROWS });
}

function ticketPayload(bundle, group, draft, unchangedFinalized, existing) {
  const maintenance = bundle.maintenance;
  const supervisor = supervisorFor(bundle);
  const category = catalogMatch(bundle.categories, ['mantenimiento', 'mantenimientos']);
  const failureType = catalogMatch(bundle.failureTypes, ['mantenimiento preventivo', 'mantenimiento', 'preventivo']);
  return {
    payload: {
      Titulo: fitMaintenanceTicketCell(clean(draft.titulo, `Mantenimiento ${group.date}`), 120),
      Estado: unchangedFinalized ? existing.Estado : 'PENDIENTE',
      Fecha: group.date,
      HoraInicio: '',
      HoraFinal: '',
      HorasTotales: 0,
      ClienteID: maintenance.ClienteID,
      Cliente: maintenance.Cliente || bundle.client?.Nombre || '',
      UbicacionID: maintenance.UbicacionID || '',
      Ubicacion: maintenance.Ubicacion || '',
      UbicacionEquipoID: '',
      UbicacionEquipo: '',
      SupervisorID: supervisor.id,
      Supervisor: supervisor.names.join(', '),
      CorreoSupervisor: supervisor.emails.join(', '),
      CorreoCliente: '',
      CategoriaID: clean(category?.CategoriaID),
      Categoria: clean(category?.Nombre, 'Mantenimiento'),
      TipoFallaID: clean(failureType?.TipoFallaID),
      TipoFalla: clean(failureType?.Nombre, 'Mantenimiento preventivo'),
      TipoDispositivo: fitMaintenanceTicketCell([...new Set(group.devices.map((device) => clean(device.Categoria || device.TipoDispositivo)).filter(Boolean))].join(', '), 1000),
      Descripcion: fitMaintenanceTicketCell(draft.descripcion),
      RazonVisita: fitMaintenanceTicketCell(draft.razonVisita),
      PruebasRealizadas: fitMaintenanceTicketCell(draft.pruebasRealizadas),
      Resultado: fitMaintenanceTicketCell(draft.resultado),
      Recomendaciones: fitMaintenanceTicketCell(draft.recomendaciones),
      EnviarCorreoCliente: false,
      CorreosCC: '',
      AsignadoA: group.technicianIds,
      asignados: group.technicianIds,
    },
    supervisor,
  };
}

async function upsertGeneratedTicketFast(ctx, bundle, group) {
  const maintenanceId = clean(bundle.maintenance.MantenimientoID);
  const ticketId = generatedTicketUid(maintenanceId, group.key);
  const existing = bundle.ticketsById.get(ticketId) || null;
  const sourceHash = sourceHashFor(bundle, group);
  const unchangedFinalized = existing
    && normalized(existing.Estado).includes('final')
    && clean(existing.OrigenMantenimientoHash) === sourceHash;
  const draft = buildMaintenanceTicketDraft(bundle, group);
  const prepared = ticketPayload(bundle, group, draft, unchangedFinalized, existing || {});
  const payload = { boletaUid: ticketId, BoletaUID: ticketId, ...prepared.payload };

  if (!existing) {
    await ticketMultiHandlers.create({ ...ctx, payload });
  } else if (!unchangedFinalized) {
    await ticketMultiHandlers.update({ ...ctx, payload });
  }

  await updateRow('Boletas', ticketId, {
    OrigenMantenimientoID: maintenanceId,
    OrigenMantenimientoGrupo: group.key,
    OrigenMantenimientoFecha: group.date,
    OrigenMantenimientoTecnicosJSON: JSON.stringify(group.technicianIds),
    OrigenMantenimientoHash: sourceHash,
    EsBoletaMantenimiento: true,
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: nowIso(),
  });

  await syncTicketEvidencesFast(ctx, bundle, ticketId, maintenanceId, group.devices);

  let delivery = null;
  if (!unchangedFinalized) {
    delivery = await ticketDeliveryHandlers.finalize({
      ...ctx,
      permissions: [...new Set([
        ...(ctx.permissions || []),
        'USUARIOS_GESTIONAR',
        'BOLETAS_CREAR',
        'BOLETAS_EDITAR',
        'BOLETAS_FINALIZAR',
      ])],
      payload: { boletaUid: ticketId, BoletaUID: ticketId },
    });
  }

  const stored = await findById('Boletas', ticketId);
  return {
    ticketId,
    ticketNumber: stored.BoletaID || ticketId,
    title: stored.Titulo || payload.Titulo,
    date: group.date,
    technicianIds: group.technicianIds,
    technicians: group.technicians.map((technician) => technician.name),
    deviceCount: group.devices.length,
    supervisorEmails: prepared.supervisor.emails,
    clientChatConfigured: Boolean(clean(bundle.client?.ChatWebhook || bundle.client?.ChatWebhookURL)),
    geminiUsed: false,
    geminiModel: '',
    geminiWarning: '',
    reused: Boolean(unchangedFinalized),
    delivery,
  };
}

async function concurrentMap(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

export async function generateMaintenanceTicketsFast(ctx, maintenanceId) {
  const id = clean(maintenanceId);
  if (!id) throw badRequest('No se indicó el mantenimiento para generar las boletas.');

  await Promise.all([
    ensureSheetColumns('Boletas', TICKET_ORIGIN_COLUMNS),
    ensureSheetColumns('EvidenciasBoleta', EVIDENCE_ORIGIN_COLUMNS),
    ensureSheetColumns('Mantenimiento', MAINTENANCE_TICKET_COLUMNS),
  ]);

  const bundle = await loadBundle(id);
  const groups = buildGroups(bundle);
  const generated = await concurrentMap(
    groups,
    DELIVERY_CONCURRENCY,
    (group) => upsertGeneratedTicketFast(ctx, bundle, group),
  );

  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    BoletasGeneradasJSON: JSON.stringify(generated.map((item) => item.ticketId)),
    BoletasGeneradasCantidad: generated.length,
    BoletasGeneradasEn: timestamp,
    EstadoBoletasMantenimiento: 'GENERADAS_Y_ENVIADAS',
    UltimoErrorBoletasMantenimiento: '',
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });

  await audit(ctx, 'GENERAR_BOLETAS_DESDE_MANTENIMIENTO', 'Mantenimiento', id, null, {
    CantidadBoletas: generated.length,
    Boletas: generated.map((item) => item.ticketNumber),
    Grupos: generated.map((item) => ({ fecha: item.date, tecnicos: item.technicians, dispositivos: item.deviceCount })),
    Estrategia: 'FINALIZACION_OPTIMIZADA',
  }).catch(() => {});

  return {
    maintenanceId: id,
    ticketCount: generated.length,
    ticketIds: generated.map((item) => item.ticketId),
    tickets: generated,
    warnings: generated.flatMap((item) => [
      item.supervisorEmails.length ? '' : `La boleta ${item.ticketNumber} no encontró correo de supervisor; se utilizaron los destinatarios alternativos disponibles.`,
      item.clientChatConfigured ? '' : `El cliente no tiene Chat configurado para la boleta ${item.ticketNumber}.`,
    ]).filter(Boolean),
    optimized: true,
  };
}
