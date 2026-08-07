import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { executeCameraAction as executeBaseCameraAction } from './camera-control-router.js';
import { CameraControlError } from './onvif-camera-control.js';

const MAX_VENDOR_RESPONSE_BYTES = 256 * 1024;

// Modelos cuya lente motorizada está documentada y para los que habilitamos
// control SUNAPI de forma explícita. No inferimos soporte solo por la marca.
const HANWHA_MOTORIZED_LENS = Object.freeze({
  'PND-A7082RV': { opticalZoomRatio: '2.0x', zoomStep: 10, restoreWideStep: -100 },
});

function clean(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function hanwhaLensProfile(device = {}) {
  return HANWHA_MOTORIZED_LENS[clean(device.model, 160).toUpperCase()] || null;
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

function authorizationForChallenge(challenge, auth, method, url) {
  if (!challenge || !auth?.username) return '';
  if (challenge.scheme === 'basic') {
    return `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`, 'utf8').toString('base64')}`;
  }
  if (challenge.scheme === 'digest') return digestAuthorization({ challenge, auth, method, url });
  return '';
}

function cameraBaseUrl(device = {}) {
  const ip = clean(device.ipAddress, 100);
  if (!ip) throw new CameraControlError('CAMERA_IP_REQUIRED', 'La cámara no tiene una IP utilizable.');
  const ports = new Set((device.openPorts || []).map(Number));
  // Preferimos HTTP cuando está publicado porque varias generaciones SUNAPI
  // responden allí aunque la interfaz web redirija a HTTPS.
  const protocol = ports.has(80) ? 'http:' : 'https:';
  return new URL(`${protocol}//${ip}/`);
}

async function rawRequest(url, { headers = {}, timeoutMs = 7000 } = {}) {
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
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'DMS-Integration-Gateway/0.9',
        Connection: 'close',
        ...headers,
      },
    }, (response) => {
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_VENDOR_RESPONSE_BYTES) {
          request.destroy(new CameraControlError('CAMERA_RESPONSE_TOO_LARGE', 'La cámara devolvió una respuesta SUNAPI demasiado grande.'));
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
    request.end();
  });
}

async function requestWithAssignedCredential(url, auth, timeoutMs) {
  const first = await rawRequest(url, { timeoutMs });
  if (first.statusCode !== 401) return first;
  const challenge = parseChallenge(first.headers['www-authenticate']);
  const authorization = authorizationForChallenge(challenge, auth, 'GET', url);
  if (!authorization) return first;
  // Único segundo intento: responde al challenge usando la MISMA credencial
  // asignada a la cámara. Nunca se recorren otras credenciales.
  return rawRequest(url, { timeoutMs, headers: { Authorization: authorization } });
}

function assertVendorSuccess(response, action) {
  if ([401, 403].includes(response.statusCode)) {
    throw new CameraControlError('CAMERA_AUTH_REJECTED', `La cámara rechazó la credencial al ${action}.`, response.statusCode);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CameraControlError('CAMERA_VENDOR_ACTION_UNSUPPORTED', `SUNAPI respondió ${response.statusCode} al ${action}.`, response.statusCode);
  }
  const body = String(response.body || '');
  if (/^\s*(?:Error|NG)\b/im.test(body) || /Result\s*=\s*(?:Fail|Error)/i.test(body)) {
    throw new CameraControlError('CAMERA_VENDOR_ACTION_REJECTED', `SUNAPI rechazó la operación al ${action}.`);
  }
  return response;
}

async function sunapiGet(device, auth, path, timeoutMs, actionLabel) {
  const base = cameraBaseUrl(device);
  const url = new URL(path, base);
  if (url.hostname !== base.hostname) {
    throw new CameraControlError('CAMERA_VENDOR_URL_REJECTED', 'La acción SUNAPI intentó salir de la IP inventariada.');
  }
  const response = await requestWithAssignedCredential(url, auth, timeoutMs);
  return assertVendorSuccess(response, actionLabel);
}

async function hanwhaSimpleFocus(device, auth, timeoutMs) {
  try {
    await sunapiGet(
      device,
      auth,
      '/stw-cgi/image.cgi?msubmenu=focus&action=control&Mode=SimpleFocus&Channel=0',
      timeoutMs,
      'ejecutar enfoque simple',
    );
    return true;
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    // El zoom ya pudo haberse aplicado correctamente. Un firmware sin SimpleFocus
    // no debe convertir el movimiento de lente en un falso error.
    return false;
  }
}

