import {
  cacheResponse,
  createOfflineId,
  enqueueOperation,
  mutateCachedResponse,
  mutateCachedResponses,
  readCachedResponse,
  responseCacheKey,
} from './offlineStore';

const TICKET_GET_ROUTES = ['boletas.get', 'tickets.get'];
const MAINTENANCE_GET_ROUTES = ['maintenance.get', 'mantenimientos.get'];

function text(value) {
  return String(value ?? '').trim();
}

function first(payload, keys, fallback = '') {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function routeText(routes) {
  return (Array.isArray(routes) ? routes : [routes]).join(' ').toLowerCase();
}

function ensureId(payload, keys, prefix) {
  const current = first(payload, keys);
  const id = text(current || createOfflineId(prefix));
  keys.forEach((key) => { payload[key] = id; });
  return id;
}

function dataUrl(payload, fallbackMime = 'application/octet-stream') {
  const encoded = text(payload?.base64);
  if (!encoded) return '';
  return `data:${text(payload?.mimeType || fallbackMime)};base64,${encoded}`;
}

function collectionItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function rebuildCollection(data, items) {
  if (Array.isArray(data)) return items;
  if (Array.isArray(data?.items)) return { ...data, items, total: items.length };
  if (Array.isArray(data?.rows)) return { ...data, rows: items, total: items.length };
  if (Array.isArray(data?.data)) return { ...data, data: items, total: items.length };
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
}

function parseCachePayload(key) {
  const parts = text(key).split('|');
  if (parts.length < 3) return {};
  try { return JSON.parse(parts.slice(2).join('|')); } catch { return {}; }
}

function localTicketRecord(payload, previous = {}) {
  const uid = text(first(payload, ['boletaUid', 'BoletaUID'], previous.BoletaUID));
  const owner = text(first(payload, ['OfflineOwnerID', 'offlineOwnerId', 'CreadoPor'], previous.OfflineOwnerID || previous.CreadoPor));
  return {
    ...previous,
    ...payload,
    BoletaUID: uid,
    boletaUid: uid,
    BoletaID: previous.BoletaID || payload.BoletaID || 'Sin sincronizar',
    Estado: text(first(payload, ['Estado', 'estado'], previous.Estado || 'PENDIENTE')).toUpperCase(),
    CreadoPor: previous.CreadoPor || owner,
    OfflineOwnerID: owner,
    OfflinePendiente: true,
    EstadoNotificacion: 'PENDIENTE_SINCRONIZACION',
  };
}

function localMaintenanceRecord(payload, previous = {}) {
  const id = text(first(payload, ['maintenanceId', 'MantenimientoID'], previous.MantenimientoID));
  const owner = text(first(payload, ['OfflineOwnerID', 'offlineOwnerId', 'CreadoPor'], previous.OfflineOwnerID || previous.CreadoPor));
  return {
    ...previous,
    ...payload,
    MantenimientoID: id,
    maintenanceId: id,
    Estado: text(first(payload, ['Estado', 'estado'], previous.Estado || 'PENDIENTE')).toUpperCase(),
    CreadoPor: previous.CreadoPor || owner,
    OfflineOwnerID: owner,
    OfflinePendiente: true,
  };
}

function ticketDetailKey(uid, sessionToken) {
  return responseCacheKey(TICKET_GET_ROUTES, { boletaUid: uid }, sessionToken);
}

function maintenanceDetailKey(id, sessionToken) {
  return responseCacheKey(MAINTENANCE_GET_ROUTES, { maintenanceId: id }, sessionToken);
}

async function updateTicketLists(record) {
  await mutateCachedResponses(
    (entry) => /\|(boletas|tickets)\.list\|/i.test(entry.key),
    (data, entry) => {
      const query = parseCachePayload(entry.key);
      const requestedStatus = text(query.status || query.estado).toUpperCase();
      const items = collectionItems(data);
      const uid = text(record.BoletaUID);
      const without = items.filter((item) => text(item.BoletaUID || item.boletaUid) !== uid);
      const include = !requestedStatus || requestedStatus === text(record.Estado).toUpperCase();
      return rebuildCollection(data, include ? [record, ...without] : without);
    },
  );
}

async function updateMaintenanceLists(record) {
  await mutateCachedResponses(
    (entry) => /\|(maintenance|mantenimientos)\.list\|/i.test(entry.key),
    (data) => {
      const items = collectionItems(data);
      const id = text(record.MantenimientoID);
      const without = items.filter((item) => text(item.MantenimientoID || item.maintenanceId) !== id);
      return rebuildCollection(data, [{ ...record, DispositivosRegistrados: Number(record.DispositivosRegistrados || 0) }, ...without]);
    },
  );
}

async function cacheTicketWrite(kind, payload, sessionToken) {
  const uid = text(first(payload, ['boletaUid', 'BoletaUID']));
  if (!uid) return;
  const key = ticketDetailKey(uid, sessionToken);

  const detail = await mutateCachedResponse(key, (current) => {
    const base = current?.boleta
      ? current
      : { boleta: localTicketRecord(payload), asignados: [], evidencias: [], offlineQueued: true };
    const assigned = (payload.AsignadoA || payload.asignados || []).map((UsuarioID) => ({ UsuarioID }));

    if (['ticket-create', 'ticket-update', 'ticket-autosave'].includes(kind)) {
      return {
        ...base,
        boleta: localTicketRecord(payload, base.boleta || {}),
        asignados: assigned.length || !('AsignadoA' in payload) ? (assigned.length ? assigned : base.asignados || []) : [],
        offlineQueued: true,
      };
    }

    if (kind === 'ticket-signature') {
      return {
        ...base,
        boleta: {
          ...localTicketRecord({}, base.boleta || {}),
          FirmaURL: dataUrl(payload, 'image/png'),
          FirmaMimeType: payload.mimeType || 'image/png',
          FirmaArchivoID: '',
        },
        offlineQueued: true,
      };
    }

    if (kind === 'ticket-evidence-create') {
      const evidenceId = text(first(payload, ['evidenciaId', 'EvidenciaID']));
      const evidence = {
        EvidenciaID: evidenceId,
        BoletaUID: uid,
        Nombre: first(payload, ['nombre', 'Nombre'], payload.fileName || 'Evidencia'),
        Nota: first(payload, ['nota', 'Nota']),
        NombreArchivo: payload.fileName || '',
        MimeType: payload.mimeType || 'application/octet-stream',
        ArchivoURL: dataUrl(payload),
        OfflinePendiente: true,
        Activo: true,
      };
      const rows = (base.evidencias || []).filter((item) => text(item.EvidenciaID || item.id) !== evidenceId);
      return { ...base, evidencias: [...rows, evidence], offlineQueued: true };
    }

    if (kind === 'ticket-evidence-update') {
      const evidenceId = text(first(payload, ['evidenciaId', 'EvidenciaID', 'id']));
      return {
        ...base,
        evidencias: (base.evidencias || []).map((item) => text(item.EvidenciaID || item.id) === evidenceId
          ? { ...item, Nombre: first(payload, ['nombre', 'Nombre'], item.Nombre), Nota: first(payload, ['nota', 'Nota'], item.Nota), OfflinePendiente: true }
          : item),
        offlineQueued: true,
      };
    }

    if (kind === 'ticket-evidence-delete') {
      const evidenceId = text(first(payload, ['evidenciaId', 'EvidenciaID', 'id']));
      return { ...base, evidencias: (base.evidencias || []).filter((item) => text(item.EvidenciaID || item.id) !== evidenceId), offlineQueued: true };
    }

    return base;
  });

  if (detail?.boleta) await updateTicketLists(detail.boleta);
}

function localDevice(payload, previous = {}) {
  const id = text(first(payload, ['deviceId', 'EvidenciaMantenimientoID'], previous.EvidenciaMantenimientoID));
  return {
    ...previous,
    ...payload,
    EvidenciaMantenimientoID: id,
    deviceId: id,
    MantenimientoRef: first(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef'], previous.MantenimientoRef),
    Categoria: first(payload, ['Categoria', 'categoria', 'TipoDispositivo'], previous.Categoria),
    TipoDispositivo: first(payload, ['TipoDispositivo', 'Categoria', 'categoria'], previous.TipoDispositivo || previous.Categoria),
    NombreDispositivo: first(payload, ['NombreDispositivo', 'nombre'], previous.NombreDispositivo),
    Zona: first(payload, ['Zona', 'zona'], previous.Zona),
    Imagenes: previous.Imagenes || [],
    OfflinePendiente: true,
    Activo: true,
  };
}

async function cacheMaintenanceWrite(kind, payload, sessionToken) {
  const maintenanceId = text(first(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));
  if (!maintenanceId) return;
  const key = maintenanceDetailKey(maintenanceId, sessionToken);

  const detail = await mutateCachedResponse(key, (current) => {
    const base = current?.mantenimiento
      ? current
      : { mantenimiento: localMaintenanceRecord(payload), responsables: [], dispositivos: [], offlineQueued: true };

    if (['maintenance-create', 'maintenance-update'].includes(kind)) {
      const responsables = payload.ResponsableIDs || payload.responsables || [];
      return {
        ...base,
        mantenimiento: localMaintenanceRecord(payload, base.mantenimiento || {}),
        responsables: responsables.map((UsuarioID) => ({ UsuarioID })),
        offlineQueued: true,
      };
    }

    if (['maintenance-device-create', 'maintenance-device-update', 'maintenance-device-autosave'].includes(kind)) {
      const deviceId = text(first(payload, ['deviceId', 'EvidenciaMantenimientoID']));
      const rows = base.dispositivos || [];
      const previous = rows.find((item) => text(item.EvidenciaMantenimientoID || item.id) === deviceId) || {};
      const device = localDevice(payload, previous);
      const next = rows.some((item) => text(item.EvidenciaMantenimientoID || item.id) === deviceId)
        ? rows.map((item) => text(item.EvidenciaMantenimientoID || item.id) === deviceId ? device : item)
        : [...rows, device];
      return { ...base, dispositivos: next, offlineQueued: true };
    }

    if (kind === 'maintenance-device-delete') {
      const deviceId = text(first(payload, ['deviceId', 'EvidenciaMantenimientoID']));
      return { ...base, dispositivos: (base.dispositivos || []).filter((item) => text(item.EvidenciaMantenimientoID || item.id) !== deviceId), offlineQueued: true };
    }

    if (kind === 'maintenance-image-create') {
      const deviceId = text(first(payload, ['deviceId', 'DispositivoMantenimientoRef']));
      const imageId = text(first(payload, ['imageId', 'FotoDispositivoID']));
      const image = {
        FotoDispositivoID: imageId,
        DispositivoMantenimientoRef: deviceId,
        Tipo: first(payload, ['Tipo', 'tipo'], 'Antes'),
        Nota: first(payload, ['Nota', 'nota']),
        Nombre: payload.fileName || 'Evidencia',
        MimeType: payload.mimeType || 'image/jpeg',
        DriveURL: dataUrl(payload, 'image/jpeg'),
        PreviewURL: dataUrl(payload, 'image/jpeg'),
        OfflinePendiente: true,
        Activo: true,
      };
      return {
        ...base,
        dispositivos: (base.dispositivos || []).map((device) => {
          if (text(device.EvidenciaMantenimientoID || device.id) !== deviceId) return device;
          const images = (device.Imagenes || []).filter((item) => text(item.FotoDispositivoID || item.id) !== imageId);
          return { ...device, Imagenes: [...images, image], OfflinePendiente: true };
        }),
        offlineQueued: true,
      };
    }

    if (kind === 'maintenance-image-update') {
      const imageId = text(first(payload, ['imageId', 'FotoDispositivoID']));
      return {
        ...base,
        dispositivos: (base.dispositivos || []).map((device) => ({
          ...device,
          Imagenes: (device.Imagenes || []).map((image) => text(image.FotoDispositivoID || image.id) === imageId
            ? { ...image, Tipo: first(payload, ['Tipo', 'tipo'], image.Tipo), Nota: first(payload, ['Nota', 'nota'], image.Nota), OfflinePendiente: true }
            : image),
        })),
        offlineQueued: true,
      };
    }

    if (kind === 'maintenance-image-delete') {
      const imageId = text(first(payload, ['imageId', 'FotoDispositivoID']));
      return {
        ...base,
        dispositivos: (base.dispositivos || []).map((device) => ({
          ...device,
          Imagenes: (device.Imagenes || []).filter((image) => text(image.FotoDispositivoID || image.id) !== imageId),
        })),
        offlineQueued: true,
      };
    }

    return base;
  });

  if (detail?.mantenimiento) {
    await updateMaintenanceLists({
      ...detail.mantenimiento,
      DispositivosRegistrados: (detail.dispositivos || []).length,
    });
  }
}

export function describeOfflineWrite(routes, payload = {}) {
  const route = routeText(routes);
  const ticketId = text(first(payload, ['boletaUid', 'BoletaUID']));
  const maintenanceId = text(first(payload, ['maintenanceId', 'MantenimientoID', 'MantenimientoRef']));

  if (route.includes('boletas.create') || route.includes('tickets.create')) return { kind: 'ticket-create', entityType: 'ticket', entityId: ticketId, recordId: ticketId, description: 'Crear boleta' };
  if (route.includes('boletas.autosave')) return { kind: 'ticket-autosave', entityType: 'ticket', entityId: ticketId, recordId: ticketId, description: 'Autoguardar boleta' };
  if (route.includes('boletas.signature.upload')) return { kind: 'ticket-signature', entityType: 'ticket', entityId: ticketId, recordId: ticketId, description: 'Subir firma de boleta' };
  if (route.includes('boletas.evidence.upload') || route.includes('tickets.evidence.upload')) return { kind: 'ticket-evidence-create', entityType: 'ticket', entityId: ticketId, recordId: first(payload, ['evidenciaId', 'EvidenciaID']), description: 'Subir evidencia de boleta' };
  if (route.includes('boletas.evidence.update') || route.includes('tickets.evidence.update')) return { kind: 'ticket-evidence-update', entityType: 'ticket', entityId: ticketId, recordId: first(payload, ['evidenciaId', 'EvidenciaID']), description: 'Editar evidencia de boleta' };
  if (route.includes('boletas.evidence.delete') || route.includes('tickets.evidence.delete')) return { kind: 'ticket-evidence-delete', entityType: 'ticket', entityId: ticketId, recordId: first(payload, ['evidenciaId', 'EvidenciaID']), description: 'Eliminar evidencia de boleta' };
  if (route.includes('boletas.finalize') || route.includes('tickets.finalize')) return { kind: 'ticket-finalize', entityType: 'ticket', entityId: ticketId, recordId: ticketId, requiresSync: true, description: 'Finalizar y enviar boleta' };
  if (route.includes('boletas.testfinalize') || route.includes('tickets.testfinalize')) return { kind: 'ticket-test', entityType: 'ticket', entityId: ticketId, recordId: ticketId, requiresSync: true, description: 'Generar prueba de boleta' };
  if (route.includes('boletas.generatepdf') || route.includes('tickets.generatepdf')) return { kind: 'ticket-pdf', entityType: 'ticket', entityId: ticketId, recordId: ticketId, requiresSync: true, description: 'Generar PDF' };
  if (route.includes('boletas.update') || route.includes('tickets.update')) return { kind: 'ticket-update', entityType: 'ticket', entityId: ticketId, recordId: ticketId, description: 'Actualizar boleta' };

  if (route.includes('maintenance.devices.create') || route.includes('mantenimientos.dispositivos.create')) return { kind: 'maintenance-device-create', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['deviceId', 'EvidenciaMantenimientoID']), description: 'Agregar dispositivo al mantenimiento' };
  if (route.includes('maintenance.devices.autosave') || route.includes('mantenimientos.dispositivos.autosave')) return { kind: 'maintenance-device-autosave', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['deviceId', 'EvidenciaMantenimientoID']), description: 'Autoguardar dispositivo' };
  if (route.includes('maintenance.devices.update') || route.includes('mantenimientos.dispositivos.update')) return { kind: 'maintenance-device-update', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['deviceId', 'EvidenciaMantenimientoID']), description: 'Actualizar dispositivo' };
  if (route.includes('maintenance.devices.delete') || route.includes('mantenimientos.dispositivos.delete')) return { kind: 'maintenance-device-delete', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['deviceId', 'EvidenciaMantenimientoID']), description: 'Eliminar dispositivo' };
  if (route.includes('maintenance.images.upload') || route.includes('mantenimientos.imagenes.upload')) return { kind: 'maintenance-image-create', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['imageId', 'FotoDispositivoID']), description: 'Subir evidencia de mantenimiento' };
  if (route.includes('maintenance.images.update') || route.includes('mantenimientos.imagenes.update')) return { kind: 'maintenance-image-update', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['imageId', 'FotoDispositivoID']), description: 'Editar evidencia de mantenimiento' };
  if (route.includes('maintenance.images.delete') || route.includes('mantenimientos.imagenes.delete')) return { kind: 'maintenance-image-delete', entityType: 'maintenance', entityId: maintenanceId, recordId: first(payload, ['imageId', 'FotoDispositivoID']), description: 'Eliminar evidencia de mantenimiento' };
  if (route.includes('maintenance.finalize') || route.includes('mantenimientos.finalize')) return { kind: 'maintenance-finalize', entityType: 'maintenance', entityId: maintenanceId, recordId: maintenanceId, requiresSync: true, description: 'Finalizar mantenimiento' };
  if (route.includes('maintenance.update') || route.includes('mantenimientos.update')) return { kind: 'maintenance-update', entityType: 'maintenance', entityId: maintenanceId, recordId: maintenanceId, description: 'Actualizar mantenimiento' };
  if (route.includes('maintenance.create') || route.includes('mantenimientos.create')) return { kind: 'maintenance-create', entityType: 'maintenance', entityId: maintenanceId, recordId: maintenanceId, description: 'Crear mantenimiento' };

  return null;
}

