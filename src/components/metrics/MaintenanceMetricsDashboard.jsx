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
const INITIAL_FILTERS = {
  cliente: '',
  fecha: '',
  funcionamiento: '',
  enUso: '',
  categoria: '',
  funcionamientoGrupo: '',
  enUsoGrupo: '',
  evidencia: '',
  responsable: '',
};

function normal(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function statusTone(value) {
  return normal(value).startsWith('si') ? 'metrics-status metrics-status--success' : 'metrics-status metrics-status--danger';
}

function activateWithKeyboard(event, action) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
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

  function applyFilter(current, key, value) {
    const next = {
      ...current,
      [key]: value,
      ...(key === 'cliente' ? { fecha: '' } : {}),
    };
    if (key === 'funcionamiento') next.funcionamientoGrupo = '';
    if (key === 'funcionamientoGrupo') next.funcionamiento = '';
    if (key === 'enUso') next.enUsoGrupo = '';
    if (key === 'enUsoGrupo') next.enUso = '';
    return next;
  }

  function updateFilter(key, value) {
    setFilters((current) => applyFilter(current, key, value));
  }

  function toggleFilter(key, value) {
    setFilters((current) => applyFilter(current, key, String(current[key]) === String(value) ? '' : value));
  }

  function showAllMaintenances() {
    setFilters((current) => ({
      ...current,
      funcionamiento: '',
      enUso: '',
      categoria: '',
      funcionamientoGrupo: '',
      enUsoGrupo: '',
      evidencia: '',
      responsable: '',
    }));
  }

  function showAllRegistered() {
    setFilters((current) => ({
      ...current,
      funcionamiento: '',
      enUso: '',
      funcionamientoGrupo: '',
      enUsoGrupo: '',
      evidencia: '',
      responsable: '',
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
    filters.categoria && ['categoria', `Categoría: ${filters.categoria}`],
    filters.funcionamientoGrupo && ['funcionamientoGrupo', filters.funcionamientoGrupo === 'operativo' ? 'Funcionamiento: funcional' : 'Funcionamiento: con falla / sin dato'],
    filters.enUsoGrupo && ['enUsoGrupo', filters.enUsoGrupo === 'en uso' ? 'Uso: en uso' : 'Uso: almacenado'],
    filters.evidencia && ['evidencia', filters.evidencia === 'con' ? 'Con evidencias' : 'Sin evidencias'],
    filters.responsable && ['responsable', `Responsable: ${filters.responsable}`],
  ].filter(Boolean), [filters]);

  const detailRows = useMemo(() => {
    const term = normal(search);
    if (!term) return data?.detailRows || [];
    return (data?.detailRows || []).filter((row) => normal(Object.values(row).join(' ')).includes(term));
  }, [data, search]);

  const useTotal = Number(charts.activeUse || 0) + Number(charts.stored || 0);
  const operationalTotal = Number(charts.operating || 0) + Number(charts.failing || 0);
  const allDeviceDimensionsClear = !filters.funcionamiento
    && !filters.enUso
    && !filters.categoria
    && !filters.funcionamientoGrupo
    && !filters.enUsoGrupo
    && !filters.evidencia
    && !filters.responsable;
  const registeredDimensionsClear = !filters.funcionamiento
    && !filters.enUso
    && !filters.funcionamientoGrupo
    && !filters.enUsoGrupo
    && !filters.evidencia
    && !filters.responsable;

  return <section className="metrics-dashboard" aria-label="Métricas de mantenimientos">
    <div className="metrics-dashboard__heading">
      <div><h2>Dashboard de mantenimientos</h2><p>Seleccione tarjetas, categorías, estados o datos del detalle para aplicar filtros.</p></div>
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
        <MetricCard icon="engineering" label="Mantenimientos" value={formatMetric(totals.mantenimientos, 0)} note="Mostrar todos los dispositivos" onClick={showAllMaintenances} active={allDeviceDimensionsClear} actionLabel="Quitar filtros aplicados desde las métricas" />
        <MetricCard icon="photo_library" label="Evidencias" value={formatMetric(totals.evidencias, 0)} note="Filtrar dispositivos con fotografías" onClick={() => toggleFilter('evidencia', 'con')} active={filters.evidencia === 'con'} />
        <MetricCard icon="inventory" label="Esperados" value={formatMetric(totals.dispositivosEsperados, 0)} note="Equipos planificados para la categoría" />
        <MetricCard icon="devices" label="Registrados" value={formatMetric(totals.dispositivosRegistrados, 0)} note="Mostrar todos los registrados" tone="success" onClick={showAllRegistered} active={registeredDimensionsClear} />
        <MetricCard icon="report_problem" label="Faltantes" value={formatMetric(totals.dispositivosFaltantes, 0)} note="Pendientes de registrar" tone="warning" />
        <MetricCard icon="monitoring" label="Avance total" value={`${formatMetric(totals.avance, 0)}%`} note="Cumplimiento del inventario" tone="primary" progress={totals.avance} />
      </div>

      <div className="metrics-layout metrics-layout--maintenance">
        <MetricsPanel title="Progreso por categoría" hint="Seleccione una categoría para filtrar los equipos y el detalle." className="metrics-panel--wide">
          {(data.resumenCategorias || []).length ? <div className="metrics-table-wrap"><table className="metrics-table metrics-category-table metrics-table--interactive"><thead><tr><th>Categoría</th><th>Esperados</th><th>Registrados</th><th>Faltantes</th><th>Avance</th></tr></thead><tbody>{data.resumenCategorias.map((row) => {
            const selected = filters.categoria === row.categoria;
            const action = () => toggleFilter('categoria', row.categoria);
            return <tr key={row.categoria} className={selected ? 'is-active' : ''} tabIndex="0" role="button" aria-pressed={selected} onClick={action} onKeyDown={(event) => activateWithKeyboard(event, action)}><td><strong>{row.categoria}</strong></td><td>{row.totalEsperado}</td><td>{row.registrados}</td><td className={row.faltantes > 0 ? 'metrics-danger-text' : ''}>{row.faltantes}</td><td><div className="metrics-category-progress"><ProgressBar value={row.porcentaje} tone={row.porcentaje >= 80 ? 'success' : 'primary'} /><span>{row.porcentaje}%</span></div></td></tr>;
          })}</tbody></table></div> : <MetricsEmpty>Sin categorías para mostrar.</MetricsEmpty>}
        </MetricsPanel>

        <MetricsPanel title="Estatus de funcionamiento" hint={`${formatMetric(totals.dispositivosFiltrados, 0)} dispositivo(s). Seleccione un estado para filtrar.`}>
          <DonutBreakdown total={operationalTotal} selected={filters.funcionamientoGrupo} onSelect={(value) => toggleFilter('funcionamientoGrupo', value)} items={[
            { label: 'Funcional', value: charts.operating || 0, filterValue: 'operativo', color: '#16845b' },
            { label: 'Con falla / sin dato', value: charts.failing || 0, filterValue: 'falla', color: '#ba1a1a' },
          ]} />
        </MetricsPanel>

        <MetricsPanel title="Distribución de activos" hint="Seleccione en uso o almacenados para filtrar el detalle.">
          <div className="metrics-usage-list">
            <button type="button" className={filters.enUsoGrupo === 'en uso' ? 'is-active' : ''} onClick={() => toggleFilter('enUsoGrupo', 'en uso')} aria-pressed={filters.enUsoGrupo === 'en uso'}><span><strong>En uso</strong><b>{formatMetric(charts.activeUse, 0)}</b></span><ProgressBar value={useTotal ? (Number(charts.activeUse || 0) / useTotal) * 100 : 0} tone="primary" /></button>
            <button type="button" className={filters.enUsoGrupo === 'almacenado' ? 'is-active' : ''} onClick={() => toggleFilter('enUsoGrupo', 'almacenado')} aria-pressed={filters.enUsoGrupo === 'almacenado'}><span><strong>Almacenados</strong><b>{formatMetric(charts.stored, 0)}</b></span><ProgressBar value={useTotal ? (Number(charts.stored || 0) / useTotal) * 100 : 0} tone="muted" /></button>
          </div>
        </MetricsPanel>
      </div>

      <MetricsPanel title="Detalle de evidencias y dispositivos" hint={`Mostrando ${detailRows.length} de ${(data.detailRows || []).length} registros. Los datos subrayados funcionan como filtros.`}>
        <div className="metrics-search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar dispositivo, zona, cliente o mantenimiento..." /></div>
        {detailRows.length ? <div className="metrics-table-wrap"><table className="metrics-table metrics-device-table"><thead><tr><th>Zona / dispositivo</th><th>Categoría</th><th>Funcionamiento</th><th>Uso</th><th>Fecha</th><th>Responsable</th><th>Evidencias</th><th>Mantenimiento</th><th>Observación</th></tr></thead><tbody>{detailRows.map((row) => <tr key={row.deviceId}>
          <td><strong>{row.nombreDispositivo}</strong><small>{row.zona}</small></td>
          <td><button type="button" className="metrics-inline-filter" onClick={() => toggleFilter('categoria', row.categoria)}>{row.categoria}</button></td>
          <td><button type="button" className={`${statusTone(row.funcionamiento)} metrics-inline-filter`} onClick={() => toggleFilter('funcionamiento', row.funcionamiento)}>{row.funcionamiento}</button></td>
          <td><button type="button" className="metrics-status metrics-status--info metrics-inline-filter" onClick={() => toggleFilter('enUso', row.enUso)}>{row.enUso}</button></td>
          <td><button type="button" className="metrics-inline-filter" onClick={() => toggleFilter('fecha', row.fechaMantenimiento || row.fechaRegistro)}>{row.fechaRegistro || row.fechaMantenimiento || '-'}</button></td>
          <td><button type="button" className="metrics-inline-filter" onClick={() => toggleFilter('responsable', row.creador)}>{row.creador}</button></td>
          <td><button type="button" className="metrics-inline-filter" onClick={() => toggleFilter('evidencia', row.evidencias > 0 ? 'con' : 'sin')}>{row.evidencias}</button></td>
          <td><strong>{row.tituloMantenimiento}</strong><small><button type="button" className="metrics-inline-filter" onClick={() => toggleFilter('cliente', row.cliente)}>{row.cliente}</button> · {row.estadoMantenimiento}</small></td>
          <td className="metrics-observation" title={row.observacion}>{row.observacion || '-'}</td>
        </tr>)}</tbody></table></div> : <MetricsEmpty />}
      </MetricsPanel>
    </>}
  </section>;
}
