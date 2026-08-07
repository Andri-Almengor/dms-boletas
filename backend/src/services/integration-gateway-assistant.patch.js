import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import { audit } from './audit.service.js';
import {
  createIntegrationCommand,
  integrationGatewayOverview,
} from './integration-gateway.service.js';
import { integrationGatewaySnapshotPresentation } from './integration-gateway-snapshot.service.js';

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
const TERMINAL_COMMAND_STATES = new Set(['COMPLETADO', 'ERROR', 'CANCELADO']);
const ACTION_WAIT_MS = 28_000;

const CLIENT_ALIASES = Object.freeze({
  rn: ['registro nacional', 'junta administrativa del registro nacional'],
  asamblea: ['asamblea legislativa', 'asamblea legislativa de costa rica'],
  bcr: ['banco de costa rica'],
  bccr: ['banco central de costa rica'],
  ice: ['instituto costarricense de electricidad'],
  ins: ['instituto nacional de seguros'],
  aya: ['acueductos y alcantarillados'],
  ccss: ['caja costarricense de seguro social'],
});

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalized(value) {
  return clean(value, 2_000)
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

function clientId(row = {}) {
  return clean(row.ClienteID || row.id, 180);
}

function clientName(row = {}) {
  return clean(row.Nombre || row.Clientes || row.RazonSocial || row.Cliente, 250) || 'Cliente';
}

function hasReadPermission(ctx) {
  return (ctx.permissions || []).some((permission) => READ_PERMISSIONS.has(permission));
}

function isAdmin(ctx) {
  return (ctx.permissions || []).includes(ADMIN_PERMISSION);
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

async function resolveExplicitClient(question) {
  const clients = (await readTable('Clientes')).filter(active);
  const matches = clients.filter((client) => explicitClientMatches(question, client));
  if (matches.length === 1) return { status: 'resolved', client: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', clients: matches.slice(0, 8) };
  return { status: 'missing', clients: [] };
}

function detectedLatest(device) {
  const value = device.DetectadoEnUltimaSincronizacion;
  return value !== false && String(value ?? 'true').toLowerCase() !== 'false';
}

function online(device) {
  return detectedLatest(device) && String(device.EstadoConexion || '').toUpperCase() === 'ONLINE';
}

function displayName(device) {
  return clean(device.NombreOperativo || device.NombreDetectado, 250) || 'Cámara sin nombre';
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

function deviceReferenceInQuestion(question, device) {
  const query = normalized(question);
  const ip = clean(device.DireccionIP, 100);
  if (ip && query.includes(ip.toLowerCase())) return 3;
  const operational = normalized(device.NombreOperativo);
  if (operational && operational.length >= 3 && query.includes(operational)) return 2;
  const detected = normalized(device.NombreDetectado);
  if (detected && detected.length >= 4 && query.includes(detected)) return 1;
  return 0;
}

function resolveExplicitDevice(question, devices) {
  const ranked = devices
    .map((device) => ({ device, score: deviceReferenceInQuestion(question, device) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: 'missing' };
  const bestScore = ranked[0].score;
  const matches = ranked.filter((item) => item.score === bestScore).map((item) => item.device);
  if (matches.length !== 1) return { status: 'ambiguous', devices: matches.slice(0, 10) };
  return { status: 'resolved', device: matches[0] };
}

function gatewayForDevice(overview, device) {
  return (overview.gateways || []).find((gateway) => clean(gateway.GatewayID, 180) === clean(device.GatewayID, 180));
}

function source(client) {
  return [{
    type: 'gateway',
    id: clientId(client),
    label: `Gateway · ${clientName(client)}`,
    url: '/integraciones',
  }];
}

function response(answer, { facts = {}, suggestions = [], sources = [], context = {}, sensitive = false } = {}) {
  return {
    type: 'answer',
    answer,
    facts,
    suggestions,
    sources,
    context,
    sensitive,
  };
}

function clarification(answer, { options = [], context = {}, resumeQuestion = '', suggestions = [] } = {}) {
  return {
    type: 'clarification',
    answer,
    message: answer,
    options,
    context,
    resumeQuestion,
    suggestions,
    facts: {},
    sources: [],
  };
}

function inventoryFacts(mode, client, devices) {
  const onlineDevices = devices.filter(online);
  if (mode === 'manufacturers') {
    const counts = new Map();
    onlineDevices.forEach((device) => {
      const name = clean(device.Fabricante, 160) || 'Marca no identificada';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return {
      mode,
      clientId: clientId(client),
      clientName: clientName(client),
      total: onlineDevices.length,
      rows: [...counts.entries()].map(([manufacturer, count]) => ({ manufacturer, count }))
        .sort((a, b) => b.count - a.count || a.manufacturer.localeCompare(b.manufacturer, 'es')),
    };
  }
  if (mode === 'locations') {
    const counts = new Map();
    onlineDevices.forEach((device) => {
      const equipment = clean(device.UbicacionEquipo, 250) || 'Sin Ubicación del equipo';
      const general = clean(device.UbicacionCliente, 250) || 'Sin ubicación general';
      const key = `${general}|${equipment}`;
      const current = counts.get(key) || { location: general, equipmentLocation: equipment, count: 0 };
      current.count += 1;
      counts.set(key, current);
    });
    return {
      mode,
      clientId: clientId(client),
      clientName: clientName(client),
      total: onlineDevices.length,
      rows: [...counts.values()].sort((a, b) => a.location.localeCompare(b.location, 'es') || a.equipmentLocation.localeCompare(b.equipmentLocation, 'es')),
    };
  }
  return {
    mode: 'cameras',
    clientId: clientId(client),
    clientName: clientName(client),
    total: onlineDevices.length,
    rows: onlineDevices.map((device) => ({
      id: clean(device.DispositivoIntegracionID, 180),
      name: displayName(device),
      ip: clean(device.DireccionIP, 100),
      manufacturer: clean(device.Fabricante, 160) || '—',
      model: clean(device.Modelo, 160) || '—',
      location: clean(device.UbicacionCliente, 250) || '—',
      equipmentLocation: clean(device.UbicacionEquipo, 250) || '—',
      status: 'ONLINE',
      credentialConfigured: Boolean(clean(device.CredencialCamaraID, 180)),
    })).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })),
  };
}

function readOnlyIntent(question) {
  const key = normalized(question);
  if (/\b(fabricante|fabricantes|marca|marcas)\b/.test(key)) return 'manufacturers';
  if (/\b(ubicacion|ubicaciones|zona|zonas)\b/.test(key)) return 'locations';
  if (/\b(camara|camaras|online|en linea|lista|inventario)\b/.test(key)) return 'cameras';
  return '';
}

function actionIntent(question) {
  const key = normalized(question);
  if (/\b(reiniciar|reinicio|reboot)\b/.test(key)) return 'CAMERA_REBOOT';
  if (/\b(que puedo hacer|acciones|capacidades|capacidad|fisicamente|fisica)\b/.test(key)) return 'CAMERA_CAPABILITIES';
  if (/\b(imagen|captura|snapshot|screen|pantallazo|foto)\b/.test(key)) return 'CAMERA_SNAPSHOT';
  if (/\b(detener|parar|stop)\b/.test(key) && /zoom/.test(key)) return 'CAMERA_ZOOM_STOP';
  if (/(volver|regresar|restaurar|normal|home)/.test(key) && /(zoom|camara|ptz)/.test(key)) return 'CAMERA_GOTO_HOME';
  if (/(zoom in|acercar|aumentar zoom|hacer zoom)/.test(key)) return 'CAMERA_ZOOM_IN';
  if (/(zoom out|alejar|reducir zoom|disminuir zoom)/.test(key)) return 'CAMERA_ZOOM_OUT';
  if (/\b(probar|validar|autenticar|autenticacion|conexion)\b/.test(key) && /\b(camara|credencial|onvif)\b/.test(key)) return 'CAMERA_AUTH_TEST';
  return '';
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    if (command && TERMINAL_COMMAND_STATES.has(String(command.Estado || '').toUpperCase())) {
      return { ...command, result: parseJson(command.ResultadoJSON) };
    }
    await sleep(850);
  }
  return null;
}

function cameraDescription(device) {
  return `${displayName(device)} (${clean(device.DireccionIP, 100) || 'sin IP'})`;
}

function actionLabel(type) {
  return {
    CAMERA_AUTH_TEST: 'probar la autenticación',
    CAMERA_CAPABILITIES: 'consultar capacidades',
    CAMERA_SNAPSHOT: 'obtener una captura',
    CAMERA_ZOOM_IN: 'acercar el zoom',
    CAMERA_ZOOM_OUT: 'alejar el zoom',
    CAMERA_ZOOM_STOP: 'detener el zoom',
    CAMERA_GOTO_HOME: 'volver a Home',
    CAMERA_REBOOT: 'reiniciar',
  }[type] || type;
}

async function dispatchCameraAction(ctx, overview, client, device, type, context) {
  if (!isAdmin(ctx)) throw forbidden('El control físico de cámaras desde el Gateway requiere permisos administrativos.');
  const gateway = gatewayForDevice(overview, device);
  if (!gateway || String(gateway.Estado || '').toUpperCase() !== 'ACTIVO' || !gateway.online) {
    return response(`El gateway de ${clientName(client)} no está en línea. No enviaré ninguna orden a ${cameraDescription(device)}.`, {
      sources: source(client),
      context,
    });
  }
  if (!online(device)) {
    return response(`${cameraDescription(device)} no figura en línea en la última sincronización. No enviaré una acción física.`, {
      sources: source(client),
      context,
    });
  }
  if (!clean(device.CredencialCamaraID, 180)) {
    return response(`${cameraDescription(device)} todavía no tiene una credencial de cámara asignada. Abra Gateways e inventario, edite la cámara y seleccione una sola credencial del cliente. El agente nunca probará una lista de contraseñas.`, {
      sources: source(client),
      context,
    });
  }

  const command = await createIntegrationCommand({
    gatewayId: gateway.GatewayID,
    type,
    payload: { deviceId: device.DispositivoIntegracionID },
    actor: ctx.user?.UsuarioID || 'ASSISTANT',
  });
  await audit(
    ctx,
    'ASISTENTE_COMANDO_CAMARA_GATEWAY',
    'IntegracionComandos',
    command.ComandoID,
    null,
    {
      GatewayID: gateway.GatewayID,
      DispositivoIntegracionID: device.DispositivoIntegracionID,
      ClienteID: clientId(client),
      Tipo: type,
    },
  );

  const completed = await waitForCommand(command.ComandoID);
  if (!completed) {
    return response(`La orden para ${actionLabel(type)} ${cameraDescription(device)} fue enviada al gateway, pero todavía no respondió. No se enviarán órdenes duplicadas automáticamente.`, {
      facts: { gatewayAction: { type, status: 'PENDIENTE', camera: cameraDescription(device), commandId: command.ComandoID } },
      sources: source(client),
      context,
    });
  }
  if (String(completed.Estado || '').toUpperCase() !== 'COMPLETADO') {
    return response(`El gateway no pudo ${actionLabel(type)} ${cameraDescription(device)}: ${clean(completed.ErrorMensaje, 500) || 'la cámara rechazó o no soportó la operación'}.`, {
      facts: { gatewayAction: { type, status: completed.Estado, camera: cameraDescription(device), errorCode: completed.ErrorCodigo } },
      sources: source(client),
      context,
    });
  }

  const result = completed.result || {};
  const facts = {
    gatewayAction: {
      type,
      status: 'COMPLETADO',
      camera: cameraDescription(device),
      commandId: command.ComandoID,
    },
  };
  let sensitive = false;
  if (type === 'CAMERA_CAPABILITIES') facts.gatewayCameraCapabilities = { camera: cameraDescription(device), ...result.capabilities };
  if (type === 'CAMERA_AUTH_TEST') facts.gatewayCameraAuthentication = result;
  if (type === 'CAMERA_SNAPSHOT' && result.snapshot?.snapshotId) {
    const snapshot = integrationGatewaySnapshotPresentation(result.snapshot.snapshotId);
    if (snapshot) {
      facts.gatewaySnapshot = { ...snapshot, camera: cameraDescription(device) };
      sensitive = true;
    }
  }

  const messages = {
    CAMERA_AUTH_TEST: `La autenticación con ${cameraDescription(device)} fue aceptada.`,
    CAMERA_CAPABILITIES: `Consulté directamente las capacidades ONVIF de ${cameraDescription(device)}.`,
    CAMERA_SNAPSHOT: facts.gatewaySnapshot ? `Captura obtenida de ${cameraDescription(device)}. La imagen es temporal y no se guarda en Sheets.` : `La cámara respondió a la captura, pero la imagen temporal ya no está disponible.`,
    CAMERA_ZOOM_IN: `Se envió un movimiento corto de zoom hacia adentro a ${cameraDescription(device)}.`,
    CAMERA_ZOOM_OUT: `Se envió un movimiento corto de zoom hacia afuera a ${cameraDescription(device)}.`,
    CAMERA_ZOOM_STOP: `Se solicitó detener el zoom de ${cameraDescription(device)}.`,
    CAMERA_GOTO_HOME: `Se solicitó volver a la posición Home de ${cameraDescription(device)}.`,
    CAMERA_REBOOT: `La cámara ${cameraDescription(device)} aceptó la solicitud de reinicio. Puede tardar unos minutos en volver a aparecer en línea.`,
  };
  return response(messages[type] || `Acción ${type} completada.`, {
    facts,
    sources: source(client),
    context: { ...context, pendingGatewayAction: null },
    sensitive,
  });
}

function confirmationQuestion(client, device) {
  const reference = clean(device.DireccionIP, 100) || displayName(device);
  return `gateway confirmar reinicio de cámara ${reference} cliente ${clientName(client)}`;
}

async function handleGatewayQuestion(ctx) {
  if (!hasReadPermission(ctx)) throw forbidden('No cuenta con permiso para consultar el inventario del Gateway.');
  const question = clean(ctx.payload?.message || ctx.payload?.question, 1_500);
  const context = ctx.payload?.context && typeof ctx.payload.context === 'object' ? { ...ctx.payload.context } : {};
  const clientResolution = await resolveExplicitClient(question);
  if (clientResolution.status === 'ambiguous') {
    return clarification('Encontré más de un cliente en la consulta. Escriba el nombre completo del cliente junto con la palabra gateway.', {
      options: clientResolution.clients.map((client) => ({ type: 'client', value: clientId(client), label: clientName(client) })),
      context,
      resumeQuestion: question,
    });
  }
  if (clientResolution.status === 'missing') {
    return clarification('Para consultas de gateway indique el nombre del cliente en el mismo mensaje. Ejemplo: “gateway lista cámaras en línea de Asamblea”.', {
      context,
      resumeQuestion: question,
    });
  }

  const client = clientResolution.client;
  const overview = await integrationGatewayOverview();
  const devices = gatewayDevices(overview, client);
  const action = actionIntent(question);
  const key = normalized(question);

  if (!action) {
    const mode = readOnlyIntent(question);
    if (mode) {
      const facts = { gatewayInventory: inventoryFacts(mode, client, devices) };
      const total = facts.gatewayInventory.total;
      const answer = mode === 'manufacturers'
        ? `Encontré ${facts.gatewayInventory.rows.length} fabricante(s) entre ${total} cámara(s) en línea de ${clientName(client)}.`
        : mode === 'locations'
          ? `Encontré ${facts.gatewayInventory.rows.length} ubicación(es) con ${total} cámara(s) en línea de ${clientName(client)}.`
          : `${clientName(client)} tiene ${total} cámara(s) en línea visibles para el gateway.`;
      return response(answer, {
        facts,
        sources: source(client),
        context,
        suggestions: [
          `gateway fabricantes de cámaras en línea de ${clientName(client)}`,
          `gateway ubicaciones de cámaras de ${clientName(client)}`,
        ],
      });
    }
    return response(`Para ${clientName(client)} puedo consultar cámaras en línea, fabricantes y ubicaciones. Para una cámara específica también puedo probar autenticación, consultar capacidades ONVIF, pedir una captura, controlar zoom cuando esté soportado, volver a Home y solicitar un reinicio. Para una acción física escriba siempre “gateway”, el cliente y la IP o nombre de la cámara.`, {
      sources: source(client),
      context,
      suggestions: [`gateway lista cámaras en línea de ${clientName(client)}`],
    });
  }

  const deviceResolution = resolveExplicitDevice(question, devices);
  if (deviceResolution.status === 'missing') {
    return clarification(`Para ${actionLabel(action)} necesito la IP o el nombre de la cámara en el mismo mensaje, además del cliente.`, {
      context,
      resumeQuestion: question,
      suggestions: devices.filter(online).slice(0, 4).map((device) => `gateway qué puedo hacer con cámara ${clean(device.DireccionIP, 100) || displayName(device)} cliente ${clientName(client)}`),
    });
  }
  if (deviceResolution.status === 'ambiguous') {
    return clarification('Ese nombre coincide con varias cámaras. Use la IP para evitar actuar sobre el equipo equivocado.', {
      context,
      resumeQuestion: question,
      suggestions: deviceResolution.devices.map((device) => `gateway qué puedo hacer con cámara ${device.DireccionIP} cliente ${clientName(client)}`),
    });
  }
  const device = deviceResolution.device;

  if (action === 'CAMERA_REBOOT') {
    const pending = context.pendingGatewayAction;
    const expectedDeviceId = clean(device.DispositivoIntegracionID, 180);
    const confirmed = /\b(confirmar|confirmo|confirmado)\b/.test(key)
      && pending?.type === 'CAMERA_REBOOT'
      && pending?.deviceId === expectedDeviceId
      && pending?.clientId === clientId(client)
      && Number(pending?.expiresAt || 0) > Date.now();
    if (!confirmed) {
      const expiresAt = Date.now() + 2 * 60_000;
      const nextContext = {
        ...context,
        pendingGatewayAction: {
          type: 'CAMERA_REBOOT',
          deviceId: expectedDeviceId,
          clientId: clientId(client),
          expiresAt,
        },
      };
      return clarification(`Reiniciar ${cameraDescription(device)} interrumpirá el video temporalmente. Confirme explícitamente dentro de 2 minutos para enviar la orden.`, {
        context: nextContext,
        resumeQuestion: question,
        options: [{ type: 'gateway-confirm', value: confirmationQuestion(client, device), label: `Confirmar reinicio · ${device.DireccionIP || displayName(device)}` }],
      });
    }
  }

  return dispatchCameraAction(ctx, overview, client, device, action, context);
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function gatewayAwareAssistantChat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question, 1_500);
  if (!GATEWAY_WORD.test(question)) return baseChat(ctx);
  return handleGatewayQuestion(ctx);
};