function dedupeKey(descriptor) {
  if (!descriptor) return '';
  if (descriptor.kind.includes('evidence-create') || descriptor.kind.includes('image-create')) return `${descriptor.kind}:${descriptor.recordId}`;
  return `${descriptor.kind}:${descriptor.recordId || descriptor.entityId}`;
}

function syntheticResponse(descriptor, payload, operation) {
  if (descriptor.kind.startsWith('ticket-')) {
    if (['ticket-create', 'ticket-update', 'ticket-autosave'].includes(descriptor.kind)) {
      return { boleta: localTicketRecord(payload), offlineQueued: true, operationId: operation.id };
    }
    if (descriptor.kind === 'ticket-evidence-create') {
      return { EvidenciaID: descriptor.recordId, BoletaUID: descriptor.entityId, Nombre: payload.nombre || payload.fileName, Nota: payload.nota || '', OfflinePendiente: true };
    }
    return { ok: true, boletaUid: descriptor.entityId, offlineQueued: true, operationId: operation.id };
  }

  if (['maintenance-create', 'maintenance-update'].includes(descriptor.kind)) {
    return { mantenimiento: localMaintenanceRecord(payload), dispositivos: [], offlineQueued: true, operationId: operation.id };
  }
  if (descriptor.kind.startsWith('maintenance-device')) {
    return { ...localDevice(payload), offlineQueued: true, operationId: operation.id };
  }
  if (descriptor.kind === 'maintenance-image-create') {
    return { FotoDispositivoID: descriptor.recordId, DispositivoMantenimientoRef: first(payload, ['deviceId', 'DispositivoMantenimientoRef']), PreviewURL: dataUrl(payload, 'image/jpeg'), OfflinePendiente: true };
  }
  return { ok: true, maintenanceId: descriptor.entityId, offlineQueued: true, operationId: operation.id };
}

