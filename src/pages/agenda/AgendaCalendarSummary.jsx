import React, { useMemo } from 'react';
import Icon from '../../components/common/Icon';

const STATUS_GROUPS = Object.freeze([
  { key: 'COMPLETA', label: 'Boleta realizada', shortLabel: 'Realizadas', icon: 'task_alt', tone: 'success' },
  { key: 'PENDIENTE', label: 'Boleta pendiente', shortLabel: 'Pendientes', icon: 'warning', tone: 'danger' },
  { key: 'FUTURA', label: 'Programada', shortLabel: 'Programadas', icon: 'schedule', tone: 'info' },
  { key: 'NO_REQUIERE', label: 'No requiere boleta', shortLabel: 'No requieren', icon: 'remove_done', tone: 'neutral' },
]);

export default function AgendaCalendarSummary({ items = [], month = '', searching = false }) {
  const monthItems = useMemo(() => (
    items.filter((item) => String(item?.Fecha || '').slice(0, 7) === month && String(item?.Estado || '').toUpperCase() !== 'CANCELADA')
  ), [items, month]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(STATUS_GROUPS.map((group) => [group.key, 0]));
    monthItems.forEach((item) => {
      const status = String(item?.status || '').toUpperCase();
      if (Object.prototype.hasOwnProperty.call(result, status)) result[status] += 1;
    });
    return result;
  }, [monthItems]);

  return <section className="agenda-month-summary" aria-label="Resumen del mes">
    <div className="agenda-month-summary__total">
      <span><Icon name="calendar_month" /></span>
      <div>
        <small>{searching ? 'Resultados en el mes' : 'Agendas del mes'}</small>
        <strong>{monthItems.length}</strong>
      </div>
    </div>

    <div className="agenda-month-summary__statuses">
      {STATUS_GROUPS.map((group) => <div className={`agenda-summary-status agenda-summary-status--${group.tone}`} key={group.key} title={group.label}>
        <span><Icon name={group.icon} /></span>
        <div><strong>{counts[group.key] || 0}</strong><small>{group.shortLabel}</small></div>
      </div>)}
    </div>
  </section>;
}
