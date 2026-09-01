import { env } from '../config/env.js';
import { appendRows } from '../infra/sheets.repository.js';
import { authenticate } from './auth.service.js';
import { ensureActivitySchema } from './activity-schema.service.js';
import { nowIso, uuid } from '../core/utils.js';

const queue = [];
let flushPromise = null;
let droppedRows = 0;
let flushedRows = 0;
let failedFlushes = 0;

const SENSITIVE_KEY = /(password|contrasena|contraseña|secret|token|authorization|cookie|salt|hash|base64|dataurl|archivo|blob|privatekey)/i;
const LONG_BINARY = /^[A-Za-z0-9+/]{500,}={0,2}$/;

export const ACTIVITY_SECTIONS = Object.freeze([
  'INICIO',
  'AGENDA',
  'BOLETAS',
  'MANTENIMIENTOS',
  'DISPOSITIVOS',
  'CASOS',
  'CLIENTES',
  'CREDENCIALES',
  'CATALOGOS',
  'USUARIOS',
  'CONOCIMIENTO',
  'ASISTENTE',
  'METRICAS',
  'ENCUESTAS',
  'INTEGRACIONES',
  'ADMINISTRACION',
  'OTROS',
]);

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clampText(value, max = 500) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeValue(value, depth = 0) {
  if (value == null) return value;
  if (depth > 5) return '[profundidad limitada]';
  if (typeof value === 'string') {
    if (LONG_BINARY.test(value)) return '[contenido binario omitido]';
    return clampText(value, 700);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, depth + 1));
  if (typeof value !== 'object') return clampText(value, 300);

  const result = {};
  Object.entries(value).slice(0, 80).forEach(([key, current]) => {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = '[dato sensible omitido]';
      return;
    }
    result[key] = safeValue(current, depth + 1);
  });
  return result;
}

function safeJson(value) {
  if (value == null) return '';
  let serialized = '';
  try {
    serialized = JSON.stringify(safeValue(value));
  } catch {
    serialized = JSON.stringify({ detalle: '[no serializable]' });
  }
  return serialized.length > 18_000 ? `${serialized.slice(0, 18_000)}…` : serialized;
}

export function sectionForRoute(value = '') {
  const route = clean(value).toLowerCase();
  if (!route || route === '/') return 'INICIO';
  if (route.includes('agenda')) return 'AGENDA';
  if (/(maintenance\.devices|mantenimientos\.dispositivos|maintenance\.images|mantenimientos\.imagenes)/.test(route)) return 'DISPOSITIVOS';
  if (route.includes('maintenance') || route.includes('mantenimientos')) return 'MANTENIMIENTOS';
  if (route.includes('boletas') || route.includes('tickets') || route.includes('/boletas')) return 'BOLETAS';
  if (route.includes('customercase') || route.includes('casos')) return 'CASOS';
  if (route.includes('credential') || route.includes('credenciales') || route.includes('password-vault')) return 'CREDENCIALES';
  if (route.includes('client') || route.includes('clientes') || route.includes('ubicacion') || route.includes('contact')) return 'CLIENTES';
  if (route.includes('catalog') || route.includes('categor') || route.includes('fabricant') || route.includes('model') || route.includes('tipos')) return 'CATALOGOS';
  if (route.includes('users') || route.includes('usuarios') || route.includes('roles')) return 'USUARIOS';
  if (route.includes('knowledge') || route.includes('conocimiento') || route.includes('tutorial')) return 'CONOCIMIENTO';
  if (route.includes('assistant') || route.includes('asistente')) return 'ASISTENTE';
  if (route.includes('metrics') || route.includes('metricas') || route.includes('dashboard')) return 'METRICAS';
  if (route.includes('survey') || route.includes('encuesta')) return 'ENCUESTAS';
  if (route.includes('integration') || route.includes('integracion')) return 'INTEGRACIONES';
  if (route.includes('admin') || route.includes('config') || route.includes('importar')) return 'ADMINISTRACION';
  return 'OTROS';
}

