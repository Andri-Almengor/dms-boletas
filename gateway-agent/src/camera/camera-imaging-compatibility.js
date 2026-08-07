import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { executeAdvancedCameraAction } from './camera-advanced-actions.js';
import { CameraControlError } from './onvif-camera-control.js';

const MAX_SOAP_BYTES = 512 * 1024;
const IMAGING_ACTIONS = new Set([
  'CAMERA_AUTOFOCUS',
  'CAMERA_DAY_MODE',
  'CAMERA_NIGHT_MODE',
  'CAMERA_DAYNIGHT_AUTO',
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

function localTag(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'i');
  return clean(String(xml || '').match(expression)?.[1] || '', 16000).replace(/<[^>]+>/g, '').trim();
}

function sections(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'gi');
  return [...String(xml || '').matchAll(expression)].map((match) => match[1] || '');
}

function allTagValues(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, 'gi');
  return [...String(xml || '').matchAll(expression)]
    .map((match) => clean(match[1], 1000).replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
}

function attributeTokens(xml, name) {
  const expression = new RegExp(`<[^>]*:?${name}\\b[^>]*\\btoken=["']([^"']+)["']`, 'gi');
  return [...String(xml || '').matchAll(expression)]
    .map((match) => clean(match[1], 500))
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
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tr2="http://www.onvif.org/ver20/media/wsdl" xmlns:timg="http://www.onvif.org/ver20/imaging/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">${wsSecurityHeader(auth)}<s:Body>${body}</s:Body></s:Envelope>`;
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

async function rawRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 7000 } = {}) {
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
      headers: { 'User-Agent': 'DMS-Integration-Gateway/1.0.1', Connection: 'close', ...headers },
    }, (response) => {
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_SOAP_BYTES) {
          request.destroy(new CameraControlError('CAMERA_RESPONSE_TOO_LARGE', 'La cámara devolvió una respuesta ONVIF demasiado grande.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        statusCode: Number(response.statusCode || 0),
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
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
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
      SOAPAction: `"${action}"`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  }, auth);
  if ([401, 403].includes(response.statusCode) || /NotAuthorized|FailedAuthentication|InvalidSecurity/i.test(response.body)) {
    throw new CameraControlError('CAMERA_AUTH_REJECTED', 'La cámara rechazó la credencial asignada.', response.statusCode);
  }
  if (response.statusCode < 200 || response.statusCode >= 300 || /<[^>]*:?Fault\b/i.test(response.body)) {
    const reason = localTag(response.body, 'Text') || localTag(response.body, 'Reason');
    throw new CameraControlError('CAMERA_ONVIF_ERROR', reason || `La cámara respondió ${response.statusCode || 'con error ONVIF'}.`, response.statusCode);
  }
  return response.body;
}

function deviceEndpoint(device = {}) {
  const ip = clean(device.ipAddress, 100);
  const announced = sameCameraUrl(device.onvifEndpoint, ip);
  if (announced) return announced;
  const ports = new Set((device.openPorts || []).map(Number));
  return new URL(`${ports.has(443) ? 'https' : 'http'}://${ip}/onvif/device_service`);
}

async function discoverImagingServices(device, auth, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const endpoint = deviceEndpoint(device);
  const xml = await soapCall(
    endpoint,
    'http://www.onvif.org/ver10/device/wsdl/GetServices',
    '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>',
    auth,
    timeoutMs,
  );
  let imaging = null;
  let media = null;
  let mediaVersion = '10';
  for (const service of sections(xml, 'Service')) {
    const namespace = localTag(service, 'Namespace');
    const url = sameCameraUrl(localTag(service, 'XAddr'), ip);
    if (!url) continue;
    if (/\/ver20\/imaging\/wsdl\/?$/i.test(namespace) && !imaging) imaging = url;
    if (/\/ver(?:10|20)\/media\/wsdl\/?$/i.test(namespace) && !media) {
      media = url;
      mediaVersion = /\/ver20\/media\/wsdl\/?$/i.test(namespace) ? '20' : '10';
    }
  }
  return { endpoint, imaging, media, mediaVersion };
}

