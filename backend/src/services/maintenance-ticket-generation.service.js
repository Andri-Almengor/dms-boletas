import { AppError, badRequest } from '../core/errors.js';
import { asArray, nowIso, pick, sha256 } from '../core/utils.js';
import {
  appendRow,
  findById,
  readTable,
  readTables,
  updateRow,
} from '../infra/sheets.repository.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { ticketMultiHandlers } from '../modules/ticket-multi.module.js';
import { getConfig } from '../modules/config.module.js';
import { rewriteTechnicalReport } from './gemini.service.js';
import { audit } from './audit.service.js';
import { sendChatMessage } from './chat.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

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

export const MAINTENANCE_TICKET_COLUMNS = [
  'BoletasGeneradasJSON',
  'BoletasGeneradasCantidad',
  'BoletasGeneradasEn',
  'EstadoBoletasMantenimiento',
  'UltimoErrorBoletasMantenimiento',
];

const running = new Map();

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

function splitEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(source
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map((item) => clean(item).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function dateOnly(value, fallback = '') {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || fallback;
}

const COSTA_RICA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Costa_Rica',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function deviceRegistrationPoint(device = {}) {
  const raw = clean(
    device.FechaRegistroDispositivo
      || device.FechaCreacion
      || device.FechaActualizacion,
  );
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? { raw, timestamp } : null;
}

function groupWorkTime(devices = []) {
  const points = devices
    .map(deviceRegistrationPoint)
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!points.length) return { startTime: '', endTime: '', totalHours: 0 };

  const first = points[0];
  const last = points[points.length - 1];
  const elapsedMs = Math.max(0, last.timestamp - first.timestamp);
  const totalHours = elapsedMs <= 0
    ? 0
    : elapsedMs <= 60 * 60 * 1000
      ? 1
      : Number((elapsedMs / (60 * 60 * 1000)).toFixed(2));

  return {
    startTime: COSTA_RICA_TIME.format(new Date(first.timestamp)),
    endTime: COSTA_RICA_TIME.format(new Date(last.timestamp)),
    totalHours,
  };
}

