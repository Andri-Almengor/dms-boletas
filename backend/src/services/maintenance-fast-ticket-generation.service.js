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

// Una finalización grande se reparte en varias boletas del mismo día y grupo
// técnico. Los límites se pueden ajustar por variables de entorno sin cambiar
// el contrato del frontend ni la estructura de las hojas.
function positiveEnvInteger(name, fallback, minimum = 1, maximum = 100_000) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export const MAINTENANCE_TICKET_SPLIT_LIMITS = Object.freeze({
  maxDevices: positiveEnvInteger('MAINTENANCE_TICKET_MAX_DEVICES', 12, 1, 100),
  maxEvidences: positiveEnvInteger('MAINTENANCE_TICKET_MAX_EVIDENCES', 18, 1, 100),
  maxEstimatedTextChars: positiveEnvInteger('MAINTENANCE_TICKET_MAX_TEXT_CHARS', 24_000, 2_000, 40_000),
});

// El Apps Script de reportes usa un ScriptLock global durante la creación del
// documento. Por eso los PDFs se mantienen secuenciales: ahora cada llamada
// recibe una parte mucho más pequeña del mantenimiento.
const DELIVERY_CONCURRENCY = 1;
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
  const safeMax = Math.max(1, Number(max) || MAINTENANCE_TICKET_SAFE_CELL_CHARS);
  if (text.length <= safeMax) return text;
  const suffix = '\n\n[Contenido resumido para compatibilidad con Google Sheets. Consulte el mantenimiento y la carpeta de evidencias para el detalle completo.]';
  if (safeMax <= suffix.length) return text.slice(0, safeMax);
  return `${text.slice(0, safeMax - suffix.length)}${suffix}`;
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
    device.FechaTrabajo || device.FechaRegistroTrabajo || device.FechaCreacion,
    dateOnly(maintenance.Fecha, dateOnly(maintenance.FechaCreacion)),
  );
}

function deviceTextWeight(device = {}) {
  const relevant = [
    device.NombreDispositivo,
    device.Zona,
    device.Categoria,
    device.TipoDispositivo,
    device.Fabricante,
    device.Modelo,
    device.Serie,
    device.Funcionamiento,
    device.EnUso,
    device.Estado,
    device.Observacion,
    device.RespuestasJSON,
  ];
  // El informe genera narrativa adicional alrededor de cada dato. Se añade un
  // margen fijo para aproximar ese texto sin tener que construir el PDF antes.
  return Math.max(900, relevant.reduce((sum, value) => sum + String(value ?? '').length, 0) + 700);
}

function imagesByDevice(bundle) {
  const map = new Map();
  for (const image of bundle.images) {
    const deviceId = String(image.DispositivoMantenimientoRef || '');
    if (!map.has(deviceId)) map.set(deviceId, []);
    map.get(deviceId).push(String(image.FotoDispositivoID || ''));
  }
  return map;
}

function chunkArray(items, size) {
  if (!items.length) return [[]];
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function splitBaseGroup(bundle, baseGroup) {
  const limits = MAINTENANCE_TICKET_SPLIT_LIMITS;
  const deviceImages = imagesByDevice(bundle);
  const units = [];

  for (const device of baseGroup.devices) {
    const deviceId = String(device.EvidenciaMantenimientoID || '');
    const imageChunks = chunkArray(deviceImages.get(deviceId) || [], limits.maxEvidences);
    imageChunks.forEach((imageIds, continuationIndex) => {
      units.push({
        device,
        imageIds,
        textWeight: deviceTextWeight(device),
        continuationIndex,
      });
    });
  }

  const rawParts = [];
  let current = null;
  const freshPart = () => ({ devices: [], imageIds: [], estimatedTextChars: 0 });
  const flush = () => {
    if (current?.devices.length) rawParts.push(current);
    current = freshPart();
  };
  current = freshPart();

  for (const unit of units) {
    const deviceId = String(unit.device.EvidenciaMantenimientoID || '');
    const alreadyIncluded = current.devices.some((item) => String(item.EvidenciaMantenimientoID || '') === deviceId);
    const nextDeviceCount = current.devices.length + (alreadyIncluded ? 0 : 1);
    const nextEvidenceCount = current.imageIds.length + unit.imageIds.length;
    const nextTextChars = current.estimatedTextChars + (alreadyIncluded ? 0 : unit.textWeight);
    const exceeds = current.devices.length > 0 && (
      nextDeviceCount > limits.maxDevices
      || nextEvidenceCount > limits.maxEvidences
      || nextTextChars > limits.maxEstimatedTextChars
    );

    if (exceeds) flush();

    const inNewPart = current.devices.some((item) => String(item.EvidenciaMantenimientoID || '') === deviceId);
    if (!inNewPart) {
      current.devices.push(unit.device);
      current.estimatedTextChars += unit.textWeight;
    }
    current.imageIds.push(...unit.imageIds);
  }
  flush();

  const partCount = rawParts.length;
  return rawParts.map((part, index) => ({
    ...baseGroup,
    // La primera parte conserva la clave histórica. Si la finalización anterior
    // alcanzó a crear una boleta antes de fallar, esa misma boleta se reutiliza.
    key: index === 0 ? baseGroup.key : `${baseGroup.key}|parte:${index + 1}`,
    devices: part.devices,
    imageIds: part.imageIds,
    estimatedTextChars: part.estimatedTextChars,
    partIndex: index + 1,
    partCount,
  }));
}

export function buildMaintenanceTicketGroups(bundle) {
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

  const baseGroups = [...groups.values()].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    return byDate || left.technicians.map((item) => item.name).join(', ').localeCompare(
      right.technicians.map((item) => item.name).join(', '),
      'es',
    );
  });

  return baseGroups.flatMap((group) => splitBaseGroup(bundle, group));
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

