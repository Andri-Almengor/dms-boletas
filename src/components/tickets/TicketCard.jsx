import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { pick } from '../../services/moduleApi';
import { formatDate, formatTime, getTicketId, normalizeTicketStatus } from '../../utils/tickets';

export function TicketStatusChip({ status }) {
  const normalized = String(status || '').toUpperCase().includes('FINAL') ? 'FINALIZADA' : 'PENDIENTE';
  return (
    <span className={`ticket-status ticket-status--${normalized === 'FINALIZADA' ? 'finished' : 'pending'}`}>
      {normalized === 'FINALIZADA' ? 'Finalizada' : 'Pendiente'}
    </span>
  );
}

export default function TicketCard({ ticket, compact = false }) {
  const id = getTicketId(ticket);
  const status = normalizeTicketStatus(ticket);
  const title = pick(ticket, ['Titulo', 'Título', 'TituloBoleta', 'title', 'TipoServicio'], 'Boleta de servicio');
  const client = pick(ticket, ['Cliente', 'ClienteNombre', 'Clientes', 'clientName'], 'Cliente sin especificar');
  const equipment = pick(ticket, ['Equipo', 'UbicacionEquipo', 'Ubicacion_equipo', 'Modelo', 'Categoria'], 'Servicio técnico');
  const date = pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
  const time = pick(ticket, ['HoraInicio', 'horaInicio', 'Hora']);
  const location = pick(ticket, ['Ubicacion', 'Ubicación', 'Direccion', 'Dirección']);
  const encodedId = encodeURIComponent(id || 'sin-id');

  return (
    <article className={`ticket-card ticket-card--${status === 'FINALIZADA' ? 'finished' : 'pending'}${compact ? ' ticket-card--compact' : ''}`}>
      <div className="ticket-card__header">
        <div className="ticket-card__identity">
          <span className="ticket-card__number">#{String(id || 'SIN-ID').slice(0, 20)}</span>
          <h3>{title}</h3>
          {compact && <p>Cliente: {client}</p>}
        </div>
        <TicketStatusChip status={status} />
      </div>

      {!compact && (
        <dl className="ticket-card__data">
          <div><dt>Cliente</dt><dd>{client}</dd></div>
          <div><dt>Equipo</dt><dd>{equipment}</dd></div>
        </dl>
      )}

      <div className="ticket-card__meta">
        <span><Icon name="calendar_today" /> {formatDate(date)}</span>
        {time && <span><Icon name="schedule" /> {formatTime(time)}</span>}
        {location && <span><Icon name="location_on" /> {location}</span>}
      </div>

      {!compact && id && (
        <div className="ticket-card__actions">
          <Link className="button button--primary button--compact" to={`/boletas/${encodedId}`}>Ver detalle</Link>
          <Link className="icon-button icon-button--outlined" to={`/boletas/${encodedId}/editar`} aria-label="Editar boleta">
            <Icon name="edit" />
          </Link>
        </div>
      )}
    </article>
  );
}
