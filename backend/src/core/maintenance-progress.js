const FIXED_CATEGORIES = Object.freeze([
  { key: 'cameras', label: 'Cámaras', field: 'CantCámaras', aliases: ['camara', 'camaras'] },
  { key: 'doors', label: 'Puertas', field: 'CantPuertas', aliases: ['puerta', 'puertas', 'control de acceso', 'controles de acceso', 'control acceso'] },
  { key: 'servers', label: 'Servidores', field: 'CantServidores', aliases: ['servidor', 'servidores'] },
  { key: 'recorders', label: 'Grabadores', field: 'CantGrabadores', aliases: ['grabador', 'grabadores', 'nvr', 'dvr'] },
  { key: 'speakers', label: 'Bocinas', field: 'CantBocinas', aliases: ['bocina', 'bocinas', 'altavoz', 'altavoces'] },
  { key: 'perimeter-sensors', label: 'Sensores perimetrales', field: 'CantSensoresPerimetrales', aliases: ['sensor perimetral', 'sensores perimetrales'] },
  { key: 'motion-sensors', label: 'Sensores de movimiento', field: 'CantSensoresMovimiento', aliases: ['sensor movimiento', 'sensor de movimiento', 'sensores de movimiento'] },
  { key: 'break-sensors', label: 'Sensores de ruptura', field: 'CantSensorRuptura', aliases: ['sensor ruptura', 'sensor de ruptura', 'sensores de ruptura'] },
  { key: 'printers', label: 'Impresoras', field: 'CantImpresora', aliases: ['impresora', 'impresoras'] },
  { key: 'cabinets', label: 'Gabinetes', field: 'CantGabinetes', aliases: ['gabinete', 'gabinetes'] },
  { key: 'videowall', label: 'VideoWall', field: 'CantVideoWall', aliases: ['videowall', 'video wall', 'videowalls'] },
]);

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseCounts(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isActive(row = {}) {
  if (row.Activo === false) return false;
  const value = normalize(row.Activo);
  return !['false', '0', 'no', 'inactivo', 'inactive'].includes(value);
}

const FIXED_BY_ALIAS = new Map();
for (const category of FIXED_CATEGORIES) {
  for (const alias of category.aliases) FIXED_BY_ALIAS.set(normalize(alias), category);
  FIXED_BY_ALIAS.set(normalize(category.label), category);
}

function fixedCategory(value) {
  return FIXED_BY_ALIAS.get(normalize(value)) || null;
}

function dynamicLabelFromKey(value) {
  return clean(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function typeMaps(deviceTypes = []) {
  const byId = new Map();
  const byName = new Map();
  for (const row of deviceTypes || []) {
    const id = clean(row.TipoDispositivoID || row.id);
    const name = clean(row.Nombre || row.TipoDispositivo || row.name);
    if (id) byId.set(id, name || id);
    if (name) byName.set(normalize(name), { id, name });
  }
  return { byId, byName };
}

function createDefinition(map, key, label, order = 1000) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      label: clean(label) || 'Dispositivo',
      expected: 0,
      registered: 0,
      order,
    });
  }
  return map.get(key);
}

function mergeExpected(definition, value) {
  // El JSON y las columnas fijas pueden representar la misma cantidad.
  // Se usa el mayor valor para no duplicar el total planificado.
  definition.expected = Math.max(definition.expected, nonNegativeNumber(value));
}

function dynamicDefinitionForType(definitions, typeId, typeName, expected = 0) {
  const fixed = fixedCategory(typeName);
  if (fixed) {
    const index = FIXED_CATEGORIES.findIndex((item) => item.key === fixed.key);
    const definition = createDefinition(definitions, `fixed:${fixed.key}`, fixed.label, index);
    mergeExpected(definition, expected);
    return definition;
  }

  const key = typeId ? `type:${typeId}` : `name:${normalize(typeName)}`;
  const definition = createDefinition(definitions, key, typeName || typeId || 'Dispositivo');
  mergeExpected(definition, expected);
  return definition;
}

