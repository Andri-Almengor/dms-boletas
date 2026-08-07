import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_PORTS = Object.freeze([80, 443, 554]);
const CAMERA_HINT = /(axis|hikvision|dahua|hanwha|wisenet|bosch|avigilon|uniview|\bunv\b|reolink|vivotek|pelco|mobotix|network\s*camera|ip\s*camera|camera|network\s*video|nvr|dvr)/i;
const MANUFACTURERS = Object.freeze([
  ['AXIS', /axis/i], ['Hikvision', /hikvision/i], ['Dahua', /dahua/i],
  ['Hanwha Vision', /hanwha|wisenet/i], ['Bosch', /bosch/i], ['Avigilon', /avigilon/i],
  ['Uniview', /uniview|\bunv\b/i], ['Reolink', /reolink/i], ['Vivotek', /vivotek/i],
  ['Pelco', /pelco/i], ['MOBOTIX', /mobotix/i],
]);

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value) {
  const unsigned = value >>> 0;
  return [unsigned >>> 24, (unsigned >>> 16) & 255, (unsigned >>> 8) & 255, unsigned & 255].join('.');
}

export function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function parsePrivateCidr(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return null;
  const ipInt = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  if (ipInt === null || prefix < 24 || prefix > 30 || !isPrivateIpv4(match[1])) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return {
    cidr: `${intToIpv4(network)}/${prefix}`,
    prefix,
    network,
    broadcast,
    hosts: Math.max(0, broadcast - network - 1),
  };
}

function interfaceCidr(address, cidr) {
  const parsed = parsePrivateCidr(cidr);
  if (parsed) return parsed.cidr;
  if (!isPrivateIpv4(address)) return '';
  const parts = String(address).split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : '';
}

export function detectLocalPrivateCidrs(configured = '') {
  const explicit = String(configured || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (explicit.length) {
    const parsed = explicit.map(parsePrivateCidr);
    if (parsed.some((item) => !item)) {
      throw new Error('DMS_NETWORK_CIDRS solo admite subredes IPv4 privadas entre /24 y /30.');
    }
    return [...new Set(parsed.map((item) => item.cidr))].slice(0, 8);
  }

  const found = [];
  Object.values(os.networkInterfaces()).flat().filter(Boolean).forEach((entry) => {
    const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
    if (entry.internal || !['IPv4', '4'].includes(family) || !isPrivateIpv4(entry.address)) return;
    const cidr = interfaceCidr(entry.address, entry.cidr || '');
    if (cidr) found.push(cidr);
  });
  return [...new Set(found)].slice(0, 8);
}

export function hostsForCidrs(cidrs = [], maxHosts = 1_024) {
  const hosts = [];
  const seen = new Set();
  for (const cidr of cidrs) {
    const parsed = parsePrivateCidr(cidr);
    if (!parsed) continue;
    for (let current = parsed.network + 1; current < parsed.broadcast; current += 1) {
      const ip = intToIpv4(current);
      if (!seen.has(ip)) {
        seen.add(ip);
        hosts.push(ip);
      }
      if (hosts.length >= maxHosts) return hosts;
    }
  }
  return hosts;
}

function decodeScope(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function xmlTag(xml, localName) {
  const expression = new RegExp(`<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i');
  return text(xml.match(expression)?.[1] || '', 4_000).replace(/<[^>]+>/g, '').trim();
}

function scopeValue(scopes, key) {
  const prefix = `onvif://www.onvif.org/${key}/`;
  const match = scopes.find((scope) => scope.toLowerCase().startsWith(prefix.toLowerCase()));
  return match ? decodeScope(match.slice(prefix.length)).replace(/_/g, ' ').trim() : '';
}

export function parseOnvifDiscoveryXml(xml = '') {
  const address = xmlTag(xml, 'Address');
  const xaddrs = xmlTag(xml, 'XAddrs').split(/\s+/).filter(Boolean).slice(0, 12);
  const scopes = xmlTag(xml, 'Scopes').split(/\s+/).filter(Boolean).slice(0, 60);
  const types = xmlTag(xml, 'Types').split(/\s+/).filter(Boolean).slice(0, 30);
  const ips = xaddrs.map((value) => {
    try { return new URL(value).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; }
  }).filter(isPrivateIpv4);
  return {
    endpoint: address,
    uuid: address.replace(/^urn:uuid:/i, ''),
    xaddrs,
    scopes,
    types,
    ips: [...new Set(ips)],
    name: scopeValue(scopes, 'name'),
    hardware: scopeValue(scopes, 'hardware'),
    location: scopeValue(scopes, 'location'),
  };
}

function mergeCandidate(map, ip, patch = {}) {
  if (!isPrivateIpv4(ip)) return;
  const current = map.get(ip) || {
    ip,
    openPorts: new Set(),
    methods: new Set(),
    onvif: null,
    http: null,
    rtsp: null,
  };
  if (patch.openPort) current.openPorts.add(Number(patch.openPort));
  if (patch.method) current.methods.add(patch.method);
  if (patch.onvif) current.onvif = { ...(current.onvif || {}), ...patch.onvif };
  if (patch.http) current.http = { ...(current.http || {}), ...patch.http };
  if (patch.rtsp) current.rtsp = { ...(current.rtsp || {}), ...patch.rtsp };
  map.set(ip, current);
}

async function discoverOnvif(timeoutMs) {
  const probe = `<?xml version="1.0" encoding="UTF-8"?>\n<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
  const socket = dgram.createSocket('udp4');
  const responses = [];
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch { /* noop */ }
      resolve(responses);
    };
    socket.on('message', (message, remote) => {
      const parsed = parseOnvifDiscoveryXml(message.toString('utf8'));
      const ips = parsed.ips.length ? parsed.ips : [remote.address].filter(isPrivateIpv4);
      ips.forEach((ip) => responses.push({ ip, ...parsed }));
    });
    socket.on('error', finish);
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setMulticastTTL(2);
        socket.send(Buffer.from(probe), 3702, '239.255.255.250', () => {});
      } catch {
        finish();
      }
    });
    setTimeout(finish, timeoutMs);
  });
}

async function portOpen(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, consume));
  return results;
}

async function probeWeb(ip, port, timeoutMs) {
  const transport = port === 443 ? https : http;
  return new Promise((resolve) => {
    const request = transport.request({
      hostname: ip,
      port,
      path: '/',
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'DMS-Integration-Gateway/0.3',
        Accept: 'text/html,application/xhtml+xml;q=0.8,*/*;q=0.2',
        Connection: 'close',
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 16_384) body += chunk.slice(0, 16_384 - body.length);
      });
      response.on('end', () => resolve({
        server: text(response.headers.server, 180),
        realm: text(String(response.headers['www-authenticate'] || '').match(/realm="?([^",]+)"?/i)?.[1] || '', 180),
        title: text(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ') || '', 180),
      }));
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
    request.end();
  });
}

async function probeRtsp(ip, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let response = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ server: text(response.match(/^Server:\s*(.+)$/im)?.[1] || '', 180) });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(`OPTIONS rtsp://${ip}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: DMS-Integration-Gateway/0.3\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      if (response.length < 8_192) response += chunk.toString('utf8').slice(0, 8_192 - response.length);
      if (response.includes('\r\n\r\n')) finish();
    });
    socket.once('timeout', finish);
    socket.once('error', () => resolve(null));
    socket.once('close', finish);
    socket.connect(554, ip);
  });
}

