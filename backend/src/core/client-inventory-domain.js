import { createHash } from 'node:crypto';

const clean = (value) => String(value ?? '').trim();
export const normalizeInventoryText = (value) => clean(value).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .replace(/\s+/g, ' ');

function tokens(value) {
  return [...new Set(normalizeInventoryText(value).split(' ').filter(Boolean))].sort();
}
function canonicalName(value) { return tokens(value).join(' '); }
function compact(value) { return normalizeInventoryText(value).replace(/\s/g, ''); }
function category(row) { return normalizeInventoryText(row.TipoDispositivo || row.Categoria); }
function location(row) { return clean(row.UbicacionEquipoID) || normalizeInventoryText(row.Zona); }
function model(row) { return clean(row.ModeloID) || normalizeInventoryText(row.Modelo); }
function serial(row) { return compact(row.Serie); }
function mac(row) { return compact(row.DireccionMAC); }
function name(row) { return clean(row.NombreDispositivo); }
function hasDistinctName(row) {
  const values = tokens(name(row));
  return values.length >= 2 && (
    values.some((token) => /\d/.test(token)) || values.filter((token) => !['camara','cam','puerta','equipo','dispositivo','lector','servidor'].includes(token)).length >= 2
  );
}
export function compatibleInventoryDevices(left, right) {
  if (category(left) !== category(right)) return false;
  if (serial(left) && serial(right) && serial(left) !== serial(right)) return false;
  if (mac(left) && mac(right) && mac(left) !== mac(right)) return false;
  if (model(left) && model(right) && model(left) !== model(right)) {
    // Catálogos históricos pueden omitir uno de los IDs; un modelo conflictivo bloquea fusión.
    return false;
  }
  return true;
}
function sameLocation(left, right) {
  return location(left) === location(right);
}
export function sameInventoryDevice(left, right) {
  if (!compatibleInventoryDevices(left, right)) return false;
  if (serial(left) && serial(right) && serial(left) === serial(right)) return true;
  if (mac(left) && mac(right) && mac(left) === mac(right)) return true;
  return sameLocation(left, right)
    && hasDistinctName(left) && hasDistinctName(right)
    && canonicalName(name(left)) === canonicalName(name(right));
}
function betterRepresentative(left, right) {
  const score = (item) => [serial(item), mac(item), clean(item.Modelo), clean(item.Fabricante), clean(item.Zona)]
    .filter(Boolean).length;
  return score(right) > score(left)
    || (score(right) === score(left) && clean(right.FechaTrabajo || right.maintenanceDate)
      > clean(left.FechaTrabajo || left.maintenanceDate))
    ? right : left;
}

export function groupInventoryDevices(rows = []) {
  const groups = [];
  const index = new Map();
  const sorted = [...rows].sort((a, b) =>
    clean(a.FechaTrabajo || a.maintenanceDate).localeCompare(clean(b.FechaTrabajo || b.maintenanceDate))
    || clean(a.EvidenciaMantenimientoID).localeCompare(clean(b.EvidenciaMantenimientoID)));
  const keys = (row) => {
    const type = category(row);
    const result = [];
    if (serial(row)) result.push(type + '|serial|' + serial(row));
    if (mac(row)) result.push(type + '|mac|' + mac(row));
    if (hasDistinctName(row)) result.push(type + '|name|' + location(row) + '|' + canonicalName(name(row)));
    return result;
  };
  for (const row of sorted) {
    if (!clean(row.EvidenciaMantenimientoID) || !name(row)) continue;
    const aliases = keys(row);
    const candidates = [...new Set(aliases.flatMap((key) => index.get(key) || []))];
    const matched = candidates.find((g) => g.sources.every((other) => sameInventoryDevice(row, other)));
    if (matched) {
      matched.sources.push(row);
      matched.representative = betterRepresentative(matched.representative, row);
      if (!matched.aliases.includes(name(row))) matched.aliases.push(name(row));
    } else {
      groups.push({ representative: row, sources: [row], aliases: [name(row)] });
    }
    const target = matched || groups[groups.length - 1];
    for (const key of aliases) {
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).includes(target)) index.get(key).push(target);
    }
  }
  return groups;
}