function actionForRoute(value = '') {
  const route = clean(value).toLowerCase();
  const rules = [
    ['create', 'CREAR'], ['crear', 'CREAR'], ['upload', 'AGREGAR ARCHIVO'], ['subir', 'AGREGAR ARCHIVO'],
    ['delete', 'ELIMINAR'], ['eliminar', 'ELIMINAR'], ['finalize', 'FINALIZAR'], ['finalizar', 'FINALIZAR'],
    ['reopen', 'REABRIR'], ['reabrir', 'REABRIR'], ['update', 'EDITAR'], ['editar', 'EDITAR'], ['autosave', 'AUTOGUARDAR'],
    ['resend', 'REENVIAR'], ['reenviar', 'REENVIAR'], ['generate', 'GENERAR'], ['report', 'GENERAR REPORTE'],
    ['submit', 'ENVIAR'], ['guardar', 'GUARDAR'], ['get', 'CONSULTAR'], ['list', 'LISTAR'], ['preview', 'PREVISUALIZAR'],
  ];
  for (const [fragment, label] of rules) {
    if (route.includes(fragment)) return label;
  }
  return route ? route.toUpperCase() : 'ACTIVIDAD';
}

function priorityForRoute(value = '') {
  const route = clean(value).toLowerCase();
  if (/boletas\.(create|update|autosave|finalize|annul|evidence)|tickets\.(create|update|finalize|evidence)/.test(route)) return 'ALTA';
  if (/maintenance\.(create|update|delete|finalize|reopen|devices|images)|mantenimientos\.(create|update|delete|finalize|reopen|dispositivos|imagenes)/.test(route)) return 'ALTA';
  if (/(create|update|delete|finalize|upload|submit|guardar|crear|editar|eliminar)/.test(route)) return 'MEDIA';
  return 'NORMAL';
}

function entityForRoute(value = '') {
  const route = clean(value).toLowerCase();
  if (/(maintenance\.devices|mantenimientos\.dispositivos)/.test(route)) return 'DispositivoMantenimiento';
  if (/(maintenance\.images|mantenimientos\.imagenes)/.test(route)) return 'ImagenMantenimiento';
  if (route.includes('maintenance') || route.includes('mantenimientos')) return 'Mantenimiento';
  if (route.includes('boletas') || route.includes('tickets')) return 'Boleta';
  if (route.includes('agenda')) return 'Agenda';
  if (route.includes('customercase') || route.includes('casos')) return 'CasoCliente';
  if (route.includes('users') || route.includes('usuarios')) return 'Usuario';
  if (route.includes('client') || route.includes('clientes')) return 'Cliente';
  if (route.includes('knowledge') || route.includes('conocimiento')) return 'Conocimiento';
  if (route.includes('survey') || route.includes('encuesta')) return 'Encuesta';
  return sectionForRoute(route);
}

function firstId(source = {}) {
  const keys = [
    'BoletaUID', 'boletaUid', 'BoletaID', 'boletaId',
    'MantenimientoID', 'maintenanceId', 'mantenimientoId',
    'EvidenciaMantenimientoID', 'evidenciaMantenimientoId', 'DispositivoID', 'dispositivoId',
    'FotoDispositivoID', 'fotoDispositivoId', 'AgendaID', 'agendaId',
    'CasoID', 'caseId', 'UsuarioID', 'usuarioId', 'ClienteID', 'clienteId',
    'TutorialID', 'tutorialId', 'EncuestaID', 'encuestaId', 'id',
  ];
  for (const key of keys) {
    const value = source?.[key];
    if (value != null && clean(value)) return clean(value);
  }
  if (source?.item && typeof source.item === 'object') return firstId(source.item);
  if (source?.user && typeof source.user === 'object') return firstId(source.user);
  if (source?.ticket && typeof source.ticket === 'object') return firstId(source.ticket);
  if (source?.maintenance && typeof source.maintenance === 'object') return firstId(source.maintenance);
  return '';
}

function queueRow(row) {
  queue.push(row);
  while (queue.length > Math.max(5_000, env.auditMaxBufferedRows * 3)) {
    queue.shift();
    droppedRows += 1;
  }
  if (queue.length >= env.auditBatchSize) void flushActivityQueue();
  return row.ActividadID;
}

const flushTimer = setInterval(() => {
  if (queue.length) void flushActivityQueue();
}, Math.max(2_000, env.auditFlushMs));
flushTimer.unref?.();

export async function flushActivityQueue() {
  if (flushPromise) return flushPromise;
  if (!queue.length) return { flushed: 0 };

  const batch = queue.splice(0, Math.min(queue.length, Math.max(20, env.auditBatchSize)));
  flushPromise = ensureActivitySchema()
    .then(() => appendRows('ActividadApp', batch, { chunkSize: Math.max(20, env.auditBatchSize) }))
    .then(() => {
      flushedRows += batch.length;
      return { flushed: batch.length };
    })
    .catch((error) => {
      failedFlushes += 1;
      queue.unshift(...batch);
      while (queue.length > Math.max(5_000, env.auditMaxBufferedRows * 3)) {
        queue.shift();
        droppedRows += 1;
      }
      console.error('No se pudo vaciar la cola de actividad:', error.message);
      return { flushed: 0, error: error.message };
    })
    .finally(() => {
      flushPromise = null;
      if (queue.length >= env.auditBatchSize) void flushActivityQueue();
    });
  return flushPromise;
}

