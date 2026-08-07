import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { CameraControlError, executeOnvifCameraAction } from './onvif-camera-control.js';

const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
const MAX_SOAP_BYTES = 512 * 1024;

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

function digestAuthorization({ challenge, username, password, method, url }) {
  const realm = challenge?.params?.realm || '';
  const nonce = challenge?.params?.nonce || '';
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
  if (challenge.params.opaque) parts.push(`opaque="${String(challenge.params.opaque).replace(/"/g, '')}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

function authorization(challenge, auth, method, url) {
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
  return `<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${escapeXml(auth.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
}

function soapEnvelope(body, auth) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tr2="http://www.onvif.org/ver20/media/wsdl">${wsSecurityHeader(auth)}<s:Body>${body}</s:Body></s:Envelope>`;
}

function sameCameraUrl(value, ip) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.hostname.replace(/^\[|\]$/g, '') !== ip) return null;
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

async function rawRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 7000, maxBytes = MAX_SNAPSHOT_BYTES } = {}) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method,
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'DMS-Integration-Gateway/0.8', Connection: 'close', ...headers },
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
    request.once('error', (error) => finish(error instanceof CameraControlError ? error : new CameraControlError('CAMERA_CONNECTION_FAILED', error.message || 'No fue posible conectarse a la cámara.')));
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
  if (isAuthRejected(response)) throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial asignada.', response.statusCode);
  if (response.statusCode < 200 || response.statusCode >= 300 || /<[^>]*:?Fault\b/i.test(response.body)) {
    throw new CameraControlError('CAMERA_ONVIF_ERROR', localTag(response.body, 'Text') || `La cámara respondió ${response.statusCode || 'con un error ONVIF'}.`, response.statusCode);
  }
  return response.body;
}

function deviceEndpoint(device) {
  const ip = clean(device?.ipAddress, 100);
  const announced = sameCameraUrl(device?.onvifEndpoint, ip);
  if (announced) return announced;
  const ports = new Set((device?.openPorts || []).map(Number));
  return new URL(`${ports.has(443) ? 'https' : 'http'}://${ip}/onvif/device_service`);
}

function mediaDescriptors(xml, ip) {
  const descriptors = [];
  for (const service of sections(xml, 'Service')) {
    const namespace = localTag(service, 'Namespace');
    if (!/\/ver(?:10|20)\/media\/wsdl\/?$/i.test(namespace)) continue;
    const url = sameCameraUrl(localTag(service, 'XAddr'), ip);
    if (!url) continue;
    descriptors.push({ url, version: /\/ver20\/media\/wsdl\/?$/i.test(namespace) ? 'MEDIA2' : 'MEDIA1' });
  }
  return descriptors;
}

function directMediaCandidates(device) {
  const endpoint = deviceEndpoint(device);
  return [
    { url: new URL('/onvif/media_service', endpoint), version: 'MEDIA1' },
    { url: new URL('/onvif/Media', endpoint), version: 'MEDIA1' },
  ];
}

async function discoverMedia(device, auth, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const endpoint = deviceEndpoint(device);
  let discovered = [];
  try {
    const servicesXml = await soapCall(
      endpoint,
      'http://www.onvif.org/ver10/device/wsdl/GetServices',
      '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>',
      auth,
      timeoutMs,
    );
    discovered = mediaDescriptors(servicesXml, ip);
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
  }
  const combined = [...discovered, ...directMediaCandidates(device)];
  const seen = new Set();
  return combined.filter(({ url, version }) => {
    const key = `${version}:${url.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function mediaDialect(version) {
  if (version === 'MEDIA2') {
    return {
      profilesAction: 'http://www.onvif.org/ver20/media/wsdl/GetProfiles',
      profilesBody: '<tr2:GetProfiles><tr2:Type>All</tr2:Type></tr2:GetProfiles>',
      snapshotAction: 'http://www.onvif.org/ver20/media/wsdl/GetSnapshotUri',
      snapshotBody: (token) => `<tr2:GetSnapshotUri><tr2:ProfileToken>${escapeXml(token)}</tr2:ProfileToken></tr2:GetSnapshotUri>`,
    };
  }
  return {
    profilesAction: 'http://www.onvif.org/ver10/media/wsdl/GetProfiles',
    profilesBody: '<trt:GetProfiles/>',
    snapshotAction: 'http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri',
    snapshotBody: (token) => `<trt:GetSnapshotUri><trt:ProfileToken>${escapeXml(token)}</trt:ProfileToken></trt:GetSnapshotUri>`,
  };
}

function imageSnapshot(response, transport) {
  const contentType = clean(String(response.headers['content-type'] || '').split(';')[0], 80).toLowerCase();
  const jpeg = response.buffer?.length >= 2 && response.buffer[0] === 0xff && response.buffer[1] === 0xd8;
  const png = response.buffer?.length >= 8 && response.buffer.subarray(1, 4).toString('ascii') === 'PNG';
  if (!jpeg && !png && !contentType.startsWith('image/')) {
    throw new CameraControlError('CAMERA_SNAPSHOT_INVALID', 'La respuesta de captura no contenía una imagen válida.');
  }
  return {
    mimeType: contentType === 'image/png' || png ? 'image/png' : 'image/jpeg',
    bytes: response.buffer.length,
    dataBase64: response.buffer.toString('base64'),
    capturedAt: new Date().toISOString(),
    transport,
  };
}

async function downloadSnapshot(url, device, auth, timeoutMs, transport) {
  const safe = sameCameraUrl(url.href, clean(device.ipAddress, 100));
  if (!safe) throw new CameraControlError('CAMERA_SNAPSHOT_URI_REJECTED', 'La cámara devolvió una URL de captura fuera de su propia IP.');
  const response = await requestWithAuth(safe, {
    method: 'GET',
    timeoutMs,
    maxBytes: MAX_SNAPSHOT_BYTES,
    headers: { Accept: 'image/jpeg,image/png;q=0.8,*/*;q=0.1' },
  }, auth);
  if (isAuthRejected(response)) throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial al solicitar la captura.', response.statusCode);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CameraControlError('CAMERA_SNAPSHOT_FAILED', `La cámara respondió ${response.statusCode} al solicitar la captura.`, response.statusCode);
  }
  return imageSnapshot(response, transport);
}

async function enhancedOnvifSnapshot(device, auth, timeoutMs) {
  const media = await discoverMedia(device, auth, timeoutMs);
  let lastError = null;
  for (const descriptor of media) {
    try {
      const dialect = mediaDialect(descriptor.version);
      const profiles = await soapCall(descriptor.url, dialect.profilesAction, dialect.profilesBody, auth, timeoutMs);
      const token = firstToken(profiles, 'Profiles');
      if (!token) continue;
      const snapshotXml = await soapCall(descriptor.url, dialect.snapshotAction, dialect.snapshotBody(token), auth, timeoutMs);
      const uri = sameCameraUrl(localTag(snapshotXml, 'Uri'), clean(device.ipAddress, 100));
      if (!uri) continue;
      return downloadSnapshot(uri, device, auth, timeoutMs, descriptor.version === 'MEDIA2' ? 'ONVIF_MEDIA2' : 'ONVIF_MEDIA1');
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
      lastError = error;
    }
  }
  throw lastError || new CameraControlError('CAMERA_SNAPSHOT_UNDETERMINED', 'No se encontró una ruta ONVIF de captura utilizable.');
}

function isHanwha(device = {}) {
  const signature = `${clean(device.manufacturer, 160)} ${clean(device.model, 160)}`.toUpperCase();
  return /HANWHA|WISENET|SAMSUNG TECHWIN|\bPND-|\bPNV-|\bXND-|\bXNV-|\bQND-|\bQNV-/.test(signature);
}

function pndA7082rv(device = {}) {
  return /^PND-A7082RV$/i.test(clean(device.model, 160));
}

async function hanwhaSnapshot(device, auth, timeoutMs) {
  const endpoint = deviceEndpoint(device);
  const ports = new Set((device.openPorts || []).map(Number));
  const protocol = ports.has(80) ? 'http:' : ports.has(443) ? 'https:' : endpoint.protocol;
  const url = new URL(`${protocol}//${clean(device.ipAddress, 100)}/stw-cgi/video.cgi?msubmenu=snapshot&action=view`);
  const response = await requestWithAuth(url, {
    method: 'GET',
    timeoutMs,
    maxBytes: MAX_SNAPSHOT_BYTES,
    headers: { Accept: 'image/jpeg,*/*;q=0.1' },
  }, auth);
  if (isAuthRejected(response)) throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara Hanwha rechazó la credencial al solicitar la captura SUNAPI.', response.statusCode);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CameraControlError('CAMERA_VENDOR_SNAPSHOT_FAILED', `SUNAPI respondió ${response.statusCode} al solicitar la captura.`, response.statusCode);
  }
  return imageSnapshot(response, 'HANWHA_SUNAPI');
}

function shouldFallbackSnapshot(error) {
  return error?.code !== 'CAMERA_AUTH_REJECTED';
}

async function fallbackSnapshot(device, auth, timeoutMs) {
  if (isHanwha(device)) {
    try {
      return await hanwhaSnapshot(device, auth, timeoutMs);
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    }
  }
  return enhancedOnvifSnapshot(device, auth, timeoutMs);
}

export async function executeCameraAction(command, { timeoutMs = 7000 } = {}) {
  const type = String(command?.Tipo || command?.type || '').toUpperCase();
  const execution = command?.execution || {};
  const device = execution.device || {};
  const auth = execution.authentication || {};

  if (type === 'CAMERA_SNAPSHOT') {
    try {
      return await executeOnvifCameraAction(command, { timeoutMs });
    } catch (error) {
      if (!shouldFallbackSnapshot(error)) throw error;
      const snapshot = await fallbackSnapshot(device, auth, timeoutMs);
      return { action: type, camera: device, snapshot };
    }
  }

  if (type === 'CAMERA_CAPABILITIES') {
    const base = await executeOnvifCameraAction(command, { timeoutMs });
    const capabilities = { ...(base.capabilities || {}) };
    capabilities.snapshotStatus = capabilities.snapshot ? 'AVAILABLE' : 'UNDETERMINED';
    capabilities.snapshotTransport = capabilities.snapshot ? 'ONVIF_MEDIA1' : '';

    if (!capabilities.snapshot) {
      try {
        const snapshot = await fallbackSnapshot(device, auth, timeoutMs);
        capabilities.snapshot = true;
        capabilities.snapshotStatus = 'AVAILABLE';
        capabilities.snapshotTransport = snapshot.transport || 'VENDOR_OR_ONVIF_FALLBACK';
      } catch (error) {
        if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
      }
    }

    if (pndA7082rv(device)) {
      capabilities.opticalZoom = true;
      capabilities.opticalZoomRatio = '2.0x';
      capabilities.zoomStatus = capabilities.continuousZoom
        ? 'AVAILABLE_ONVIF_PTZ'
        : 'HARDWARE_PRESENT_CONTROL_NOT_CONFIRMED';
    }

    return { ...base, capabilities };
  }

  return executeOnvifCameraAction(command, { timeoutMs });
}