async function readNeighborTable() {
  const macs = new Map();
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('arp.exe', ['-a'], { windowsHide: true, timeout: 4_000 });
      String(stdout).split(/\r?\n/).forEach((line) => {
        const match = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+/i);
        if (match) macs.set(match[1], match[2].replace(/-/g, ':').toUpperCase());
      });
    } else if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('ip', ['neigh', 'show'], { timeout: 4_000 });
      String(stdout).split(/\r?\n/).forEach((line) => {
        const match = line.match(/^(\d{1,3}(?:\.\d{1,3}){3}).*\blladdr\s+([0-9a-f:]{17})\b/i);
        if (match) macs.set(match[1], match[2].toUpperCase());
      });
    } else {
      const { stdout } = await execFileAsync('arp', ['-an'], { timeout: 4_000 });
      String(stdout).split(/\r?\n/).forEach((line) => {
        const match = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:]{17})/i);
        if (match) macs.set(match[1], match[2].toUpperCase());
      });
    }
  } catch {
    // La MAC es opcional.
  }
  return macs;
}

function candidateMaterial(candidate) {
  return [candidate.onvif?.hardware, candidate.onvif?.name, candidate.http?.server,
    candidate.http?.realm, candidate.http?.title, candidate.rtsp?.server].filter(Boolean).join(' ');
}

function manufacturer(candidate) {
  const material = candidateMaterial(candidate);
  return MANUFACTURERS.find(([, expression]) => expression.test(material))?.[0] || '';
}

function confidence(candidate) {
  const material = candidateMaterial(candidate);
  if (candidate.onvif) return 'HIGH';
  if (CAMERA_HINT.test(material) && candidate.openPorts.has(554)) return 'HIGH';
  if (CAMERA_HINT.test(material) || candidate.openPorts.has(554)) return 'MEDIUM';
  return 'LOW';
}

function detectedName(candidate) {
  return [candidate.onvif?.name, candidate.http?.title, candidate.http?.realm]
    .map((value) => text(value, 180))
    .find((value) => value && !/^(login|web service|index)$/i.test(value))
    || `Cámara detectada ${candidate.ip}`;
}

