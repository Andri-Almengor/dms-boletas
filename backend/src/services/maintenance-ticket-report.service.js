function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim() || fallback;
  return fallback;
}

function normalized(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanize(key) {
  return cleanText(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function parseJsonObject(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value, '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function valueFromAnswerObject(value = {}) {
  const candidates = [
    value.value,
    value.valor,
    value.Valor,
    value.respuesta,
    value.Respuesta,
    value.answer,
    value.Answer,
    value.resultado,
    value.Resultado,
  ];
  return candidates.find((item) => item !== undefined && item !== null && item !== '');
}

function labelFromAnswerObject(value = {}, fallback = '') {
  return cleanText(
    value.label
      || value.etiqueta
      || value.Pregunta
      || value.pregunta
      || value.nombre
      || value.Nombre
      || value.key
      || value.Clave,
    fallback,
  );
}

function readableValue(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return cleanText(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => readableValue(item, depth + 1))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const direct = valueFromAnswerObject(value);
    if (direct !== undefined) return readableValue(direct, depth + 1);
    return Object.entries(value)
      .filter(([key]) => !['id', 'questionId', 'PreguntaDispositivoID', 'typeId', 'TipoDispositivoID', 'order', 'Orden', 'key', 'Clave', 'label', 'Pregunta', 'pregunta'].includes(key))
      .map(([, item]) => readableValue(item, depth + 1))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function metadataEntries(value, fallbackLabel = '') {
  const list = Array.isArray(value) ? value : [];
  return list.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const label = labelFromAnswerObject(item, fallbackLabel || `Verificación ${index + 1}`);
    const answer = readableValue(valueFromAnswerObject(item));
    return label && answer ? [[label, answer]] : [];
  });
}

const ANSWER_METADATA_KEYS = new Set([
  '__preguntas',
  'preguntas',
  'questionDetails',
  'respuestasDetalle',
  'metadata',
]);

export function maintenanceDeviceChecks(device = {}) {
  const answers = parseJsonObject(device.RespuestasJSON || device.respuestas || {});
  const checks = [
    ['Funcionamiento general', readableValue(device.Funcionamiento)],
    ['Condición de uso', readableValue(device.EnUso)],
  ];

  for (const [key, value] of Object.entries(answers)) {
    if (ANSWER_METADATA_KEYS.has(key)) {
      checks.push(...metadataEntries(value));
      continue;
    }

    if (Array.isArray(value)) {
      const detailed = metadataEntries(value, humanize(key));
      if (detailed.length) checks.push(...detailed);
      else {
        const text = readableValue(value);
        if (text) checks.push([humanize(key), text]);
      }
      continue;
    }

    if (value && typeof value === 'object') {
      const label = labelFromAnswerObject(value, humanize(key));
      const answer = readableValue(value);
      if (label && answer) checks.push([label, answer]);
      continue;
    }

    const text = readableValue(value);
    if (text) checks.push([humanize(key), text]);
  }

  const seen = new Set();
  return checks
    .map(([label, value]) => [cleanText(label), cleanText(value)])
    .filter(([label, value]) => label && value && value !== '[object Object]')
    .filter(([label]) => {
      const key = normalized(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function classifyMaintenanceAnswer(value) {
  const text = normalized(value);
  if (!text || ['n a', 'na', 'no aplica', 'sin dato'].includes(text)) return 'neutral';
  if (text.includes('guardado') || text.includes('reserva')) return 'positive';
  if (text.includes('pendiente') || text.includes('por revisar') || text.includes('sin verificar')) return 'pending';
  if (
    text === 'no'
    || text.includes('no funciona')
    || text.includes('sin funcionamiento')
    || text.includes('falla')
    || text.includes('mal estado')
    || text.includes('incorrect')
    || text.includes('defect')
    || text.includes('sin señal')
    || text.includes('desconect')
  ) return 'negative';
  if (
    text === 'si'
    || text === 'sí'
    || text.startsWith('si ')
    || text.startsWith('sí ')
    || text.includes('correct')
    || text.includes('conforme')
    || text.includes('operativ')
    || text.includes('funciona')
    || text.includes('estable')
    || text.includes('aprob')
    || text.includes('buen estado')
  ) return 'positive';
  return 'neutral';
}

function deviceStatus(device, checks) {
  const state = normalized(device.Estado);
  if (state.includes('pendiente')) return 'pending';
  if (state.includes('mal') || state.includes('falla') || state.includes('incorrect')) return 'issue';
  if (checks.some(([, value]) => classifyMaintenanceAnswer(value) === 'negative')) return 'issue';
  if (checks.some(([, value]) => classifyMaintenanceAnswer(value) === 'pending')) return 'pending';
  if (state.includes('correct') || state.includes('conforme') || state.includes('final')) return 'correct';
  if (checks.length && checks.every(([, value]) => ['positive', 'neutral'].includes(classifyMaintenanceAnswer(value)))) return 'correct';
  return 'review';
}

function articleFor(label) {
  const text = normalized(label);
  if (/^(estado|funcionamiento|montaje|lector|respaldo|almacenamiento|servicio)/.test(text)) return 'el';
  if (/^(alimentacion|conexion|condicion|limpieza|visualizacion|grabacion|funcion|cerradura|prueba|revision)/.test(text)) return 'la';
  return 'la verificación de';
}

function checklistPhrase(labels) {
  const unique = [...new Set(labels.map(cleanText).filter(Boolean))];
  if (!unique.length) return '';
  const items = unique.map((label) => `${articleFor(label)} ${label.toLowerCase()}`);
  return joinNatural(items);
}

function joinNatural(items) {
  const values = items.map(cleanText).filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`;
}

function formatDateEs(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return text;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function deviceName(device) {
  return cleanText(device.NombreDispositivo, 'dispositivo sin nombre');
}

function deviceCategory(device) {
  return cleanText(device.Categoria || device.TipoDispositivo, 'dispositivo');
}

function deviceLocation(device, maintenance = {}) {
  return cleanText(
    device.UbicacionEquipoNombre
      || device.UbicacionEquipo
      || device.Zona
      || maintenance.Ubicacion,
  );
}

function deviceArticle(category) {
  const text = normalized(category);
  return /^(camara|puerta|impresora|bocina|cerradura|fuente)/.test(text) ? 'la' : 'el';
}

function deviceReference(device, maintenance = {}) {
  const category = deviceCategory(device).toLowerCase();
  const name = deviceName(device);
  const location = deviceLocation(device, maintenance);
  const details = [
    cleanText(device.Fabricante) ? `fabricante ${cleanText(device.Fabricante)}` : '',
    cleanText(device.Modelo) ? `modelo ${cleanText(device.Modelo)}` : '',
    cleanText(device.Serie) ? `serie ${cleanText(device.Serie)}` : '',
  ].filter(Boolean);
  const article = deviceArticle(category);
  const locationPhrase = location ? `, ${article === 'la' ? 'ubicada' : 'ubicado'} en ${location}` : '';
  return `${article} ${category} “${name}”${locationPhrase}${details.length ? ` (${details.join(', ')})` : ''}`;
}

function testNarrative(device, maintenance) {
  const checks = maintenanceDeviceChecks(device);
  const positive = checks.filter(([, value]) => classifyMaintenanceAnswer(value) === 'positive');
  const negative = checks.filter(([, value]) => classifyMaintenanceAnswer(value) === 'negative');
  const pending = checks.filter(([, value]) => classifyMaintenanceAnswer(value) === 'pending');
  const neutral = checks.filter(([, value]) => classifyMaintenanceAnswer(value) === 'neutral');
  const sentences = [`Se inspeccionó ${deviceReference(device, maintenance)}.`];

  if (positive.length) {
    sentences.push(`Se comprobaron satisfactoriamente ${checklistPhrase(positive.map(([label]) => label))}.`);
  }
  if (negative.length) {
    sentences.push(`Se detectaron condiciones no conformes en ${checklistPhrase(negative.map(([label]) => label))}.`);
  }
  if (pending.length) {
    sentences.push(`Quedaron pendientes de verificación ${checklistPhrase(pending.map(([label]) => label))}.`);
  }
  if (neutral.length) {
    const details = neutral
      .map(([label, value]) => `${label.toLowerCase()}: ${value}`)
      .filter((item) => !item.includes('[object Object]'));
    if (details.length) sentences.push(`También se registraron los siguientes datos: ${details.join('; ')}.`);
  }

  const observation = cleanText(device.Observacion);
  if (observation) sentences.push(`Observación técnica: ${observation}.`);
  return sentences.join(' ').replace(/\.\./g, '.');
}

function resultNarrative(device, maintenance) {
  const checks = maintenanceDeviceChecks(device);
  const status = deviceStatus(device, checks);
  const reference = deviceReference(device, maintenance);
  const negativeLabels = checks
    .filter(([, value]) => classifyMaintenanceAnswer(value) === 'negative')
    .map(([label]) => label);
  const pendingLabels = checks
    .filter(([, value]) => classifyMaintenanceAnswer(value) === 'pending')
    .map(([label]) => label);
  const observation = cleanText(device.Observacion);

  if (status === 'pending') {
    const reason = [
      pendingLabels.length ? `faltan por confirmar ${checklistPhrase(pendingLabels)}` : '',
      negativeLabels.length ? `se detectaron observaciones en ${checklistPhrase(negativeLabels)}` : '',
      observation ? `se registró la observación: ${observation}` : '',
    ].filter(Boolean);
    return `${reference.charAt(0).toUpperCase()}${reference.slice(1)} quedó pendiente de seguimiento${reason.length ? ` debido a que ${joinNatural(reason)}` : ''}.`;
  }

  if (status === 'issue') {
    const issues = negativeLabels.length
      ? `requiere atención en ${checklistPhrase(negativeLabels)}`
      : 'requiere atención técnica';
    return `${reference.charAt(0).toUpperCase()}${reference.slice(1)} ${issues}${observation ? `. Observación registrada: ${observation}` : ''}.`;
  }

  if (status === 'correct') {
    return `${reference.charAt(0).toUpperCase()}${reference.slice(1)} quedó operativa y con las verificaciones registradas en condición conforme${observation ? `. Se dejó como observación: ${observation}` : ''}.`;
  }

  return `${reference.charAt(0).toUpperCase()}${reference.slice(1)} quedó registrada para revisión posterior, ya que la información disponible no permite establecer una conclusión automática${observation ? `. Observación: ${observation}` : ''}.`;
}

function summaryCounts(devices) {
  return devices.reduce((summary, device) => {
    const status = deviceStatus(device, maintenanceDeviceChecks(device));
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, { correct: 0, issue: 0, pending: 0, review: 0 });
}

function plural(count, singular, pluralValue) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function reportSummary(devices) {
  const counts = summaryCounts(devices);
  const parts = [
    counts.correct ? plural(counts.correct, 'dispositivo quedó conforme', 'dispositivos quedaron conformes') : '',
    counts.issue ? plural(counts.issue, 'dispositivo presentó una condición que requiere atención', 'dispositivos presentaron condiciones que requieren atención') : '',
    counts.pending ? plural(counts.pending, 'dispositivo quedó pendiente', 'dispositivos quedaron pendientes') : '',
    counts.review ? plural(counts.review, 'dispositivo quedó para revisión', 'dispositivos quedaron para revisión') : '',
  ].filter(Boolean);
  return parts.length ? `Como resultado de la jornada, ${joinNatural(parts)}.` : 'No se registraron resultados de dispositivos durante la jornada.';
}

function recommendationsFor(devices, maintenance) {
  const recommendations = [];
  for (const device of devices) {
    const observation = cleanText(device.Observacion);
    const status = deviceStatus(device, maintenanceDeviceChecks(device));
    const name = deviceName(device);
    const location = deviceLocation(device, maintenance);
    if (observation) recommendations.push(`${name}${location ? ` (${location})` : ''}: ${observation}`);
    else if (status === 'pending') recommendations.push(`Completar la revisión pendiente del dispositivo ${name}${location ? ` ubicado en ${location}` : ''}.`);
  }
  if (!recommendations.length) {
    recommendations.push('Mantener el programa de revisión preventiva y dar seguimiento a cualquier cambio detectado en la operación de los equipos.');
  }
  return recommendations.join('\n');
}

export function safeReportText(value, fallback = '') {
  const text = readableValue(value)
    .replace(/\[object Object\]/gi, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
  return text || fallback;
}

export function mergeImprovedMaintenanceDraft(raw, improved = {}) {
  const fields = ['titulo', 'razonVisita', 'descripcion', 'pruebasRealizadas', 'resultado', 'recomendaciones'];
  const result = { ...raw };
  for (const field of fields) {
    const improvedValue = improved?.[field];
    const candidate = typeof improvedValue === 'string'
      ? safeReportText(improvedValue)
      : '';
    result[field] = candidate || raw[field];
  }
  return result;
}

export function buildMaintenanceTicketDraft(bundle = {}, group = {}) {
  const maintenance = bundle.maintenance || {};
  const devices = Array.isArray(group.devices) ? group.devices : [];
  const technicians = (group.technicians || []).map((item) => cleanText(item.name)).filter(Boolean);
  const technicianNames = joinNatural(technicians) || 'el equipo técnico asignado';
  const categories = [...new Set(devices.map(deviceCategory).filter(Boolean))];
  const locations = [...new Set(devices.map((device) => deviceLocation(device, maintenance)).filter(Boolean))];
  const date = formatDateEs(group.date) || 'la fecha registrada';
  const client = cleanText(maintenance.Cliente || bundle.client?.Nombre, 'el cliente');
  const mainLocation = cleanText(maintenance.Ubicacion) || joinNatural(locations);
  const amount = plural(devices.length, 'dispositivo', 'dispositivos');

  const workVerb = technicians.length === 1 ? 'realizó' : 'realizaron';
  const reason = `Durante la jornada del ${date}, ${technicianNames} ${workVerb} labores de mantenimiento preventivo y revisión técnica sobre ${amount} de ${client}${mainLocation ? ` en ${mainLocation}` : ''}.`;
  const description = `El alcance incluyó ${joinNatural(categories.map((item) => item.toLowerCase())) || 'los equipos registrados'}${locations.length ? ` distribuidos en ${joinNatural(locations)}` : ''}. Se documentaron las verificaciones funcionales, el estado de uso, las condiciones observadas y las evidencias asociadas a cada dispositivo.`;
  const tests = [
    `Durante la inspección se evaluaron ${amount} y se registraron las pruebas efectuadas en cada equipo:`,
    ...devices.map((device, index) => `${index + 1}. ${testNarrative(device, maintenance)}`),
  ].join('\n');
  const result = [
    reportSummary(devices),
    ...devices.map((device, index) => `${index + 1}. ${resultNarrative(device, maintenance)}`),
  ].join('\n');

  return {
    titulo: `Informe de mantenimiento de ${categories.join(', ') || 'dispositivos'} - ${group.date || date}`,
    razonVisita: safeReportText(reason),
    descripcion: safeReportText(description),
    pruebasRealizadas: safeReportText(tests),
    resultado: safeReportText(result),
    recomendaciones: safeReportText(recommendationsFor(devices, maintenance)),
    categories,
    technicianNames: technicians.join(', '),
  };
}