export async function queueOfflineRequest(routes, originalPayload, sessionToken) {
  const payload = originalPayload || {};
  const descriptor = describeOfflineWrite(routes, payload);
  if (!descriptor) return null;

  if (descriptor.kind === 'ticket-create') ensureId(payload, ['boletaUid', 'BoletaUID'], 'boleta');
  if (descriptor.kind === 'ticket-evidence-create') ensureId(payload, ['evidenciaId', 'EvidenciaID'], 'evidencia');
  if (descriptor.kind === 'maintenance-create') ensureId(payload, ['maintenanceId', 'MantenimientoID'], 'mantenimiento');
  if (descriptor.kind === 'maintenance-device-create') ensureId(payload, ['deviceId', 'EvidenciaMantenimientoID'], 'dispositivo');
  if (descriptor.kind === 'maintenance-image-create') ensureId(payload, ['imageId', 'FotoDispositivoID'], 'imagen');

  const resolved = describeOfflineWrite(routes, payload);
  if (resolved.requiresSync) {
    throw new Error('Esta acción estará disponible cuando todos los cambios se hayan sincronizado correctamente.');
  }

  const operation = await enqueueOperation({
    routes,
    payload,
    entityId: resolved.entityId,
    entityType: resolved.entityType,
    description: resolved.description,
    dedupeKey: dedupeKey(resolved),
  });

  if (resolved.entityType === 'ticket') await cacheTicketWrite(resolved.kind, payload, sessionToken);
  if (resolved.entityType === 'maintenance') await cacheMaintenanceWrite(resolved.kind, payload, sessionToken);
  return syntheticResponse(resolved, payload, operation);
}

export async function readOfflineEntityDetail(routes, payload, sessionToken) {
  const route = routeText(routes);
  if (route.includes('boletas.get') || route.includes('tickets.get')) {
    const uid = first(payload, ['boletaUid', 'BoletaUID', 'id']);
    return readCachedResponse(ticketDetailKey(uid, sessionToken));
  }
  if (route.includes('maintenance.get') || route.includes('mantenimientos.get')) {
    const id = first(payload, ['maintenanceId', 'MantenimientoID', 'id']);
    return readCachedResponse(maintenanceDetailKey(id, sessionToken));
  }
  return null;
}

export async function cacheOfflineServerDetail(routes, payload, sessionToken, result) {
  const route = routeText(routes);
  if (route.includes('boletas.get') || route.includes('tickets.get')) {
    const uid = first(payload, ['boletaUid', 'BoletaUID', 'id']);
    await cacheResponse(ticketDetailKey(uid, sessionToken), result);
  }
  if (route.includes('maintenance.get') || route.includes('mantenimientos.get')) {
    const id = first(payload, ['maintenanceId', 'MantenimientoID', 'id']);
    await cacheResponse(maintenanceDetailKey(id, sessionToken), result);
  }
}