async function hanwhaLensZoom(device, auth, direction, timeoutMs) {
  const profile = hanwhaLensProfile(device);
  if (!profile) throw new CameraControlError('CAMERA_VENDOR_ZOOM_UNSUPPORTED', 'No hay un perfil SUNAPI de lente habilitado para este modelo.');
  const step = direction === 'in' ? profile.zoomStep : -profile.zoomStep;
  await sunapiGet(
    device,
    auth,
    `/stw-cgi/ptzcontrol.cgi?msubmenu=absolute&action=control&Zoom=${step}`,
    timeoutMs,
    `${direction === 'in' ? 'acercar' : 'alejar'} el zoom`,
  );
  const focusRequested = await hanwhaSimpleFocus(device, auth, timeoutMs);
  return {
    moved: true,
    direction,
    step,
    focusRequested,
    transport: 'HANWHA_SUNAPI_LENS',
  };
}

async function hanwhaStopLens(device, auth, timeoutMs) {
  await sunapiGet(
    device,
    auth,
    '/stw-cgi/ptzcontrol.cgi?msubmenu=stop&action=control&OperationType=All',
    timeoutMs,
    'detener el movimiento de lente',
  );
  return { stopped: true, transport: 'HANWHA_SUNAPI_LENS' };
}

async function hanwhaRestoreWide(device, auth, timeoutMs) {
  const profile = hanwhaLensProfile(device);
  if (!profile) throw new CameraControlError('CAMERA_VENDOR_HOME_UNSUPPORTED', 'No hay una restauración de lente habilitada para este modelo.');
  await sunapiGet(
    device,
    auth,
    `/stw-cgi/ptzcontrol.cgi?msubmenu=absolute&action=control&Zoom=${profile.restoreWideStep}`,
    timeoutMs,
    'restaurar el ángulo amplio',
  );
  const focusRequested = await hanwhaSimpleFocus(device, auth, timeoutMs);
  return {
    homeRequested: true,
    restoreMode: 'WIDE',
    step: profile.restoreWideStep,
    focusRequested,
    transport: 'HANWHA_SUNAPI_LENS',
  };
}

function mayFallbackToVendor(error) {
  return error?.code !== 'CAMERA_AUTH_REJECTED' && error?.code !== 'CAMERA_AUTH_COOLDOWN';
}

async function baseThenHanwhaFallback(command, fallback, timeoutMs) {
  try {
    return await executeBaseCameraAction(command, { timeoutMs });
  } catch (error) {
    if (!mayFallbackToVendor(error)) throw error;
    return fallback();
  }
}

export async function executePhysicalCameraAction(command, { timeoutMs = 7000 } = {}) {
  const type = String(command?.Tipo || command?.type || '').toUpperCase();
  const execution = command?.execution || {};
  const device = execution.device || {};
  const auth = execution.authentication || {};
  const lensProfile = hanwhaLensProfile(device);

  if (type === 'CAMERA_CAPABILITIES') {
    const base = await executeBaseCameraAction(command, { timeoutMs });
    const capabilities = { ...(base.capabilities || {}) };
    if (lensProfile) {
      capabilities.opticalZoom = true;
      capabilities.opticalZoomRatio = lensProfile.opticalZoomRatio;
      capabilities.lensZoomControl = true;
      capabilities.zoomStatus = capabilities.continuousZoom ? 'AVAILABLE_ONVIF_PTZ' : 'AVAILABLE_VENDOR_LENS';
      capabilities.zoomControlTransport = capabilities.continuousZoom ? 'ONVIF_PTZ' : 'HANWHA_SUNAPI_LENS';
      capabilities.restoreWide = true;
      capabilities.restoreWideTransport = 'HANWHA_SUNAPI_LENS';
      capabilities.simpleFocus = true;
    }
    return { ...base, capabilities };
  }

  if (!lensProfile) return executeBaseCameraAction(command, { timeoutMs });

  if (type === 'CAMERA_ZOOM_IN') {
    return baseThenHanwhaFallback(command, async () => ({
      action: type,
      camera: device,
      ...(await hanwhaLensZoom(device, auth, 'in', timeoutMs)),
    }), timeoutMs);
  }
  if (type === 'CAMERA_ZOOM_OUT') {
    return baseThenHanwhaFallback(command, async () => ({
      action: type,
      camera: device,
      ...(await hanwhaLensZoom(device, auth, 'out', timeoutMs)),
    }), timeoutMs);
  }
  if (type === 'CAMERA_ZOOM_STOP') {
    return baseThenHanwhaFallback(command, async () => ({
      action: type,
      camera: device,
      ...(await hanwhaStopLens(device, auth, timeoutMs)),
    }), timeoutMs);
  }
  if (type === 'CAMERA_GOTO_HOME') {
    return baseThenHanwhaFallback(command, async () => ({
      action: type,
      camera: device,
      ...(await hanwhaRestoreWide(device, auth, timeoutMs)),
    }), timeoutMs);
  }

  return executeBaseCameraAction(command, { timeoutMs });
}
