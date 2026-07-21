import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { requestAvailable } from '../../services/moduleApi';
import {
  DonutBreakdown,
  FilterChip,
  formatMetric,
  MetricCard,
  MetricsEmpty,
  MetricsPanel,
  MetricsStatus,
  ProgressBar,
} from './MetricsPrimitives';

const MAINTENANCE_METRICS_ROUTES = ['metrics.maintenance.get', 'metricas.mantenimientos.get'];
const INITIAL_FILTERS = { cliente: '', fecha: '', funcionamiento: '', enUso: '' };

function normal(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function statusTone(value) {
  return normal(value).startsWith('si') ? 'metrics-status metrics-status--success' : 'metrics-status metrics-status--danger';
}

export default function MaintenanceMetricsDashboard() {
  const { sessionToken } = useAuth();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await requestAvailable(MAINTENANCE_METRICS_ROUTES, filters, sessionToken));
    } catch (requestError) {
      setError(requestError.message || 'No fue posible cargar las métricas de mantenimientos.');
    } finally {
      setLoading(false);
    }
  }, [filters, sessionToken]);

  useEffect(() => { load(); }, [load]);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'cliente' ? { fecha: '' } : {}),
    }));
  }

  const totals = data?.totals || {};
  const charts = data?.charts || {};
  const options = data?.options || {};
  const activeFilters = useMemo(() => [
    filters.cliente && ['cliente', `Cliente: ${filters.cliente}`],
    filters.fecha && ['fecha', `Fecha: ${filters.fecha}`],
    filters.funcionamiento && ['funcionamiento', `Funcionamiento: ${filters.funcionamiento}`],
    filters.enUso && ['enUso', `En uso: ${filters.enUso}`],
  ].filter(Boolean), [filters]);

  const detailRows = useMemo(() => {
    const term = normal(search);
    if (!term) return data?.detailRows || [];
    return (data?.detailRows || []).filter((row) => normal(Object.values(row).join(' ')).includes(term));
  }, [data, search]);

  const useTotal = Number(charts.activeUse || 0) + Number(charts.stored || 0);
  const operationalTotal = Number(charts.operating || 0) + Number(charts.failing || 0);

  return <section className="metrics-dashboard" aria-label="Métricas de mantenimientos">
    <div className="metrics-dashboard__heading">
      <div><h2>Dashboard de mantenimientos</h2><p>Progreso de equipos esperados, evidencias, funcionamiento y uso de los dispositivos.</p></div>
      <button type="button" className="button button--secondary" onClick={load} disabled={loading}><Icon name="refresh" />Actualizar</button>
    </div>

    <section className="metrics-filters">
      <label><span>Cliente</span><select value={filters.cliente} onChange={(event) => updateFilter('cliente', event.target.value)} disabled={loading}><option value="">Todos los clientes</option>{(options.clientes || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Fecha de mantenimiento</span><select value={filters.fecha} onChange={(event) => updateFilter('fecha', event.target.value)} disabled={loading}><option value="">Todas las fechas</option>{(options.fechas || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Funcionamiento</span><select value={filters.funcionamiento} onChange={(event) => updateFilter('funcionamiento', event.target.value)} disabled={loading}><option value="">Todos</option>{(options.funcionamiento || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>En uso</span><select value={filters.enUso} onChange={(event) => updateFilter('enUso', event.target.value)} disabled={loading}><option value="">Todos</option>{(options.enUso || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button type="button" className="button button--ghost" onClick={() => { setFilters(INITIAL_FILTERS); setSearch(''); }} disabled={loading || (!activeFilters.length && !search)}><Icon name="filter_alt_off" />Limpiar</button>
    </section>

    <div className="metrics-active-filters"><span>Filtros activos:</span>{activeFilters.length ? activeFilters.map(([key, label]) => <FilterChip key={key} label={label} onRemove={() => updateFilter(key, '')} />) : <small>Sin filtros adicionales</small>}</div>

    <MetricsStatus loading={loading && !data} error={error} />
    {data && <>
      <div className="metrics-kpi-grid">
        <MetricCard icon="engineering" label="Mantenimientos" value={formatMetric(totals.mantenimientos, 0)} note="Registros seleccionados" />
        <MetricCard icon="photo_library" label="Evidencias" value={formatMetric(totals.evidencias, 0)} note="Fotografías registradas" />
        <MetricCard icon="inventory" label="Esperados" value={formatMetric(totals.dispositivosEsperados, 0)} note="Equipos planificados" />
        <MetricCard icon="devices" label="Registrados" value={formatMetric(totals.dispositivosRegistrados, 0)} note="Equipos inspeccionados" tone="success" />
        <MetricCard icon="report_problem" label="Faltantes" value={formatMetric(totals.dispositivosFaltantes, 0)} note="Pendientes de registrar" tone="warning" />
        <MetricCard icon="monitoring" label="Avance total" value={`${formatMetric(totals.avance, 0)}%`} note="Cumplimiento del inventario" tone="primary" progress={totals.avance} />
      </div>

      <div className="metrics-layout metrics-layout--maintenance">
        <MetricsPanel title="Progreso por categoría" hint="Comparación entre equipos esperados y registrados." className="metrics-panel--wide">
          {(data.resumenCategorias || []).length ? <div className="metrics-table-wrap"><table className="metrics-table metrics-category-table"><thead><tr><th>Categoría</th><th>Esperados</th><th>Registrados</th><th>Faltantes</th><th>Avance</th></tr></thead><tbody>{data.resumenCategorias.map((row) => <tr key={row.categoria}><td><strong>{row.categoria}</strong></td><td>{row.totalEsperado}</td><td>{row.registrados}</td><td className={row.faltantes > 0 ? 'metrics-danger-text' : ''}>{row.faltantes}</td><td><div className="metrics-category-progress"><ProgressBar value={row.porcentaje} tone={row.porcentaje >= 80 ? 'success' : 'primary'} /><span>{row.porcentaje}%</span></div></td></tr>)}</tbody></table></div> : <MetricsEmpty>Sin categorías para mostrar.</MetricsEmpty>}
        </MetricsPanel>

        <MetricsPanel title="Estatus de funcionamiento" hint={`${formatMetric(totals.dispositivosFiltrados, 0)} dispositivo(s) bajo los filtros actuales.`}>
          <DonutBreakdown total={operationalTotal} items={[
            { label: 'Funcional', value: charts.operating || 0, color: '#16845b' },
            { label: 'Con falla / sin dato', value: charts.failing || 0, color: '#ba1a1a' },
          ]} />
        </MetricsPanel>

        <MetricsPanel title="Distribución de activos" hint="Equipos en uso y almacenados.">
          <div className="metrics-usage-list">
            <div><span><strong>En uso</strong><b>{formatMetric(charts.activeUse, 0)}</b></span><ProgressBar value={useTotal ? (Number(charts.activeUse || 0) / useTotal) * 100 : 0} tone="primary" /></div>
            <div><span><strong>Almacenados</strong><b>{formatMetric(charts.stored, 0)}</b></span><ProgressBar value={useTotal ? (Number(charts.stored || 0) / useTotal) * 100 : 0} tone="muted" /></div>
          </div>
        </MetricsPanel>
      </div>

      <MetricsPanel title="Detalle de evidencias y dispositivos" hint={`Mostrando ${detailRows.length} de ${(data.detailRows || []).length} registros.`}>
        <div className="metrics-search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar dispositivo, zona, cliente o mantenimiento..." /></div>
        {detailRows.length ? <div className="metrics-table-wrap"><table className="metrics-table metrics-device-table"><thead><tr><th>Zona / dispositivo</th><th>Categoría</th><th>Funcionamiento</th><th>Uso</th><th>Fecha</th><th>Responsable</th><th>Evidencias</th><th>Mantenimiento</th><th>Observación</th></tr></thead><tbody>{detailRows.map((row) => <tr key={row.deviceId}><td><strong>{row.nombreDispositivo}</strong><small>{row.zona}</small></td><td>{row.categoria}</td><td><span className={statusTone(row.funcionamiento)}>{row.funcionamiento}</span></td><td><span className="metrics-status metrics-status--info">{row.enUso}</span></td><td>{row.fechaRegistro || row.fechaMantenimiento || '-'}</td><td>{row.creador}</td><td>{row.evidencias}</td><td><strong>{row.tituloMantenimiento}</strong><small>{row.cliente} · {row.estadoMantenimiento}</small></td><td className="metrics-observation" title={row.observacion}>{row.observacion || '-'}</td></tr>)}</tbody></table></div> : <MetricsEmpty />}
      </MetricsPanel>
    </>}
  </section>;
}
