import React from 'react';
import Icon from '../common/Icon';

export function formatMetric(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value || '0';
  return new Intl.NumberFormat('es-CR', { maximumFractionDigits }).format(number);
}

export function MetricCard({
  icon,
  label,
  value,
  note,
  tone = 'default',
  progress = null,
  onClick = null,
  active = false,
  actionLabel = '',
}) {
  const content = <>
    <div className="metrics-kpi__top"><span>{label}</span><span className="metrics-kpi__icon"><Icon name={icon} /></span></div>
    <strong>{value}</strong>
    {progress !== null && <div className="metrics-progress" aria-label={`${label}: ${progress}%`}><span style={{ width: `${Math.max(0, Math.min(100, Number(progress) || 0))}%` }} /></div>}
    {note && <small>{note}</small>}
  </>;
  const className = `metrics-kpi metrics-kpi--${tone}${onClick ? ' metrics-kpi--interactive' : ''}${active ? ' is-active' : ''}`;
  if (onClick) {
    return <button type="button" className={className} onClick={onClick} aria-pressed={active} title={actionLabel || `Filtrar por ${label}`}>{content}</button>;
  }
  return <article className={className}>{content}</article>;
}

export function MetricsPanel({ title, hint, children, className = '' }) {
  return <section className={`metrics-panel ${className}`.trim()}>
    <header className="metrics-panel__header"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></header>
    {children}
  </section>;
}

export function MetricsEmpty({ children = 'No hay datos para los filtros seleccionados.' }) {
  return <div className="metrics-empty"><Icon name="query_stats" /><span>{children}</span></div>;
}

export function MetricsStatus({ loading, error }) {
  if (loading) return <div className="metrics-state"><Icon name="progress_activity" /><span>Cargando métricas...</span></div>;
  if (error) return <div className="metrics-state metrics-state--error"><Icon name="error" /><span>{error}</span></div>;
  return null;
}

export function FilterChip({ label, onRemove }) {
  return <button type="button" className="metrics-chip" onClick={onRemove} title="Quitar filtro"><span>{label}</span><Icon name="close" /></button>;
}

export function ProgressBar({ value, tone = 'primary' }) {
  const percentage = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className={`metrics-progress metrics-progress--${tone}`}><span style={{ width: `${percentage}%` }} /></div>;
}

export function BarDistribution({ rows = [], onSelect, selected = '', emptyText }) {
  if (!rows.length) return <MetricsEmpty>{emptyText}</MetricsEmpty>;
  const max = Math.max(...rows.map((row) => Number(row[1]) || 0), 1);
  return <div className="metrics-bars">
    {rows.map(([label, value]) => {
      const active = selected && String(selected) === String(label);
      return <button type="button" key={label} className={`metrics-bar-row${active ? ' is-active' : ''}`} onClick={() => onSelect?.(label)} aria-pressed={Boolean(active)}>
        <span className="metrics-bar-row__meta"><strong>{label}</strong><b>{formatMetric(value)}</b></span>
        <span className="metrics-bar-row__track"><span style={{ width: `${Math.max(4, Math.round(((Number(value) || 0) / max) * 100))}%` }} /></span>
      </button>;
    })}
  </div>;
}

export function DateColumns({ rows = [], onSelect, selected = '' }) {
  if (!rows.length) return <MetricsEmpty>No hay fechas disponibles.</MetricsEmpty>;
  const max = Math.max(...rows.map((row) => Number(row[1]) || 0), 1);
  return <div className="metrics-date-chart" role="list">
    {rows.map(([label, value]) => <button type="button" role="listitem" key={label} className={String(selected) === String(label) ? 'is-active' : ''} onClick={() => onSelect?.(label)} aria-pressed={String(selected) === String(label)} title={`${label}: ${value}`}>
      <span className="metrics-date-chart__value">{formatMetric(value, 0)}</span>
      <span className="metrics-date-chart__column"><span style={{ height: `${Math.max(8, Math.round(((Number(value) || 0) / max) * 100))}%` }} /></span>
      <small>{label}</small>
    </button>)}
  </div>;
}

export function DonutBreakdown({ total = 0, items = [], onSelect, selected = '' }) {
  const colors = ['#c77800', '#16845b', '#6161ff', '#af101a', '#5f5e5e'];
  const safeTotal = Math.max(Number(total) || 0, items.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    cursor += safeTotal ? ((Number(item.value) || 0) / safeTotal) * 100 : 0;
    return `${item.color || colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  const background = safeTotal && stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--surface-container)';
  return <div className="metrics-donut-layout">
    <div className="metrics-donut" style={{ background }}><div><strong>{formatMetric(safeTotal, 0)}</strong><span>Total</span></div></div>
    <div className="metrics-legend">
      {items.map((item, index) => {
        const filterValue = item.filterValue || item.label;
        const active = String(selected) === String(filterValue);
        return <button type="button" key={item.label} className={active ? 'is-active' : ''} onClick={() => onSelect?.(filterValue)} aria-pressed={active}>
          <span><i style={{ background: item.color || colors[index % colors.length] }} />{item.label}</span><strong>{formatMetric(item.value, 0)}</strong>
        </button>;
      })}
    </div>
  </div>;
}
