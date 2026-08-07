import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { executePhysicalCameraAction } from './camera-physical-actions.js';
import { CameraControlError } from './onvif-camera-control.js';

const MAX_SOAP_BYTES = 512 * 1024;
const ADVANCED_TYPES = new Set([
  'CAMERA_AUTOFOCUS',
  'CAMERA_PAN_LEFT',
  'CAMERA_PAN_RIGHT',
  'CAMERA_TILT_UP',
  'CAMERA_TILT_DOWN',
  'CAMERA_PTZ_STOP',
  'CAMERA_PRESETS_LIST',
  'CAMERA_PRESET_GOTO',
  'CAMERA_DAY_MODE',
  'CAMERA_NIGHT_MODE',
  'CAMERA_DAYNIGHT_AUTO',
  'CAMERA_IR_ON',
  'CAMERA_IR_OFF',
  'CAMERA_WIPER_ON',
  'CAMERA_WIPER_OFF',
  'CAMERA_RELAY_LIST',
  'CAMERA_RELAY_ON',
  'CAMERA_RELAY_OFF',
  'CAMERA_AUDIO_TEST',
  'CAMERA_HEALTH',
  'CAMERA_DIAGNOSTIC',
]);

function clean(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function commandPayload(command = {}) {
  return command.payload && typeof command.payload === 'object'
    ? command.payload
    : parseJson(command.PayloadJSON, {});
}

function localTag(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'i');
  return clean(String(xml || '').match(expression)?.[1] || '', 16000).replace(/<[^>]+>/g, '').trim();
}

function sections(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'gi');
  return [...String(xml || '').matchAll(expression)].map((match) => match[1] || '');
}

function firstToken(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}\\b[^>]*\\btoken=["']([^"']+)["']`, 'i');
  return clean(expression.exec(String(xml || ''))?.[1] || '', 500);
}

function allTokens(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}\\b[^>]*\\btoken=["']([^"']+)["']`, 'gi');
  return [...String(xml || '').matchAll(expression)].map((match) => clean(match[1], 500)).filter(Boolean);
}

function allTagValues(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'gi');
  return [...String(xml || '').matchAll(expression)]
    .map((match) => clean(match[1], 1000).replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
}

function hash(algorithm, value) {
  const normalized = /^sha-?256$/i.test(algorithm) ? 'sha256' : 'md5';
  return createHash(normalized).update(value).digest('hex');
}

function parseChallenge(header = '') {
  const raw = String(header || '').trim();
  const scheme = raw.match(/^([A-Za-z]+)\s*/)?.[1]?.toLowerCase();
  if (!scheme) return null;
  const params = {};
  raw.replace(/^\w+\s*/i, '').replace(/([A-Za-z0-9_-]+)=(?:"([^"]*)"|([^,\s]+))/g, (match, key, quoted, bare) => {
    params[key.toLowerCase()] = quoted ?? bare ?? '';
    return match;
  });
  return { scheme, params };
}

function digestAuthorization({ challenge, auth, method, url }) {
  const realm = challenge?.params?.realm || '';
  const nonce = challenge?.params?.nonce || '';
  if (!realm || !nonce) return '';
  const algorithm = challenge.params.algorithm || 'MD5';
  if (!/^(MD5|SHA-?256)$/i.test(algorithm)) return '';
  const qopValues = String(challenge.params.qop || '').split(',').map((value) => value.trim().toLowerCase());
  const qop = qopValues.includes('auth') ? 'auth' : '';
  const uri = `${url.pathname || '/'}${url.search || ''}`;
  const ha1 = hash(algorithm, `${auth.username}:${realm}:${auth.password || ''}`);
  const ha2 = hash(algorithm, `${method}:${uri}`);
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const response = qop
    ? hash(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${String(auth.username).replace(/"/g, '')}"`,
    `realm="${String(realm).replace(/"/g, '')}"`,
    `nonce="${String(nonce).replace(/"/g, '')}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.params.opaque) parts.push(`opaque="${String(challenge.params.opaque).replace(/"/g, '')}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

function authorization(challenge, auth, method, url) {
  if (!challenge || !auth?.username) return '';
  if (challenge.scheme === 'basic') {
    return `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`, 'utf8').toString('base64')}`;
  }
  if (challenge.scheme === 'digest') return digestAuthorization({ challenge, auth, method, url });
  return '';
}

function wsSecurityHeader(auth = {}) {
  if (!auth.username) return '';
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(String(auth.password || ''))]))
    .digest('base64');
  return `<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${escapeXml(auth.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
}

function soapEnvelope(body, auth) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tr2="http://www.onvif.org/ver20/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:timg="http://www.onvif.org/ver20/imaging/wsdl" xmlns:tmd="http://www.onvif.org/ver10/deviceIO/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">${wsSecurityHeader(auth)}<s:Body>${body}</s:Body></s:Envelope>`;
}

