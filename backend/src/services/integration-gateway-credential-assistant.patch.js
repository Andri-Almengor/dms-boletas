import { forbidden } from '../core/errors.js';
import { readTable, updateRow } from '../infra/sheets.repository.js';
import { assistantDynamicMaintenanceQuestionHandlers } from '../modules/assistant-dynamic-maintenance-questions.module.js';
import { audit } from './audit.service.js';
import { integrationGatewayOverview } from './integration-gateway.service.js';

const baseChat = assistantDynamicMaintenanceQuestionHandlers.chat;
const GATEWAY_CREDENTIAL_QUERY = /\bgateway\b[\s\S]*\bcredencial(?:es)?\b|\bcredencial(?:es)?\b[\s\S]*\bgateway\b/i;
const ADMIN_PERMISSION = 'USUARIOS_GESTIONAR';

const CLIENT_ALIASES = Object.freeze({
  dms: ['digital management systems'],
  rn: ['registro nacional', 'junta administrativa del registro nacional'],
  asamblea: ['asamblea legislativa'],
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

function matchesClient(question, client) {
  const query = normalized(question);
  const full = normalized(clientName(client));
  if (full && query.includes(full)) return true;
  const withoutSuffix = full.replace(/\b(s a|sa|srl|sociedad anonima|limitada|ltda)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutSuffix.length >= 5 && query.includes(withoutSuffix)) return true;
  return Object.entries(CLIENT_ALIASES).some(([alias, names]) => (
    new RegExp(`(^| )${alias}( |$)`).test(query)
    && names.some((name) => full.includes(normalized(name)))
  ));
}

async function resolveClient(question) {
  const matches = (await readTable('Clientes')).filter(active).filter((row) => matchesClient(question, row));
  if (matches.length === 1) return matches[0];
  return null;
}

function displayName(device) {
  return clean(device.NombreOperativo || device.NombreDetectado, 250) || 'Cámara sin nombre';
}

function matchesCamera(question, device) {
  const query = normalized(question);
  const ip = clean(device.DireccionIP, 100).toLowerCase();
  if (ip && query.includes(ip)) return true;
  const operational = normalized(device.NombreOperativo);
  if (operational.length >= 3 && query.includes(operational)) return true;
  const detected = normalized(device.NombreDetectado);
  return detected.length >= 4 && query.includes(detected);
}

function matchesCredential(question, credential) {
  const query = normalized(question);
  const name = normalized(credential.Nombre);
  const username = normalized(credential.Usuario);
  if (name.length >= 3 && query.includes(name)) return true;
  return username.length >= 4 && query.includes(username);
}

function credentialLine(row, index) {
  const url = clean(row.URL, 500);
  return `${index + 1}. ${clean(row.Nombre, 250) || 'Credencial'} · usuario ${clean(row.Usuario, 250) || '—'}${url ? ` · ${url}` : ''}`;
}

assistantDynamicMaintenanceQuestionHandlers.chat = async function gatewayCredentialChat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question, 1_500);
  if (!GATEWAY_CREDENTIAL_QUERY.test(question)) return baseChat(ctx);

  const client = await resolveClient(question);
  if (!client) {
    const answer = 'Para consultar o asignar credenciales desde gateway indique explícitamente el nombre del cliente en el mismo mensaje.';
    return { type: 'clarification', answer, message: answer, facts: {}, sources: [], options: [], suggestions: [], context: ctx.payload?.context || {}, resumeQuestion: question };
  }

  const cid = clientId(client);
  const credentials = (await readTable('CredencialesClientes'))
    .filter((row) => active(row) && clean(row.ClienteID, 180) === cid)
    .sort((a, b) => clean(a.Nombre).localeCompare(clean(b.Nombre), 'es'));
  const assigning = /\b(asignar|asigna|usar|utilizar|vincular|vincula)\b/i.test(normalized(question));

  if (!assigning) {
    if (!credentials.length) {
      return {
        type: 'answer',
        answer: `${clientName(client)} no tiene credenciales activas disponibles en el gestor. Cree primero la credencial de la cámara; no se intentarán contraseñas por defecto.`,
        facts: {},
        sources: [{ type: 'credentials', id: cid, label: `Credenciales · ${clientName(client)}`, url: `/credenciales?clientId=${encodeURIComponent(cid)}` }],
        suggestions: [],
        context: ctx.payload?.context || {},
      };
    }
    const answer = [
      `Credenciales activas disponibles para cámaras de ${clientName(client)}:`,
      ...credentials.slice(0, 25).map(credentialLine),
      credentials.length > 25 ? `… y ${credentials.length - 25} más.` : '',
      'Esta lista no prueba ninguna contraseña. Para usar una, asígnela explícitamente a una cámara por IP o nombre.',
    ].filter(Boolean).join('\n');
    return {
      type: 'answer',
      answer,
      facts: { gatewayCredentialCatalog: { clientId: cid, clientName: clientName(client), total: credentials.length } },
      sources: [{ type: 'credentials', id: cid, label: `Credenciales · ${clientName(client)}`, url: `/credenciales?clientId=${encodeURIComponent(cid)}` }],
      suggestions: [],
      context: ctx.payload?.context || {},
    };
  }

  if (!(ctx.permissions || []).includes(ADMIN_PERMISSION)) {
    throw forbidden('Solo un administrador puede vincular una credencial a una cámara.');
  }

  const overview = await integrationGatewayOverview();
  const gatewayIds = new Set((overview.gateways || [])
    .filter((gateway) => active(gateway) && clean(gateway.ClienteID, 180) === cid)
    .map((gateway) => clean(gateway.GatewayID, 180)));
  const cameras = (overview.devices || []).filter((device) => (
    active(device)
    && String(device.Tipo || '').toUpperCase() === 'CAMERA'
    && gatewayIds.has(clean(device.GatewayID, 180))
    && matchesCamera(question, device)
  ));
  if (cameras.length !== 1) {
    const answer = cameras.length
      ? 'El nombre coincide con varias cámaras. Use la IP exacta para asignar la credencial al equipo correcto.'
      : 'No pude identificar una sola cámara. Incluya la IP o el nombre operativo de la cámara.';
    return { type: 'clarification', answer, message: answer, facts: {}, sources: [], options: [], suggestions: [], context: ctx.payload?.context || {}, resumeQuestion: question };
  }

  const matchedCredentials = credentials.filter((credential) => matchesCredential(question, credential));
  if (matchedCredentials.length !== 1) {
    const answer = matchedCredentials.length
      ? 'La referencia coincide con varias credenciales. Escriba el nombre completo de la credencial o su usuario.'
      : `No pude identificar una credencial única. Consulte primero “gateway credenciales de cámaras de ${clientName(client)}”.`;
    return { type: 'clarification', answer, message: answer, facts: {}, sources: [], options: [], suggestions: [], context: ctx.payload?.context || {}, resumeQuestion: question };
  }

  const camera = cameras[0];
  const credential = matchedCredentials[0];
  await updateRow('IntegracionDispositivos', camera.DispositivoIntegracionID, {
    CredencialCamaraID: credential.CredencialID,
    FechaActualizacion: new Date().toISOString(),
  });
  await audit(
    ctx,
    'ASIGNAR_CREDENCIAL_CAMARA_GATEWAY',
    'IntegracionDispositivos',
    camera.DispositivoIntegracionID,
    null,
    {
      ClienteID: cid,
      GatewayID: camera.GatewayID,
      CredencialAsignada: true,
    },
  );
  return {
    type: 'answer',
    answer: `Asigné “${clean(credential.Nombre, 250)}” a ${displayName(camera)} (${clean(camera.DireccionIP, 100)}). El gateway usará únicamente esta credencial; si la cámara la rechaza, no probará otras y activará el período de enfriamiento.`,
    facts: { gatewayCredentialAssignment: { deviceId: camera.DispositivoIntegracionID, camera: displayName(camera), ip: camera.DireccionIP, configured: true } },
    sources: [{ type: 'gateway', id: camera.GatewayID, label: `Gateway · ${clientName(client)}`, url: '/integraciones' }],
    suggestions: [`gateway probar autenticación cámara ${clean(camera.DireccionIP, 100)} cliente ${clientName(client)}`],
    context: ctx.payload?.context || {},
  };
};
