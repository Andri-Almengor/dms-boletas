import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import { audit } from './audit.service.js';
import { createIntegrationCommand, integrationGatewayOverview } from './integration-gateway.service.js';

const baseChat = assistantDynamicMaintenanceQuestionHandlers.chat;
const GATEWAY_WORD = /\bgateway\b/i;
const ADMIN_PERMISSION = 'USUARIOS_GESTIONAR';
const READ_PERMISSIONS = new Set([
  ADMIN_PERMISSION,
  'CLIENTES_VER',
  'MANTENIMIENTOS_VER',
  'MANTENIMIENTOS_GESTIONAR',
  'BOLETAS_VER',
]);
const TERMINAL_STATES = new Set(['COMPLETADO', 'ERROR', 'CANCELADO']);
const ACTION_WAIT_MS = 28_000;
const CONFIRMATION_WINDOW_MS = 2 * 60_000;

const CLIENT_ALIASES = Object.freeze({
  rn: ['registro nacional', 'junta administrativa del registro nacional'],
  asamblea: ['asamblea legislativa', 'asamblea legislativa de costa rica'],
  bcr: ['banco de costa rica'],
  bccr: ['banco central de costa rica'],
  ice: ['instituto costarricense de electricidad'],
  ins: ['instituto nacional de seguros'],
  aya: ['acueductos y alcantarillados'],
  ccss: ['caja costarricense de seguro social'],
  dms: ['digital management systems'],
});

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalized(value) {
  return clean(value, 3000)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && !['INACTIVO', 'REVOCADO'].includes(String(row.Estado || '').toUpperCase());
}

function online(device) {
  const detected = device.DetectadoEnUltimaSincronizacion !== false
    && String(device.DetectadoEnUltimaSincronizacion ?? 'true').toLowerCase() !== 'false';
  return detected && String(device.EstadoConexion || '').toUpperCase() === 'ONLINE';
}

function hasReadPermission(ctx) {
  return (ctx.permissions || []).some((permission) => READ_PERMISSIONS.has(permission));
}

function isAdmin(ctx) {
  return (ctx.permissions || []).includes(ADMIN_PERMISSION);
}

function clientId(row = {}) {
  return clean(row.ClienteID || row.id, 180);
}

function clientName(row = {}) {
  return clean(row.Nombre || row.Clientes || row.RazonSocial || row.Cliente, 250) || 'Cliente';
}

function displayName(device = {}) {
  return clean(device.NombreOperativo || device.NombreDetectado, 250) || 'Cámara sin nombre';
}

function cameraDescription(device = {}) {
  return `${displayName(device)} (${clean(device.DireccionIP, 100) || 'sin IP'})`;
}

function explicitClientMatches(question, client) {
  const query = normalized(question);
  const name = normalized(clientName(client));
  if (name && query.includes(name)) return true;
  const parenthetical = [...clientName(client).matchAll(/\(([^)]+)\)/g)].map((match) => normalized(match[1]));
  if (parenthetical.some((alias) => alias && new RegExp(`(^| )${alias}( |$)`).test(query))) return true;
  return Object.entries(CLIENT_ALIASES).some(([alias, targets]) => (
    new RegExp(`(^| )${alias}( |$)`).test(query)
    && targets.some((target) => name.includes(normalized(target)) || normalized(target).includes(name))
  ));
}