function parseAnswers(device = {}) {
  const source = device.RespuestasJSON || device.respuestas || {};
  if (typeof source === 'object' && source !== null) return source;
  try {
    const parsed = JSON.parse(source || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function humanize(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function isPositive(value) {
  const text = normalized(value);
  if (!text) return null;
  if (text.includes('mal') || text.includes('falla') || text.includes('incorrect') || text === 'no') return false;
  if (text.startsWith('si') || text.includes('correct') || text.includes('aprob') || text.includes('funciona')) return true;
  if (text.includes('guardado')) return true;
  return null;
}

function deviceIdentity(device = {}) {
  const parts = [
    clean(device.NombreDispositivo, 'Dispositivo'),
    clean(device.Categoria || device.TipoDispositivo),
    clean(device.Zona),
    clean(device.Fabricante),
    clean(device.Modelo),
    clean(device.Serie),
  ].filter(Boolean);
  return parts.join(' · ');
}

function deviceChecks(device = {}) {
  const answers = parseAnswers(device);
  return [
    ['Funcionamiento', device.Funcionamiento],
    ['En uso', device.EnUso],
    ...Object.entries(answers).map(([key, value]) => [humanize(key), value]),
    ['Estado', device.Estado],
  ].filter(([, value]) => clean(value));
}

function deviceResult(device = {}) {
  const checks = deviceChecks(device);
  const negatives = checks.filter(([, value]) => isPositive(value) === false);
  const unresolved = checks.filter(([, value]) => isPositive(value) === null);
  if (negatives.length) {
    return `${clean(device.NombreDispositivo, 'Dispositivo')}: requiere atención en ${negatives.map(([label, value]) => `${label} (${value})`).join(', ')}.`;
  }
  if (checks.length && !unresolved.length) {
    return `${clean(device.NombreDispositivo, 'Dispositivo')}: revisión conforme según las respuestas registradas.`;
  }
  return `${clean(device.NombreDispositivo, 'Dispositivo')}: ${checks.map(([label, value]) => `${label}: ${value}`).join('; ') || 'sin respuestas registradas'}.`;
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

  return [...groups.values()]
    .map((group) => ({ ...group, ...groupWorkTime(group.devices) }))
    .sort((left, right) => {
      const byDate = left.date.localeCompare(right.date);
      return byDate || left.technicians.map((item) => item.name).join(', ').localeCompare(right.technicians.map((item) => item.name).join(', '), 'es');
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

  return {
    id: clean(selected[0]?.ContactoID),
    names,
    emails,
  };
}

function catalogMatch(rows, terms) {
  const expected = terms.map(normalized);
  return rows.find((row) => expected.includes(normalized(row.Nombre)))
    || rows.find((row) => expected.some((term) => normalized(row.Nombre).includes(term)))
    || null;
}

function rawDraft(bundle, group) {
  const technicianNames = group.technicians.map((item) => item.name).join(', ');
  const categories = [...new Set(group.devices.map((device) => clean(device.Categoria || device.TipoDispositivo)).filter(Boolean))];
  const deviceNames = group.devices.map((device) => clean(device.NombreDispositivo, 'Dispositivo'));
  const reason = [
    `Se realizó mantenimiento a ${group.devices.length} dispositivo${group.devices.length === 1 ? '' : 's'} el ${group.date}.`,
    `Grupo técnico: ${technicianNames}.`,
    `Equipos atendidos: ${deviceNames.join(', ')}.`,
  ].join(' ');

  const tests = group.devices.map((device, index) => {
    const checks = deviceChecks(device).map(([label, value]) => `${label}: ${value}`).join('; ');
    return `${index + 1}. ${deviceIdentity(device)}. ${checks || 'Sin respuestas de checklist.'}`;
  }).join('\n');

  const result = group.devices.map(deviceResult).join('\n');
  const recomendaciones = group.devices
    .filter((device) => clean(device.Observacion))
    .map((device) => `${clean(device.NombreDispositivo, 'Dispositivo')}: ${clean(device.Observacion)}`)
    .join('\n');

  return {
    titulo: `Mantenimiento de ${categories.join(', ') || 'dispositivos'} - ${group.date}`,
    razonVisita: reason,
    descripcion: `${group.devices.length} dispositivo${group.devices.length === 1 ? '' : 's'}: ${deviceNames.join(', ')}.`,
    pruebasRealizadas: tests,
    resultado: result,
    recomendaciones,
    categories,
    technicianNames,
  };
}

async function improveDraft(bundle, group, raw) {
  try {
    const improved = await rewriteTechnicalReport({
      titulo: raw.titulo,
      razonVisita: raw.razonVisita,
      descripcion: raw.descripcion,
      pruebasRealizadas: raw.pruebasRealizadas,
      resultado: raw.resultado,
      recomendaciones: raw.recomendaciones,
      cliente: bundle.maintenance.Cliente || bundle.client?.Nombre,
      ubicacion: bundle.maintenance.Ubicacion,
      categoria: 'Mantenimiento',
      tipoFalla: 'Mantenimiento preventivo y revisión técnica',
      tipoDispositivo: raw.categories.join(', '),
      nombreDispositivo: group.devices.map((device) => clean(device.NombreDispositivo)).filter(Boolean).join(', '),
      fabricante: [...new Set(group.devices.map((device) => clean(device.Fabricante)).filter(Boolean))].join(', '),
      modelo: [...new Set(group.devices.map((device) => clean(device.Modelo)).filter(Boolean))].join(', '),
      serie: group.devices.map((device) => clean(device.Serie)).filter(Boolean).join(', '),
    });
    return {
      ...raw,
      ...improved,
      geminiUsed: true,
      geminiModel: improved.model || '',
      geminiWarning: '',
    };
  } catch (error) {
    return {
      ...raw,
      geminiUsed: false,
      geminiModel: '',
      geminiWarning: `Gemini no pudo mejorar esta boleta; se conservó la redacción técnica original: ${error?.message || error}`,
    };
  }
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
      'Categorias',
      'TiposFalla',
    ]),
  ]);

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
  };
}

async function buildDrafts(maintenanceId) {
  const bundle = await loadBundle(maintenanceId);
  const groups = buildGroups(bundle);
  const drafts = [];
  for (const group of groups) {
    const raw = rawDraft(bundle, group);
    const contentFingerprint = {
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
        registeredAt: device.FechaRegistroDispositivo || device.FechaCreacion,
      })),
      images: bundle.images
        .filter((image) => group.devices.some((device) => String(device.EvidenciaMantenimientoID) === String(image.DispositivoMantenimientoRef)))
        .map((image) => image.FotoDispositivoID),
    };
    drafts.push({
      bundle,
      group,
      draft: await improveDraft(bundle, group, raw),
      sourceHash: sha256(JSON.stringify(contentFingerprint)),
    });
  }
  return drafts;
}

