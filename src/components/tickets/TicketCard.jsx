import React, { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import { pick } from '../../services/moduleApi';
import { formatDate, formatTime, getTicketId, normalizeTicketStatus } from '../../utils/tickets';

function assignedNames(ticket = {}) {
  const direct = pick(ticket, ['AsignadosNombres'], '');
  if (String(direct || '').trim()) return String(direct).trim();

  const raw = ticket.asignados ?? ticket.Asignados ?? ticket.AsignadoA ?? ticket.Responsables;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [...new Set(values
    .map((item) => typeof item === 'string'
      ? item
      : pick(item, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'UsuarioID'], ''))
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .join(', ');
}

export function TicketStatusChip({ status }) {
  const raw = String(status || '').toUpperCase();
  const normalized = raw.includes('FINAL') ? 'FINALIZADA' : raw.includes('ANUL') ? 'ANULADA' : 'PENDIENTE';
  return <span className={`ticket-status ticket-status--${normalized === 'FINALIZADA' ? 'finished' : normalized === 'ANULADA' ? 'cancelled' : 'pending'}`}>{normalized === 'FINALIZADA' ? 'Finalizado' : normalized === 'ANULADA' ? 'Anulado' : 'Pendiente'}</span>;
}

function TicketCard({ ticket, compact = false, onDelete, returnTo = '' }) {
  const navigate = useNavigate();
  const id = getTicketId(ticket);
  const uid = pick(ticket, ['BoletaUID', 'TicketUID', 'boletaUid', 'uid'], id);
  const status = normalizeTicketStatus(ticket);
  const title = pick(ticket, ['Titulo', 'Título', 'TituloBoleta', 'title', 'TipoServicio'], 'Boleta de servicio');
  const client = pick(ticket, ['Cliente', 'ClienteNombre', 'Clientes', 'clientName'], 'Cliente sin especificar');
  const equipment = [pick(ticket, ['TipoDispositivo']), pick(ticket, ['Fabricante']), pick(ticket, ['Modelo'])].filter(Boolean).join(' · ') || pick(ticket, ['Equipo', 'UbicacionEquipo', 'Ubicacion_equipo', 'Categoria'], 'Servicio técnico');
  const assigned = assignedNames(ticket);
  const date = pick(ticket, ['FechaFinalizacion', 'Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
  const time = pick(ticket, ['HoraInicio', 'horaInicio', 'Hora']);
  const location = pick(ticket, ['Ubicacion', 'Ubicación', 'Direccion', 'Dirección']);
  const pdfUrl = pick(ticket, ['PDFURL', 'PDFUrl', 'PDF_Url', 'pdfUrl']);
  const encodedUid = encodeURIComponent(uid || 'sin-id');
  const detailUrl = uid ? `/boletas/${encodedUid}` : '';

  function returnState() {
    if (!returnTo) return undefined;
    return {
      returnTo,
      returnScrollY: typeof window === 'undefined' ? 0 : Math.max(0, Number(window.scrollY || 0)),
    };
  }

  function openDetail(event) {
    if (!detailUrl || event.target.closest('a, button, input, select, textarea, label')) return;
    navigate(detailUrl, { state: returnState() });
  }

  function openWithKeyboard(event) {
    if (!detailUrl || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(detailUrl, { state: returnState() });
  }

  function openLinkWithContext(event, target) {
    if (!returnTo) return;
    event.preventDefault();
    navigate(target, { state: returnState() });
  }

  return <article
    className={`ticket-card ticket-card--${status === 'FINALIZADA' ? 'finished' : status === 'ANULADO' ? 'cancelled' : 'pending'}${compact ? ' ticket-card--compact' : ''}${detailUrl ? ' detail-clickable-card' : ''}`}
    onClick={openDetail}
    onKeyDown={openWithKeyboard}
    role={detailUrl ? 'link' : undefined}
    tabIndex={detailUrl ? 0 : undefined}
    aria-label={detailUrl ? `Abrir detalle de la boleta ${id || ''}` : undefined}
  >
    <div className="ticket-card__header"><div className="ticket-card__identity"><span className="ticket-card__number">#{String(id || 'SIN-ID').slice(0, 20)}</span><h3>{title}</h3>{compact && <p>Cliente: {client}</p>}</div><TicketStatusChip status={status} /></div>
    {!compact && <dl className="ticket-card__data"><div><dt>Cliente</dt><dd>{client}</dd></div><div><dt>Equipo</dt><dd>{equipment}</dd></div>{assigned && <div className="ticket-card__data-wide"><dt>Asignados</dt><dd>{assigned}</dd></div>}</dl>}
    {compact && <div className="ticket-card__compact-data"><span><Icon name="devices_other" />{equipment}</span>{assigned && <span><Icon name="engineering" />{assigned}</span>}</div>}
    <div className="ticket-card__meta"><span><Icon name="calendar_today" /> {formatDate(date)}</span>{time && <span><Icon name="schedule" /> {formatTime(time)}</span>}{location && <span className="ticket-card__meta-location"><Icon name="location_on" /> {location}</span>}</div>
    {!compact && uid && <div className="ticket-card__actions"><Link className="button button--primary button--compact ticket-card__primary-action" to={detailUrl} onClick={(event) => openLinkWithContext(event, detailUrl)}>Ver detalle</Link><div className="ticket-card__secondary-actions">{status !== 'FINALIZADA' && <Link className="icon-button icon-button--outlined" to={`${detailUrl}/editar`} onClick={(event) => openLinkWithContext(event, `${detailUrl}/editar`)} aria-label="Editar boleta"><Icon name="edit" /></Link>}{status === 'FINALIZADA' && pdfUrl && <a className="icon-button icon-button--outlined" href={pdfUrl} target="_blank" rel="noreferrer" aria-label="Abrir PDF"><Icon name="picture_as_pdf" /></a>}{onDelete && <button className="icon-button icon-button--danger" type="button" onClick={() => onDelete(ticket)} aria-label="Anular boleta"><Icon name="delete" /></button>}</div></div>}
  </article>;
}

export default memo(TicketCard);