export function buildMaintenanceProgress({ maintenance = {}, devices = [], deviceTypes = [] } = {}) {
  const definitions = new Map();
  const counts = parseCounts(maintenance.CantidadesJSON);
  const types = typeMaps(deviceTypes);

  FIXED_CATEGORIES.forEach((category, index) => {
    const definition = createDefinition(definitions, `fixed:${category.key}`, category.label, index);
    mergeExpected(definition, maintenance[category.field]);
    mergeExpected(definition, counts[category.field]);
  });

  Object.entries(counts).forEach(([rawKey, rawValue]) => {
    const typeIdMatch = String(rawKey).match(/^TipoDispositivo:(.+)$/i);
    if (typeIdMatch) {
      const typeId = clean(typeIdMatch[1]);
      dynamicDefinitionForType(definitions, typeId, types.byId.get(typeId) || typeId, rawValue);
      return;
    }

    const typeNameMatch = String(rawKey).match(/^TipoDispositivoNombre:(.+)$/i);
    if (typeNameMatch) {
      const storedName = clean(typeNameMatch[1]);
      const known = types.byName.get(normalize(storedName));
      dynamicDefinitionForType(definitions, known?.id || '', known?.name || dynamicLabelFromKey(storedName), rawValue);
    }
  });

  for (const device of devices || []) {
    if (!isActive(device)) continue;
    const typeId = clean(device.TipoDispositivoID || device.tipoDispositivoId);
    let typeName = clean(device.TipoDispositivo || device.Categoria || device.categoria);
    if (!typeName && typeId) typeName = types.byId.get(typeId) || '';

    const fixed = fixedCategory(typeName || types.byId.get(typeId));
    const definition = fixed
      ? createDefinition(
        definitions,
        `fixed:${fixed.key}`,
        fixed.label,
        FIXED_CATEGORIES.findIndex((item) => item.key === fixed.key),
      )
      : dynamicDefinitionForType(definitions, typeId, typeName || types.byId.get(typeId) || 'Dispositivo');
    definition.registered += 1;
  }

  const items = [...definitions.values()]
    .filter((item) => item.expected > 0 || item.registered > 0)
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'))
    .map((item) => ({
      key: item.key,
      label: item.label,
      registered: item.registered,
      expected: item.expected,
      remaining: Math.max(0, item.expected - item.registered),
      percentage: item.expected > 0 ? Math.round((item.registered / item.expected) * 1000) / 10 : 0,
    }));

  const registered = items.reduce((total, item) => total + item.registered, 0);
  const expected = items.reduce((total, item) => total + item.expected, 0);
  return {
    items,
    registered,
    expected,
    remaining: Math.max(0, expected - registered),
    percentage: expected > 0 ? Math.round((registered / expected) * 1000) / 10 : 0,
    overPlan: Math.max(0, registered - expected),
  };
}

export function plannedCountsFingerprint(maintenance = {}) {
  const counts = parseCounts(maintenance.CantidadesJSON);
  const pairs = [];
  for (const category of FIXED_CATEGORIES) {
    pairs.push([category.field, nonNegativeNumber(maintenance[category.field] ?? counts[category.field])]);
  }
  Object.entries(counts)
    .filter(([key]) => /^TipoDispositivo(?::|Nombre:)/i.test(key))
    .forEach(([key, value]) => pairs.push([String(key), nonNegativeNumber(value)]));
  pairs.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(pairs);
}

export function maintenancePlannedCountsChanged(before = {}, after = {}) {
  return plannedCountsFingerprint(before) !== plannedCountsFingerprint(after);
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function isMaintenanceProgressWeekday(date = new Date(), timeZone = 'America/Costa_Rica') {
  const weekday = zonedParts(date, timeZone).weekday;
  return !['Sat', 'Sun'].includes(weekday);
}

export function maintenanceProgressScheduleSlot(
  date = new Date(),
  timeZone = 'America/Costa_Rica',
  hours = [7, 17],
) {
  const parts = zonedParts(date, timeZone);
  if (['Sat', 'Sun'].includes(parts.weekday)) return null;
  const hour = Number(parts.hour);
  const allowed = new Set((hours || []).map(Number).filter(Number.isFinite));
  if (!allowed.has(hour)) return null;
  const slot = `${String(hour).padStart(2, '0')}:00`;
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    key: `${dateKey}|${slot}`,
    dateKey,
    slot,
    hour,
    minute: Number(parts.minute),
  };
}

function localTimestamp(date, timeZone) {
  return new Intl.DateTimeFormat('es-CR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function heading(reason, slot) {
  if (reason === 'CREATED') return '🆕 MANTENIMIENTO CREADO';
  if (reason === 'COUNTS_UPDATED') return '🔢 CANTIDADES DEL MANTENIMIENTO ACTUALIZADAS';
  if (slot === '07:00') return '🌅 ESTADO DE MANTENIMIENTO · 7:00 a. m.';
  if (slot === '17:00') return '🌇 ESTADO DE MANTENIMIENTO · 5:00 p. m.';
  return '🛠️ ESTADO DE MANTENIMIENTO';
}

export function formatMaintenanceProgressMessage({
  maintenance = {},
  progress = { items: [], registered: 0, expected: 0, remaining: 0, percentage: 0, overPlan: 0 },
  reason = 'SCHEDULED',
  slot = '',
  now = new Date(),
  timeZone = 'America/Costa_Rica',
} = {}) {
  const lines = [
    heading(reason, slot),
    '',
    `Cliente: ${clean(maintenance.Cliente) || 'Sin especificar'}`,
    `Mantenimiento: ${clean(maintenance.TituloMantenimiento) || clean(maintenance.MantenimientoID) || 'Sin título'}`,
  ];

  if (clean(maintenance.Ubicacion)) lines.push(`Ubicación: ${clean(maintenance.Ubicacion)}`);
  lines.push('Estado: PENDIENTE', '', 'Avance por tipo:');

  if (!progress.items?.length) {
    lines.push('• Sin cantidades planificadas ni dispositivos registrados.');
  } else {
    progress.items.forEach((item) => {
      lines.push(`• ${item.label}: ${item.registered} de ${item.expected}`);
    });
  }

  lines.push('', `Total: ${progress.registered} de ${progress.expected} (${progress.percentage}%)`);
  if (progress.remaining > 0) lines.push(`Pendientes: ${progress.remaining}`);
  if (progress.overPlan > 0) lines.push(`Sobre lo planificado: +${progress.overPlan}`);
  if (clean(maintenance.Responsables)) lines.push(`Responsables: ${clean(maintenance.Responsables)}`);
  lines.push(`Actualizado: ${localTimestamp(now, timeZone)}`);

  return lines.join('\n').slice(0, 3900);
}