function sameCameraUrl(value, expectedIp) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.hostname.replace(/^\[|\]$/g, '') !== expectedIp) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isAuthRejected(response) {
  return [401, 403].includes(Number(response?.statusCode || 0))
    || /NotAuthorized|FailedAuthentication|InvalidSecurity|ter:NotAuthorized|wsse:FailedAuthentication/i.test(String(response?.body || ''));
}

async function rawRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 7000, maxBytes = MAX_SOAP_BYTES } = {}) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method,
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'DMS-Integration-Gateway/1.0', Connection: 'close', ...headers },
    }, (response) => {
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new CameraControlError('CAMERA_RESPONSE_TOO_LARGE', 'La cámara devolvió una respuesta demasiado grande.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        finish(null, {
          statusCode: Number(response.statusCode || 0),
          headers: response.headers,
          buffer,
          body: buffer.toString('utf8'),
        });
      });
    });
    request.once('timeout', () => request.destroy(new CameraControlError('CAMERA_TIMEOUT', 'La cámara no respondió dentro del tiempo permitido.')));
    request.once('error', (error) => finish(error instanceof CameraControlError
      ? error
      : new CameraControlError('CAMERA_CONNECTION_FAILED', error.message || 'No fue posible conectarse a la cámara.')));
    if (body) request.write(body);
    request.end();
  });
}

async function requestWithAuth(url, options, auth) {
  const first = await rawRequest(url, options);
  if (first.statusCode !== 401) return first;
  const challenge = parseChallenge(first.headers['www-authenticate']);
  const value = authorization(challenge, auth, options.method || 'GET', url);
  if (!value) return first;
  return rawRequest(url, { ...options, headers: { ...(options.headers || {}), Authorization: value } });
}

async function soapCall(url, action, bodyXml, auth, timeoutMs) {
  const body = soapEnvelope(bodyXml, auth);
  const response = await requestWithAuth(url, {
    method: 'POST',
    timeoutMs,
    maxBytes: MAX_SOAP_BYTES,
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
      SOAPAction: `"${action}"`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  }, auth);
  if (isAuthRejected(response)) {
    throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial asignada.', response.statusCode);
  }
  if (response.statusCode < 200 || response.statusCode >= 300 || /<[^>]*:?Fault\b/i.test(response.body)) {
    throw new CameraControlError(
      'CAMERA_ONVIF_ERROR',
      localTag(response.body, 'Text') || localTag(response.body, 'Reason') || `La cámara respondió ${response.statusCode || 'con un error ONVIF'}.`,
      response.statusCode,
    );
  }
  return response.body;
}

function deviceEndpoint(device = {}) {
  const ip = clean(device.ipAddress, 100);
  if (!ip) throw new CameraControlError('CAMERA_IP_REQUIRED', 'La cámara no tiene una IP utilizable.');
  const announced = sameCameraUrl(device.onvifEndpoint, ip);
  if (announced) return announced;
  const ports = new Set((device.openPorts || []).map(Number));
  return new URL(`${ports.has(443) ? 'https' : 'http'}://${ip}/onvif/device_service`);
}

function serviceDescriptors(xml, ip) {
  const result = { media: null, ptz: null, imaging: null, deviceIO: null };
  for (const service of sections(xml, 'Service')) {
    const namespace = localTag(service, 'Namespace');
    const url = sameCameraUrl(localTag(service, 'XAddr'), ip);
    if (!url) continue;
    if (/\/ver(?:10|20)\/media\/wsdl\/?$/i.test(namespace) && !result.media) result.media = url;
    if (/\/ver(?:10|20)\/ptz\/wsdl\/?$/i.test(namespace) && !result.ptz) result.ptz = url;
    if (/\/ver20\/imaging\/wsdl\/?$/i.test(namespace) && !result.imaging) result.imaging = url;
    if (/\/ver10\/deviceIO\/wsdl\/?$/i.test(namespace) && !result.deviceIO) result.deviceIO = url;
  }
  return result;
}