async function resolveClient(question) {
  const clients = (await readTable('Clientes')).filter(active);
  const matches = clients.filter((client) => explicitClientMatches(question, client));
  if (matches.length === 1) return { status: 'resolved', client: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', clients: matches.slice(0, 8) };
  return { status: 'missing' };
}

function gatewayDevices(overview, client) {
  const id = clientId(client);
  const gatewayIds = new Set((overview.gateways || [])
    .filter((gateway) => active(gateway) && clean(gateway.ClienteID, 180) === id)
    .map((gateway) => clean(gateway.GatewayID, 180)));
  return (overview.devices || []).filter((device) => (
    active(device)
    && String(device.Tipo || '').toUpperCase() === 'CAMERA'
    && String(device.SourceSystem || '').toUpperCase() !== 'SIMULATED'
    && gatewayIds.has(clean(device.GatewayID, 180))
  ));
}

function deviceScore(question, device) {
  const query = normalized(question);
  const ip = clean(device.DireccionIP, 100).toLowerCase();
  if (ip && query.includes(ip)) return 5;
  const operational = normalized(device.NombreOperativo);
  if (operational && operational.length >= 3 && query.includes(operational)) return 4;
  const detected = normalized(device.NombreDetectado);
  if (detected && detected.length >= 4 && query.includes(detected)) return 3;
  const model = normalized(device.Modelo);
  if (model && model.length >= 4 && query.includes(model)) return 2;
  return 0;
}

function resolveDevice(question, devices) {
  const ranked = devices
    .map((device) => ({ device, score: deviceScore(question, device) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: 'missing' };
  const best = ranked[0].score;
  const matches = ranked.filter((item) => item.score === best).map((item) => item.device);
  if (matches.length !== 1) return { status: 'ambiguous', devices: matches.slice(0, 8) };
  return { status: 'resolved', device: matches[0] };
}

function gatewayForDevice(overview, device) {
  return (overview.gateways || []).find((gateway) => clean(gateway.GatewayID, 180) === clean(device.GatewayID, 180));
}

function response(answer, { facts = {}, suggestions = [], context = {}, sources = [] } = {}) {
  return { type: 'answer', answer, facts, suggestions, context, sources };
}

function clarification(answer, { suggestions = [], context = {}, options = [] } = {}) {
  return { type: 'clarification', answer, message: answer, facts: {}, sources: [], suggestions, context, options };
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function waitForCommand(commandId, timeoutMs = ACTION_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const command = (await readTable('IntegracionComandos'))
      .find((row) => clean(row.ComandoID, 180) === clean(commandId, 180));
    if (command && TERMINAL_STATES.has(String(command.Estado || '').toUpperCase())) {
      return { ...command, result: parseJson(command.ResultadoJSON) };
    }
    await new Promise((resolve) => setTimeout(resolve, 850));
  }
  return null;
}

function blockedDangerousIntent(question) {
  const key = normalized(question);
  if (/\b(factory reset|reset fabrica|restablecer fabrica|valores de fabrica|reinicio de fabrica)\b/.test(key)) return 'restablecimiento de fábrica';
  if (/\b(firmware|actualiza firmware|actualizar firmware|upgrade firmware)\b/.test(key)) return 'actualización de firmware';
  if (/\b(cambiar ip|cambia la ip|poner ip|modificar ip|direccion ip nueva)\b/.test(key)) return 'cambio de dirección IP';
  if (/\b(cambiar contrasena|cambia la contrasena|cambiar password|cambia password)\b/.test(key)) return 'cambio de contraseña';
  if (/\b(desactivar video|apagar video|deshabilitar video|desactivar stream)\b/.test(key)) return 'desactivación del video';
  return '';
}

function advancedIntent(question) {
  const key = normalized(question);
  if (/\b(diagnostica|diagnostico|diagnosticar|salud completa|revision completa|revisa completamente)\b/.test(key)) return 'CAMERA_DIAGNOSTIC';
  if (/\b(salud|health|estado tecnico|estado completo)\b/.test(key) && /\b(camara|ip)\b/.test(key)) return 'CAMERA_HEALTH';
  if (/\b(enfoca|enfocar|autofocus|auto focus|enfoque automatico|reenfoca)\b/.test(key)) return 'CAMERA_AUTOFOCUS';
  if (/\b(lista|dime|muestra|ver)\b/.test(key) && /\b(preset|presets|posiciones guardadas)\b/.test(key)) return 'CAMERA_PRESETS_LIST';
  if (/\b(ve|ir|lleva|mueve|regresa|vuelve)\b/.test(key) && /\b(preset|posicion guardada)\b/.test(key)) return 'CAMERA_PRESET_GOTO';
  if (/\b(izquierda|a la izquierda|gira izquierda|mueve izquierda)\b/.test(key)) return 'CAMERA_PAN_LEFT';
  if (/\b(derecha|a la derecha|gira derecha|mueve derecha)\b/.test(key)) return 'CAMERA_PAN_RIGHT';
  if (/\b(arriba|hacia arriba|sube la camara|mueve arriba)\b/.test(key)) return 'CAMERA_TILT_UP';
  if (/\b(abajo|hacia abajo|baja la camara|mueve abajo)\b/.test(key)) return 'CAMERA_TILT_DOWN';
  if (/\b(detener|deten|parar|para)\b/.test(key) && /\b(ptz|movimiento|pan|tilt)\b/.test(key)) return 'CAMERA_PTZ_STOP';
  if (/\b(modo automatico|automatico dia noche|dia noche automatico|auto dia noche)\b/.test(key)) return 'CAMERA_DAYNIGHT_AUTO';
  if (/\b(modo dia|forzar dia|poner de dia|vision dia)\b/.test(key)) return 'CAMERA_DAY_MODE';
  if (/\b(modo noche|forzar noche|poner de noche|vision noche)\b/.test(key)) return 'CAMERA_NIGHT_MODE';
  if (/\b(encender|enciende|activar|activa)\b/.test(key) && /\b(ir|infrarrojo|infrarrojos|iluminador)\b/.test(key)) return 'CAMERA_IR_ON';
  if (/\b(apagar|apaga|desactivar|desactiva)\b/.test(key) && /\b(ir|infrarrojo|infrarrojos|iluminador)\b/.test(key)) return 'CAMERA_IR_OFF';
  if (/\b(encender|enciende|activar|activa|limpiar|limpia)\b/.test(key) && /\b(wiper|limpiaparabrisas|limpia parabrisas)\b/.test(key)) return 'CAMERA_WIPER_ON';
  if (/\b(apagar|apaga|desactivar|desactiva|detener|deten)\b/.test(key) && /\b(wiper|limpiaparabrisas|limpia parabrisas)\b/.test(key)) return 'CAMERA_WIPER_OFF';
  if (/\b(lista|dime|muestra|ver)\b/.test(key) && /\b(rele|reles|relay|relays|salidas auxiliares|salidas de rele)\b/.test(key)) return 'CAMERA_RELAY_LIST';
  if (/\b(activar|activa|encender|enciende)\b/.test(key) && /\b(rele|relay|salida auxiliar|salida)\b/.test(key)) return 'CAMERA_RELAY_ON';
  if (/\b(desactivar|desactiva|apagar|apaga)\b/.test(key) && /\b(rele|relay|salida auxiliar|salida)\b/.test(key)) return 'CAMERA_RELAY_OFF';
  if (/\b(audio|microfono|micrófono|altavoz|speaker|sonido|backchannel)\b/.test(question.toLowerCase())) return 'CAMERA_AUDIO_TEST';
  return '';
}

function extractPreset(question) {
  const quoted = String(question).match(/["“']([^"”']{1,120})["”']/)?.[1];
  if (quoted) return clean(quoted, 120);
  return clean(String(question).match(/\b(?:preset|posici[oó]n guardada)\s+(?:n[uú]mero\s+)?([a-z0-9_.-]+)/i)?.[1], 120);
}

function extractRelay(question) {
  const quoted = String(question).match(/["“']([^"”']{1,120})["”']/)?.[1];
  if (quoted) return clean(quoted, 120);
  return clean(String(question).match(/\b(?:rel[eé]|relay|salida(?: auxiliar)?)\s+(?:n[uú]mero\s+)?([a-z0-9_.:-]+)/i)?.[1], 120);
}

function actionLabel(type) {
  return {
    CAMERA_AUTOFOCUS: 'enfocar la cámara',
    CAMERA_PAN_LEFT: 'mover la cámara a la izquierda',
    CAMERA_PAN_RIGHT: 'mover la cámara a la derecha',
    CAMERA_TILT_UP: 'mover la cámara hacia arriba',
    CAMERA_TILT_DOWN: 'mover la cámara hacia abajo',
    CAMERA_PTZ_STOP: 'detener el movimiento PTZ',
    CAMERA_PRESETS_LIST: 'consultar presets PTZ',
    CAMERA_PRESET_GOTO: 'ir al preset PTZ',
    CAMERA_DAY_MODE: 'activar modo Día',
    CAMERA_NIGHT_MODE: 'activar modo Noche',
    CAMERA_DAYNIGHT_AUTO: 'activar modo Día/Noche automático',
    CAMERA_IR_ON: 'encender el iluminador IR',
    CAMERA_IR_OFF: 'apagar el iluminador IR',
    CAMERA_WIPER_ON: 'activar el limpiaparabrisas',
    CAMERA_WIPER_OFF: 'detener el limpiaparabrisas',
    CAMERA_RELAY_LIST: 'consultar salidas de relé',
    CAMERA_RELAY_ON: 'activar una salida de relé',
    CAMERA_RELAY_OFF: 'desactivar una salida de relé',
    CAMERA_AUDIO_TEST: 'probar las capacidades de audio',
    CAMERA_HEALTH: 'consultar la salud de la cámara',
    CAMERA_DIAGNOSTIC: 'diagnosticar la cámara',
  }[type] || type;
}

function commandPayload(type, question) {
  const payload = { requestedAt: new Date().toISOString() };
  if (type === 'CAMERA_PRESET_GOTO') payload.preset = extractPreset(question);
  if (type === 'CAMERA_RELAY_ON' || type === 'CAMERA_RELAY_OFF') payload.relay = extractRelay(question);
  return payload;
}

function needsConfirmation(type) {
  return ['CAMERA_RELAY_ON', 'CAMERA_RELAY_OFF'].includes(type);
}

function confirmationKey(type, client, device, payload) {
  return {
    type,
    clientId: clientId(client),
    deviceId: clean(device.DispositivoIntegracionID, 180),
    relay: clean(payload.relay, 120),
    expiresAt: Date.now() + CONFIRMATION_WINDOW_MS,
  };
}

function confirmed(question, context, type, client, device, payload) {
  const key = normalized(question);
  const pending = context.pendingGatewayAdvancedAction;
  return /\b(confirmar|confirmo|confirmado|si confirmar|si confirmo)\b/.test(key)
    && pending?.type === type
    && pending?.clientId === clientId(client)
    && pending?.deviceId === clean(device.DispositivoIntegracionID, 180)
    && clean(pending?.relay, 120) === clean(payload.relay, 120)
    && Number(pending?.expiresAt || 0) > Date.now();
}

function formatAdvancedResult(type, device, result = {}) {
  if (type === 'CAMERA_PRESETS_LIST') {
    const presets = Array.isArray(result.presets) ? result.presets : [];
    if (!presets.length) return `${cameraDescription(device)} no devolvió presets PTZ.`;
    return [`Presets disponibles en ${cameraDescription(device)}:`, ...presets.map((preset, index) => `• ${index + 1}. ${preset.name || preset.token} · token ${preset.token}`)].join('\n');
  }
  if (type === 'CAMERA_RELAY_LIST') {
    const relays = Array.isArray(result.relays) ? result.relays : [];
    if (!relays.length) return `${cameraDescription(device)} no devolvió salidas de relé ONVIF.`;
    return [`Salidas de relé de ${cameraDescription(device)}:`, ...relays.map((relay) => `• ${relay.index}. ${relay.token}`)].join('\n');
  }
  if (type === 'CAMERA_AUDIO_TEST') {
    const audio = result.audio || {};
    return [
      `Prueba de audio de ${cameraDescription(device)}:`,
      `• Micrófono / entrada: ${audio.microphone ? 'Sí' : 'No detectado'}`,
      `• Codificador de audio: ${audio.audioEncoder ? 'Sí' : 'No detectado'}`,
      `• Altavoz / salida: ${audio.speaker ? 'Sí' : 'No detectado'}`,
      `• Backchannel: ${audio.backchannelDetected ? 'Detectado' : 'No detectado'}`,
      `• Tono de prueba desde el Gateway: ${audio.testToneAvailable ? 'Disponible' : 'No habilitado'}`,
      audio.note || '',
    ].filter(Boolean).join('\n');
  }
  if (type === 'CAMERA_HEALTH' || type === 'CAMERA_DIAGNOSTIC') {
    const h = result.health || {};
    const portLines = Array.isArray(h.ports)
      ? h.ports.map((item) => `${item.port}:${item.open ? `ABIERTO${item.latencyMs !== null ? ` (${item.latencyMs} ms)` : ''}` : 'CERRADO/NO RESPONDE'}`).join(' · ')
      : '—';
    const video = h.video || {};
    const audio = h.audio || {};
    return [
      `Diagnóstico de ${cameraDescription(device)}:`,
      `• Estado inventario: ${online(device) ? 'ONLINE' : 'OFFLINE'}`,
      `• IP: ${clean(device.DireccionIP, 100) || '—'}`,
      `• Marca / modelo: ${clean(device.Fabricante, 160) || '—'} ${clean(device.Modelo, 160) || ''}`.trim(),
      `• Puertos probados: ${portLines}`,
      `• Red alcanzable: ${h.networkReachable ? 'Sí' : 'No'}`,
      `• Autenticación: ${h.authentication || 'No determinada'}`,
      `• ONVIF: ${h.onvif ? 'Disponible' : 'No determinado'}`,
      `• Snapshot: ${h.snapshot || 'No determinado'}${h.snapshotTransport ? ` · ${h.snapshotTransport}` : ''}`,
      `• PTZ: ${h.ptz ? 'Disponible' : 'No detectado'}`,
      `• Zoom: ${h.zoom ? 'Disponible' : 'No detectado'}`,
      `• Auto Focus: ${h.autofocus ? 'Disponible' : 'No detectado'}`,
      `• Día/Noche: ${h.dayNight ? 'Disponible' : 'No detectado'}`,
      `• Control IR: ${h.irControl ? 'Disponible' : 'No detectado'}`,
      `• Wiper: ${h.wiper ? 'Disponible' : 'No detectado'}`,
      `• Relés: ${Array.isArray(h.relayOutputs) ? h.relayOutputs.length : 0}`,
      `• Audio entrada/salida: ${audio.microphone ? 'entrada ' : ''}${audio.speaker ? 'salida' : ''}`.trim() || '• Audio entrada/salida: No detectado',
      video.encoding ? `• Video: ${video.encoding}${video.width && video.height ? ` ${video.width}x${video.height}` : ''}${video.frameRateLimit ? ` · ${video.frameRateLimit} fps` : ''}${video.bitrateKbps ? ` · ${video.bitrateKbps} kbps` : ''}` : '',
      h.system?.hostname ? `• Hostname cámara: ${h.system.hostname}` : '',
      h.system?.cameraTime ? `• Hora reportada por cámara: ${h.system.cameraTime}` : '',
      `• Temperatura: ${h.temperature ?? 'No estándar/no disponible'}`,
      `• Uptime: ${h.uptime ?? 'No estándar/no disponible'}`,
      `• Almacenamiento/SD: ${h.storage ?? 'No estándar/no disponible'}`,
      `• Ubicación: ${clean(device.UbicacionCliente, 200) || '—'} / ${clean(device.UbicacionEquipo, 200) || '—'}`,
      `• Última conexión: ${clean(device.UltimaConexion, 100) || '—'}`,
    ].filter(Boolean).join('\n');
  }
  const transport = clean(result.transport, 100);
  return `${actionLabel(type)} en ${cameraDescription(device)}: completado${transport ? ` mediante ${transport}` : ''}.`;
}

function diagnosticSuggestions(client, device, result = {}) {
  const h = result.health || {};
  const ref = clean(device.DireccionIP, 100) || displayName(device);
  const base = `gateway`;
  const suffix = `cámara ${ref} cliente ${clientName(client)}`;
  const suggestions = [`${base} qué puedo hacer físicamente con ${suffix}`];
  if (h.autofocus) suggestions.push(`${base} enfoca la ${suffix}`);
  if (h.ptz) {
    suggestions.push(`${base} mueve a la izquierda la ${suffix}`);
    suggestions.push(`${base} lista presets de la ${suffix}`);
  }
  if (h.dayNight) suggestions.push(`${base} pon modo automático día noche en la ${suffix}`);
  if (h.irControl) suggestions.push(`${base} enciende IR de la ${suffix}`);
  if (h.wiper) suggestions.push(`${base} activa limpiaparabrisas de la ${suffix}`);
  if (Array.isArray(h.relayOutputs) && h.relayOutputs.length) suggestions.push(`${base} lista relés de la ${suffix}`);
  if (h.audio?.microphone || h.audio?.speaker) suggestions.push(`${base} prueba audio de la ${suffix}`);
  return suggestions.slice(0, 8);
}

async function dispatch(ctx, question, context, overview, client, device, type) {
  if (!isAdmin(ctx)) throw forbidden('Las acciones físicas avanzadas del Gateway requieren permisos administrativos.');
  const gateway = gatewayForDevice(overview, device);
  if (!gateway || String(gateway.Estado || '').toUpperCase() !== 'ACTIVO' || !gateway.online) {
    return response(`El gateway de ${clientName(client)} no está en línea. No enviaré ${actionLabel(type)}.`, { context });
  }
  if (!online(device)) {
    return response(`${cameraDescription(device)} figura OFFLINE en la última sincronización. No enviaré una acción física.`, { context });
  }
  if (!clean(device.CredencialCamaraID, 180)) {
    return response(`${cameraDescription(device)} no tiene una credencial de cámara asignada. Asigne una única credencial desde Gateways e inventario antes de ejecutar acciones físicas.`, { context });
  }

  const payload = { deviceId: device.DispositivoIntegracionID, ...commandPayload(type, question) };
  if (type === 'CAMERA_PRESET_GOTO' && !payload.preset) {
    return clarification('Indique el nombre o número del preset. Ejemplo: “gateway ve al preset 2 de la cámara 192.168.1.20 cliente Cliente X”.', { context });
  }
  if ((type === 'CAMERA_RELAY_ON' || type === 'CAMERA_RELAY_OFF') && !payload.relay) {
    return clarification('Indique el número o token de la salida de relé. Primero puede pedir “gateway lista relés de la cámara ...”.', { context });
  }

  if (needsConfirmation(type) && !confirmed(question, context, type, client, device, payload)) {
    const nextContext = {
      ...context,
      pendingGatewayAdvancedAction: confirmationKey(type, client, device, payload),
    };
    const state = type === 'CAMERA_RELAY_ON' ? 'ACTIVAR' : 'DESACTIVAR';
    return clarification(
      `${state} la salida de relé ${payload.relay} de ${cameraDescription(device)} puede accionar un equipo físico conectado. Confirme explícitamente dentro de 2 minutos.`,
      {
        context: nextContext,
        options: [{
          type: 'gateway-confirm',
          value: `${question} confirmar`,
          label: `Confirmar ${state.toLowerCase()} relé ${payload.relay}`,
        }],
      },
    );
  }

  const command = await createIntegrationCommand({
    gatewayId: gateway.GatewayID,
    type,
    payload,
    actor: ctx.user?.UsuarioID || 'ASSISTANT',
  });
  await audit(ctx, 'ASISTENTE_ACCION_AVANZADA_CAMARA_GATEWAY', 'IntegracionComandos', command.ComandoID, null, {
    GatewayID: gateway.GatewayID,
    ClienteID: clientId(client),
    DispositivoIntegracionID: device.DispositivoIntegracionID,
    Tipo: type,
    Parametro: type === 'CAMERA_PRESET_GOTO' ? payload.preset : type.includes('RELAY_') ? payload.relay : '',
  });

  const completed = await waitForCommand(command.ComandoID);
  if (!completed) {
    return response(`La orden para ${actionLabel(type)} fue enviada a ${cameraDescription(device)}, pero el Gateway todavía no respondió. No enviaré una orden duplicada automáticamente.`, {
      facts: { gatewayAdvancedAction: { type, status: 'PENDIENTE', commandId: command.ComandoID } },
      context,
    });
  }
  if (String(completed.Estado || '').toUpperCase() !== 'COMPLETADO') {
    return response(`El gateway no pudo ${actionLabel(type)} en ${cameraDescription(device)}: ${clean(completed.ErrorMensaje, 700) || 'la cámara no soportó o rechazó la operación'}.`, {
      facts: { gatewayAdvancedAction: { type, status: completed.Estado, errorCode: completed.ErrorCodigo } },
      context,
    });
  }

  const result = completed.result || {};
  const facts = { gatewayAdvancedAction: { type, status: 'COMPLETADO', result } };
  if (type === 'CAMERA_HEALTH' || type === 'CAMERA_DIAGNOSTIC') facts.gatewayDiagnostic = result.health || {};
  return response(formatAdvancedResult(type, device, result), {
    facts,
    context: { ...context, pendingGatewayAdvancedAction: null },
    suggestions: (type === 'CAMERA_HEALTH' || type === 'CAMERA_DIAGNOSTIC') ? diagnosticSuggestions(client, device, result) : [],
  });
}

async function handle(ctx, question) {
  if (!hasReadPermission(ctx)) throw forbidden('No cuenta con permiso para consultar el Gateway.');
  const dangerous = blockedDangerousIntent(question);
  if (dangerous) {
    return response(
      `Reconozco la solicitud de ${dangerous}, pero no la ejecuto directamente desde el chat. Esa operación puede dejar la cámara inaccesible o interrumpir video y debe realizarse mediante un flujo administrativo separado con validación previa, respaldo de configuración y confirmaciones adicionales.`,
      {
        suggestions: ['gateway diagnostica la cámara antes de cualquier cambio crítico'],
      },
    );
  }

  const type = advancedIntent(question);
  if (!type) return null;
  const clientResolution = await resolveClient(question);
  if (clientResolution.status === 'missing') {
    return clarification('Indique también el cliente. Ejemplo: “gateway diagnostica la cámara 192.168.100.232 cliente DMS”.');
  }
  if (clientResolution.status === 'ambiguous') {
    return clarification('Encontré más de un cliente posible. Escriba el nombre completo del cliente junto con la palabra gateway.');
  }

  const client = clientResolution.client;
  const overview = await integrationGatewayOverview();
  const devices = gatewayDevices(overview, client);
  const resolved = resolveDevice(question, devices);
  if (resolved.status === 'missing') {
    return clarification(`Para ${actionLabel(type)} indique la IP, nombre o modelo de la cámara.`, {
      suggestions: devices.filter(online).slice(0, 4).map((device) => `gateway diagnostica la cámara ${device.DireccionIP || displayName(device)} cliente ${clientName(client)}`),
    });
  }
  if (resolved.status === 'ambiguous') {
    return clarification('Ese nombre o modelo coincide con varias cámaras. Use la IP para evitar actuar sobre el equipo equivocado.');
  }

  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  return dispatch(ctx, question, context, overview, client, resolved.device, type);
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function advancedGatewayAssistantChat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question, 1500);
  if (!GATEWAY_WORD.test(question)) return baseChat(ctx);
  const handled = await handle(ctx, question);
  return handled || baseChat(ctx);
};
