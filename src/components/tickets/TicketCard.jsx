import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { pick } from '../../services/moduleApi';
import { formatDate, formatTime, getTicketId, normalizeTicketStatus } from '../../utils/tickets';

export function TicketStatusChip({ status }) {
  const raw = String(status || '').toUpperCase();
  const normalized = raw.includes('FINAL') ? 'FINALIZADA' : raw.includes('ANUL') ? 'ANULADA' : 'PENDIENTE';
  return <span className={`ticket-status ticket-status--${normalized === 'FINALIZADA' ? 'finished' : normalized === 'ANULADA' ? 'cancelled' : 'pending'}`}>{normalized === 'FINALIZADA' ? 'Finalizado' : normalized === 'ANULADA' ? 'Anulado' : 'Pendiente'}</span>;
}

export default function TicketCard({ ticket, compact = false, onDelete }) {
  const id = getTicketId(ticket);
  const uid = pick(ticket, ['BoletaUID', 'TicketUID', 'boletaUid', 'uid'], id);
  const status = normalizeTicketStatus(ticket);
  const title = pick(ticket, ['Titulo', 'Título', 'TituloBoleta', 'title', 'TipoServicio'], 'Boleta de servicio');
  const client = pick(ticket, ['Cliente', 'ClienteNombre', 'Clientes', 'clientName'], 'Cliente sin especificar');
  const equipment = [pick(ticket, ['TipoDispositivo']), pick(ticket, ['Fabricante']), pick(ticket, ['Modelo'])].filter(Boolean).join(' · ') || pick(ticket, ['Equipo', 'UbicacionEquipo', 'Ubicacion_equipo', 'Categoria'], 'Servicio técnico');
  const date = pick(ticket, ['FechaFinalizacion', 'Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
  const time = pick(ticket, ['HoraInicio', 'horaInicio', 'Hora']);
  const location = pick(ticket, ['Ubicacion', 'Ubicación', 'Direccion', 'Dirección']);
  const pdfUrl = pick(ticket, ['PDFURL', 'PDFUrl', 'PDF_Url', 'pdfUrl']);
  const encodedUid = encodeURIComponent(uid || 'sin-id');

  return <article className={`ticket-card ticket-card--${status === 'FINALIZADA' ? 'finished' : status === 'ANULADO' ? 'cancelled' : 'pending'}${compact ? ' ticket-card--compact' : ''}`}>
    <div className="ticket-card__header"><div className="ticket-card__identity"><span className="ticket-card__number">#{String(id || 'SIN-ID').slice(0, 20)}</span><h3>{title}</h3>{compact && <p>Cliente: {client}</p>}</div><TicketStatusChip status={status} /></div>
    {!compact && <dl className="ticket-card__data"><div><dt>Cliente</dt><dd>{client}</dd></div><div><dt>Equipo</dt><dd>{equipment}</dd></div></dl>}
    <div className="ticket-card__meta"><span><Icon name="calendar_today" /> {formatDate(date)}</span>{time && <span><Icon name="schedule" /> {formatTime(time)}</span>}{location && <span><Icon name="location_on" /> {location}</span>}</div>
    {!compact && uid && <div className="ticket-card__actions"><Link className="button button--primary button--compact" to={`/boletas/${encodedUid}`}>Ver detalle</Link>{status !== 'FINALIZADA' && <Link className="icon-button icon-button--outlined" to={`/boletas/${encodedUid}/editar`} aria-label="Editar boleta"><Icon name="edit" /></Link>}{status === 'FINALIZADA' && pdfUrl && <a className="icon-button icon-button--outlined" href={pdfUrl} target="_blank" rel="noreferrer" aria-label="Abrir PDF"><Icon name="picture_as_pdf" /></a>}{onDelete && <button className="icon-button icon-button--danger" type="button" onClick={() => onDelete(ticket)} aria-label="Anular boleta"><Icon name="delete" /></button>}</div>}
  </article>;
}