function numbers(row) {
  return [...new Set((normalizeInventoryText(name(row)).match(/\d+/g) || []))].sort().join(',');
}
export function candidateInventoryAliases(groups = [], limit = 120) {
  // Acota el costo incluso si miles de cámaras están en un mismo piso:
  // antes de comparar nombres deben coincidir también sus identificadores numéricos.
  const byIdentity = new Map();
  groups.forEach((group, index) => {
    const r = group.representative;
    if (!hasDistinctName(r)) return;
    const key = category(r) + '|' + location(r) + '|' + numbers(r);
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(index);
  });
  const pairs = [];
  for (const indices of byIdentity.values()) {
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const left = groups[indices[i]].representative;
        const right = groups[indices[j]].representative;
        if (!compatibleInventoryDevices(left, right)) continue;
        const a = tokens(name(left)), b = tokens(name(right));
        const intersection = a.filter((item) => b.includes(item)).length;
        if (intersection < 2 || intersection / Math.max(a.length, b.length) < 0.55) continue;
        pairs.push({ left: indices[i], right: indices[j],
          leftName: name(left), rightName: name(right),
          type: clean(left.TipoDispositivo || left.Categoria),
          location: clean(left.Zona), model: clean(left.Modelo), serial: clean(left.Serie) });
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}

export function mergeInventoryAliases(groups, pairs, approved = []) {
  const allowed = new Set(pairs.map((pair) => [pair.left, pair.right].join(':')));
  const parent = groups.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) index = parent[index];
    return index;
  };
  for (const item of approved) {
    const left = Number(item.left), right = Number(item.right);
    if (!Number.isInteger(left) || !Number.isInteger(right)) continue;
    if (!allowed.has([left, right].join(':')) || Number(item.confidence) < 0.95) continue;
    const a = find(left), b = find(right);
    if (a === b) continue;
    const safe = groups[a].sources.every((x) => groups[b].sources.every((y) =>
      compatibleInventoryDevices(x, y) && sameLocation(x, y)));
    if (!safe) continue;
    groups[a].sources.push(...groups[b].sources);
    for (const alias of groups[b].aliases) if (!groups[a].aliases.includes(alias)) groups[a].aliases.push(alias);
    groups[a].representative = betterRepresentative(groups[a].representative, groups[b].representative);
    parent[b] = a;
  }
  return groups.filter((_, index) => find(index) === index);
}

export function inventoryDeviceId(clientId, group, previousSourceIds = new Map()) {
  for (const source of group.sources) {
    const matched = previousSourceIds.get(clean(source.EvidenciaMantenimientoID));
    if (matched) return matched;
  }
  const first = [...group.sources].map((row) => clean(row.EvidenciaMantenimientoID)).sort()[0] || '';
  return createHash('sha256').update(clean(clientId) + '|' + first).digest('hex').slice(0, 32);
}

// Los registros antiguos con pocos campos no se vinculan por texto genérico.
function ticketCandidates(ticket, groups, sourceToGroup, evidenceSourceIds = []) {
  const direct = [
    clean(ticket.DispositivoID),
    ...evidenceSourceIds.map(clean),
  ].map((id) => sourceToGroup.get(id)).filter(Boolean);
  if (direct.length) return [...new Set(direct)].length === 1 ? [direct[0]] : [];
  const ticketType = normalizeInventoryText(ticket.TipoDispositivo);
  const ticketSerial = compact(ticket.Serie);
  const ticketMac = compact(ticket.DireccionMAC);
  if (ticketSerial || ticketMac) {
    const matched = groups.filter((g) =>
      (!ticketType || category(g.representative) === ticketType)
      && g.sources.some((row) =>
        ticketSerial && serial(row) === ticketSerial || ticketMac && mac(row) === ticketMac));
    return matched.length === 1 ? matched : [];
  }
  // Solo identidad inequívoca explícita: nombre completo en un texto,
  // mismo tipo y ubicación (si constan). Nunca enlazar por "cámara" genérica.
  const ticketText = normalizeInventoryText([
    ticket.Titulo, ticket.RazonVisita, ticket.Descripcion,
    ticket.PruebasRealizadas, ticket.Resultado,
  ].filter(Boolean).join(' '));
  if (!ticketText || !ticketType) return [];
  const ticketLocation = clean(ticket.UbicacionEquipoID);
  const matches = groups.filter((g) => {
    const r = g.representative;
    if (category(r) !== ticketType) return false;
    if (ticketLocation && location(r) !== ticketLocation) return false;
    return g.sources.some((row) => hasDistinctName(row) && tokens(name(row)).every((token) =>
      new RegExp('(?:^| )' + token + '(?: |$)').test(ticketText)));
  });
  return matches.length === 1 ? matches : [];
}