async function discoverServices(device, auth, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const endpoint = deviceEndpoint(device);
  const xml = await soapCall(
    endpoint,
    'http://www.onvif.org/ver10/device/wsdl/GetServices',
    '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>',
    auth,
    timeoutMs,
  );
  return { device: endpoint, ...serviceDescriptors(xml, ip) };
}

async function mediaProfile(mediaUrl, auth, timeoutMs) {
  if (!mediaUrl) return { profileToken: '', videoSourceToken: '', audioInput: false, audioEncoder: false, audioOutput: false };
  const xml = await soapCall(
    mediaUrl,
    'http://www.onvif.org/ver10/media/wsdl/GetProfiles',
    '<trt:GetProfiles/>',
    auth,
    timeoutMs,
  );
  const profile = sections(xml, 'Profiles')[0] || '';
  return {
    profileToken: firstToken(xml, 'Profiles'),
    videoSourceToken: localTag(profile, 'SourceToken'),
    audioInput: /<[^>]*:?AudioSourceConfiguration\b/i.test(profile),
    audioEncoder: /<[^>]*:?AudioEncoderConfiguration\b/i.test(profile),
    audioOutput: /<[^>]*:?AudioOutputConfiguration\b|<[^>]*:?AudioDecoderConfiguration\b/i.test(profile),
  };
}

async function ptzAuxiliaryCommands(ptzUrl, auth, timeoutMs) {
  if (!ptzUrl) return [];
  const xml = await soapCall(
    ptzUrl,
    'http://www.onvif.org/ver20/ptz/wsdl/GetNodes',
    '<tptz:GetNodes/>',
    auth,
    timeoutMs,
  );
  return [...new Set(allTagValues(xml, 'AuxiliaryCommands'))].slice(0, 50);
}

async function listPresets(ptzUrl, profileToken, auth, timeoutMs) {
  if (!ptzUrl || !profileToken) return [];
  const xml = await soapCall(
    ptzUrl,
    'http://www.onvif.org/ver20/ptz/wsdl/GetPresets',
    `<tptz:GetPresets><tptz:ProfileToken>${escapeXml(profileToken)}</tptz:ProfileToken></tptz:GetPresets>`,
    auth,
    timeoutMs,
  );
  const entries = [];
  const expression = /<[^>]*:?Preset\b[^>]*\btoken=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]*:?Preset>/gi;
  for (const match of String(xml || '').matchAll(expression)) {
    entries.push({ token: clean(match[1], 250), name: localTag(match[2], 'Name') || clean(match[1], 250) });
  }
  return entries.slice(0, 64);
}

async function ptzContinuousMove(context, x, y, timeoutMs) {
  if (!context.services.ptz || !context.profile.profileToken) {
    throw new CameraControlError('CAMERA_PTZ_UNSUPPORTED', 'La cámara no publica un servicio PTZ utilizable.');
  }
  await soapCall(
    context.services.ptz,
    'http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove',
    `<tptz:ContinuousMove><tptz:ProfileToken>${escapeXml(context.profile.profileToken)}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${x}" y="${y}"/></tptz:Velocity></tptz:ContinuousMove>`,
    context.auth,
    timeoutMs,
  );
  await sleep(350);
  await stopPtz(context, timeoutMs);
  return { moved: true, x, y, durationMs: 350, transport: 'ONVIF_PTZ' };
}

async function stopPtz(context, timeoutMs) {
  if (!context.services.ptz || !context.profile.profileToken) {
    throw new CameraControlError('CAMERA_PTZ_UNSUPPORTED', 'La cámara no publica un servicio PTZ utilizable.');
  }
  await soapCall(
    context.services.ptz,
    'http://www.onvif.org/ver20/ptz/wsdl/Stop',
    `<tptz:Stop><tptz:ProfileToken>${escapeXml(context.profile.profileToken)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`,
    context.auth,
    timeoutMs,
  );
  return { stopped: true, transport: 'ONVIF_PTZ' };
}

