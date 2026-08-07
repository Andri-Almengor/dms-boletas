import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';

const CAMERA_VENDORS = Object.freeze([
  ['AXIS', /\baxis(?: communications)?\b/i],
  ['Hikvision', /\bhikvision\b|\bhikvision digital technology\b/i],
  ['Dahua', /\bdahua\b|\bdahua technology\b/i],
  ['Hanwha Vision', /\bhanwha\b|\bwisenet\b/i],
  ['Bosch', /\bbosch\b/i],
  ['Avigilon', /\bavigilon\b/i],
  ['Uniview', /\buniview\b|\bUNV\b/i],
  ['Vivotek', /\bvivotek\b/i],
  ['Pelco', /\bpelco\b/i],
  ['MOBOTIX', /\bmobotix\b/i],
  ['Reolink', /\breolink\b/i],
]);

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function localTag(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  return clean(xml.match(expression)?.[1] || '', 8_000).replace(/<[^>]+>/g, '').trim();
}

function localTags(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'ig');
  const values = [];
  let match;
  while ((match = expression.exec(String(xml || ''))) && values.length < 20) {
    const value = clean(match[1], 1_000).replace(/<[^>]+>/g, '').trim();
    if (value) values.push(value);
  }
  return values;
}

function decodeScope(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function scopeValue(scopes, key) {
  const prefix = `onvif://www.onvif.org/${key}/`;
  const match = scopes.find((scope) => scope.toLowerCase().startsWith(prefix.toLowerCase()));
  return match ? decodeScope(match.slice(prefix.length)).replace(/_/g, ' ').trim() : '';
}

function normalizeMac(value) {
  const raw = clean(value, 80).replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (raw.length !== 12) return '';
  return raw.match(/.{2}/g).join(':');
}

function safeUrl(value, expectedIp = '') {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (expectedIp && url.hostname.replace(/^\[|\]$/g, '') !== expectedIp) return null;
    return url;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseDiscoveryXml(xml = '', remoteIp = '') {
  const address = localTag(xml, 'Address');
  const xaddrs = localTag(xml, 'XAddrs').split(/\s+/).filter(Boolean).slice(0, 12);
  const scopes = localTag(xml, 'Scopes').split(/\s+/).filter(Boolean).slice(0, 60);
  const types = localTag(xml, 'Types').split(/\s+/).filter(Boolean).slice(0, 30);
  return {
    ip: remoteIp,
    endpoint: address,
    uuid: address.replace(/^urn:uuid:/i, ''),
    xaddrs,
    scopes,
    types,
    name: scopeValue(scopes, 'name'),
    hardware: scopeValue(scopes, 'hardware'),
    location: scopeValue(scopes, 'location'),
  };
}

export function parseOnvifDeviceInformationXml(xml = '') {
  const manufacturer = localTag(xml, 'Manufacturer');
  const model = localTag(xml, 'Model');
  const firmwareVersion = localTag(xml, 'FirmwareVersion');
  const serialNumber = localTag(xml, 'SerialNumber');
  const hardwareId = localTag(xml, 'HardwareId');
  const found = Boolean(manufacturer || model || firmwareVersion || serialNumber || hardwareId);
  return { found, manufacturer, model, firmwareVersion, serialNumber, hardwareId };
}

export function parseOnvifNetworkInterfacesXml(xml = '') {
  return unique(localTags(xml, 'HwAddress').map(normalizeMac));
}

function discoveryProbeXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
}

export async function probeOnvifUnicast(ip, timeoutMs = 700) {
  const timeout = boundedNumber(timeoutMs, 700, 250, 3_000);
  const socket = dgram.createSocket('udp4');
  const responses = [];
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch { /* noop */ }
      resolve(responses[0] || null);
    };
    socket.on('message', (message, remote) => {
      if (remote.address !== ip) return;
      const xml = message.toString('utf8');
      if (!/ProbeMatches|onvif\.org/i.test(xml)) return;
      responses.push(parseDiscoveryXml(xml, remote.address));
      finish();
    });
    socket.on('error', finish);
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.send(Buffer.from(discoveryProbeXml()), 3702, ip, () => {});
      } catch {
        finish();
      }
    });
    setTimeout(finish, timeout);
  });
}