function generatedTicketUid(maintenanceId, groupKey) {
  return `mnt-${sha256(maintenanceId).slice(0, 12)}-${sha256(groupKey).slice(0, 20)}`;
}

function generatedEvidenceId(ticketId, imageId) {
  return `mnt-evidence-${sha256(`${ticketId}|${imageId}`).slice(0, 32)}`;
}

async function syncTicketEvidences(ctx, ticketId, maintenanceId, devices, images) {
  await ensureSheetColumns('EvidenciasBoleta', EVIDENCE_ORIGIN_COLUMNS);
  const deviceIds = new Set(devices.map((device) => String(device.EvidenciaMantenimientoID)));
  const selectedImages = images.filter((image) => deviceIds.has(String(image.DispositivoMantenimientoRef)));
  const current = await readTable('EvidenciasBoleta', { force: true });
  const expectedIds = new Set();

  for (let index = 0; index < selectedImages.length; index += 1) {
    const image = selectedImages[index];
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
      FechaActualizacion: nowIso(),
    };
    const existing = current.find((item) => String(item.EvidenciaID) === evidenceId);
    if (existing) {
      await updateRow('EvidenciasBoleta', evidenceId, row);
    } else {
      await appendRow('EvidenciasBoleta', {
        EvidenciaID: evidenceId,
        ...row,
        CreadoPor: ctx.user.UsuarioID,
        FechaCreacion: nowIso(),
      });
    }
  }

  for (const old of current.filter((item) => (
    String(item.BoletaUID) === String(ticketId)
    && clean(item.OrigenMantenimientoID) === clean(maintenanceId)
    && !expectedIds.has(String(item.EvidenciaID))
    && active(item)
  ))) {
    await updateRow('EvidenciasBoleta', old.EvidenciaID, {
      Activo: false,
      ActualizadoPor: ctx.user.UsuarioID,
      FechaActualizacion: nowIso(),
    });
  }
}