async function gotoPreset(context, requestedPreset, timeoutMs) {
  const presets = await listPresets(context.services.ptz, context.profile.profileToken, context.auth, timeoutMs);
  if (!presets.length) throw new CameraControlError('CAMERA_PRESETS_UNSUPPORTED', 'La cámara no devolvió presets PTZ disponibles.');
  const requested = clean(requestedPreset, 250);
  const index = Number(requested);
  const normalized = requested.toLowerCase();
  const preset = presets.find((item) => item.token.toLowerCase() === normalized || item.name.toLowerCase() === normalized)
    || (Number.isInteger(index) && index >= 1 ? presets[index - 1] : null);
  if (!preset) {
    throw new CameraControlError('CAMERA_PRESET_NOT_FOUND', `No se encontró el preset "${requested}". Consulte primero la lista de presets.`);
  }
  await soapCall(
    context.services.ptz,
    'http://www.onvif.org/ver20/ptz/wsdl/GotoPreset',
    `<tptz:GotoPreset><tptz:ProfileToken>${escapeXml(context.profile.profileToken)}</tptz:ProfileToken><tptz:PresetToken>${escapeXml(preset.token)}</tptz:PresetToken></tptz:GotoPreset>`,
    context.auth,
    timeoutMs,
  );
  return { preset, transport: 'ONVIF_PTZ' };
}

function isHanwhaPndA7082rv(device = {}) {
  return /^PND-A7082RV$/i.test(clean(device.model, 160));
}

async function vendorGet(device, auth, path, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const ports = new Set((device.openPorts || []).map(Number));
  const url = new URL(`${ports.has(80) ? 'http' : 'https'}://${ip}${path}`);
  const response = await requestWithAuth(url, { method: 'GET', timeoutMs, maxBytes: 256 * 1024 }, auth);
  if (isAuthRejected(response)) throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial asignada.', response.statusCode);
  if (response.statusCode < 200 || response.statusCode >= 300 || /^\s*(?:Error|NG)\b/im.test(response.body)) {
    throw new CameraControlError('CAMERA_VENDOR_ACTION_REJECTED', `La cámara respondió ${response.statusCode || 'con error'} al ejecutar la acción de fabricante.`, response.statusCode);
  }
  return response;
}

async function autofocus(context, timeoutMs) {
  if (isHanwhaPndA7082rv(context.device)) {
    await vendorGet(context.device, context.auth, '/stw-cgi/image.cgi?msubmenu=focus&action=control&Mode=SimpleFocus&Channel=0', timeoutMs);
    return { focused: true, transport: 'HANWHA_SUNAPI_SIMPLE_FOCUS' };
  }
  if (!context.services.imaging || !context.profile.videoSourceToken) {
    throw new CameraControlError('CAMERA_AUTOFOCUS_UNSUPPORTED', 'La cámara no publica Imaging/AutoFocus mediante ONVIF.');
  }
  await soapCall(
    context.services.imaging,
    'http://www.onvif.org/ver20/imaging/wsdl/SetImagingSettings',
    `<timg:SetImagingSettings><timg:VideoSourceToken>${escapeXml(context.profile.videoSourceToken)}</timg:VideoSourceToken><timg:ImagingSettings><tt:Focus><tt:AutoFocusMode>AUTO</tt:AutoFocusMode></tt:Focus></timg:ImagingSettings><timg:ForcePersistence>false</timg:ForcePersistence></timg:SetImagingSettings>`,
    context.auth,
    timeoutMs,
  );
  return { focused: true, transport: 'ONVIF_IMAGING_AUTOFOCUS' };
}

async function setDayNight(context, value, timeoutMs) {
  if (!context.services.imaging || !context.profile.videoSourceToken) {
    throw new CameraControlError('CAMERA_DAYNIGHT_UNSUPPORTED', 'La cámara no publica control Día/Noche mediante ONVIF Imaging.');
  }
  await soapCall(
    context.services.imaging,
    'http://www.onvif.org/ver20/imaging/wsdl/SetImagingSettings',
    `<timg:SetImagingSettings><timg:VideoSourceToken>${escapeXml(context.profile.videoSourceToken)}</timg:VideoSourceToken><timg:ImagingSettings><tt:IrCutFilter>${value}</tt:IrCutFilter></timg:ImagingSettings><timg:ForcePersistence>false</timg:ForcePersistence></timg:SetImagingSettings>`,
    context.auth,
    timeoutMs,
  );
  return {
    mode: value === 'ON' ? 'DAY' : value === 'OFF' ? 'NIGHT' : 'AUTO',
    irCutFilter: value,
    transport: 'ONVIF_IMAGING',
  };
}

function findAuxCommand(commands, feature, enabled) {
  const featurePattern = feature === 'wiper'
    ? /wiper|washer|clean/i
    : /(?:^|[^a-z])ir(?:[^a-z]|$)|infrared|illuminator|irlight|irlamp/i;
  const statePattern = enabled ? /(?:on|start|activate|enable|1)\b/i : /(?:off|stop|deactivate|disable|0)\b/i;
  return commands.find((value) => featurePattern.test(value) && statePattern.test(value)) || '';
}

