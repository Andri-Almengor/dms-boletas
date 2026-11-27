import { AppError } from '../core/errors.js';

export const VISUAL_REPORT_FILTERS = Object.freeze(['todos', 'sanos', 'danados']);

function text(value) { return String(value ?? '').trim(); }
function normalized(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function visualDeviceState(row = {}) {
  const estado = normalized(row.estado);
  const severity = normalized(row.gravedadFalla);
  const damaged = estado === 'mal estado' || row.averiado === true;
  const healthy = !damaged && (row.operativo === true || ['buen estado', 'correcto', 'en buen estado'].includes(estado));
  return {
    kind: damaged ? 'danado' : healthy ? 'sano' : 'sin_evaluar',
    severity: damaged && severity === 'critica' ? 'Crítica'
      : damaged && severity === 'moderada' ? 'Moderada'
        : damaged && severity === 'leve' ? 'Leve' : (damaged ? 'Sin clasificar' : ''),
    rank: damaged ? (severity === 'critica' ? 0 : severity === 'moderada' ? 1 : severity === 'leve' ? 2 : 3)
      : healthy ? 4 : 5,
  };
}

// El resumen y los gráficos siempre utilizan TODOS los equipos evaluados para
// cliente/fecha; el selector afecta solo a la tabla, no a la salud del sistema.
export function buildMaintenanceVisualReportModel(data, filter = 'todos') {
  if (!VISUAL_REPORT_FILTERS.includes(filter)) throw new AppError('INVALID_REPORT_FILTER', 'Seleccione todos, solo buenos o solo dañados.', 400);
  if (!Array.isArray(data?.detailRows) || data.reportDetailCount !== data.detailRows.length
    || data.detailRows.length !== data?.totals?.dispositivosFiltrados) {
    throw new AppError('INCOMPLETE_VISUAL_REPORT', 'Los dispositivos del informe llegaron incompletos. No se generó el documento.', 502);
  }
  const all = data.detailRows.map((row) => ({ ...row, salud: visualDeviceState(row) }));
  const healthy = all.filter((row) => row.salud.kind === 'sano').length;
  const damaged = all.filter((row) => row.salud.kind === 'danado').length;
  const pending = all.length - healthy - damaged;
  const evaluated = healthy + damaged;
  const byCategory = new Map();
  all.forEach((row) => {
    const key = text(row.categoria) || 'Sin categoría';
    if (!byCategory.has(key)) byCategory.set(key, { categoria: key, total: 0, sanos: 0, danados: 0, sinEvaluar: 0 });
    const category = byCategory.get(key);
    category.total += 1;
    if (row.salud.kind === 'sano') category.sanos += 1;
    else if (row.salud.kind === 'danado') category.danados += 1;
    else category.sinEvaluar += 1;
  });
  const rows = all.filter((row) => filter === 'todos' || (filter === 'sanos' ? row.salud.kind === 'sano' : row.salud.kind === 'danado'))
    .sort((a, b) => a.salud.rank - b.salud.rank
      || a.categoria.localeCompare(b.categoria, 'es')
      || a.zona.localeCompare(b.zona, 'es')
      || a.nombreDispositivo.localeCompare(b.nombreDispositivo, 'es'));
  const visits = Array.isArray(data.reportContext?.mantenimientos)
    ? data.reportContext.mantenimientos : [];
  const sites = [...new Set(visits.map((visit) => text(visit.ubicacion)).filter(Boolean))];
  const maintenanceLabel = visits.length === 1
    ? text(visits[0].titulo || visits[0].id)
    : visits.length > 1 ? `${visits.length} mantenimientos` : '';
  const siteLabel = sites.length === 1 ? sites[0] : sites.length > 1 ? 'Varias ubicaciones' : '';
  return {
    client: text(data.filtersApplied.cliente),
    date: text(data.filtersApplied.fecha),
    maintenanceLabel,
    siteLabel,
    responsibleLabel: [...new Set(all.map((row) => text(row.creador)).filter((name) => name && name !== 'Sin responsable'))].sort((a, b) => a.localeCompare(b, 'es')).join(', '),
    evidenceCount: Number(data.totals.evidencias || 0),
    filter,
    rows,
    total: all.length,
    healthy,
    damaged,
    pending,
    evaluated,
    health: evaluated ? Math.round(healthy * 1000 / evaluated) / 10 : null,
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'es')),
  };
}