async function videoSourceCandidates(services, auth, timeoutMs) {
  if (!services.media) return [];
  const action = services.mediaVersion === '20'
    ? 'http://www.onvif.org/ver20/media/wsdl/GetVideoSources'
    : 'http://www.onvif.org/ver10/media/wsdl/GetVideoSources';
  const body = services.mediaVersion === '20' ? '<tr2:GetVideoSources/>' : '<trt:GetVideoSources/>';
  const candidates = [];
  try {
    const xml = await soapCall(services.media, action, body, auth, timeoutMs);
    candidates.push(...attributeTokens(xml, 'VideoSources'));
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
  }

  try {
    const profileAction = services.mediaVersion === '20'
      ? 'http://www.onvif.org/ver20/media/wsdl/GetProfiles'
      : 'http://www.onvif.org/ver10/media/wsdl/GetProfiles';
    const profileBody = services.mediaVersion === '20' ? '<tr2:GetProfiles/>' : '<trt:GetProfiles/>';
    const xml = await soapCall(services.media, profileAction, profileBody, auth, timeoutMs);
    for (const profile of sections(xml, 'Profiles')) {
      const videoConfig = sections(profile, 'VideoSourceConfiguration')[0] || '';
      const sourceToken = localTag(videoConfig, 'SourceToken');
      if (sourceToken) candidates.push(sourceToken);
    }
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
  }
  return [...new Set(candidates.map((value) => clean(value, 500)).filter(Boolean))].slice(0, 8);
}

async function validateVideoSource(imaging, token, auth, timeoutMs) {
  const settings = await soapCall(
    imaging,
    'http://www.onvif.org/ver20/imaging/wsdl/GetImagingSettings',
    `<timg:GetImagingSettings><timg:VideoSourceToken>${escapeXml(token)}</timg:VideoSourceToken></timg:GetImagingSettings>`,
    auth,
    timeoutMs,
  );
  let options = '';
  try {
    options = await soapCall(
      imaging,
      'http://www.onvif.org/ver20/imaging/wsdl/GetOptions',
      `<timg:GetOptions><timg:VideoSourceToken>${escapeXml(token)}</timg:VideoSourceToken></timg:GetOptions>`,
      auth,
      timeoutMs,
    );
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
  }
  const dayNightModes = [...new Set(allTagValues(options, 'IrCutFilterModes').map((value) => value.toUpperCase()))];
  const autofocusModes = [...new Set(allTagValues(options, 'AutoFocusModes').map((value) => value.toUpperCase()))];
  return {
    token,
    currentIrCutFilter: localTag(settings, 'IrCutFilter').toUpperCase(),
    currentAutoFocusMode: localTag(settings, 'AutoFocusMode').toUpperCase(),
    dayNightModes,
    autofocusModes,
  };
}

export async function probeValidatedImaging(command, { timeoutMs = 7000 } = {}) {
  const device = command?.execution?.device || {};
  const auth = command?.execution?.authentication || {};
  const services = await discoverImagingServices(device, auth, timeoutMs);
  if (!services.imaging || !services.media) {
    return { validated: false, reason: 'IMAGING_OR_MEDIA_NOT_PUBLISHED', sourcesChecked: 0 };
  }
  const candidates = await videoSourceCandidates(services, auth, timeoutMs);
  for (const token of candidates) {
    try {
      const source = await validateVideoSource(services.imaging, token, auth, timeoutMs);
      return {
        validated: true,
        imagingUrl: services.imaging.toString(),
        mediaUrl: services.media.toString(),
        source,
        sourcesChecked: candidates.indexOf(token) + 1,
      };
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
      // Un VideoSourceToken inválido no se considera fallo de contraseña.
      // Se prueba únicamente el siguiente token anunciado por LA MISMA cámara.
    }
  }
  return { validated: false, reason: 'NO_VALID_VIDEO_SOURCE', sourcesChecked: candidates.length };
}

async function setDayNight(command, mode, timeoutMs) {
  const probe = await probeValidatedImaging(command, { timeoutMs });
  if (!probe.validated) {
    throw new CameraControlError('CAMERA_DAYNIGHT_UNSUPPORTED', 'La cámara publica Imaging, pero no fue posible validar un VideoSource real para Día/Noche.');
  }
  const supported = probe.source.dayNightModes;
  if (!supported.includes(mode)) {
    throw new CameraControlError(
      'CAMERA_DAYNIGHT_MODE_UNSUPPORTED',
      `La cámara no anuncia soporte para el modo ${mode}. Modos publicados: ${supported.join(', ') || 'ninguno'}.`,
    );
  }
  const imaging = new URL(probe.imagingUrl);
  const auth = command.execution.authentication || {};
  await soapCall(
    imaging,
    'http://www.onvif.org/ver20/imaging/wsdl/SetImagingSettings',
    `<timg:SetImagingSettings><timg:VideoSourceToken>${escapeXml(probe.source.token)}</timg:VideoSourceToken><timg:ImagingSettings><tt:IrCutFilter>${mode}</tt:IrCutFilter></timg:ImagingSettings><timg:ForcePersistence>false</timg:ForcePersistence></timg:SetImagingSettings>`,
    auth,
    timeoutMs,
  );
  const verified = await validateVideoSource(imaging, probe.source.token, auth, timeoutMs);
  if (verified.currentIrCutFilter && verified.currentIrCutFilter !== mode) {
    throw new CameraControlError('CAMERA_DAYNIGHT_VERIFY_FAILED', `La cámara aceptó la orden, pero reporta IrCutFilter=${verified.currentIrCutFilter} en lugar de ${mode}.`);
  }
  return {
    action: String(command.Tipo || command.type || '').toUpperCase(),
    camera: command.execution.device,
    mode: mode === 'ON' ? 'DAY' : mode === 'OFF' ? 'NIGHT' : 'AUTO',
    irCutFilter: mode,
    videoSourceToken: probe.source.token,
    transport: 'ONVIF_IMAGING_VALIDATED_SOURCE',
    verified: true,
  };
}