async function sendAuxiliary(context, feature, enabled, timeoutMs) {
  if (!context.services.ptz || !context.profile.profileToken) {
    throw new CameraControlError('CAMERA_AUX_UNSUPPORTED', 'La cámara no publica comandos auxiliares PTZ utilizables.');
  }
  const commands = await ptzAuxiliaryCommands(context.services.ptz, context.auth, timeoutMs);
  const selected = findAuxCommand(commands, feature, enabled);
  if (!selected) {
    throw new CameraControlError(
      feature === 'wiper' ? 'CAMERA_WIPER_UNSUPPORTED' : 'CAMERA_IR_UNSUPPORTED',
      `La cámara no anuncia un comando auxiliar compatible para ${feature === 'wiper' ? 'limpiaparabrisas' : 'iluminador IR'}.`,
    );
  }
  await soapCall(
    context.services.ptz,
    'http://www.onvif.org/ver20/ptz/wsdl/SendAuxiliaryCommand',
    `<tptz:SendAuxiliaryCommand><tptz:ProfileToken>${escapeXml(context.profile.profileToken)}</tptz:ProfileToken><tptz:AuxiliaryData>${escapeXml(selected)}</tptz:AuxiliaryData></tptz:SendAuxiliaryCommand>`,
    context.auth,
    timeoutMs,
  );
  return { enabled, auxiliaryCommand: selected, transport: 'ONVIF_PTZ_AUXILIARY' };
}

async function relayOutputs(context, timeoutMs) {
  if (!context.services.deviceIO) return [];
  const xml = await soapCall(
    context.services.deviceIO,
    'http://www.onvif.org/ver10/deviceIO/wsdl/GetRelayOutputs',
    '<tmd:GetRelayOutputs/>',
    context.auth,
    timeoutMs,
  );
  return [...new Set(allTokens(xml, 'RelayOutputs'))].slice(0, 32).map((token, index) => ({ index: index + 1, token }));
}

async function setRelay(context, requested, enabled, timeoutMs) {
  const relays = await relayOutputs(context, timeoutMs);
  if (!relays.length) throw new CameraControlError('CAMERA_RELAY_UNSUPPORTED', 'La cámara no publica salidas de relé ONVIF.');
  const key = clean(requested, 250);
  const numeric = Number(key);
  const relay = relays.find((item) => item.token.toLowerCase() === key.toLowerCase())
    || (Number.isInteger(numeric) && numeric >= 1 ? relays[numeric - 1] : null);
  if (!relay) throw new CameraControlError('CAMERA_RELAY_NOT_FOUND', `No se encontró la salida de relé "${key}".`);
  await soapCall(
    context.services.deviceIO,
    'http://www.onvif.org/ver10/deviceIO/wsdl/SetRelayOutputState',
    `<tmd:SetRelayOutputState><tmd:RelayOutputToken>${escapeXml(relay.token)}</tmd:RelayOutputToken><tmd:LogicalState>${enabled ? 'active' : 'inactive'}</tmd:LogicalState></tmd:SetRelayOutputState>`,
    context.auth,
    timeoutMs,
  );
  return { relay, enabled, transport: 'ONVIF_DEVICE_IO' };
}

async function audioCapabilities(context, timeoutMs) {
  const profile = context.profile;
  let deviceInputs = [];
  let deviceOutputs = [];
  if (context.services.deviceIO) {
    const [inputs, outputs] = await Promise.allSettled([
      soapCall(context.services.deviceIO, 'http://www.onvif.org/ver10/deviceIO/wsdl/GetAudioSources', '<tmd:GetAudioSources/>', context.auth, timeoutMs),
      soapCall(context.services.deviceIO, 'http://www.onvif.org/ver10/deviceIO/wsdl/GetAudioOutputs', '<tmd:GetAudioOutputs/>', context.auth, timeoutMs),
    ]);
    if (inputs.status === 'fulfilled') deviceInputs = allTokens(inputs.value, 'Token').concat(allTokens(inputs.value, 'AudioSources'));
    if (outputs.status === 'fulfilled') deviceOutputs = allTokens(outputs.value, 'Token').concat(allTokens(outputs.value, 'AudioOutputs'));
  }
  const microphone = profile.audioInput || deviceInputs.length > 0;
  const speaker = profile.audioOutput || deviceOutputs.length > 0;
  return {
    microphone,
    audioEncoder: profile.audioEncoder,
    speaker,
    backchannelDetected: speaker,
    testToneAvailable: false,
    note: speaker
      ? 'Se detectó salida/backchannel de audio, pero el Gateway no inyecta audio arbitrario sin un adaptador de streaming específico.'
      : 'No se detectó salida/backchannel de audio en el perfil consultado.',
  };
}

