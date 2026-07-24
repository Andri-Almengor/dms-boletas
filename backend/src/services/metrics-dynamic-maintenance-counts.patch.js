import { metricsHandlers } from '../modules/metrics.module.js';
import { readTables } from '../infra/sheets.repository.js';

const originalMaintenanceMetrics = metricsHandlers.maintenance;
const FIXED_FIELDS = new Set([
  'CantCámaras', 'CantPuertas', 'CantServidores', 'CantGrabadores', 'CantBocinas',
  'CantSensoresPerimetrales', 'CantSensoresMovimiento', 'CantSensorRuptura',
  'CantImpresora', 'CantGabinetes', 'CantVideoWall',
]);

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}
function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function sameText(left, right) { return normalized(left) === normalized(right); }
function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}
function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}
function categoryLabel(value) {
  const key = normalized(value);
  if (['camara', 'camaras'].includes(key)) return 'Cámaras';
  if (['puerta', 'puertas', 'control de acceso', 'control acceso', 'controles de acceso', 'control de accesos'].includes(key)) return 'Puertas';
  if (['servidor', 'servidores'].includes(key)) return 'Servidor';
  if (['grabador', 'grabadores', 'nvr', 'dvr'].includes(key)) return 'Grabador';
  if (['bocina', 'bocinas', 'altavoz', 'altavoces'].includes(key)) return 'Bocinas';
  return clean(value, 'Sin categoría');
}
function parseCounts(row = {}) {
  try {
    return typeof row.CantidadesJSON === 'string'
      ? JSON.parse(row.CantidadesJSON || '{}')
      : (row.CantidadesJSON || {});
  } catch {
    return {};
  }
}
function dynamicExpectedForMaintenance(maintenance, typesById, typesByName) {
  const result = new Map();
  const counts = parseCounts(maintenance);
  for (const [key, rawAmount] of Object.entries(counts)) {
    const amount = number(rawAmount);
    if (!amount || FIXED_FIELDS.has(key)) continue;

    let type = null;
    let fallbackLabel = '';
    if (key.startsWith('TipoDispositivo:')) {
      const id = key.slice('TipoDispositivo:'.length);
      type = typesById.get(id);
      fallbackLabel = id;
    } else if (key.startsWith('TipoDispositivoNombre:')) {
      const nameKey = normalized(key.slice('TipoDispositivoNombre:'.length));
      type = typesByName.get(nameKey);
      fallbackLabel = key.slice('TipoDispositivoNombre:'.length).replace(/\s+/g, ' ');
    } else {
      continue;
    }

    const label = categoryLabel(type?.Nombre || fallbackLabel || key);
    result.set(label, (result.get(label) || 0) + amount);
  }
  return result;
}

metricsHandlers.maintenance = async function maintenanceMetricsWithDynamicCounts(ctx = {}) {
  const base = await originalMaintenanceMetrics(ctx);
  const payload = ctx.payload || {};
  const client = clean(payload.cliente || payload.Cliente);
  const date = dateOnly(payload.fecha || payload.Fecha);
  const category = clean(payload.categoria || payload.Categoria);

  const tables = await readTables(['Mantenimiento', 'TiposDispositivo']);
  const types = (tables.TiposDispositivo || []).filter(active);
  const typesById = new Map(types.map((row) => [clean(row.TipoDispositivoID), row]));
  const typesByName = new Map(types.map((row) => [normalized(row.Nombre), row]));
  const selectedMaintenances = (tables.Mantenimiento || [])
    .filter(active)
    .filter((row) => !client || sameText(row.Cliente, client))
    .filter((row) => !date || dateOnly(row.Fecha) === date);

  const dynamicExpected = new Map();
  selectedMaintenances.forEach((maintenance) => {
    dynamicExpectedForMaintenance(maintenance, typesById, typesByName).forEach((amount, label) => {
      dynamicExpected.set(label, (dynamicExpected.get(label) || 0) + amount);
    });
  });

  if (!dynamicExpected.size) return base;

  const summaryByKey = new Map((base.resumenCategorias || []).map((row) => [normalized(row.categoria), { ...row }]));
  dynamicExpected.forEach((amount, label) => {
    if (category && !sameText(label, category)) return;
    const key = normalized(label);
    const current = summaryByKey.get(key) || {
      categoria: label,
      totalEsperado: 0,
      registrados: 0,
      faltantes: 0,
      porcentaje: 0,
    };
    current.totalEsperado = number(current.totalEsperado) + amount;
    current.faltantes = Math.max(0, current.totalEsperado - number(current.registrados));
    current.porcentaje = current.totalEsperado
      ? Math.min(100, Math.round((number(current.registrados) / current.totalEsperado) * 100))
      : (number(current.registrados) ? 100 : 0);
    summaryByKey.set(key, current);
  });

  const resumenCategorias = [...summaryByKey.values()]
    .filter((row) => !category || sameText(row.categoria, category))
    .sort((left, right) => number(right.totalEsperado) - number(left.totalEsperado)
      || clean(left.categoria).localeCompare(clean(right.categoria), 'es'));
  const dispositivosEsperados = resumenCategorias.reduce((sum, row) => sum + number(row.totalEsperado), 0);
  const dispositivosRegistrados = number(base.totals?.dispositivosRegistrados);
  const categorias = [...new Set([
    ...(base.options?.categorias || []),
    ...resumenCategorias.map((row) => row.categoria),
  ])].sort((left, right) => clean(left).localeCompare(clean(right), 'es'));

  return {
    ...base,
    options: { ...base.options, categorias },
    totals: {
      ...base.totals,
      dispositivosEsperados,
      dispositivosFaltantes: Math.max(0, dispositivosEsperados - dispositivosRegistrados),
      avance: dispositivosEsperados
        ? Math.min(100, Math.round((dispositivosRegistrados / dispositivosEsperados) * 100))
        : (dispositivosRegistrados ? 100 : 0),
    },
    resumenCategorias,
  };
};
