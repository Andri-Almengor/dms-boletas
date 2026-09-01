import { readTables } from '../infra/sheets.repository.js';
import { sectionForRoute, flushActivityQueue, activityQueueSnapshot } from '../services/activity-log.service.js';
import { ensureActivitySchema } from '../services/activity-schema.service.js';

const TIME_ZONE = 'America/Costa_Rica';

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

function normalizedActivity(row = {}) {
  const when = localDateTime(row.FechaInicio || row.FechaFin);
  return {
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
}

function auditSection(row = {}) {
  return sectionForRoute(`${row.Accion || ''} ${row.Entidad || ''}`);
}

function normalizedAudit(row = {}) {
  const when = localDateTime(row.Fecha);
  return {
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
    if (!current.actions.includes(row.action)) current.actions.push(row.action);
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
  const totalActiveSeconds = exactPageTimeRows.reduce((sum, row) => sum + row.durationSeconds, 0);
  const actionRows = timeline.filter((row) => row.type !== 'PAGE_TIME' && row.type !== 'PAGE_VIEW');

  return {
    generatedAt: new Date().toISOString(),
    timezone: TIME_ZONE,
    filters,
    selectedUsers,
    summary: {
      users: selectedUsers.length,
      activityRows: timeline.length,
      actions: actionRows.length,
      highPriorityActions: actionRows.filter((row) => row.priority === 'ALTA').length,
      pageTimeSeconds: Math.round(totalActiveSeconds),
      agendaItems: agenda.length,
      ticketsTouched: new Set(actionRows.filter((row) => row.entity === 'Boleta').map((row) => row.entityId).filter(Boolean)).size,
      maintenancesTouched: new Set(actionRows.filter((row) => row.entity === 'Mantenimiento').map((row) => row.entityId).filter(Boolean)).size,
      devicesTouched: new Set(actionRows.filter((row) => row.entity === 'DispositivoMantenimiento').map((row) => row.entityId).filter(Boolean)).size,
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
      note: telemetryDates.length
        ? 'El tiempo exacto por pestaña se calcula con telemetría activa desde la primera fecha indicada. La auditoría anterior aporta acciones históricas, pero no puede reconstruir tiempo de permanencia retroactivamente.'
        : 'Todavía no existe telemetría de navegación. Las acciones históricas se obtienen de Auditoria, pero el tiempo por pestaña comenzará a medirse desde el despliegue de esta versión.',
    },
    queue: activityQueueSnapshot(),
  };
}