async function videoEncoderInfo(context, timeoutMs) {
  if (!context.services.media) return {};
  try {
    const xml = await soapCall(
      context.services.media,
      'http://www.onvif.org/ver10/media/wsdl/GetVideoEncoderConfigurations',
      '<trt:GetVideoEncoderConfigurations/>',
      context.auth,
      timeoutMs,
    );
    const first = sections(xml, 'Configurations')[0] || '';
    return {
      encoding: localTag(first, 'Encoding'),
      width: Number(localTag(first, 'Width') || 0) || null,
      height: Number(localTag(first, 'Height') || 0) || null,
      frameRateLimit: Number(localTag(first, 'FrameRateLimit') || 0) || null,
      bitrateKbps: Number(localTag(first, 'BitrateLimit') || 0) || null,
    };
  } catch {
    return {};
  }
}

async function systemInfo(context, timeoutMs) {
  const result = { hostname: '', cameraTime: '', onvifReachable: false };
  const [hostname, clock] = await Promise.allSettled([
    soapCall(context.services.device, 'http://www.onvif.org/ver10/device/wsdl/GetHostname', '<tds:GetHostname/>', context.auth, timeoutMs),
    soapCall(context.services.device, 'http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime', '<tds:GetSystemDateAndTime/>', context.auth, timeoutMs),
  ]);
  if (hostname.status === 'fulfilled') {
    result.hostname = localTag(hostname.value, 'Name');
    result.onvifReachable = true;
  }
  if (clock.status === 'fulfilled') {
    const year = localTag(clock.value, 'Year');
    const month = localTag(clock.value, 'Month');
    const day = localTag(clock.value, 'Day');
    const hour = localTag(clock.value, 'Hour');
    const minute = localTag(clock.value, 'Minute');
    const second = localTag(clock.value, 'Second');
    if (year && month && day) result.cameraTime = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour || 0).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}:${String(second || 0).padStart(2, '0')}`;
    result.onvifReachable = true;
  }
  return result;
}

async function tcpProbe(ip, port, timeoutMs = 900) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ port, open, latencyMs: open ? Date.now() - startedAt : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function buildContext(command, timeoutMs) {
  const execution = command.execution || {};
  const device = execution.device || {};
  const auth = execution.authentication || {};
  const services = await discoverServices(device, auth, timeoutMs);
  const profile = await mediaProfile(services.media, auth, timeoutMs).catch((error) => {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    return { profileToken: '', videoSourceToken: '', audioInput: false, audioEncoder: false, audioOutput: false };
  });
  return { command, device, auth, services, profile };
}

async function advancedCapabilities(command, timeoutMs) {
  const basePromise = executePhysicalCameraAction(command, { timeoutMs });
  const contextPromise = buildContext(command, timeoutMs);
  const [baseSettled, contextSettled] = await Promise.allSettled([basePromise, contextPromise]);
  if (baseSettled.status === 'rejected' && baseSettled.reason?.code === 'CAMERA_AUTH_REJECTED') throw baseSettled.reason;
  if (contextSettled.status === 'rejected' && contextSettled.reason?.code === 'CAMERA_AUTH_REJECTED') throw contextSettled.reason;

  const base = baseSettled.status === 'fulfilled' ? baseSettled.value : { action: 'CAMERA_CAPABILITIES', capabilities: {} };
  const capabilities = { ...(base.capabilities || {}) };
  if (contextSettled.status === 'rejected') {
    return { ...base, capabilities: { ...capabilities, advancedDiscovery: false, diagnostics: true } };
  }
  const context = contextSettled.value;
  const [presetsSettled, auxSettled, relaysSettled, audioSettled] = await Promise.allSettled([
    listPresets(context.services.ptz, context.profile.profileToken, context.auth, timeoutMs),
    ptzAuxiliaryCommands(context.services.ptz, context.auth, timeoutMs),
    relayOutputs(context, timeoutMs),
    audioCapabilities(context, timeoutMs),
  ]);
  const presets = presetsSettled.status === 'fulfilled' ? presetsSettled.value : [];
  const aux = auxSettled.status === 'fulfilled' ? auxSettled.value : [];
  const relays = relaysSettled.status === 'fulfilled' ? relaysSettled.value : [];
  const audio = audioSettled.status === 'fulfilled' ? audioSettled.value : {};
  const wiper = Boolean(findAuxCommand(aux, 'wiper', true) || findAuxCommand(aux, 'wiper', false));
  const irControl = Boolean(findAuxCommand(aux, 'ir', true) || findAuxCommand(aux, 'ir', false));

  return {
    ...base,
    capabilities: {
      ...capabilities,
      advancedDiscovery: true,
      panTilt: Boolean(context.services.ptz && context.profile.profileToken),
      presets: presets.length > 0,
      presetCount: presets.length,
      autofocus: Boolean(isHanwhaPndA7082rv(context.device) || (context.services.imaging && context.profile.videoSourceToken)),
      dayNight: Boolean(context.services.imaging && context.profile.videoSourceToken),
      irControl,
      wiper,
      relayOutputs: relays.length,
      audioInput: Boolean(audio.microphone),
      audioOutput: Boolean(audio.speaker),
      audioTest: Boolean(audio.microphone || audio.speaker || audio.audioEncoder),
      diagnostics: true,
    },
  };
}

async function healthReport(command, timeoutMs) {
  const execution = command.execution || {};
  const device = execution.device || {};
  const ip = clean(device.ipAddress, 100);
  const ports = [...new Set((device.openPorts || []).map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))].slice(0, 8);
  const candidates = ports.length ? ports : [80, 443, 554];

  const [network, capabilitiesSettled, contextSettled] = await Promise.all([
    Promise.all(candidates.map((port) => tcpProbe(ip, port))),
    Promise.allSettled([advancedCapabilities({ ...command, type: 'CAMERA_CAPABILITIES', Tipo: 'CAMERA_CAPABILITIES' }, timeoutMs)]).then(([item]) => item),
    Promise.allSettled([buildContext(command, timeoutMs)]).then(([item]) => item),
  ]);

  if (capabilitiesSettled.status === 'rejected' && capabilitiesSettled.reason?.code === 'CAMERA_AUTH_REJECTED') throw capabilitiesSettled.reason;
  if (contextSettled.status === 'rejected' && contextSettled.reason?.code === 'CAMERA_AUTH_REJECTED') throw contextSettled.reason;

  const capabilities = capabilitiesSettled.status === 'fulfilled' ? capabilitiesSettled.value.capabilities || {} : {};
  let system = {};
  let video = {};
  let audio = {};
  let relays = [];
  let aux = [];
  if (contextSettled.status === 'fulfilled') {
    const context = contextSettled.value;
    const results = await Promise.allSettled([
      systemInfo(context, timeoutMs),
      videoEncoderInfo(context, timeoutMs),
      audioCapabilities(context, timeoutMs),
      relayOutputs(context, timeoutMs),
      ptzAuxiliaryCommands(context.services.ptz, context.auth, timeoutMs),
    ]);
    if (results[0].status === 'fulfilled') system = results[0].value;
    if (results[1].status === 'fulfilled') video = results[1].value;
    if (results[2].status === 'fulfilled') audio = results[2].value;
    if (results[3].status === 'fulfilled') relays = results[3].value;
    if (results[4].status === 'fulfilled') aux = results[4].value;
  }

  return {
    action: String(command.Tipo || command.type || '').toUpperCase(),
    camera: device,
    health: {
      checkedAt: new Date().toISOString(),
      ip,
      networkReachable: network.some((item) => item.open),
      ports: network,
      authentication: capabilitiesSettled.status === 'fulfilled' ? 'OK' : 'UNDETERMINED',
      onvif: Boolean(system.onvifReachable || capabilities.advancedDiscovery),
      snapshot: capabilities.snapshot ? 'OK' : capabilities.snapshotStatus === 'UNDETERMINED' ? 'UNDETERMINED' : 'NOT_DETECTED',
      snapshotTransport: capabilities.snapshotTransport || '',
      ptz: Boolean(capabilities.ptz || capabilities.panTilt),
      zoom: Boolean(capabilities.continuousZoom || capabilities.lensZoomControl),
      autofocus: Boolean(capabilities.autofocus),
      dayNight: Boolean(capabilities.dayNight),
      irControl: Boolean(capabilities.irControl),
      wiper: Boolean(capabilities.wiper),
      relayOutputs: relays,
      audio,
      auxiliaryCommands: aux.slice(0, 20),
      system,
      video,
      uptime: null,
      temperature: null,
      storage: null,
      notes: [
        'Uptime, temperatura y almacenamiento no son universales en ONVIF; solo se informarán cuando exista un adaptador seguro del fabricante.',
        'La prueba de audio valida entradas/salidas publicadas; no inyecta audio arbitrario en la cámara.',
      ],
    },
  };
}

export async function executeAdvancedCameraAction(command, { timeoutMs = 7000 } = {}) {
  const type = String(command?.Tipo || command?.type || '').toUpperCase();
  if (type === 'CAMERA_CAPABILITIES') return advancedCapabilities(command, timeoutMs);
  if (!ADVANCED_TYPES.has(type)) return executePhysicalCameraAction(command, { timeoutMs });

  if (type === 'CAMERA_HEALTH' || type === 'CAMERA_DIAGNOSTIC') return healthReport(command, timeoutMs);

  const context = await buildContext(command, timeoutMs);
  const payload = commandPayload(command);

  if (type === 'CAMERA_AUTOFOCUS') {
    return { action: type, camera: context.device, ...(await autofocus(context, timeoutMs)) };
  }
  if (type === 'CAMERA_PAN_LEFT') return { action: type, camera: context.device, ...(await ptzContinuousMove(context, -0.35, 0, timeoutMs)) };
  if (type === 'CAMERA_PAN_RIGHT') return { action: type, camera: context.device, ...(await ptzContinuousMove(context, 0.35, 0, timeoutMs)) };
  if (type === 'CAMERA_TILT_UP') return { action: type, camera: context.device, ...(await ptzContinuousMove(context, 0, 0.35, timeoutMs)) };
  if (type === 'CAMERA_TILT_DOWN') return { action: type, camera: context.device, ...(await ptzContinuousMove(context, 0, -0.35, timeoutMs)) };
  if (type === 'CAMERA_PTZ_STOP') return { action: type, camera: context.device, ...(await stopPtz(context, timeoutMs)) };
  if (type === 'CAMERA_PRESETS_LIST') {
    const presets = await listPresets(context.services.ptz, context.profile.profileToken, context.auth, timeoutMs);
    return { action: type, camera: context.device, presets };
  }
  if (type === 'CAMERA_PRESET_GOTO') {
    const preset = clean(payload.preset || payload.presetName || payload.presetToken, 250);
    if (!preset) throw new CameraControlError('CAMERA_PRESET_REQUIRED', 'Indique el nombre, número o token del preset PTZ.');
    return { action: type, camera: context.device, ...(await gotoPreset(context, preset, timeoutMs)) };
  }
  if (type === 'CAMERA_DAY_MODE') return { action: type, camera: context.device, ...(await setDayNight(context, 'ON', timeoutMs)) };
  if (type === 'CAMERA_NIGHT_MODE') return { action: type, camera: context.device, ...(await setDayNight(context, 'OFF', timeoutMs)) };
  if (type === 'CAMERA_DAYNIGHT_AUTO') return { action: type, camera: context.device, ...(await setDayNight(context, 'AUTO', timeoutMs)) };
  if (type === 'CAMERA_IR_ON') return { action: type, camera: context.device, ...(await sendAuxiliary(context, 'ir', true, timeoutMs)) };
  if (type === 'CAMERA_IR_OFF') return { action: type, camera: context.device, ...(await sendAuxiliary(context, 'ir', false, timeoutMs)) };
  if (type === 'CAMERA_WIPER_ON') return { action: type, camera: context.device, ...(await sendAuxiliary(context, 'wiper', true, timeoutMs)) };
  if (type === 'CAMERA_WIPER_OFF') return { action: type, camera: context.device, ...(await sendAuxiliary(context, 'wiper', false, timeoutMs)) };
  if (type === 'CAMERA_RELAY_LIST') {
    return { action: type, camera: context.device, relays: await relayOutputs(context, timeoutMs) };
  }
  if (type === 'CAMERA_RELAY_ON' || type === 'CAMERA_RELAY_OFF') {
    const relay = clean(payload.relay || payload.relayToken || payload.output, 250);
    if (!relay) throw new CameraControlError('CAMERA_RELAY_REQUIRED', 'Indique el número o token de la salida de relé.');
    return { action: type, camera: context.device, ...(await setRelay(context, relay, type === 'CAMERA_RELAY_ON', timeoutMs)) };
  }
  if (type === 'CAMERA_AUDIO_TEST') {
    return { action: type, camera: context.device, audio: await audioCapabilities(context, timeoutMs) };
  }

  return executePhysicalCameraAction(command, { timeoutMs });
}
