import { readTables } from '../infra/sheets.repository.js';
import { sectionForRoute, flushActivityQueue, activityQueueSnapshot } from '../services/activity-log.service.js';
import { ensureActivitySchema } from '../services/activity-schema.service.js';

const TIME_ZONE = 'America/Costa_Rica';
const SECTION_LABELS = Object.freeze({
  INICIO: 'Inicio',
  AGENDA: 'Agenda',
  BOLETAS: 'Boletas',
  MANTENIMIENTOS: 'Mantenimientos',
  DISPOSITIVOS: 'Dispositivos de mantenimiento',
  CASOS: 'Casos de clientes',
  CLIENTES: 'Clientes',
  CREDENCIALES: 'Credenciales',
  CATALOGOS: 'Catálogos',
  USUARIOS: 'Usuarios',
  CONOCIMIENTO: 'Base de conocimientos',
  ASISTENTE: 'Asistente',
  METRICAS: 'Métricas y reportes',
  ENCUESTAS: 'Encuestas',
  INTEGRACIONES: 'Integraciones',
  ADMINISTRACION: 'Administración',
  OTROS: 'Otra sección',
});

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return String(value); }
}

function localDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '', label: clean(value) };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, item) => {
    acc[item.type] = item.value;
    return acc;
  }, {});
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const timeKey = `${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    date: dateKey,
    time: timeKey,
    label: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function eventInRange(timestamp, filters) {
  const local = localDateTime(timestamp);
  if (!local.date) return false;
  if (filters.dateFrom && local.date < filters.dateFrom) return false;
  if (filters.dateTo && local.date > filters.dateTo) return false;
  const time = local.time.slice(0, 5);
  if (filters.timeFrom && time < filters.timeFrom) return false;
  if (filters.timeTo && time > filters.timeTo) return false;
  return true;
}

function agendaInRange(agenda, filters) {
  const date = clean(agenda.Fecha).slice(0, 10);
  const start = clean(agenda.HoraInicio, '00:00').slice(0, 5);
  const end = clean(agenda.HoraFin, start).slice(0, 5);
  if (!date) return false;
  if (filters.dateFrom && date < filters.dateFrom) return false;
  if (filters.dateTo && date > filters.dateTo) return false;
  if (filters.timeFrom && end < filters.timeFrom) return false;
  if (filters.timeTo && start > filters.timeTo) return false;
  return true;
}

function normalizeFilters(input = {}) {
  const userIds = [...new Set(asArray(input.userIds || input.usuarioIds || input.UsuarioIDs).map(clean).filter(Boolean))];
  const sections = [...new Set(asArray(input.sections || input.secciones || input.section || input.seccion)
    .map((value) => clean(value).toUpperCase())
    .filter((value) => value && value !== 'TODAS' && value !== 'ALL'))];
  const contentTypes = [...new Set(asArray(input.contentTypes || input.contenidos || input.include)
    .map((value) => clean(value).toUpperCase())
    .filter(Boolean))];
  return {
    userIds,
    sections,
    contentTypes: contentTypes.length ? contentTypes : ['ACTIVITY', 'AGENDA'],
    dateFrom: clean(input.dateFrom || input.fechaDesde).slice(0, 10),
    dateTo: clean(input.dateTo || input.fechaHasta).slice(0, 10),
    timeFrom: clean(input.timeFrom || input.horaDesde).slice(0, 5),
    timeTo: clean(input.timeTo || input.horaHasta).slice(0, 5),
    includeReads: input.includeReads !== false,
    includeHistoricalAudit: input.includeHistoricalAudit !== false,
  };
}

function activeAssignment(row = {}) {
  const active = clean(row.Activo, 'true').toLowerCase();
  return !['false', '0', 'no', 'inactivo'].includes(active) && !clean(row.FechaDesasignacion);
}

function userName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo, 'Usuario');
}

function sectionMatches(section, filters) {
  return !filters.sections.length || filters.sections.includes(clean(section, 'OTROS').toUpperCase());
}

function userMatches(userId, filters) {
  return !filters.userIds.length || filters.userIds.includes(clean(userId));
}

function sectionLabel(section) {
  const key = clean(section, 'OTROS').toUpperCase();
  return SECTION_LABELS[key] || key;
}

function durationLabel(value) {
  let seconds = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  const parts = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds || !parts.length) parts.push(`${seconds} s`);
  return parts.join(' ');
}

function detailObjects(detail) {
  if (!detail || typeof detail !== 'object') return [];
  return [
    detail.solicitud,
    detail.request,
    detail.respuesta,
    detail.response,
    detail.despues,
    detail.after,
    detail.antes,
    detail.before,
    detail,
  ].filter((value) => value && typeof value === 'object');
}

function detailValue(detail, keys = []) {
  for (const object of detailObjects(detail)) {
    for (const key of keys) {
      const value = object?.[key];
      if (value !== undefined && value !== null && clean(value)) return clean(value);
    }
  }
  return '';
}

function friendlyId(value) {
  const text = clean(value);
  if (!text) return '';
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text) || text.length > 70) return '';
  return text;
}

function idSuffix(row) {
  const id = friendlyId(row.entityId);
  return id ? ` ${id}` : '';
}

function uiRouteDescription(row = {}) {
  const route = clean(row.uiRoute).split('?')[0];
  const lower = route.toLowerCase();
  const section = sectionLabel(row.section);
  const detailMatch = (pattern) => {
    const match = route.match(pattern);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  };

  if (!route || route === '/') return 'Entró a Inicio.';
  if (/^\/boletas\/(nueva|nuevo)\/?$/i.test(route)) return 'Entró al formulario para crear una boleta.';
  if (/^\/mantenimientos\/(nuevo|nueva)\/?$/i.test(route)) return 'Entró al formulario para crear un mantenimiento.';
  if (/^\/boletas\/[^/]+\/editar\/?$/i.test(route)) return 'Entró a editar una boleta.';
  if (/^\/mantenimientos\/[^/]+\/editar\/?$/i.test(route)) return 'Entró a editar un mantenimiento.';
  const ticketId = detailMatch(/^\/boletas\/([^/]+)\/?$/i);
  if (ticketId) return `Abrió el detalle de la boleta ${ticketId}.`;
  const maintenanceId = detailMatch(/^\/mantenimientos\/([^/]+)\/?$/i);
  if (maintenanceId) return `Abrió el detalle del mantenimiento ${maintenanceId}.`;
  const clientId = detailMatch(/^\/clientes\/([^/]+)\/?$/i);
  if (clientId) return `Abrió el detalle del cliente ${clientId}.`;
  if (lower.includes('/agenda')) return 'Entró a Agenda.';
  if (lower.includes('/boletas')) return 'Entró a Boletas.';
  if (lower.includes('/mantenimientos')) return 'Entró a Mantenimientos.';
  if (lower.includes('/casos')) return 'Entró a Casos de clientes.';
  if (lower.includes('/clientes')) return 'Entró a Clientes.';
  if (lower.includes('/credenciales')) return 'Entró a Credenciales.';
  if (lower.includes('/usuarios')) return 'Entró a Usuarios.';
  if (lower.includes('/conocimiento')) return 'Entró a Base de conocimientos.';
  if (lower.includes('/asistente')) return 'Entró al Asistente.';
  if (lower.includes('/metricas') || lower.includes('/dashboard')) return 'Entró a Métricas y reportes.';
  if (lower.includes('/encuestas')) return 'Entró a Encuestas.';
  if (lower.includes('/integraciones')) return 'Entró a Integraciones.';
  return `Entró a ${section}.`;
}

function apiActivityDescription(row = {}) {
  const route = clean(row.actionRoute).toLowerCase();
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};
  const suffix = idSuffix(row);
  const name = detailValue(detail, ['titulo', 'Titulo', 'nombre', 'Nombre', 'detalle', 'Detalle']);
  const named = name ? ` “${name.slice(0, 120)}”` : '';

  if (/boletas\.(evidence|evidencia)\.upload|tickets\.(evidence|evidencia)\.upload/.test(route)) return `Agregó una evidencia a la boleta${suffix}.`;
  if (/boletas\.(evidence|evidencia)\.update|tickets\.(evidence|evidencia)\.update/.test(route)) return `Editó una evidencia de la boleta${suffix}.`;
  if (/boletas\.(evidence|evidencia)\.delete|tickets\.(evidence|evidencia)\.delete/.test(route)) return `Eliminó una evidencia de la boleta${suffix}.`;
  if (/boletas\.signature\.upload|tickets\.signature\.upload/.test(route)) return `Agregó o actualizó la firma de la boleta${suffix}.`;
  if (/boletas\.(create)|tickets\.(create)/.test(route)) return `Creó la boleta${suffix}${named}.`;
  if (/boletas\.(autosave)/.test(route)) return `Autoguardó cambios de la boleta${suffix}.`;
  if (/boletas\.(update)|tickets\.(update)/.test(route)) return `Actualizó la boleta${suffix}${named}.`;
  if (/boletas\.(finalize)|tickets\.(finalize)/.test(route)) return `Finalizó la boleta${suffix}.`;
  if (/boletas\.(annul)|tickets\.(annul)/.test(route)) return `Anuló la boleta${suffix}.`;
  if (/boletas\.(generatepdf)|tickets\.(generatepdf)/.test(route)) return `Generó el PDF de la boleta${suffix}.`;

  if (/maintenance\.images\.upload|mantenimientos\.imagenes\.upload/.test(route)) return `Agregó una evidencia a un dispositivo del mantenimiento${suffix}.`;
  if (/maintenance\.images\.update|mantenimientos\.imagenes\.update/.test(route)) return `Editó una evidencia de un dispositivo del mantenimiento${suffix}.`;
  if (/maintenance\.images\.delete|mantenimientos\.imagenes\.delete/.test(route)) return `Eliminó una evidencia de un dispositivo del mantenimiento${suffix}.`;
  if (/maintenance\.devices\.create|mantenimientos\.dispositivos\.create/.test(route)) return `Agregó un dispositivo al mantenimiento${suffix}${named}.`;
  if (/maintenance\.devices\.(update|autosave)|mantenimientos\.dispositivos\.(update|autosave)/.test(route)) return `Actualizó un dispositivo del mantenimiento${suffix}${named}.`;
  if (/maintenance\.devices\.delete|mantenimientos\.dispositivos\.delete/.test(route)) return `Eliminó un dispositivo del mantenimiento${suffix}.`;
  if (/maintenance\.(create)|mantenimientos\.(create)/.test(route)) return `Creó el mantenimiento${suffix}${named}.`;
  if (/maintenance\.(update)|mantenimientos\.(update)/.test(route)) return `Actualizó el mantenimiento${suffix}${named}.`;
  if (/maintenance\.(finalize)|mantenimientos\.(finalize)/.test(route)) return `Finalizó el mantenimiento${suffix}.`;
  if (/maintenance\.(reopen)|mantenimientos\.(reopen)/.test(route)) return `Reabrió el mantenimiento${suffix}.`;
  if (/maintenance\.(delete)|mantenimientos\.(delete)/.test(route)) return `Eliminó el mantenimiento${suffix}.`;
  if (/maintenance\.report\.|mantenimientos\.reporte\./.test(route)) return `Generó un reporte del mantenimiento${suffix}.`;

  if (/clients\.operational\.locations\.create|clientlocations\..*create|clientes\.ubicaciones\..*create|ubicacionescliente\..*create/.test(route)) return `Agregó una ubicación de cliente${named}.`;
  if (/equipmentlocations\..*create|clients\.operational\.equipmentlocations\.create|ubicacionesequipo\..*create/.test(route)) return `Agregó una ubicación de equipo${named}.`;
  if (/contacts\..*create|contactoscliente\..*create/.test(route)) return `Agregó un contacto o supervisor${named}.`;

  if (/agenda.*create|agenda.*crear/.test(route)) return `Creó o agregó información en Agenda${named}.`;
  if (/agenda.*update|agenda.*editar/.test(route)) return `Actualizó información de Agenda${suffix}${named}.`;
  if (/agenda.*delete|agenda.*eliminar/.test(route)) return `Eliminó un registro de Agenda${suffix}.`;

  const entity = clean(row.entity, sectionLabel(row.section));
  const action = clean(row.action, 'Actividad').toUpperCase();
  if (action === 'LISTAR') return `Consultó la lista de ${sectionLabel(row.section)}.`;
  if (action === 'CONSULTAR') return `Consultó ${entity}${suffix}.`;
  if (action === 'CREAR') return `Creó ${entity}${suffix}${named}.`;
  if (action === 'EDITAR' || action === 'AUTOGUARDAR' || action === 'GUARDAR') return `Actualizó ${entity}${suffix}${named}.`;
  if (action === 'ELIMINAR') return `Eliminó ${entity}${suffix}.`;
  if (action === 'FINALIZAR') return `Finalizó ${entity}${suffix}.`;
  if (action === 'REABRIR') return `Reabrió ${entity}${suffix}.`;
  if (action === 'REENVIAR') return `Reenvió información relacionada con ${entity}${suffix}.`;
  if (action === 'GENERAR' || action === 'GENERAR REPORTE') return `Generó información relacionada con ${entity}${suffix}.`;
  if (action === 'AGREGAR ARCHIVO') return `Agregó un archivo o evidencia en ${sectionLabel(row.section)}${suffix}.`;
  return `Realizó “${clean(row.action, 'actividad')}” en ${sectionLabel(row.section)}${suffix}.`;
}

function describeActivity(row = {}) {
  const type = clean(row.type).toUpperCase();
  if (type === 'PAGE_VIEW') return uiRouteDescription(row);
  if (type === 'UI_TAB') {
    return row.view
      ? `Cambió a la pestaña “${row.view}” en ${sectionLabel(row.section)}.`
      : `Cambió de pestaña en ${sectionLabel(row.section)}.`;
  }
  if (type === 'PAGE_TIME') {
    const place = row.view ? `${sectionLabel(row.section)} · ${row.view}` : sectionLabel(row.section);
    return `Permaneció ${durationLabel(row.durationSeconds)} en ${place}.`;
  }
  if (type === 'AUDIT_ACTION') {
    const suffix = idSuffix(row);
    return `Registro histórico: ${clean(row.action, 'actividad')} en ${clean(row.entity, sectionLabel(row.section))}${suffix}.`;
  }
  return apiActivityDescription(row);
}

function normalizedActivity(row = {}) {
  const when = localDateTime(row.FechaInicio || row.FechaFin);
  const normalized = {
    source: clean(row.Fuente, 'ACTIVIDAD_APP'),
    activityId: clean(row.ActividadID),
    userId: clean(row.UsuarioID),
    userName: clean(row.UsuarioNombre, 'Usuario'),
    type: clean(row.TipoEvento, 'ACTIVIDAD'),
    section: clean(row.Seccion, 'OTROS').toUpperCase(),
    view: clean(row.Vista),
    uiRoute: clean(row.RutaUI),
    actionRoute: clean(row.RutaAccion),
    action: clean(row.Accion, 'Actividad'),
    entity: clean(row.Entidad),
    entityId: clean(row.EntidadID),
    result: clean(row.Resultado, 'OK'),
    priority: clean(row.Prioridad, 'NORMAL'),
    detail: parseJson(row.DetalleJSON),
    startedAt: clean(row.FechaInicio),
    endedAt: clean(row.FechaFin),
    durationSeconds: Math.max(0, Number(row.DuracionSegundos || 0)),
    date: when.date,
    time: when.time,
    dateTimeLabel: when.label,
    ip: clean(row.IP),
    userAgent: clean(row.UserAgent),
  };
  normalized.activityText = describeActivity(normalized);
  return normalized;
}

function auditSection(row = {}) {
  return sectionForRoute(`${row.Accion || ''} ${row.Entidad || ''}`);
}

function normalizedAudit(row = {}) {
  const when = localDateTime(row.Fecha);
  const normalized = {
    source: 'AUDITORIA_HISTORICA',
    activityId: clean(row.AuditoriaID),
    userId: clean(row.UsuarioID),
    userName: clean(row.UsuarioNombre, 'Usuario'),
    type: 'AUDIT_ACTION',
    section: auditSection(row),
    view: '',
    uiRoute: '',
    actionRoute: '',
    action: clean(row.Accion, 'Actividad auditada'),
    entity: clean(row.Entidad),
    entityId: clean(row.EntidadID),
    result: 'OK',
    priority: /(BOLETA|MANTENIMIENTO|DISPOSITIVO|EVIDENCIA)/i.test(`${row.Accion} ${row.Entidad}`) ? 'ALTA' : 'MEDIA',
    detail: {
      antes: parseJson(row.DatosAntesJSON),
      despues: parseJson(row.DatosDespuesJSON),
    },
    startedAt: clean(row.Fecha),
    endedAt: clean(row.Fecha),
    durationSeconds: 0,
    date: when.date,
    time: when.time,
    dateTimeLabel: when.label,
    ip: clean(row.IP),
    userAgent: clean(row.UserAgent),
  };
  normalized.activityText = describeActivity(normalized);
  return normalized;
}

function nearDuplicate(audit, activityRows) {
  const auditMs = new Date(audit.startedAt).getTime();
  if (!Number.isFinite(auditMs)) return false;
  return activityRows.some((item) => {
    if (item.userId !== audit.userId) return false;
    if (audit.entity && item.entity && clean(item.entity).toLowerCase() !== clean(audit.entity).toLowerCase()) return false;
    if (audit.entityId && item.entityId && item.entityId !== audit.entityId) return false;
    const activityMs = new Date(item.startedAt).getTime();
    return Number.isFinite(activityMs) && Math.abs(activityMs - auditMs) <= 5_000;
  });
}

function pageSummary(activityRows) {
  const groups = new Map();
  activityRows.filter((row) => row.type === 'PAGE_TIME' && row.durationSeconds > 0).forEach((row) => {
    const key = [row.userId, row.section, row.uiRoute, row.view].join('|');
    const current = groups.get(key) || {
      userId: row.userId,
      userName: row.userName,
      section: row.section,
      route: row.uiRoute,
      view: row.view,
      durationSeconds: 0,
      visits: 0,
    };
    current.durationSeconds += row.durationSeconds;
    current.visits += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.durationSeconds - a.durationSeconds);
}

function sectionSummary(activityRows) {
  const groups = new Map();
  activityRows.forEach((row) => {
    const key = `${row.userId}|${row.section}`;
    const current = groups.get(key) || {
      userId: row.userId,
      userName: row.userName,
      section: row.section,
      actions: 0,
      durationSeconds: 0,
      highPriorityActions: 0,
    };
    if (row.type !== 'PAGE_TIME') current.actions += 1;
    current.durationSeconds += row.type === 'PAGE_TIME' ? row.durationSeconds : 0;
    if (row.priority === 'ALTA') current.highPriorityActions += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.durationSeconds - a.durationSeconds || b.actions - a.actions);
}

function entitySummary(activityRows) {
  const groups = new Map();
  activityRows.filter((row) => row.entity && row.entity !== 'Interfaz').forEach((row) => {
    const key = `${row.userId}|${row.entity}|${row.entityId || ''}`;
    const current = groups.get(key) || {
      userId: row.userId,
      userName: row.userName,
      entity: row.entity,
      entityId: row.entityId,
      section: row.section,
      actions: [],
      firstAt: row.startedAt,
      lastAt: row.startedAt,
    };
    const action = clean(row.activityText, row.action);
    if (!current.actions.includes(action)) current.actions.push(action);
    if (row.startedAt < current.firstAt) current.firstAt = row.startedAt;
    if (row.startedAt > current.lastAt) current.lastAt = row.startedAt;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function buildAgendaRows(agendas, assignments, usersById, filters) {
  const assignmentsByAgenda = new Map();
  assignments.filter(activeAssignment).forEach((row) => {
    const agendaId = clean(row.AgendaID);
    if (!assignmentsByAgenda.has(agendaId)) assignmentsByAgenda.set(agendaId, []);
    assignmentsByAgenda.get(agendaId).push(clean(row.UsuarioID));
  });

  return agendas.filter((agenda) => agendaInRange(agenda, filters)).map((agenda) => {
    const assignedIds = assignmentsByAgenda.get(clean(agenda.AgendaID)) || [];
    const selectedIds = filters.userIds.length ? assignedIds.filter((id) => filters.userIds.includes(id)) : assignedIds;
    if (filters.userIds.length && !selectedIds.length) return null;
    return {
      agendaId: clean(agenda.AgendaID),
      date: clean(agenda.Fecha).slice(0, 10),
      startTime: clean(agenda.HoraInicio),
      endTime: clean(agenda.HoraFin),
      detail: clean(agenda.Detalle),
      status: clean(agenda.Estado),
      requiresTicket: String(agenda.RequiereBoleta ?? '').toLowerCase() !== 'false',
      ticketUid: clean(agenda.BoletaUID),
      assigned: assignedIds.map((id) => ({
        userId: id,
        userName: userName(usersById.get(id) || { UsuarioID: id }),
        email: clean(usersById.get(id)?.Correo),
        selected: !filters.userIds.length || filters.userIds.includes(id),
      })),
    };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export async function buildActivityReport(input = {}) {
  const filters = normalizeFilters(input);
  await ensureActivitySchema();
  await flushActivityQueue();
  const tables = await readTables(['ActividadApp', 'Auditoria', 'Agendas', 'AgendaAsignados', 'Usuarios'], { force: true });
  const users = tables.Usuarios || [];
  const usersById = new Map(users.map((user) => [clean(user.UsuarioID), user]));

  const selectedUsers = (filters.userIds.length
    ? users.filter((user) => filters.userIds.includes(clean(user.UsuarioID)))
    : users.filter((user) => clean(user.Estado).toUpperCase() === 'ACTIVO'))
    .map((user) => ({ userId: clean(user.UsuarioID), name: userName(user), email: clean(user.Correo) }));

  let activity = (tables.ActividadApp || [])
    .map(normalizedActivity)
    .filter((row) => userMatches(row.userId, filters))
    .filter((row) => sectionMatches(row.section, filters))
    .filter((row) => eventInRange(row.startedAt, filters));

  if (!filters.includeReads) {
    activity = activity.filter((row) => !['CONSULTAR', 'LISTAR'].includes(row.action));
  }

  const historicalAudit = filters.includeHistoricalAudit
    ? (tables.Auditoria || [])
      .map(normalizedAudit)
      .filter((row) => userMatches(row.userId, filters))
      .filter((row) => sectionMatches(row.section, filters))
      .filter((row) => eventInRange(row.startedAt, filters))
      .filter((row) => !nearDuplicate(row, activity))
    : [];

  const timeline = filters.contentTypes.includes('ACTIVITY')
    ? [...activity, ...historicalAudit].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    : [];

  const agenda = filters.contentTypes.includes('AGENDA')
    ? buildAgendaRows(tables.Agendas || [], tables.AgendaAsignados || [], usersById, filters)
    : [];

  const exactPageTimeRows = activity.filter((row) => row.type === 'PAGE_TIME');
  const telemetryDates = (tables.ActividadApp || []).map((row) => clean(row.FechaInicio)).filter(Boolean).sort();
  const totalVisibleSeconds = exactPageTimeRows.reduce((sum, row) => sum + row.durationSeconds, 0);
  const actionRows = timeline.filter((row) => row.type !== 'PAGE_TIME');
  const operationalRows = actionRows.filter((row) => !['PAGE_VIEW', 'UI_TAB'].includes(row.type));

  return {
    generatedAt: new Date().toISOString(),
    timezone: TIME_ZONE,
    filters,
    selectedUsers,
    summary: {
      users: selectedUsers.length,
      activityRows: timeline.length,
      actions: actionRows.length,
      operationalActions: operationalRows.length,
      navigationEvents: actionRows.filter((row) => ['PAGE_VIEW', 'UI_TAB'].includes(row.type)).length,
      highPriorityActions: operationalRows.filter((row) => row.priority === 'ALTA').length,
      pageTimeSeconds: Math.round(totalVisibleSeconds),
      agendaItems: agenda.length,
      ticketsTouched: new Set(operationalRows.filter((row) => row.entity === 'Boleta').map((row) => row.entityId).filter(Boolean)).size,
      maintenancesTouched: new Set(operationalRows.filter((row) => row.entity === 'Mantenimiento').map((row) => row.entityId).filter(Boolean)).size,
      devicesTouched: new Set(operationalRows.filter((row) => row.entity === 'DispositivoMantenimiento').map((row) => row.entityId).filter(Boolean)).size,
    },
    pageSummary: pageSummary(activity),
    sectionSummary: sectionSummary(activity),
    entitySummary: entitySummary(timeline),
    timeline,
    agenda,
    coverage: {
      telemetryStartedAt: telemetryDates[0] || '',
      telemetryLatestAt: telemetryDates[telemetryDates.length - 1] || '',
      historicalAuditRows: historicalAudit.length,
      exactPageTimeAvailable: Boolean(telemetryDates.length),
      measurement: 'VISIBLE_APP_TIME',
      note: telemetryDates.length
        ? 'El tiempo se mide mientras la aplicación permanece visible en el dispositivo, aunque la persona no esté haciendo clic o escribiendo constantemente. Se detiene cuando la pestaña del navegador queda oculta. La auditoría anterior aporta acciones históricas, pero no puede reconstruir tiempo de permanencia retroactivamente.'
        : 'Todavía no existe telemetría de navegación. Las acciones históricas se obtienen de Auditoria, pero el tiempo visible comenzará a medirse desde el despliegue de esta versión.',
    },
    queue: activityQueueSnapshot(),
  };
}
