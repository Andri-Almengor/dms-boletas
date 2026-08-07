import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function clean(value, maxLength = 1_000) {
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

function localTag(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  return clean(xml.match(expression)?.[1] || '', 16_000).replace(/<[^>]+>/g, '').trim();
}

function section(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  return expression.exec(String(xml || ''))?.[1] || '';
}

function firstToken(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}\\b[^>]*\\btoken=["']([^"']+)["']`, 'i');
  return clean(expression.exec(String(xml || ''))?.[1] || '', 500);
}

function sameCameraUrl(value, expectedIp) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host !== expectedIp) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function hash(algorithm, value) {
  const normalized = /^sha-?256$/i.test(algorithm) ? 'sha256' : 'md5';
  return createHash(normalized).update(value).digest('hex');
}

function parseChallenge(header = '') {
  const raw = String(header || '').trim();
  if (!raw) return null;
  const scheme = raw.match(/^([A-Za-z]+)\s*/)?.[1]?.toLowerCase();
  if (!scheme) return null;
  const params = {};
  raw.replace(/^\w+\s*/i, '').replace(/([A-Za-z0-9_-]+)=(?:"([^"]*)"|([^,\s]+))/g, (_match, key, quoted, bare) => {
    params[key.toLowerCase()] = quoted ?? bare ?? '';
    return _match;
  });
  return { scheme, params };
}

function digestAuthorization({ challenge, username, password, method, url }) {
  const realm = challenge.params.realm || '';
  const nonce = challenge.params.nonce || '';
  if (!realm || !nonce) return '';
  const algorithm = challenge.params.algorithm || 'MD5';
  if (!/^(MD5|SHA-?256)$/i.test(algorithm)) return '';
  const qopValues = String(challenge.params.qop || '').split(',').map((value) => value.trim().toLowerCase());
  const qop = qopValues.includes('auth') ? 'auth' : '';
  const uri = `${url.pathname || '/'}${url.search || ''}`;
  const ha1 = hash(algorithm, `${username}:${realm}:${password}`);
  const ha2 = hash(algorithm, `${method}:${uri}`);
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const response = qop
    ? hash(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${String(username).replace(/"/g, '')}"`,
    `realm="${String(realm).replace(/"/g, '')}"`,
    `nonce="${String(nonce).replace(/"/g, '')}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.params.opaque) parts.push(`opaque="${challenge.params.opaque.replace(/"/g, '')}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

function authorizationForChallenge(challenge, auth, method, url) {
  if (!challenge || !auth?.username) return '';
  if (challenge.scheme === 'basic') {
    return `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`, 'utf8').toString('base64')}`;
  }
  if (challenge.scheme === 'digest') {
    return digestAuthorization({ challenge, username: auth.username, password: auth.password || '', method, url });
  }
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
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">${wsSecurityHeader(auth)}<s:Body>${body}</s:Body></s:Envelope>`;
}

function isAuthRejected(response) {
  return [401, 403].includes(Number(response?.statusCode || 0))
    || /NotAuthorized|FailedAuthentication|InvalidSecurity|ter:NotAuthorized|wsse:FailedAuthentication/i.test(String(response?.body || ''));
}

export class CameraControlError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'CameraControlError';
    this.code = code;
    this.status = status;
  }
}

async function rawRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    let bytes = 0;
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
      headers: {
        'User-Agent': 'DMS-Integration-Gateway/0.7',
        Connection: 'close',
        ...headers,
      },
    }, (response) => {
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new CameraControlError('CAMERA_RESPONSE_TOO_LARGE', 'La cámara devolvió una respuesta demasiado grande.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        statusCode: Number(response.statusCode || 0),
        headers: response.headers,
        buffer: Buffer.concat(chunks),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('timeout', () => request.destroy(new CameraControlError('CAMERA_TIMEOUT', 'La cámara no respondió dentro del tiempo permitido.')));
    request.once('error', (error) => finish(error instanceof CameraControlError ? error : new CameraControlError('CAMERA_CONNECTION_FAILED', error.message || 'No fue posible conectarse a la cámara.')));
    if (body) request.write(body);
    request.end();
  });
}

