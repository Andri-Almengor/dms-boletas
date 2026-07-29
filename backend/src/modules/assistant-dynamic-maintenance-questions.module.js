import { readTables } from '../infra/sheets.repository.js';
import {
  parseMaintenanceAnswers,
  parseMaintenanceQuestionSnapshot,
} from '../services/maintenance-question-catalog.service.js';
import { assistantOperationalReportHandlers } from './assistant-operational-report.module.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function active(row = {}) {
  const enabled = normalized(row.Activo ?? 'true');
  const status = normalized(row.Estado || '');
  return !['false', '0', 'no'].includes(enabled) && status !== 'inactivo';
}

function maintenanceReference(row = {}) {
  return clean(row.MantenimientoRef || row.MantenimientoID || row.MantenimientoRefID || row.maintenanceId);
}

function humanizeKey(value) {
  return clean(value)
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function answerKind(value) {
  const key = normalized(value);
  if (!key) return 'other';
  if (key.startsWith('no') && !key.includes('guardad')) return 'no';
  if (key.startsWith('si') || ['ok', 'correcto', 'bien', 'cumple', 'aprobado'].includes(key)) return 'yes';
  return 'other';
}

function functioningOk(value) {
  const key = normalized(value);
  return key.startsWith('si') || ['correcto', 'bien', 'funciona', 'funcionando'].includes(key);
}

function useStatusOk(value) {
  const key = normalized(value);
  if (!key) return false;
  if (key.startsWith('si') && key.includes('uso')) return true;
  if (key.startsWith('no') && key.includes('guardad')) return true;
  return false;
}

function deviceNeedsAttention(device) {
  const state = normalized(device.Estado);
  if (state.includes('mal') || state.includes('falla') || state.includes('atencion')) return true;
  const hasOperationalStatus = clean(device.Funcionamiento) || clean(device.EnUso);
  if (hasOperationalStatus) return !(functioningOk(device.Funcionamiento) && useStatusOk(device.EnUso));
  return false;
}

function answersForDevice(device) {
  const answers = parseMaintenanceAnswers(device.RespuestasJSON);
  const snapshot = parseMaintenanceQuestionSnapshot(answers.__preguntas);
  if (snapshot.length) {
    return snapshot
      .map((item) => ({
        key: clean(item.key || item.Clave),
        question: clean(item.label || item.Pregunta || item.key),
        answer: clean(answers[item.key || item.Clave] ?? item.value),
        order: Number(item.order ?? item.Orden ?? 0),
      }))
      .filter((item) => item.key && item.question && item.answer)
      .sort((left, right) => left.order - right.order || left.question.localeCompare(right.question, 'es'));
  }

  return Object.entries(answers)
    .filter(([key, value]) => !key.startsWith('__') && value !== null && typeof value !== 'object' && clean(value))
    .map(([key, value]) => ({ key, question: humanizeKey(key), answer: clean(value), order: 0 }));
}

function summarizeCategories(devices) {
  const groups = new Map();
  for (const device of devices) {
    const category = clean(device.TipoDispositivo || device.Categoria, 'Sin categoría');
    const row = groups.get(category) || { category, total: 0, good: 0, bad: 0, checklistMap: new Map() };
    row.total += 1;
    if (deviceNeedsAttention(device)) row.bad += 1;
    else row.good += 1;

    for (const item of answersForDevice(device)) {
      const current = row.checklistMap.get(item.question) || {
        question: item.question,
        yes: 0,
        no: 0,
        other: 0,
        answered: 0,
      };
      current.answered += 1;
      current[answerKind(item.answer)] += 1;
      row.checklistMap.set(item.question, current);
    }
    groups.set(category, row);
  }

  return [...groups.values()]
    .map(({ checklistMap, ...row }) => ({ ...row, checklist: [...checklistMap.values()] }))
    .sort((left, right) => left.category.localeCompare(right.category, 'es'));
}

function dynamicLines(categories) {
  return categories.map((category) => {
    const checks = category.checklist.map((item) => {
      const parts = [`${item.yes} sí`];
      if (item.no) parts.push(`${item.no} no`);
      if (item.other) parts.push(`${item.other} otro`);
      return `${item.question}: ${parts.join(', ')}`;
    }).join('; ');
    return `${category.category}: ${category.total} equipos, ${category.good} bien y ${category.bad} con atención${checks ? `. Verificaciones: ${checks}` : ''}.`;
  }).join('\n');
}

function sanitizeLegacyQuestionMetadata(answer) {
  return clean(answer)
    .replace(/;?\s*Preguntas:\s*\d+\s+sí(?:,\s*\d+\s+no)?(?:,\s*\d+\s+otro)?/gi, '')
    .replace(/\s+\./g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function enhanceAttentionDevices(result, devices) {
  const byId = new Map(devices.map((device) => [clean(device.EvidenciaMantenimientoID), device]));
  const current = Array.isArray(result.facts?.devices) ? result.facts.devices : [];
  const enhanced = current.map((view) => {
    const device = byId.get(clean(view.id));
    if (!device) return view;
    const failedChecks = answersForDevice(device)
      .filter((item) => answerKind(item.answer) === 'no')
      .map((item) => item.question);
    const observationParts = [clean(device.Observacion)];
    if (failedChecks.length) observationParts.push(`Pruebas con atención: ${failedChecks.join(', ')}`);
    return {
      ...view,
      failedChecks: failedChecks.join(', '),
      observation: observationParts.filter(Boolean).join(' · '),
    };
  });
  return enhanced;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function maintenanceLocationListIntent(question) {
  const text = normalized(question);
  const mentionsLocations = /\b(ubicacion|ubicaciones|zona|zonas)\b/.test(text);
  const mentionsMaintenance = /\b(mantenimiento|mantenimientos|ultimo|ultima|reciente)\b/.test(text);
  const requestsList = /\b(lista|listar|dame|muestrame|mostrar|cuales|indica|segun)\b/.test(text);
  return mentionsLocations && mentionsMaintenance && requestsList;
}

function storedLocationGroups(maintenance = {}) {
  return parseArray(maintenance.UbicacionesEquipoJSON).map((item) => {
    if (typeof item === 'string') return { id: clean(item), name: '', locationId: '', locationName: '' };
    return {
      id: clean(item?.id || item?.value || item?.UbicacionEquipoID || item?.ubicacionEquipoId),
      name: clean(item?.name || item?.nombre || item?.Nombre || item?.UbicacionEquipoNombre),
      locationId: clean(item?.locationId || item?.ubicacionId || item?.UbicacionID),
      locationName: clean(item?.locationName || item?.ubicacionNombre || item?.UbicacionNombre),
    };
  }).filter((item) => item.id);
}

function maintenanceLocations(maintenance, devices, equipmentLocations, clientLocations) {
  const catalogById = new Map(equipmentLocations.map((row) => [clean(row.UbicacionEquipoID), row]));
  const clientLocationNames = new Map(clientLocations.map((row) => [clean(row.UbicacionID), clean(row.Nombre)]));
  const stored = storedLocationGroups(maintenance);
  const storedById = new Map(stored.map((group) => [group.id, group]));
  const orderedIds = stored.map((group) => group.id);
  const knownIds = new Set(orderedIds);
  const deviceCounts = new Map();
  const deviceNames = new Map();

  for (const device of devices) {
    const id = clean(device.UbicacionEquipoID);
    if (!id) continue;
    deviceCounts.set(id, (deviceCounts.get(id) || 0) + 1);
    if (!deviceNames.has(id)) deviceNames.set(id, clean(device.UbicacionEquipoNombre || device.Zona));
    if (!knownIds.has(id)) {
      orderedIds.push(id);
      knownIds.add(id);
    }
  }

  const resolved = orderedIds.map((id) => {
    const snapshot = storedById.get(id) || {};
    const catalog = catalogById.get(id);
    const locationId = clean(snapshot.locationId || catalog?.UbicacionID);
    return {
      id,
      name: clean(snapshot.name || catalog?.Nombre || deviceNames.get(id), 'Ubicación no disponible'),
      locationId,
      locationName: clean(snapshot.locationName || clientLocationNames.get(locationId)),
      description: clean(catalog?.Descripcion),
      deviceCount: Number(deviceCounts.get(id) || 0),
      historical: !catalog,
    };
  });

  const legacy = new Map();
  for (const device of devices) {
    if (clean(device.UbicacionEquipoID)) continue;
    const name = clean(device.UbicacionEquipoNombre || device.Zona, 'Sin ubicación');
    const id = `legacy:${normalized(name) || 'sin-ubicacion'}`;
    const current = legacy.get(id) || {
      id,
      name,
      locationId: '',
      locationName: '',
      description: 'Registro histórico sin identificador de ubicación.',
      deviceCount: 0,
      historical: true,
    };
    current.deviceCount += 1;
    legacy.set(id, current);
  }

  return [...resolved, ...legacy.values()];
}

function locationLine(location, index) {
  const count = Number(location.deviceCount || 0);
  const details = [location.name];
  if (location.locationName) details.push(`sede: ${location.locationName}`);
  details.push(`${count} ${count === 1 ? 'dispositivo' : 'dispositivos'}`);
  if (location.historical) details.push('registro histórico');
  return `${index + 1}. ${details.join(' · ')}`;
}

async function buildMaintenanceLocationList(ctx, question) {
  const reportQuestion = `${question}\nGenera un resumen del mantenimiento.`;
  const result = await assistantOperationalReportHandlers.chat({
    ...ctx,
    payload: {
      ...(ctx.payload || {}),
      message: reportQuestion,
      question: reportQuestion,
    },
  });

  if (result?.type === 'clarification') return { ...result, resumeQuestion: question };
  if (!result?.facts?.maintenanceReport?.id) return result;

  const maintenanceId = clean(result.facts.maintenanceReport.id);
  try {
    const tables = await readTables([
      'Mantenimiento',
      'Evidencia_Mantenimientos',
      'ClienteUbicacionesEquipo',
      'ClienteUbicaciones',
    ]);
    const maintenance = (tables.Mantenimiento || [])
      .find((row) => clean(row.MantenimientoID) === maintenanceId);
    if (!maintenance) return result;

    const devices = (tables.Evidencia_Mantenimientos || [])
      .filter((row) => active(row) && maintenanceReference(row) === maintenanceId);
    const locations = maintenanceLocations(
      maintenance,
      devices,
      tables.ClienteUbicacionesEquipo || [],
      tables.ClienteUbicaciones || [],
    );
    const report = result.facts.maintenanceReport;
    const maintenanceLabel = clean(report.title, 'Mantenimiento');
    const maintenanceDate = clean(report.date, 'sin fecha registrada');
    const client = clean(report.client, 'el cliente');
    const answer = locations.length
      ? [
        `Según el mantenimiento más reciente de ${client}, “${maintenanceLabel}” del ${maintenanceDate}, estas son las ubicaciones del equipo registradas:`,
        ...locations.map(locationLine),
      ].join('\n')
      : `El mantenimiento más reciente de ${client}, “${maintenanceLabel}” del ${maintenanceDate}, no tiene ubicaciones del equipo registradas.`;

    return {
      ...result,
      answer,
      facts: {
        ...result.facts,
        locations,
        locationList: {
          maintenanceId,
          maintenanceTitle: maintenanceLabel,
          maintenanceDate,
          client,
          total: locations.length,
        },
      },
      suggestions: [
        'Dame los equipos con fallas de este mantenimiento',
        '¿Qué modelos se registraron?',
        '¿Cuántas evidencias tiene este mantenimiento?',
      ],
      context: {
        ...(result.context || {}),
        lastIntent: 'maintenance_locations',
      },
    };
  } catch (error) {
    console.warn(`[assistant-maintenance-locations] No se pudo construir la lista: ${error?.message || error}`);
    return result;
  }
}

async function chat(ctx) {
  const question = clean(ctx.payload?.message || ctx.payload?.question);
  if (maintenanceLocationListIntent(question)) return buildMaintenanceLocationList(ctx, question);

  const result = await assistantOperationalReportHandlers.chat(ctx);
  if (!result?.facts?.maintenanceReport) return result;

  const maintenanceIds = new Set((result.sources || [])
    .filter((source) => source.type === 'maintenance')
    .map((source) => clean(source.id))
    .filter(Boolean));
  if (!maintenanceIds.size && result.facts.maintenanceReport.id) maintenanceIds.add(clean(result.facts.maintenanceReport.id));
  if (!maintenanceIds.size) return result;

  try {
    const { Evidencia_Mantenimientos = [] } = await readTables(['Evidencia_Mantenimientos']);
    const devices = Evidencia_Mantenimientos.filter((row) => active(row) && maintenanceIds.has(maintenanceReference(row)));
    if (!devices.length) return result;
    const categories = summarizeCategories(devices);
    const lines = dynamicLines(categories);
    const answer = sanitizeLegacyQuestionMetadata(result.answer);
    const withDynamicQuestions = lines
      ? `${answer}\nVerificaciones configuradas por tipo de dispositivo:\n${lines}`
      : answer;
    const attentionDevices = enhanceAttentionDevices(result, devices);
    return {
      ...result,
      answer: withDynamicQuestions,
      facts: {
        ...result.facts,
        maintenanceReport: {
          ...result.facts.maintenanceReport,
          categories,
        },
        devices: attentionDevices,
      },
    };
  } catch (error) {
    console.warn(`[assistant-dynamic-questions] No se pudo enriquecer el reporte: ${error?.message || error}`);
    return result;
  }
}

export const assistantDynamicMaintenanceQuestionHandlers = {
  ...assistantOperationalReportHandlers,
  chat,
};