export function attachInventoryTickets(groups, tickets = [], ticketEvidence = []) {
  const sourceToGroup = new Map(groups.flatMap((g) =>
    g.sources.map((source) => [clean(source.EvidenciaMantenimientoID), g])));
  const evidenceByTicket = new Map();
  for (const evidence of ticketEvidence) {
    const key = clean(evidence.BoletaUID);
    if (!evidenceByTicket.has(key)) evidenceByTicket.set(key, []);
    evidenceByTicket.get(key).push(evidence);
  }
  const ticketMatches = new Map();
  for (const ticket of tickets) {
    const evidence = evidenceByTicket.get(clean(ticket.BoletaUID)) || [];
    const matches = ticketCandidates(ticket, groups, sourceToGroup,
      evidence.map((item) => item.OrigenMantenimientoDispositivoID).filter(Boolean));
    if (matches.length === 1) {
      const group = matches[0];
      const id = clean(ticket.BoletaUID);
      if (!ticketMatches.has(group)) ticketMatches.set(group, []);
      ticketMatches.get(group).push({ ticket, evidence });
      // Evita la asignación de una boleta a varios equipos sin referencia inequívoca.
      if (!id) ticketMatches.get(group).pop();
    }
  }
  return ticketMatches;
}


function maintenanceChecklistSummary(raw = '') {
  let answers = {};
  try {
    answers = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch { return ''; }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return '';
  const labels = new Map((Array.isArray(answers.__preguntas) ? answers.__preguntas : [])
    .map((item) => [clean(item.key || item.Clave), clean(item.label || item.Pregunta)]));
  const entries = Object.entries(answers)
    .filter(([key, value]) => key !== '__preguntas' && value != null
      && typeof value !== 'object' && clean(value))
    .map(([key, value]) => clean(labels.get(key) || key).slice(0, 120) + ': ' + clean(value).slice(0, 120))
    .slice(0, 12);
  return entries.length ? 'Checklist: ' + entries.join('; ') : '';
}
function cut(value, max = 1500) { return clean(value).slice(0, max); }
function uniqueByKey(rows, keyName) {
  return [...new Map(rows.map((row) => [row[keyName], row])).values()];
}
export function buildInventorySnapshot({
  clientId, groups, tickets = [], ticketEvidence = [], maintenanceImages = [],
  previousSourceIds = new Map(),
}) {
  const matches = attachInventoryTickets(groups, tickets, ticketEvidence);
  const imagesByDevice = new Map();
  for (const image of maintenanceImages) {
    const id = clean(image.DispositivoMantenimientoRef);
    if (!imagesByDevice.has(id)) imagesByDevice.set(id, []);
    imagesByDevice.get(id).push(image);
  }
  const devices = [], events = [], media = [];
  const usedDeviceIds = new Set();
  for (const group of groups) {
    const representative = group.representative;
    let deviceId = inventoryDeviceId(clientId, group, previousSourceIds);
    if (usedDeviceIds.has(deviceId)) {
      const firstSource = [...group.sources].map((row) => clean(row.EvidenciaMantenimientoID)).sort()[0];
      deviceId = createHash('sha256').update(clean(clientId) + '|split|' + firstSource).digest('hex').slice(0,32);
    }
    usedDeviceIds.add(deviceId);
    const sourceIds = [...new Set(group.sources.map((s) => clean(s.EvidenciaMantenimientoID)))];
    devices.push({
      clientId, deviceId,
      type: cut(representative.TipoDispositivo || representative.Categoria, 140),
      name: cut(representative.NombreDispositivo, 240),
      location: cut(representative.Zona, 240),
      manufacturer: cut(representative.Fabricante, 180),
      model: cut(representative.Modelo, 180),
      serial: cut(representative.Serie, 160),
      mac: cut(representative.DireccionMAC, 100),
      sourceIds,
      details: {
        aliases: group.aliases,
        typeId: clean(representative.TipoDispositivoID),
        equipmentLocationId: clean(representative.UbicacionEquipoID),
        manufacturerId: clean(representative.FabricanteID),
        modelId: clean(representative.ModeloID),
        functioning: cut(representative.Funcionamiento, 70),
        inUse: cut(representative.EnUso, 70),
        state: cut(representative.Estado, 70),
        lastMaintenance: cut(representative.maintenanceTitle, 240),
      },
    });
    for (const source of group.sources) {
      const maintenanceId = clean(source.MantenimientoRef);
      const date = cut(source.FechaTrabajo || source.maintenanceDate || source.maintenanceFinishedAt, 40);
      const note = [source.Observacion, maintenanceChecklistSummary(source.RespuestasJSON),
        source.maintenanceDescription]
        .map((value) => cut(value, 600)).filter(Boolean).join(' · ');
      events.push({
        clientId, deviceId, key: 'M:' + clean(source.EvidenciaMantenimientoID),
        type: 'MANTENIMIENTO', sourceId: maintenanceId,
        date, title: cut(source.maintenanceTitle || 'Mantenimiento', 240),
        summary: note || 'Revisión del dispositivo registrada en mantenimiento.',
        technicians: cut(source.Tecnicos || source.maintenanceTechnicians, 500),
      });
      for (const image of imagesByDevice.get(clean(source.EvidenciaMantenimientoID)) || []) {
        if (!clean(image.FotoDispositivoID) || !String(image.MimeType || 'image/jpeg').startsWith('image/')) continue;
        media.push({
          clientId, deviceId, key: 'M:' + clean(image.FotoDispositivoID),
          type: 'MANTENIMIENTO', sourceId: maintenanceId,
          evidenceId: clean(image.FotoDispositivoID),
          date: cut(image.FechaCaptura || image.FechaCreacion || date, 40),
          label: cut(source.maintenanceTitle || 'Mantenimiento', 240),
          mimeType: cut(image.MimeType || 'image/jpeg', 100),
          fileId: cut(image.DriveFileID, 400),
        });
      }
    }
    for (const { ticket, evidence } of matches.get(group) || []) {
      const id = clean(ticket.BoletaUID);
      events.push({
        clientId, deviceId, key: 'B:' + id, type: 'BOLETA', sourceId: id,
        date: cut(ticket.Fecha || ticket.FinalizadaEn || ticket.FechaCreacion, 40),
        title: cut(ticket.Titulo || 'Boleta ' + clean(ticket.BoletaID), 240),
        summary: [ticket.RazonVisita, ticket.Descripcion, ticket.PruebasRealizadas,
          ticket.Resultado, ticket.Recomendaciones].map((v) => cut(v, 400)).filter(Boolean).join(' · ').slice(0, 1800),
        technicians: cut(ticket.assignees || ticket.AsignadoALegacy, 500),
      });
      for (const image of evidence) {
        if (!clean(image.EvidenciaID) || !String(image.MimeType || 'image/jpeg').startsWith('image/')) continue;
        media.push({
          clientId, deviceId, key: 'B:' + clean(image.EvidenciaID),
          type: 'BOLETA', sourceId: id,
          evidenceId: clean(image.EvidenciaID),
          date: cut(image.FechaCreacion || ticket.Fecha, 40),
          label: cut('Boleta ' + clean(ticket.BoletaID), 240),
          mimeType: cut(image.MimeType || 'image/jpeg', 100),
          fileId: cut(image.ArchivoID, 400),
        });
      }
    }
  }
  return {
    devices: uniqueByKey(devices, 'deviceId'),
    events,
    media,
  };
}