async function requestWithHttpAuthentication(url, options, auth) {
  const first = await rawRequest(url, options);
  if (first.statusCode !== 401) return first;
  const challenge = parseChallenge(first.headers['www-authenticate']);
  const authorization = authorizationForChallenge(challenge, auth, options.method || 'GET', url);
  if (!authorization) return first;
  // Este es el único segundo intento: responde al challenge HTTP con la MISMA
  // credencial asignada. Nunca se prueban credenciales alternativas.
  return rawRequest(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: authorization },
  });
}

async function soapCall(url, action, bodyXml, auth, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const body = soapEnvelope(bodyXml, auth);
  const response = await requestWithHttpAuthentication(url, {
    method: 'POST',
    timeoutMs,
    maxBytes: 512 * 1024,
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
    const reason = localTag(response.body, 'Text') || localTag(response.body, 'Reason');
    throw new CameraControlError('CAMERA_ONVIF_ERROR', reason || `La cámara respondió ${response.statusCode || 'con un error ONVIF'}.`, response.statusCode);
  }
  return response.body;
}

function resolveDeviceEndpoint(device) {
  const ip = clean(device?.ipAddress, 100);
  if (!ip) throw new CameraControlError('CAMERA_IP_REQUIRED', 'La cámara no tiene una IP válida.');
  const announced = sameCameraUrl(device?.onvifEndpoint, ip);
  if (announced) return announced;
  const ports = new Set((device?.openPorts || []).map(Number));
  if (ports.has(443)) return new URL(`https://${ip}/onvif/device_service`);
  return new URL(`http://${ip}/onvif/device_service`);
}

async function serviceEndpoints(device, auth, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const deviceUrl = resolveDeviceEndpoint(device);
  const xml = await soapCall(
    deviceUrl,
    'http://www.onvif.org/ver10/device/wsdl/GetCapabilities',
    '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>',
    auth,
    timeoutMs,
  );
  const mediaUrl = sameCameraUrl(localTag(section(xml, 'Media'), 'XAddr'), ip);
  const ptzUrl = sameCameraUrl(localTag(section(xml, 'PTZ'), 'XAddr'), ip);
  return { deviceUrl, mediaUrl, ptzUrl };
}

async function mediaProfile(mediaUrl, auth, timeoutMs) {
  if (!mediaUrl) return null;
  const profilesXml = await soapCall(
    mediaUrl,
    'http://www.onvif.org/ver10/media/wsdl/GetProfiles',
    '<trt:GetProfiles/>',
    auth,
    timeoutMs,
  );
  const profileToken = firstToken(profilesXml, 'Profiles');
  if (!profileToken) return null;
  const profileSection = section(profilesXml, 'Profiles');
  return {
    profileToken,
    ptzConfigurationToken: firstToken(profileSection, 'PTZConfiguration'),
  };
}

async function snapshotUri(mediaUrl, profileToken, deviceIp, auth, timeoutMs) {
  if (!mediaUrl || !profileToken) return null;
  const xml = await soapCall(
    mediaUrl,
    'http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri',
    `<trt:GetSnapshotUri><trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken></trt:GetSnapshotUri>`,
    auth,
    timeoutMs,
  );
  return sameCameraUrl(localTag(xml, 'Uri'), deviceIp);
}

async function ptzCapabilities(ptzUrl, auth, timeoutMs) {
  if (!ptzUrl) return { ptz: false, continuousZoom: false, homePosition: false };
  try {
    const xml = await soapCall(
      ptzUrl,
      'http://www.onvif.org/ver20/ptz/wsdl/GetNodes',
      '<tptz:GetNodes/>',
      auth,
      timeoutMs,
    );
    return {
      ptz: true,
      continuousZoom: /ContinuousZoomVelocitySpace/i.test(xml),
      homePosition: /HomeSupported\s*=\s*["'](?:true|1)["']/i.test(xml) || /<[^>]*:?HomeSupported>\s*(?:true|1)\s*</i.test(xml),
    };
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    return { ptz: true, continuousZoom: false, homePosition: false };
  }
}

async function getCapabilities(device, auth, timeoutMs) {
  const endpoints = await serviceEndpoints(device, auth, timeoutMs);
  const profile = await mediaProfile(endpoints.mediaUrl, auth, timeoutMs);
  let snapshotSupported = false;
  if (profile?.profileToken && endpoints.mediaUrl) {
    try {
      snapshotSupported = Boolean(await snapshotUri(endpoints.mediaUrl, profile.profileToken, device.ipAddress, auth, timeoutMs));
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    }
  }
  const ptz = await ptzCapabilities(endpoints.ptzUrl, auth, timeoutMs);
  return {
    endpoints,
    profile,
    capabilities: {
      authentication: true,
      snapshot: snapshotSupported,
      ptz: ptz.ptz,
      continuousZoom: ptz.continuousZoom,
      homePosition: ptz.homePosition,
      reboot: true,
    },
  };
}

async function getSnapshot(device, auth, timeoutMs) {
  const resolved = await getCapabilities(device, auth, timeoutMs);
  if (!resolved.capabilities.snapshot || !resolved.endpoints.mediaUrl || !resolved.profile?.profileToken) {
    throw new CameraControlError('CAMERA_SNAPSHOT_UNSUPPORTED', 'La cámara no expone una captura ONVIF utilizable con este perfil.');
  }
  const uri = await snapshotUri(resolved.endpoints.mediaUrl, resolved.profile.profileToken, device.ipAddress, auth, timeoutMs);
  if (!uri) throw new CameraControlError('CAMERA_SNAPSHOT_URI_REJECTED', 'La cámara devolvió una URL de captura fuera de su propia IP.');
  const response = await requestWithHttpAuthentication(uri, {
    method: 'GET',
    timeoutMs,
    maxBytes: 3 * 1024 * 1024,
    headers: { Accept: 'image/jpeg,image/png;q=0.8,*/*;q=0.1' },
  }, auth);
  if (isAuthRejected(response)) throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial al solicitar la captura.', response.statusCode);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CameraControlError('CAMERA_SNAPSHOT_FAILED', `La cámara respondió ${response.statusCode} al solicitar la captura.`, response.statusCode);
  }
  const contentType = clean(String(response.headers['content-type'] || '').split(';')[0], 80).toLowerCase();
  const mimeType = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  return {
    mimeType,
    bytes: response.buffer.length,
    dataBase64: response.buffer.toString('base64'),
    capturedAt: new Date().toISOString(),
  };
}

async function zoom(device, auth, direction, timeoutMs) {
  const resolved = await getCapabilities(device, auth, timeoutMs);
  if (!resolved.capabilities.continuousZoom || !resolved.endpoints.ptzUrl || !resolved.profile?.profileToken) {
    throw new CameraControlError('CAMERA_ZOOM_UNSUPPORTED', 'La cámara no informa soporte para zoom continuo mediante ONVIF.');
  }
  const velocity = direction === 'in' ? 0.5 : -0.5;
  await soapCall(
    resolved.endpoints.ptzUrl,
    'http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove',
    `<tptz:ContinuousMove><tptz:ProfileToken>${escapeXml(resolved.profile.profileToken)}</tptz:ProfileToken><tptz:Velocity><tt:Zoom x="${velocity}"/></tptz:Velocity><tptz:Timeout>PT1S</tptz:Timeout></tptz:ContinuousMove>`,
    auth,
    timeoutMs,
  );
  return { moved: true, direction, velocity, duration: 'PT1S' };
}

async function stopZoom(device, auth, timeoutMs) {
  const resolved = await getCapabilities(device, auth, timeoutMs);
  if (!resolved.endpoints.ptzUrl || !resolved.profile?.profileToken) {
    throw new CameraControlError('CAMERA_PTZ_UNSUPPORTED', 'La cámara no expone servicio PTZ mediante ONVIF.');
  }
  await soapCall(
    resolved.endpoints.ptzUrl,
    'http://www.onvif.org/ver20/ptz/wsdl/Stop',
    `<tptz:Stop><tptz:ProfileToken>${escapeXml(resolved.profile.profileToken)}</tptz:ProfileToken><tptz:PanTilt>false</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`,
    auth,
    timeoutMs,
  );
  return { stopped: true };
}

async function gotoHome(device, auth, timeoutMs) {
  const resolved = await getCapabilities(device, auth, timeoutMs);
  if (!resolved.capabilities.homePosition || !resolved.endpoints.ptzUrl || !resolved.profile?.profileToken) {
    throw new CameraControlError('CAMERA_HOME_UNSUPPORTED', 'La cámara no informa una posición Home segura para restaurar el PTZ/zoom.');
  }
  await soapCall(
    resolved.endpoints.ptzUrl,
    'http://www.onvif.org/ver20/ptz/wsdl/GotoHomePosition',
    `<tptz:GotoHomePosition><tptz:ProfileToken>${escapeXml(resolved.profile.profileToken)}</tptz:ProfileToken></tptz:GotoHomePosition>`,
    auth,
    timeoutMs,
  );
  return { homeRequested: true };
}

async function reboot(device, auth, timeoutMs) {
  const deviceUrl = resolveDeviceEndpoint(device);
  const xml = await soapCall(
    deviceUrl,
    'http://www.onvif.org/ver10/device/wsdl/SystemReboot',
    '<tds:SystemReboot/>',
    auth,
    timeoutMs,
  );
  return { rebootRequested: true, message: localTag(xml, 'Message') || 'Reinicio aceptado por la cámara.' };
}

async function authTest(device, auth, timeoutMs) {
  const deviceUrl = resolveDeviceEndpoint(device);
  const xml = await soapCall(
    deviceUrl,
    'http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation',
    '<tds:GetDeviceInformation/>',
    auth,
    timeoutMs,
  );
  return {
    authenticated: true,
    manufacturer: localTag(xml, 'Manufacturer'),
    model: localTag(xml, 'Model'),
    firmwareVersion: localTag(xml, 'FirmwareVersion'),
    serialNumber: localTag(xml, 'SerialNumber'),
  };
}

export async function executeOnvifCameraAction(command, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const type = String(command?.Tipo || command?.type || '').toUpperCase();
  const execution = command?.execution || {};
  const device = execution.device || {};
  const auth = execution.authentication || {};
  if (!device.ipAddress || !auth.username || auth.password === undefined) {
    const serverError = command?.executionError;
    throw new CameraControlError(
      serverError?.code || 'CAMERA_EXECUTION_CONTEXT_MISSING',
      serverError?.message || 'El gateway no recibió una cámara y credencial válidas para ejecutar la acción.',
    );
  }

  if (type === 'CAMERA_AUTH_TEST') return { action: type, camera: device, ...(await authTest(device, auth, timeoutMs)) };
  if (type === 'CAMERA_CAPABILITIES') {
    const result = await getCapabilities(device, auth, timeoutMs);
    return { action: type, camera: device, capabilities: result.capabilities };
  }
  if (type === 'CAMERA_SNAPSHOT') return { action: type, camera: device, snapshot: await getSnapshot(device, auth, timeoutMs) };
  if (type === 'CAMERA_ZOOM_IN') return { action: type, camera: device, ...(await zoom(device, auth, 'in', timeoutMs)) };
  if (type === 'CAMERA_ZOOM_OUT') return { action: type, camera: device, ...(await zoom(device, auth, 'out', timeoutMs)) };
  if (type === 'CAMERA_ZOOM_STOP') return { action: type, camera: device, ...(await stopZoom(device, auth, timeoutMs)) };
  if (type === 'CAMERA_GOTO_HOME') return { action: type, camera: device, ...(await gotoHome(device, auth, timeoutMs)) };
  if (type === 'CAMERA_REBOOT') return { action: type, camera: device, ...(await reboot(device, auth, timeoutMs)) };
  throw new CameraControlError('CAMERA_ACTION_UNSUPPORTED', `La acción ${type || 'desconocida'} no está soportada.`);
}