export function activityQueueSnapshot() {
  return {
    queued: queue.length,
    flushing: Boolean(flushPromise),
    flushedRows,
    failedFlushes,
    droppedRows,
  };
}

function baseRow(auth, meta = {}) {
  const started = meta.startedAt ? new Date(meta.startedAt) : new Date();
  const ended = meta.endedAt ? new Date(meta.endedAt) : started;
  const duration = Math.max(0, Number(meta.durationSeconds ?? ((ended.getTime() - started.getTime()) / 1000)) || 0);
  return {
    ActividadID: uuid(),
    UsuarioID: clean(auth?.user?.UsuarioID, 'SYSTEM'),
    UsuarioNombre: clean(auth?.user?.NombreCompleto || auth?.user?.Nombre || auth?.user?.NombreUsuario, 'SYSTEM'),
    SesionID: clean(auth?.session?.SesionID),
    TipoEvento: clean(meta.type, 'API_ACTION'),
    Seccion: clean(meta.section, 'OTROS'),
    Vista: clampText(meta.view, 180),
    RutaUI: clampText(meta.uiRoute, 500),
    RutaAccion: clampText(meta.actionRoute, 300),
    Accion: clampText(meta.action, 180),
    Entidad: clampText(meta.entity, 120),
    EntidadID: clampText(meta.entityId, 180),
    Resultado: clean(meta.result, 'OK'),
    Prioridad: clean(meta.priority, 'NORMAL'),
    DetalleJSON: safeJson(meta.detail),
    FechaInicio: started.toISOString(),
    FechaFin: ended.toISOString(),
    DuracionSegundos: Math.round(duration * 10) / 10,
    IP: clampText(meta.ip, 120),
    UserAgent: clampText(meta.userAgent, 500),
    Fuente: clean(meta.source, 'BACKEND'),
  };
}

export async function recordApiActivityFromToken({
  sessionToken,
  route,
  payload,
  data,
  error,
  startedAt,
  endedAt,
  ip,
  userAgent,
}) {
  if (!sessionToken || !route) return { queued: false };
  try {
    const auth = await authenticate(sessionToken);
    const detail = {
      solicitud: safeValue(payload),
      respuesta: error ? undefined : safeValue(data),
      error: error ? { code: error.code || '', message: error.message || String(error) } : undefined,
    };
    const row = baseRow(auth, {
      type: 'API_ACTION',
      section: sectionForRoute(route),
      actionRoute: route,
      action: actionForRoute(route),
      entity: entityForRoute(route),
      entityId: firstId(data) || firstId(payload),
      result: error ? 'ERROR' : 'OK',
      priority: priorityForRoute(route),
      detail,
      startedAt,
      endedAt,
      ip,
      userAgent,
      source: 'BACKEND_ACTION',
    });
    queueRow(row);
    return { queued: true, activityId: row.ActividadID };
  } catch {
    return { queued: false };
  }
}

export function recordUiActivity(auth, event = {}, requestMeta = {}) {
  const uiRoute = clean(event.route || event.ruta || event.pathname);
  const row = baseRow(auth, {
    type: clean(event.type, 'PAGE_TIME').toUpperCase(),
    section: clean(event.section, sectionForRoute(uiRoute)).toUpperCase(),
    view: event.view || event.vista || '',
    uiRoute,
    actionRoute: '',
    action: event.action || (clean(event.type).toUpperCase() === 'UI_TAB' ? 'CAMBIAR PESTAÑA' : 'PERMANENCIA EN PESTAÑA'),
    entity: 'Interfaz',
    entityId: '',
    result: 'OK',
    priority: 'NORMAL',
    detail: event.detail || event.detalle || {},
    startedAt: event.startedAt || event.fechaInicio || nowIso(),
    endedAt: event.endedAt || event.fechaFin || nowIso(),
    durationSeconds: event.durationSeconds || event.duracionSegundos || 0,
    ip: requestMeta.ip,
    userAgent: requestMeta.userAgent,
    source: 'FRONTEND_TELEMETRY',
  });
  queueRow(row);
  return { queued: true, activityId: row.ActividadID };
}
