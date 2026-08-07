import { readFileSync, writeFileSync } from 'node:fs';

const cameraFile = 'gateway-agent/src/camera/onvif-camera-control.js';
let camera = readFileSync(cameraFile, 'utf8');

function replaceOnce(before, after, label) {
  if (camera.includes(after)) return;
  if (!camera.includes(before)) throw new Error(`No se encontró el ancla para ${label}.`);
  camera = camera.replace(before, after);
}

replaceOnce(
`function section(xml, localName) {
  const expression = new RegExp(\`<[^>]*:?\${localName}\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/[^>]*:?\${localName}>\`, 'i');
  return expression.exec(String(xml || ''))?.[1] || '';
}
`,
`function section(xml, localName) {
  const expression = new RegExp(\`<[^>]*:?\${localName}\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/[^>]*:?\${localName}>\`, 'i');
  return expression.exec(String(xml || ''))?.[1] || '';
}

function sections(xml, localName) {
  const expression = new RegExp(\`<[^>]*:?\${localName}\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/[^>]*:?\${localName}>\`, 'gi');
  return [...String(xml || '').matchAll(expression)].map((match) => match[1] || '');
}
`,
  'lector de secciones ONVIF repetidas',
);

replaceOnce(
`function isAuthRejected(response) {
  return [401, 403].includes(Number(response?.statusCode || 0))
    || /NotAuthorized|FailedAuthentication|InvalidSecurity|ter:NotAuthorized|wsse:FailedAuthentication/i.test(String(response?.body || ''));
}
`,
`function isAuthRejected(response) {
  return [401, 403].includes(Number(response?.statusCode || 0))
    || /NotAuthorized|FailedAuthentication|InvalidSecurity|ter:NotAuthorized|wsse:FailedAuthentication/i.test(String(response?.body || ''));
}

function isOptionalOnvifActionUnsupported(error) {
  return error?.code === 'CAMERA_ONVIF_ERROR'
    && /Optional Action Not Implemented|ActionNotSupported|InvalidOperation|NoSuchService/i.test(String(error?.message || ''));
}
`,
  'clasificación de acciones ONVIF opcionales',
);

const oldEndpoints = `async function serviceEndpoints(device, auth, timeoutMs) {
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
`;

const newEndpoints = `function serviceUrlFromServices(xml, namespacePattern, expectedIp) {
  for (const service of sections(xml, 'Service')) {
    const namespace = localTag(service, 'Namespace');
    if (!namespacePattern.test(namespace)) continue;
    const url = sameCameraUrl(localTag(service, 'XAddr'), expectedIp);
    if (url) return url;
  }
  return null;
}

async function serviceEndpoints(device, auth, timeoutMs) {
  const ip = clean(device.ipAddress, 100);
  const deviceUrl = resolveDeviceEndpoint(device);

  try {
    // Omitir Category es equivalente a solicitar todas las capacidades según ONVIF
    // y evita firmwares que rechazan explícitamente Category=All con InvalidOperation.
    const xml = await soapCall(
      deviceUrl,
      'http://www.onvif.org/ver10/device/wsdl/GetCapabilities',
      '<tds:GetCapabilities/>',
      auth,
      timeoutMs,
    );
    const mediaUrl = sameCameraUrl(localTag(section(xml, 'Media'), 'XAddr'), ip);
    const ptzUrl = sameCameraUrl(localTag(section(xml, 'PTZ'), 'XAddr'), ip);
    return { deviceUrl, mediaUrl, ptzUrl, discoveryMethod: 'GET_CAPABILITIES' };
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    if (!isOptionalOnvifActionUnsupported(error)) throw error;
  }

  try {
    // GetCapabilities está deprecado en ONVIF moderno. Algunos firmwares/OEM,
    // incluyendo variantes compatibles de TruVision, solo exponen correctamente
    // la enumeración genérica GetServices.
    const xml = await soapCall(
      deviceUrl,
      'http://www.onvif.org/ver10/device/wsdl/GetServices',
      '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>',
      auth,
      timeoutMs,
    );
    const mediaUrl = serviceUrlFromServices(xml, /\\/ver(?:10|20)\\/media\\/wsdl\\/?$/i, ip);
    const ptzUrl = serviceUrlFromServices(xml, /\\/ver(?:10|20)\\/ptz\\/wsdl\\/?$/i, ip);
    return { deviceUrl, mediaUrl, ptzUrl, discoveryMethod: 'GET_SERVICES' };
  } catch (error) {
    if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
    if (!isOptionalOnvifActionUnsupported(error)) throw error;
    // La autenticación ya fue aceptada; no se considera una contraseña errónea ni
    // se activa una búsqueda de credenciales. La cámara simplemente no implementa
    // los métodos opcionales de descubrimiento que necesitamos.
    return { deviceUrl, mediaUrl: null, ptzUrl: null, discoveryMethod: 'DEVICE_ONLY' };
  }
}
`;

replaceOnce(oldEndpoints, newEndpoints, 'fallback GetCapabilities/GetServices');

replaceOnce(
`async function getCapabilities(device, auth, timeoutMs) {
  const endpoints = await serviceEndpoints(device, auth, timeoutMs);
  const profile = await mediaProfile(endpoints.mediaUrl, auth, timeoutMs);
`,
`async function getCapabilities(device, auth, timeoutMs) {
  const endpoints = await serviceEndpoints(device, auth, timeoutMs);
  let profile = null;
  if (endpoints.mediaUrl) {
    try {
      profile = await mediaProfile(endpoints.mediaUrl, auth, timeoutMs);
    } catch (error) {
      if (error.code === 'CAMERA_AUTH_REJECTED') throw error;
      // Un servicio Media parcialmente implementado no debe tumbar toda la
      // consulta de capacidades. Se reporta la función concreta como no disponible.
    }
  }
`,
  'degradación parcial de Media',
);

writeFileSync(cameraFile, camera);

const testFile = 'tests/characterization/gateway-camera-control-assistant.test.mjs';
let tests = readFileSync(testFile, 'utf8');
const anchor = `  assert.match(camera, /Este es el único segundo intento/);\n`;
const addition = `  assert.match(camera, /<tds:GetCapabilities\\/>/);\n  assert.match(camera, /GetServices/);\n  assert.match(camera, /Optional Action Not Implemented\\|ActionNotSupported\\|InvalidOperation/);\n  assert.match(camera, /discoveryMethod: 'GET_SERVICES'/);\n`;
if (!tests.includes(addition)) {
  if (!tests.includes(anchor)) throw new Error('No se encontró el ancla de pruebas ONVIF.');
  tests = tests.replace(anchor, anchor + addition);
}
writeFileSync(testFile, tests);

console.log('Compatibilidad ONVIF TruVision aplicada.');
