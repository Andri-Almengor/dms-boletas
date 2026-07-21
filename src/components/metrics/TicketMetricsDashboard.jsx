import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { requestAvailable } from '../../services/moduleApi';
import {
  BarDistribution,
  DateColumns,
  DonutBreakdown,
  FilterChip,
  formatMetric,
  MetricCard,
  MetricsEmpty,
  MetricsPanel,
  MetricsStatus,
} from './MetricsPrimitives';

const TICKET_METRICS_ROUTES = ['metrics.tickets.get', 'metricas.boletas.get'];
const INITIAL_FILTERS = { cliente: '', fecha: '', tipoFalla: '', estado: '' };

function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('final')) return 'metrics-status metrics-status--success';
  if (text.includes('pend')) return 'metrics-status metrics-status--warning';
  return 'metrics-status metrics-status--info';
}

export default function TicketMetricsDashboard() {
  const { sessionToken } = useAuth();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await requestAvailable(TICKET_METRICS_ROUTES, filters, sessionToken));
    } catch (requestError) {
      setError(requestError.message || 'No fue posible cargar las métricas de boletas.');
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
    filters.tipoFalla && ['tipoFalla', `Tipo de falla: ${filters.tipoFalla}`],
    filters.estado && ['estado', `Estado: ${options.estados?.find((item) => item.value === filters.estado)?.label || filters.estado}`],
  ].filter(Boolean), [filters, options.estados]);

  return <section className="metrics-dashboard" aria-label="Métricas de boletas">
    <div className="metrics-dashboard__heading">
      <div><h2>Dashboard de boletas</h2><p>Avance, estados, horas, categorías y distribución del trabajo técnico.</p></div>
      <button type="button" className="button button--secondary" onClick={load} disabled={loading}><Icon name="refresh" />Actualizar</button>
    </div>

    <section className="metrics-filters">
      <label><span>Cliente</span><select value={filters.cliente} onChange={(event) => updateFilter('cliente', event.target.value)} disabled={loading}><option value="">Todos los clientes</option>{(options.clientes || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Fecha</span><select value={filters.fecha} onChange={(event) => updateFilter('fecha', event.target.value)} disabled={loading}><option value="">Todas las fechas</option>{(options.fechas || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Tipo de falla</span><select value={filters.tipoFalla} onChange={(event) => updateFilter('tipoFalla', event.target.value)} disabled={loading}><option value="">Todos los tipos</option>{(options.tiposFalla || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Estado</span><select value={filters.estado} onChange={(event) => updateFilter('estado', event.target.value)} disabled={loading}><option value="">Todos los estados</option>{(options.estados || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="button" className="button button--ghost" onClick={() => setFilters(INITIAL_FILTERS)} disabled={loading || !activeFilters.length}><Icon name="filter_alt_off" />Limpiar</button>
    </section>

    <div className="metrics-active-filters"><span>Filtros activos:</span>{activeFilters.length ? activeFilters.map(([key, label]) => <FilterChip key={key} label={label} onRemove={() => updateFilter(key, '')} />) : <small>Sin filtros adicionales</small>}</div>

    <MetricsStatus loading={loading && !data} error={error} />
    {data && <>
      <div className="metrics-kpi-grid">
        <MetricCard icon="list_alt" label="Total boletas" value={formatMetric(totals.total, 0)} note="Registros filtrados" />
        <MetricCard icon="pending_actions" label="Pendientes" value={formatMetric(totals.pendientes, 0)} note="Requieren atención" tone="warning" />
        <MetricCard icon="task_alt" label="Finalizadas" value={formatMetric(totals.finalizadas, 0)} note="Servicios cerrados" tone="success" />
        <MetricCard icon="sync" label="En proceso / otros" value={formatMetric(totals.enProceso, 0)} note="Seguimiento activo" tone="info" />
        <MetricCard icon="timer" label="Horas totales" value={formatMetric(totals.horasTotales)} note="Horas acumuladas" />
        <MetricCard icon="speed" label="Promedio horas" value={formatMetric(totals.promedioHoras)} note="Promedio por boleta" />
      </div>

      <div className="metrics-layout metrics-layout--ticket">
        <MetricsPanel title="Boletas por fecha" hint="Seleccione una columna para filtrar el detalle por día." className="metrics-panel--wide">
          <DateColumns rows={charts.porFecha || []} selected={filters.fecha} onSelect={(value) => updateFilter('fecha', filters.fecha === value ? '' : value)} />
        </MetricsPanel>

        <MetricsPanel title="Estado de las boletas" hint="Distribución de los registros actuales.">
          <DonutBreakdown total={totals.total} selected={filters.estado} onSelect={(value) => updateFilter('estado', filters.estado === value ? '' : value)} items={[
            { label: 'Pendiente', value: totals.pendientes, filterValue: 'pendiente', color: '#c77800' },
            { label: 'Finalizado', value: totals.finalizadas, filterValue: 'finalizado', color: '#16845b' },
            { label: 'En proceso / otros', value: totals.enProceso, filterValue: 'otro', color: '#6161ff' },
          ]} />
        </MetricsPanel>

        <MetricsPanel title="Tipo de falla" hint="Principales motivos registrados.">
          <BarDistribution rows={charts.porTipoFalla || []} selected={filters.tipoFalla} onSelect={(value) => updateFilter('tipoFalla', filters.tipoFalla === value ? '' : value)} emptyText="No hay tipos de falla registrados." />
        </MetricsPanel>

        <MetricsPanel title="Rendimiento por categorías" hint="Cantidad de boletas agrupadas por categoría.">
          <BarDistribution rows={charts.porCategoria || []} emptyText="No hay categorías registradas." />
        </MetricsPanel>

        <MetricsPanel title="Horas por técnico" hint="Las horas se distribuyen entre los técnicos asignados a cada boleta.">
          {(data.tableAsignadoHoras || []).length ? <div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>#</th><th>Técnico</th><th>Horas</th></tr></thead><tbody>{data.tableAsignadoHoras.map((row) => <tr key={`${row.index}-${row.asignadoA}`}><td><span className="metrics-rank">{row.index}</span></td><td>{row.asignadoA}</td><td><strong>{formatMetric(row.horasTotales)} h</strong></td></tr>)}</tbody></table></div> : <MetricsEmpty>Sin datos de asignaciones.</MetricsEmpty>}
        </MetricsPanel>
      </div>

      <MetricsPanel title="Detalle de boletas" hint={`${(data.detailRows || []).length} registro(s) con los filtros actuales.`}>
        {(data.detailRows || []).length ? <div className="metrics-ticket-grid">{data.detailRows.map((row) => <article key={row.boletaUid} className="metrics-ticket-card">
          <header><div><small>#{row.id}</small><h3>{row.titulo}</h3></div><span className={statusClass(row.estado)}>{row.estado}</span></header>
          <dl><div><dt>Cliente</dt><dd>{row.cliente}</dd></div><div><dt>Fecha</dt><dd>{row.fecha || 'Sin fecha'}</dd></div><div><dt>Categoría</dt><dd>{row.categoria}</dd></div><div><dt>Técnico</dt><dd>{row.asignadoA}</dd></div><div><dt>Horas</dt><dd>{formatMetric(row.horasTotales)} h</dd></div><div><dt>Tipo de falla</dt><dd>{row.tipoFalla}</dd></div></dl>
          {row.esMantenimiento && <footer><Icon name="engineering" />Generada desde mantenimiento</footer>}
        </article>)}</div> : <MetricsEmpty />}
      </MetricsPanel>
    </>}
  </section>;
}
