import React from 'react';
import Icon from '../../components/common/Icon';
import { statusMeta } from '../../features/agenda/agendaDomain';

function clean(value) {
  return String(value ?? '').trim();
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo || 'Usuario');
}

function shortPersonName(user = {}) {
  const parts = personName(user).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[1]}` : parts[0] || 'Usuario';
}

function formatDateLong(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export default function AgendaDayDialog({ date, items = [], onClose, onOpen }) {
  if (!date) return null;
  const ordered = [...items].sort((left, right) => (
    clean(left.HoraInicio).localeCompare(clean(right.HoraInicio))
    || clean(left.Detalle).localeCompare(clean(right.Detalle), 'es')
  ));

  return <div className="agenda-modal-backdrop agenda-day-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="agenda-day-dialog" role="dialog" aria-modal="true" aria-label={`Agendas del ${formatDateLong(date)}`}>
      <header className="agenda-day-dialog__header">
        <div>
          <span className="eyebrow">Programación del día</span>
          <h2>{formatDateLong(date)}</h2>
          <p>{ordered.length} agenda{ordered.length === 1 ? '' : 's'} programada{ordered.length === 1 ? '' : 's'}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </header>

      <div className="agenda-day-dialog__list">
        {ordered.map((item) => {
          const meta = statusMeta(item?.status);
          return <button type="button" className={`agenda-day-row agenda-day-row--${meta.tone}`} key={item.AgendaID} onClick={() => onOpen?.(item)}>
            <span className="agenda-day-row__time"><strong>{item.HoraInicio || '07:00'}</strong><small>{item.HoraFin || '17:00'}</small></span>
            <span className="agenda-day-row__main">
              <strong>{item.Detalle}</strong>
              <small>{item.asignados?.map(shortPersonName).join(', ') || 'Sin asignación'}</small>
            </span>
            <span className={`agenda-status agenda-status--${meta.tone}`}><Icon name={meta.icon} /><span>{meta.label}</span></span>
            <Icon name="chevron_right" />
          </button>;
        })}
      </div>
    </section>
  </div>;
}