function soapEnvelope(operation) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body><tds:${operation}/></s:Body></s:Envelope>`;
}

async function soapPost(url, operation, timeoutMs) {
  const transport = url.protocol === 'https:' ? https : http;
  const action = `http://www.onvif.org/ver10/device/wsdl/${operation}`;
  const body = soapEnvelope(operation);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method: 'POST',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'DMS-Integration-Gateway/0.5',
        'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
        SOAPAction: `"${action}"`,
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (responseBody.length < 64_000) responseBody += chunk.slice(0, 64_000 - responseBody.length);
      });
      response.on('end', () => finish({
        statusCode: Number(response.statusCode || 0),
        body: responseBody,
        server: clean(response.headers.server, 200),
        authenticate: clean(response.headers['www-authenticate'], 500),
      }));
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => finish(null));
    request.end(body);
  });
}

function onvifBodyEvidence(body = '') {
  return /onvif\.org\/ver10\/device|GetDeviceInformationResponse|GetNetworkInterfacesResponse|ter:ActionNotSupported|SOAP-ENV:Fault|<[^>]*:?Fault\b/i.test(body);
}

function serviceCandidates(ip, openPorts = [], discovery = null) {
  const ports = new Set((openPorts || []).map(Number));
  const result = [];
  const seen = new Set();
  const add = (value, fromDiscovery = false) => {
    const url = safeUrl(value, ip);
    if (!url) return;
    const key = url.toString();
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ url, fromDiscovery });
  };
  (discovery?.xaddrs || []).forEach((value) => add(value, true));
  if (ports.has(80)) add(`http://${ip}/onvif/device_service`);
  if (ports.has(443)) add(`https://${ip}/onvif/device_service`);
  return result.slice(0, 4);
}

async function queryOnvifDeviceService(ip, openPorts, discovery, timeoutMs) {
  const candidates = serviceCandidates(ip, openPorts, discovery);
  let authRequired = false;
  let likelyEndpoint = '';
  let confirmed = Boolean(discovery);
  let deviceInfo = null;
  let macAddresses = [];
  let responseServer = '';

  for (const candidate of candidates) {
    const response = await soapPost(candidate.url, 'GetDeviceInformation', timeoutMs);
    if (!response) continue;
    responseServer ||= response.server;
    const info = parseOnvifDeviceInformationXml(response.body);
    const bodyEvidence = onvifBodyEvidence(response.body);
    const protectedEndpoint = [401, 403].includes(response.statusCode);
    if (info.found || bodyEvidence || (candidate.fromDiscovery && protectedEndpoint)) {
      confirmed = true;
      likelyEndpoint = candidate.url.toString();
    }
    if (protectedEndpoint) authRequired = true;
    if (!info.found) continue;

    deviceInfo = info;
    likelyEndpoint = candidate.url.toString();
    const networkResponse = await soapPost(candidate.url, 'GetNetworkInterfaces', timeoutMs);
    if (networkResponse?.body) {
      macAddresses = parseOnvifNetworkInterfacesXml(networkResponse.body);
    }
    break;
  }

  return {
    confirmed,
    authRequired,
    endpoint: likelyEndpoint,
    deviceInfo,
    macAddresses,
    responseServer,
  };
}

function inferManufacturer(material = '') {
  return CAMERA_VENDORS.find(([, expression]) => expression.test(material))?.[0] || '';
}

function inferModel(material = '', manufacturer = '') {
  const source = clean(material, 8_000);
  const patterns = [];
  if (manufacturer === 'AXIS') patterns.push(/\bAXIS\s+([PQMFCATV][0-9][A-Z0-9-]{2,})\b/i);
  if (manufacturer === 'Hikvision') patterns.push(/\b(DS-[A-Z0-9-]{4,})\b/i);
  if (manufacturer === 'Dahua') patterns.push(/\b((?:IPC|NVR|DVR|HAC)-[A-Z0-9-]{3,})\b/i);
  if (manufacturer === 'Hanwha Vision') patterns.push(/\b([QXPT][A-Z]{1,3}-[A-Z0-9-]{3,})\b/i);
  for (const expression of patterns) {
    const match = source.match(expression);
    if (match?.[1]) return clean(manufacturer === 'AXIS' ? `AXIS ${match[1]}` : match[1], 160);
  }
  return '';
}