function groupImages(bundle, group) {
  if (Array.isArray(group.imageIds)) {
    const allowed = new Set(group.imageIds.map(String));
    return bundle.images.filter((image) => allowed.has(String(image.FotoDispositivoID)));
  }
  const deviceIds = new Set(group.devices.map((device) => String(device.EvidenciaMantenimientoID)));
  return bundle.images.filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)));
}

function sourceHashFor(bundle, group) {
  return sha256(JSON.stringify({
    group: group.key,
    part: [group.partIndex || 1, group.partCount || 1],
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
    images: groupImages(bundle, group).map((image) => image.FotoDispositivoID),
  }));
}

async function updateRowsInChunks(sheetName, updates, idColumn) {
  for (let index = 0; index < updates.length; index += UPDATE_BATCH_ROWS) {
    await updateRows(sheetName, updates.slice(index, index + UPDATE_BATCH_ROWS), idColumn);
  }
}

async function syncTicketEvidencesFast(ctx, bundle, ticketId, maintenanceId, group) {
  const devices = group.devices;
  const selectedImages = groupImages(bundle, group);
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
  const partLabel = group.partCount > 1 ? ` - Parte ${group.partIndex} de ${group.partCount}` : '';
  const partNote = group.partCount > 1
    ? `\n\nEste reporte corresponde a la parte ${group.partIndex} de ${group.partCount} del mantenimiento realizado el ${group.date}.`
    : '';
  return {
    payload: {
      Titulo: fitMaintenanceTicketCell(`${clean(draft.titulo, `Mantenimiento ${group.date}`)}${partLabel}`, 120),
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
      Descripcion: fitMaintenanceTicketCell(`${draft.descripcion}${partNote}`),
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

  await syncTicketEvidencesFast(ctx, bundle, ticketId, maintenanceId, group);

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
    partIndex: group.partIndex || 1,
    partCount: group.partCount || 1,
    technicianIds: group.technicianIds,
    technicians: group.technicians.map((technician) => technician.name),
    deviceCount: group.devices.length,
    evidenceCount: groupImages(bundle, group).length,
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
  const groups = buildMaintenanceTicketGroups(bundle);
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
    Grupos: generated.map((item) => ({
      fecha: item.date,
      parte: `${item.partIndex}/${item.partCount}`,
      tecnicos: item.technicians,
      dispositivos: item.deviceCount,
      evidencias: item.evidenceCount,
    })),
    LimitesDivision: MAINTENANCE_TICKET_SPLIT_LIMITS,
    Estrategia: 'FINALIZACION_OPTIMIZADA_DIVIDIDA',
  }).catch(() => {});

  return {
    maintenanceId: id,
    ticketCount: generated.length,
    ticketIds: generated.map((item) => item.ticketId),
    tickets: generated,
    splitLimits: MAINTENANCE_TICKET_SPLIT_LIMITS,
    warnings: generated.flatMap((item) => [
      item.supervisorEmails.length ? '' : `La boleta ${item.ticketNumber} no encontró correo de supervisor; se utilizaron los destinatarios alternativos disponibles.`,
      item.clientChatConfigured ? '' : `El cliente no tiene Chat configurado para la boleta ${item.ticketNumber}.`,
    ]).filter(Boolean),
    optimized: true,
    splitLargeGroups: true,
  };
}
