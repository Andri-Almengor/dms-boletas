import { forbidden } from '../core/errors.js';
import { readTable } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import { audit } from './audit.service.js';
import { integrationGatewayOverview } from './integration-gateway.service.js';
import { updateIntegrationDeviceOperationalName } from './integration-device-admin.service.js';

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

const PORT_LABELS = Object.freeze({
  80: 'HTTP',
  443: 'HTTPS',
  554: 'RTSP',
  3702: 'ONVIF/WS-Discovery',
  8000: 'SDK',
  37777: 'SDK',
});

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalized(value) {
  return clean(value, 3_000)
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

function deviceReferenceScore(question, device) {
  const query = normalized(question);
  const ip = clean(device.DireccionIP, 100).toLowerCase();
  if (ip && query.includes(ip)) return 4;
  const operational = normalized(device.NombreOperativo);
  if (operational && operational.length >= 3 && query.includes(operational)) return 3;
  const detected = normalized(device.NombreDetectado);
  if (detected && detected.length >= 4 && query.includes(detected)) return 2;
  const model = normalized(device.Modelo);
  if (model && model.length >= 4 && query.includes(model)) return 1;
  return 0;
}

function resolveDevice(question, devices) {
  const ranked = devices
    .map((device) => ({ device, score: deviceReferenceScore(question, device) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: 'missing' };
  const score = ranked[0].score;
  const matches = ranked.filter((item) => item.score === score).map((item) => item.device);
  if (matches.length !== 1) return { status: 'ambiguous', devices: matches.slice(0, 10) };
  return { status: 'resolved', device: matches[0] };
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function openPorts(device) {
  const metadata = parseJson(device.MetadataJSON);
  const ports = Array.isArray(metadata.openPorts) ? metadata.openPorts : [];
  return [...new Set(ports.map(Number).filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535))]
    .sort((a, b) => a - b);
}

function formatPorts(device) {
  const ports = openPorts(device);
  return ports.length
    ? ports.map((port) => `${port}${PORT_LABELS[port] ? `/${PORT_LABELS[port]}` : ''}`).join(', ')
    : '—';
}

function statusLabel(device) {
  return online(device) ? 'ONLINE' : 'OFFLINE';
}

function networkRow(device) {
  return {
    name: displayName(device),
    ip: clean(device.DireccionIP, 100) || '—',
    status: statusLabel(device),
    ports: formatPorts(device),
    manufacturer: clean(device.Fabricante, 160) || '—',
    model: clean(device.Modelo, 160) || '—',
    location: clean(device.UbicacionEquipo || device.UbicacionCliente, 250) || '—',
    lastSeen: clean(device.UltimaConexion, 100) || '—',
  };
}

function markdownCell(value, maxLength = 70) {
  return clean(value, maxLength).replace(/\|/g, '/').replace(/\s+/g, ' ');
}

function networkTable(rows = []) {
  const header = '| Cámara | IP | Estado | Puertos detectados | Marca / Modelo | Ubicación |';
  const separator = '|---|---|---|---|---|---|';
  const body = rows.slice(0, 80).map((row) => `| ${markdownCell(row.name, 42)} | ${markdownCell(row.ip, 24)} | ${row.status} | ${markdownCell(row.ports, 48)} | ${markdownCell(`${row.manufacturer} ${row.model}`, 48)} | ${markdownCell(row.location, 42)} |`);
  return [header, separator, ...body].join('\n');
}

function response(answer, { facts = {}, suggestions = [], context = {}, sensitive = false } = {}) {
  return { type: 'answer', answer, facts, suggestions, sources: [], context, sensitive };
}

function clarification(answer, { suggestions = [], context = {}, options = [] } = {}) {
  return { type: 'clarification', answer, message: answer, facts: {}, sources: [], suggestions, context, options };
}

function isRenameIntent(question) {
  const key = normalized(question);
  return /\b(renombra|renombrar|renombrala|nombre|llamala|llamarla|ponle|ponele|cambiale|cambiarle)\b/.test(key)
    && /\b(camara|ip|nombre)\b/.test(key);
}

function trimNameCandidate(value, client) {
  let result = clean(value, 250)
    .replace(/^[\s:=-]+|[\s.,;:-]+$/g, '')
    .replace(/^(?:como|a|por)\s+/i, '')
    .trim();
  const name = clientName(client);
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\s+cliente\\s+${escaped}\\s*$`, 'i'), '').trim();
  }
  result = result.replace(/\s+cliente\s+.+$/i, '').trim();
  return clean(result, 250);
}

function extractRequestedName(question, client) {
  const quoted = [...String(question).matchAll(/[“"']([^”"']{2,250})[”"']/g)]
    .map((match) => trimNameCandidate(match[1], client))
    .filter((value) => value && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value));
  if (quoted.length) return quoted[quoted.length - 1];

  const patterns = [
    /\b(?:ponle|ponele|p[oó]ngale)\s+(?:el\s+nombre\s+)?(.+?)(?=\s+cliente\b|$)/i,
    /\b(?:ll[aá]mala|llamarla|ren[oó]mbrala|renombrar)\s+(?:como\s+)?(.+?)(?=\s+cliente\b|$)/i,
    /\bc[aá]mbia(?:le|rle)?\s+(?:el\s+)?nombre(?:\s+de\s+.+?)?\s+(?:a|por)\s+(.+?)(?=\s+cliente\b|$)/i,
    /\bponle\s+el\s+nombre\s+(.+?)\s+a\s+(?:la\s+)?(?:ip|c[aá]mara)\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(question).match(pattern);
    if (!match?.[1]) continue;
    let candidate = trimNameCandidate(match[1], client);
    candidate = candidate.replace(/\s+(?:a|de)\s+(?:la\s+)?(?:ip|c[aá]mara)\s+\d{1,3}(?:\.\d{1,3}){3}.*$/i, '').trim();
    if (candidate && candidate.length >= 2) return candidate;
  }
  return '';
}

function networkIntent(question) {
  const key = normalized(question);
  const ports = /\b(puerto|puertos|comunicacion|servicio|servicios|rtsp|http|https)\b/.test(key);
  const ips = /\b(ip|ips|direccion ip|direcciones ip)\b/.test(key);
  const status = /\b(estado|online|offline|en linea|fuera de linea|caida|caidas|desconectada|desconectadas|viva|vivas|arriba)\b/.test(key);
  const table = /\b(tabla|listado|lista|inventario|todas|todos)\b/.test(key);
  if (ports || ips || status) return { ports, ips, status, table };
  return null;
}

function desiredStatus(question) {
  const key = normalized(question);
  if (/\b(offline|fuera de linea|caida|caidas|desconectada|desconectadas|abajo)\b/.test(key)) return 'OFFLINE';
  if (/\b(online|en linea|viva|vivas|arriba|conectada|conectadas)\b/.test(key)) return 'ONLINE';
  return '';
}

function canonicalizePhysicalLanguage(question) {
  const key = normalized(question);
  const additions = [];
  if (/\b(acercamela|acercala|acercamiento|mas cerca|hazla mas cerca|aproxima)\b/.test(key) && !/zoom/.test(key)) additions.push('acercar zoom');
  if (/\b(alejamela|alejala|mas lejos|abre la vista|vista mas amplia|hazla mas amplia)\b/.test(key) && !/zoom/.test(key)) additions.push('alejar zoom');
  if (/\b(dejala normal|dejala como estaba|vista normal|restaura la vista|vuelve a normal)\b/.test(key)) additions.push('volver zoom a normal');
  if (/\b(reiniciala|reinicialo|reinicia la camara|reinicia esa camara)\b/.test(key)) additions.push('reiniciar');
  if (/\b(que esta viendo|muestrame lo que ve|quiero ver lo que ve|sacame una foto|toma una foto)\b/.test(key)) additions.push('captura imagen');
  return additions.length ? `${question} ${additions.join(' ')}` : question;
}

async function handleRename(ctx, question, client, devices) {
  if (!isAdmin(ctx)) throw forbidden('Cambiar el nombre operativo de una cámara desde el Gateway requiere permisos administrativos.');
  const resolved = resolveDevice(question, devices);
  if (resolved.status === 'missing') {
    return clarification('Indique la IP o el nombre actual de la cámara que quiere renombrar.', {
      suggestions: devices.slice(0, 4).map((device) => `gateway ponle "Nuevo nombre" a la cámara ${device.DireccionIP} cliente ${clientName(client)}`),
    });
  }
  if (resolved.status === 'ambiguous') {
    return clarification('Ese nombre coincide con varias cámaras. Use la IP para cambiar el nombre de forma segura.');
  }
  const newName = extractRequestedName(question, client);
  if (!newName) {
    return clarification(`¿Qué nombre quiere ponerle a ${displayName(resolved.device)} (${resolved.device.DireccionIP})? Use, por ejemplo: gateway ponle "Entrada principal" a la cámara ${resolved.device.DireccionIP} cliente ${clientName(client)}.`);
  }
  if (newName.length < 2) return clarification('El nuevo nombre debe tener al menos 2 caracteres.');
  const before = displayName(resolved.device);
  const updated = await updateIntegrationDeviceOperationalName({
    deviceId: resolved.device.DispositivoIntegracionID,
    name: newName,
    actor: ctx.user?.UsuarioID || 'ASSISTANT',
  });
  await audit(ctx, 'ASISTENTE_RENOMBRAR_CAMARA_GATEWAY', 'IntegracionDispositivos', resolved.device.DispositivoIntegracionID, {
    NombreOperativo: resolved.device.NombreOperativo || '',
  }, {
    NombreOperativo: newName,
    ClienteID: clientId(client),
    DireccionIP: resolved.device.DireccionIP,
  });
  return response(`Listo. Cambié el nombre operativo de ${before} (${resolved.device.DireccionIP}) a “${updated.displayName || newName}”. La detección automática seguirá conservando este nombre manual.`, {
    facts: {
      gatewayDeviceUpdate: {
        deviceId: resolved.device.DispositivoIntegracionID,
        ip: resolved.device.DireccionIP,
        previousName: before,
        name: updated.displayName || newName,
      },
    },
    suggestions: [
      `gateway estado de ${resolved.device.DireccionIP} cliente ${clientName(client)}`,
      `gateway qué puertos tiene ${resolved.device.DireccionIP} cliente ${clientName(client)}`,
    ],
  });
}

async function handleNetworkQuery(question, client, devices) {
  const intent = networkIntent(question);
  if (!intent) return null;
  const specific = resolveDevice(question, devices);
  let selected = devices;
  if (specific.status === 'resolved') selected = [specific.device];
  else if (specific.status === 'ambiguous') {
    return clarification('Ese nombre coincide con varias cámaras. Use la IP para consultar el equipo correcto.');
  }

  const wanted = desiredStatus(question);
  if (specific.status !== 'resolved' && wanted) {
    selected = selected.filter((device) => statusLabel(device) === wanted);
  }
  const rows = selected.map(networkRow)
    .sort((a, b) => a.ip.localeCompare(b.ip, 'es', { numeric: true }));

  if (!rows.length) {
    return response(`No encontré cámaras ${wanted || ''} que coincidan con la consulta para ${clientName(client)}.`.replace(/\s+/g, ' '));
  }

  const title = specific.status === 'resolved'
    ? `Información de red de ${rows[0].name}`
    : wanted
      ? `Cámaras ${wanted} de ${clientName(client)}`
      : `Cámaras y comunicación de red de ${clientName(client)}`;
  const answer = `${title}\n\n${networkTable(rows)}${rows.length > 80 ? `\n\nMostrando 80 de ${rows.length} cámaras.` : ''}`;
  return response(answer, {
    facts: {
      gatewayNetworkTable: {
        clientId: clientId(client),
        clientName: clientName(client),
        rows,
      },
    },
    suggestions: specific.status === 'resolved'
      ? [
        `gateway qué puedo hacer físicamente con ${rows[0].ip} cliente ${clientName(client)}`,
        `gateway dame una captura de ${rows[0].ip} cliente ${clientName(client)}`,
      ]
      : [
        `gateway cámaras offline de ${clientName(client)}`,
        `gateway lista de ips y puertos de ${clientName(client)}`,
      ],
  });
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function naturalGatewayAssistantChat(ctx) {
  const originalQuestion = clean(ctx.payload?.message || ctx.payload?.question, 1_500);
  if (!GATEWAY_WORD.test(originalQuestion)) return baseChat(ctx);
  if (!hasReadPermission(ctx)) throw forbidden('No cuenta con permiso para consultar el inventario del Gateway.');

  const clientResolution = await resolveClient(originalQuestion);
  if (clientResolution.status !== 'resolved') {
    // El asistente gateway existente conserva sus aclaraciones y aliases.
    return baseChat(ctx);
  }

  const client = clientResolution.client;
  const overview = await integrationGatewayOverview();
  const devices = gatewayDevices(overview, client);

  if (isRenameIntent(originalQuestion)) {
    return handleRename(ctx, originalQuestion, client, devices);
  }

  const networkAnswer = await handleNetworkQuery(originalQuestion, client, devices);
  if (networkAnswer) return networkAnswer;

  const canonicalQuestion = canonicalizePhysicalLanguage(originalQuestion);
  if (canonicalQuestion === originalQuestion) return baseChat(ctx);
  return baseChat({
    ...ctx,
    payload: {
      ...(ctx.payload || {}),
      message: canonicalQuestion,
      question: canonicalQuestion,
    },
  });
};