async function fingerprintWeb(ip, openPorts, timeoutMs) {
  const ports = (openPorts || []).map(Number).filter((port) => port === 80 || port === 443);
  for (const port of [443, 80].filter((value) => ports.includes(value))) {
    const transport = port === 443 ? https : http;
    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const request = transport.request({
        hostname: ip,
        port,
        path: '/',
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'DMS-Integration-Gateway/0.5',
          Accept: 'text/html,application/xhtml+xml;q=0.8,*/*;q=0.2',
          Connection: 'close',
        },
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length < 32_000) body += chunk.slice(0, 32_000 - body.length);
        });
        response.on('end', () => {
          const title = clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' '), 200);
          const generator = clean(body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1], 200);
          const realm = clean(String(response.headers['www-authenticate'] || '').match(/realm="?([^",]+)"?/i)?.[1], 200);
          const material = [response.headers.server, response.headers['x-powered-by'], title, generator, realm, body].filter(Boolean).join(' ');
          const manufacturer = inferManufacturer(material);
          finish({
            manufacturer,
            model: inferModel(material, manufacturer),
            title,
            generator,
            server: clean(response.headers.server, 200),
            realm,
            statusCode: Number(response.statusCode || 0),
          });
        });
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => finish(null));
      request.end();
    });
    if (result?.manufacturer || result?.model) return result;
  }
  return null;
}

export async function identifyNetworkCamera(device, options = {}) {
  const ip = clean(device?.ipAddress || device?.DireccionIP, 100);
  if (!ip) return null;
  const metadata = device?.metadata || device?.Metadata || {};
  const openPorts = Array.isArray(metadata.openPorts) ? metadata.openPorts.map(Number) : [];
  const timeoutMs = boundedNumber(options.timeoutMs, 1_200, 300, 5_000);
  const discoveryTimeoutMs = boundedNumber(options.discoveryTimeoutMs, 700, 250, 3_000);
  const useUnicastDiscovery = options.useUnicastDiscovery !== false;

  const discovery = useUnicastDiscovery
    ? await probeOnvifUnicast(ip, discoveryTimeoutMs).catch(() => null)
    : null;
  const onvif = await queryOnvifDeviceService(ip, openPorts, discovery, timeoutMs);
  const baseMaterial = [
    device?.manufacturer,
    device?.model,
    metadata.httpServer,
    metadata.httpTitle,
    metadata.rtspServer,
    discovery?.name,
    discovery?.hardware,
    onvif.responseServer,
  ].filter(Boolean).join(' ');
  let manufacturer = clean(onvif.deviceInfo?.manufacturer || inferManufacturer(baseMaterial), 160);
  let model = clean(onvif.deviceInfo?.model || discovery?.hardware || inferModel(baseMaterial, manufacturer), 160);
  let web = null;

  if (!manufacturer || !model) {
    web = await fingerprintWeb(ip, openPorts, timeoutMs).catch(() => null);
    manufacturer ||= clean(web?.manufacturer, 160);
    model ||= clean(web?.model, 160);
  }

  const rtspDetected = Boolean(device?.capabilities?.rtspDetected || openPorts.includes(554));
  const confirmed = Boolean(discovery || onvif.confirmed);
  const evidence = unique([
    discovery ? 'ONVIF_UNICAST_DISCOVERY' : '',
    onvif.deviceInfo?.found ? 'ONVIF_GET_DEVICE_INFORMATION' : '',
    onvif.macAddresses.length ? 'ONVIF_GET_NETWORK_INTERFACES' : '',
    onvif.authRequired ? 'ONVIF_AUTH_REQUIRED' : '',
    manufacturer ? 'MANUFACTURER_FINGERPRINT' : '',
    model ? 'MODEL_FINGERPRINT' : '',
    rtspDetected ? 'RTSP' : '',
  ]);
  const highConfidence = confirmed || Boolean(manufacturer && rtspDetected);

  return {
    manufacturer,
    model,
    macAddress: onvif.macAddresses[0] || '',
    confidence: highConfidence ? 'HIGH' : (rtspDetected || manufacturer ? 'MEDIUM' : 'LOW'),
    evidence,
    discovery,
    onvif: {
      confirmed,
      authRequired: onvif.authRequired,
      endpoint: onvif.endpoint,
      manufacturer: clean(onvif.deviceInfo?.manufacturer, 160),
      model: clean(onvif.deviceInfo?.model, 160),
      firmwareVersion: clean(onvif.deviceInfo?.firmwareVersion, 200),
      serialNumber: clean(onvif.deviceInfo?.serialNumber, 200),
      hardwareId: clean(onvif.deviceInfo?.hardwareId, 200),
      macAddresses: onvif.macAddresses,
      uuid: clean(discovery?.uuid, 250),
      name: clean(discovery?.name, 200),
      hardware: clean(discovery?.hardware, 200),
      location: clean(discovery?.location, 250),
    },
    web,
  };
}