async function setAutofocus(command, timeoutMs) {
  const device = command?.execution?.device || {};
  if (/^PND-A7082RV$/i.test(clean(device.model, 160))) {
    return executeAdvancedCameraAction(command, { timeoutMs });
  }
  const probe = await probeValidatedImaging(command, { timeoutMs });
  if (!probe.validated || !probe.source.autofocusModes.includes('AUTO')) {
    throw new CameraControlError('CAMERA_AUTOFOCUS_UNSUPPORTED', 'La cámara no anuncia Auto Focus sobre un VideoSource ONVIF válido.');
  }
  const imaging = new URL(probe.imagingUrl);
  const auth = command.execution.authentication || {};
  await soapCall(
    imaging,
    'http://www.onvif.org/ver20/imaging/wsdl/SetImagingSettings',
    `<timg:SetImagingSettings><timg:VideoSourceToken>${escapeXml(probe.source.token)}</timg:VideoSourceToken><timg:ImagingSettings><tt:Focus><tt:AutoFocusMode>AUTO</tt:AutoFocusMode></tt:Focus></timg:ImagingSettings><timg:ForcePersistence>false</timg:ForcePersistence></timg:SetImagingSettings>`,
    auth,
    timeoutMs,
  );
  return {
    action: String(command.Tipo || command.type || '').toUpperCase(),
    camera: device,
    focused: true,
    videoSourceToken: probe.source.token,
    transport: 'ONVIF_IMAGING_VALIDATED_SOURCE',
  };
}

export async function executeCameraActionWithValidatedImaging(command, { timeoutMs = 7000 } = {}) {
  const type = String(command?.Tipo || command?.type || '').toUpperCase();
  if (type === 'CAMERA_CAPABILITIES') {
    const base = await executeAdvancedCameraAction(command, { timeoutMs });
    let probe = null;
    try {
      probe = await probeValidatedImaging(command, { timeoutMs });
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    }
    const capabilities = { ...(base.capabilities || {}) };
    const hanwhaVendorFocus = /^PND-A7082RV$/i.test(clean(command?.execution?.device?.model, 160));
    if (!probe?.validated) {
      capabilities.autofocus = hanwhaVendorFocus;
      capabilities.dayNight = false;
      capabilities.dayMode = false;
      capabilities.nightMode = false;
      capabilities.dayNightAuto = false;
      capabilities.imagingValidated = false;
      capabilities.imagingValidationStatus = probe?.reason || 'UNDETERMINED';
      return { ...base, capabilities };
    }
    const modes = probe.source.dayNightModes;
    capabilities.autofocus = hanwhaVendorFocus || probe.source.autofocusModes.includes('AUTO');
    capabilities.dayMode = modes.includes('ON');
    capabilities.nightMode = modes.includes('OFF');
    capabilities.dayNightAuto = modes.includes('AUTO');
    capabilities.dayNight = capabilities.dayMode || capabilities.nightMode || capabilities.dayNightAuto;
    capabilities.dayNightModes = modes;
    capabilities.imagingValidated = true;
    capabilities.imagingVideoSourceTokenValidated = true;
    capabilities.imagingVideoSource = probe.source.token;
    return { ...base, capabilities };
  }

  if (!IMAGING_ACTIONS.has(type)) return executeAdvancedCameraAction(command, { timeoutMs });
  if (type === 'CAMERA_AUTOFOCUS') return setAutofocus(command, timeoutMs);
  if (type === 'CAMERA_DAY_MODE') return setDayNight(command, 'ON', timeoutMs);
  if (type === 'CAMERA_NIGHT_MODE') return setDayNight(command, 'OFF', timeoutMs);
  if (type === 'CAMERA_DAYNIGHT_AUTO') return setDayNight(command, 'AUTO', timeoutMs);
  return executeAdvancedCameraAction(command, { timeoutMs });
}