async function upsertGeneratedTicket(ctx, item) {
  const { bundle, group, draft, sourceHash } = item;
  const maintenance = bundle.maintenance;
  const maintenanceId = clean(maintenance.MantenimientoID);
  const ticketId = generatedTicketUid(maintenanceId, group.key);
  const supervisor = supervisorFor(bundle);
  const category = catalogMatch(bundle.categories, ['mantenimiento', 'mantenimientos']);
  const failureType = catalogMatch(bundle.failureTypes, ['mantenimiento preventivo', 'mantenimiento', 'preventivo']);
  const existingRows = await readTable('Boletas', { force: true });
  const existing = existingRows.find((ticket) => String(ticket.BoletaUID) === ticketId);
  const unchangedFinalized = existing
    && normalized(existing.Estado).includes('final')
    && clean(existing.OrigenMantenimientoHash) === sourceHash;

  const payload = {
    boletaUid: ticketId,
    BoletaUID: ticketId,
    Titulo: clean(draft.titulo, `Mantenimiento ${group.date}`).slice(0, 120),
    Estado: unchangedFinalized ? existing.Estado : 'PENDIENTE',
    Fecha: group.date,
    HoraInicio: group.startTime,
    HoraFinal: group.endTime,
    HorasTotales: group.totalHours,
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
    TipoDispositivo: [...new Set(group.devices.map((device) => clean(device.Categoria || device.TipoDispositivo)).filter(Boolean))].join(', '),
    Descripcion: clean(draft.descripcion),
    RazonVisita: clean(draft.razonVisita),
    PruebasRealizadas: clean(draft.pruebasRealizadas),
    Resultado: clean(draft.resultado),
    Recomendaciones: clean(draft.recomendaciones),
    EnviarCorreoCliente: false,
    CorreosCC: '',
    AsignadoA: group.technicianIds,
    asignados: group.technicianIds,
  };

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

  await syncTicketEvidences(ctx, ticketId, maintenanceId, group.devices, bundle.images);

  let delivery = null;
  if (!unchangedFinalized) {
    const systemContext = {
      ...ctx,
      permissions: [...new Set([
        ...(ctx.permissions || []),
        'USUARIOS_GESTIONAR',
        'BOLETAS_CREAR',
        'BOLETAS_EDITAR',
        'BOLETAS_FINALIZAR',
      ])],
      payload: { boletaUid: ticketId, BoletaUID: ticketId },
    };
    delivery = await ticketDeliveryHandlers.finalize(systemContext);
  }

  const stored = await findById('Boletas', ticketId);
  return {
    ticketId,
    ticketNumber: stored.BoletaID || ticketId,
    title: stored.Titulo || payload.Titulo,
    date: group.date,
    startTime: group.startTime,
    endTime: group.endTime,
    totalHours: group.totalHours,
    technicianIds: group.technicianIds,
    technicians: group.technicians.map((technician) => technician.name),
    deviceCount: group.devices.length,
    supervisorEmails: supervisor.emails,
    clientChatConfigured: Boolean(clean(bundle.client?.ChatWebhook || bundle.client?.ChatWebhookURL)),
    geminiUsed: draft.geminiUsed,
    geminiModel: draft.geminiModel,
    geminiWarning: draft.geminiWarning,
    reused: unchangedFinalized,
    delivery,
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

function previewText(maintenance, previews) {
  return [
    '🧪 PRUEBA DE BOLETAS AUTOMÁTICAS DE MANTENIMIENTO',
    `Mantenimiento: ${maintenance.TituloMantenimiento || maintenance.MantenimientoID}`,
    `Cliente: ${maintenance.Cliente || 'Sin cliente'}`,
    `Grupos detectados: ${previews.length}`,
    '',
    ...previews.flatMap((preview, index) => [
      `BOLETA ${index + 1}`,
      `Fecha: ${preview.group.date}`,
      `Técnicos: ${preview.group.technicians.map((technician) => technician.name).join(', ')}`,
      `Dispositivos: ${preview.group.devices.length}`,
      `Título propuesto: ${preview.draft.titulo}`,
      `Razón: ${preview.draft.razonVisita}`,
      `Pruebas: ${preview.draft.pruebasRealizadas}`,
      `Resultado: ${preview.draft.resultado}`,
      preview.draft.geminiWarning ? `Advertencia: ${preview.draft.geminiWarning}` : '',
      '',
    ]),
    'Esta prueba no creó boletas, no cambió el mantenimiento y no notificó al cliente ni al supervisor.',
  ].filter(Boolean).join('\n');
}

async function sendPreviewToTestChat(maintenance, previews) {
  const config = await getConfig();
  const url = testWebhook(config);
  if (!url) throw new AppError('MAINTENANCE_TEST_CHAT_MISSING', 'No se configuró el Chat de pruebas.', 500);
  const text = previewText(maintenance, previews);
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

export async function previewMaintenanceTickets(ctx, maintenanceId, { sendTestChat = false } = {}) {
  const previews = await buildDrafts(maintenanceId);
  const maintenance = previews[0]?.bundle?.maintenance || await findById('Mantenimiento', maintenanceId);
  const chat = sendTestChat ? await sendPreviewToTestChat(maintenance, previews) : null;
  await audit(ctx, 'PROBAR_BOLETAS_AUTOMATICAS_MANTENIMIENTO', 'Mantenimiento', maintenanceId, null, {
    Grupos: previews.length,
    Fechas: previews.map((item) => item.group.date),
    Tecnicos: previews.map((item) => item.group.technicians.map((technician) => technician.name)),
    Dispositivos: previews.map((item) => item.group.devices.length),
    EstadoCambiado: false,
    BoletasCreadas: false,
  }).catch(() => {});
  return {
    tested: true,
    stateChanged: false,
    ticketsCreated: false,
    groupCount: previews.length,
    chat,
    groups: previews.map((item) => ({
      date: item.group.date,
      technicianIds: item.group.technicianIds,
      technicians: item.group.technicians.map((technician) => technician.name),
      deviceCount: item.group.devices.length,
      title: item.draft.titulo,
      reason: item.draft.razonVisita,
      tests: item.draft.pruebasRealizadas,
      result: item.draft.resultado,
      geminiUsed: item.draft.geminiUsed,
      geminiWarning: item.draft.geminiWarning,
    })),
    message: `Prueba completada: se detectaron ${previews.length} grupo(s) por fecha y equipo técnico. No se crearon boletas reales.`,
  };
}

async function generate(ctx, maintenanceId) {
  await Promise.all([
    ensureSheetColumns('Boletas', TICKET_ORIGIN_COLUMNS),
    ensureSheetColumns('EvidenciasBoleta', EVIDENCE_ORIGIN_COLUMNS),
    ensureSheetColumns('Mantenimiento', MAINTENANCE_TICKET_COLUMNS),
  ]);

  const items = await buildDrafts(maintenanceId);
  const generated = [];
  for (const item of items) generated.push(await upsertGeneratedTicket(ctx, item));

  const timestamp = nowIso();
  await updateRow('Mantenimiento', maintenanceId, {
    BoletasGeneradasJSON: JSON.stringify(generated.map((item) => item.ticketId)),
    BoletasGeneradasCantidad: generated.length,
    BoletasGeneradasEn: timestamp,
    EstadoBoletasMantenimiento: 'GENERADAS_Y_ENVIADAS',
    UltimoErrorBoletasMantenimiento: '',
    ActualizadoPor: ctx.user.UsuarioID,
    FechaActualizacion: timestamp,
  });

  await audit(ctx, 'GENERAR_BOLETAS_DESDE_MANTENIMIENTO', 'Mantenimiento', maintenanceId, null, {
    CantidadBoletas: generated.length,
    Boletas: generated.map((item) => item.ticketNumber),
    Grupos: generated.map((item) => ({ fecha: item.date, tecnicos: item.technicians, dispositivos: item.deviceCount })),
    Gemini: generated.map((item) => ({ boleta: item.ticketNumber, usado: item.geminiUsed, modelo: item.geminiModel, advertencia: item.geminiWarning })),
  }).catch(() => {});

  return {
    maintenanceId,
    ticketCount: generated.length,
    ticketIds: generated.map((item) => item.ticketId),
    tickets: generated,
    warnings: generated.flatMap((item) => [
      item.geminiWarning,
      item.supervisorEmails.length ? '' : `La boleta ${item.ticketNumber} no encontró correo de supervisor; el correo utilizó los destinatarios alternativos configurados.`,
      item.clientChatConfigured ? '' : `El cliente no tiene Chat configurado para la boleta ${item.ticketNumber}.`,
    ]).filter(Boolean),
  };
}

export async function generateMaintenanceTickets(ctx, maintenanceId) {
  const id = clean(maintenanceId);
  if (!id) throw badRequest('No se indicó el mantenimiento para generar las boletas.');
  const key = `maintenance-tickets:${id}`;
  if (running.has(key)) return running.get(key);
  const operation = generate(ctx, id).finally(() => running.delete(key));
  running.set(key, operation);
  return operation;
}