export function candidateToInventoryItem(candidate, macAddress = '', now = new Date().toISOString()) {
  if (!candidate?.ip || confidence(candidate) === 'LOW') return null;
  const mac = text(macAddress, 40).toUpperCase();
  const uuid = text(candidate.onvif?.uuid, 250);
  return {
    externalId: uuid ? `onvif:${uuid}` : mac ? `mac:${mac}` : `ip:${candidate.ip}`,
    sourceSystem: 'NETWORK_DISCOVERY',
    type: 'CAMERA',
    name: detectedName(candidate),
    ipAddress: candidate.ip,
    macAddress: mac,
    manufacturer: manufacturer(candidate),
    model: text(candidate.onvif?.hardware, 160),
    status: 'ONLINE',
    lastSeenAt: now,
    capabilities: {
      inventory: true,
      status: true,
      snapshot: false,
      onvifDiscovered: Boolean(candidate.onvif),
      rtspDetected: candidate.openPorts.has(554),
    },
    metadata: {
      discoveryConfidence: confidence(candidate),
      discoveryMethods: [...candidate.methods],
      openPorts: [...candidate.openPorts].sort((a, b) => a - b),
      onvifLocation: text(candidate.onvif?.location, 250),
      onvifTypes: candidate.onvif?.types || [],
      httpServer: text(candidate.http?.server, 180),
      httpTitle: text(candidate.http?.title, 180),
      rtspServer: text(candidate.rtsp?.server, 180),
    },
  };
}

export class NetworkDiscoveryAdapter {
  constructor({ env = process.env } = {}) {
    this.name = 'NETWORK_DISCOVERY';
    this.cidrs = detectLocalPrivateCidrs(env.DMS_NETWORK_CIDRS || '');
    this.scanPorts = String(env.DMS_NETWORK_SCAN_PORTS || DEFAULT_PORTS.join(','))
      .split(',').map(Number)
      .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535)
      .slice(0, 8);
    this.timeoutMs = boundedNumber(env.DMS_NETWORK_PROBE_TIMEOUT_MS, 600, 200, 5_000);
    this.onvifTimeoutMs = boundedNumber(env.DMS_NETWORK_ONVIF_TIMEOUT_MS, 1_500, 500, 5_000);
    this.concurrency = boundedNumber(env.DMS_NETWORK_SCAN_CONCURRENCY, 48, 4, 96);
    this.maxHosts = boundedNumber(env.DMS_NETWORK_MAX_HOSTS, 1_024, 1, 2_000);
  }

  capabilities() {
    return {
      inventory: true,
      heartbeat: true,
      commands: ['PING', 'INVENTORY_SYNC'],
      snapshots: false,
      liveVideo: false,
      networkDiscovery: true,
      sourceSystems: ['NETWORK_DISCOVERY'],
    };
  }

  async testConnection() {
    if (!this.cidrs.length) {
      const error = new Error('No se detectó ninguna subred IPv4 privada para explorar. Configure DMS_NETWORK_CIDRS.');
      error.code = 'NETWORK_DISCOVERY_NO_PRIVATE_SUBNET';
      throw error;
    }
    const devices = await this.listDevices();
    return {
      source: this.name,
      cidrs: this.cidrs,
      devices: devices.length,
      message: `${devices.length} posible(s) cámara(s) detectada(s) en ${this.cidrs.join(', ')}.`,
    };
  }

  async listDevices() {
    if (!this.cidrs.length) return [];
    const candidates = new Map();

    (await discoverOnvif(this.onvifTimeoutMs)).forEach((response) => {
      mergeCandidate(candidates, response.ip, { method: 'ONVIF_WS_DISCOVERY', onvif: response });
    });

    const tasks = [];
    hostsForCidrs(this.cidrs, this.maxHosts).forEach((ip) => {
      this.scanPorts.forEach((port) => tasks.push({ ip, port }));
    });
    const checks = await mapLimit(tasks, this.concurrency, async ({ ip, port }) => ({
      ip, port, open: await portOpen(ip, port, this.timeoutMs),
    }));
    checks.filter((item) => item.open).forEach(({ ip, port }) => {
      mergeCandidate(candidates, ip, { method: `TCP_${port}`, openPort: port });
    });

    await mapLimit([...candidates.values()], Math.min(16, this.concurrency), async (candidate) => {
      const webPort = candidate.openPorts.has(443) ? 443 : candidate.openPorts.has(80) ? 80 : 0;
      if (webPort) {
        const info = await probeWeb(candidate.ip, webPort, Math.max(750, this.timeoutMs));
        if (info) mergeCandidate(candidates, candidate.ip, { method: `HTTP_${webPort}`, http: info });
      }
      if (candidate.openPorts.has(554)) {
        const info = await probeRtsp(candidate.ip, Math.max(750, this.timeoutMs));
        if (info) mergeCandidate(candidates, candidate.ip, { method: 'RTSP_OPTIONS', rtsp: info });
      }
    });

    const macs = await readNeighborTable();
    const now = new Date().toISOString();
    return [...candidates.values()]
      .map((candidate) => candidateToInventoryItem(candidate, macs.get(candidate.ip) || '', now))
      .filter(Boolean)
      .slice(0, 2_500);
  }

  async execute(command) {
    const type = String(command?.Tipo || command?.type || '').toUpperCase();
    if (type === 'PING') {
      return { pong: true, adapter: this.name, cidrs: this.cidrs, receivedAt: new Date().toISOString() };
    }
    if (type === 'INVENTORY_SYNC') {
      const devices = await this.listDevices();
      return { inventoryRequested: true, deviceCount: devices.length, devices };
    }
    const error = new Error(`El adaptador de red no admite el comando ${type || 'desconocido'}.`);
    error.code = 'UNSUPPORTED_COMMAND';
    throw error;
  }
}
