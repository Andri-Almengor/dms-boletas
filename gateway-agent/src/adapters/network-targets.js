import os from 'node:os';

function ipv4ToInt(ip) {
  const parts = String(ip).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value) {
  const unsigned = value >>> 0;
  return [unsigned >>> 24, (unsigned >>> 16) & 255, (unsigned >>> 8) & 255, unsigned & 255].join('.');
}

export function isValidIpv4(ip) {
  return ipv4ToInt(ip) !== null;
}

export function isPrivateTargetIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function cidrBounds(ip, prefix) {
  const value = ipv4ToInt(ip);
  if (value === null || prefix < 24 || prefix > 32) return null;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  let start = network;
  let end = broadcast;
  if (prefix <= 30) {
    start = network + 1;
    end = broadcast - 1;
  }
  return { network, broadcast, start, end };
}

function rangeTarget(startIp, endIp, original) {
  const start = ipv4ToInt(startIp);
  const end = ipv4ToInt(endIp);
  if (start === null || end === null || end < start) return null;
  return {
    kind: start === end ? 'IP' : 'RANGE',
    spec: start === end ? intToIpv4(start) : `${intToIpv4(start)}-${intToIpv4(end)}`,
    original,
    start,
    end,
    hostCount: end - start + 1,
    privateOnly: isPrivateTargetIpv4(startIp) && isPrivateTargetIpv4(endIp),
  };
}

export function parseNetworkTarget(value) {
  const original = String(value || '').trim();
  if (!original) return null;

  const cidrMatch = original.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,3})$/);
  if (cidrMatch) {
    const suffix = Number(cidrMatch[2]);
    if (suffix <= 32) {
      const bounds = cidrBounds(cidrMatch[1], suffix);
      if (!bounds) return null;
      return {
        kind: suffix === 32 ? 'IP' : 'CIDR',
        spec: suffix === 32 ? intToIpv4(bounds.start) : `${intToIpv4(bounds.network)}/${suffix}`,
        original,
        prefix: suffix,
        start: bounds.start,
        end: bounds.end,
        hostCount: Math.max(0, bounds.end - bounds.start + 1),
        privateOnly: isPrivateTargetIpv4(cidrMatch[1]),
      };
    }

    // Atajo solicitado para rangos dentro del mismo /24: 192.168.4.100/200.
    if (suffix <= 255) {
      const startIp = cidrMatch[1];
      const parts = startIp.split('.');
      const startLast = Number(parts[3]);
      if (suffix < startLast) return null;
      return rangeTarget(startIp, `${parts[0]}.${parts[1]}.${parts[2]}.${suffix}`, original);
    }
    return null;
  }

  const shortRange = original.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3})$/);
  if (shortRange) {
    const parts = shortRange[1].split('.');
    const last = Number(shortRange[2]);
    if (!Number.isInteger(last) || last < 0 || last > 255) return null;
    return rangeTarget(shortRange[1], `${parts[0]}.${parts[1]}.${parts[2]}.${last}`, original);
  }

  const fullRange = original.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (fullRange) return rangeTarget(fullRange[1], fullRange[2], original);

  if (isValidIpv4(original)) return rangeTarget(original, original, original);
  return null;
}

function autoPrivateTargets() {
  const targets = [];
  Object.values(os.networkInterfaces()).flat().filter(Boolean).forEach((entry) => {
    const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
    if (entry.internal || !['IPv4', '4'].includes(family) || !isPrivateTargetIpv4(entry.address)) return;
    const parts = String(entry.address).split('.');
    const target = parseNetworkTarget(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
    if (target) targets.push(target);
  });
  const unique = new Map(targets.map((target) => [target.spec, target]));
  return [...unique.values()].slice(0, 8);
}

export function parseNetworkTargets(raw = '', {
  allowPublic = false,
  maxHosts = 1_024,
  maxPublicHostsPerTarget = 256,
} = {}) {
  const pieces = String(raw || '')
    .split(/[;,\r\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const targets = pieces.length ? pieces.map(parseNetworkTarget) : autoPrivateTargets();

  if (targets.some((target) => !target)) {
    throw new Error(
      'Hay un rango inválido. Use IP, CIDR /24 a /32, rango IP-IP, 192.168.4.100-200 o el atajo 192.168.4.100/200.',
    );
  }

  const unique = [...new Map(targets.map((target) => [target.spec, target])).values()];
  for (const target of unique) {
    if (target.hostCount < 1) throw new Error(`El rango ${target.original} no contiene direcciones utilizables.`);
    if (!target.privateOnly) {
      if (!allowPublic) {
        throw new Error(
          `El destino ${target.original} no es una red privada RFC1918. Para una IP/red pública autorizada, habilite DMS_NETWORK_ALLOW_PUBLIC_TARGETS=true localmente.`,
        );
      }
      if (target.hostCount > maxPublicHostsPerTarget) {
        throw new Error(`El destino público ${target.original} supera el máximo de ${maxPublicHostsPerTarget} IP por rango.`);
      }
    }
  }

  const hosts = [];
  const seen = new Set();
  for (const target of unique) {
    for (let current = target.start; current <= target.end; current += 1) {
      const ip = intToIpv4(current);
      if (!seen.has(ip)) {
        seen.add(ip);
        hosts.push(ip);
      }
      if (hosts.length >= maxHosts) break;
    }
    if (hosts.length >= maxHosts) break;
  }

  return { targets: unique, hosts };
}

export function findNetworkTarget(targets = [], ip = '') {
  const value = ipv4ToInt(ip);
  if (value === null) return null;
  return targets.find((target) => value >= target.start && value <= target.end) || null;
}
