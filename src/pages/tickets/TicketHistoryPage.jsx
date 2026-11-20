import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import TicketHistoryPanel from '../../components/tickets/TicketHistoryPanel';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import '../../styles/ticket-history.css';

// This page reuses the existing revision viewer and the protected history
// endpoint. It does not duplicate business logic or introduce extra permissions.
export default function TicketHistoryPage() {
  const { boletaUid } = useParams();
  const { sessionToken } = useAuth();
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    let active = true;
    setTicket(null);
    if (boletaUid && sessionToken) {
      requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid }, sessionToken)
        .then((response) => {
          if (active) setTicket(response?.boleta || response || null);
        })
        .catch(() => {
          // History remains available if the optional title/number lookup fails.
          if (active) setTicket(null);
        });
    }
    return () => { active = false; };
  }, [boletaUid, sessionToken]);

  const detailPath = `/boletas/${encodeURIComponent(boletaUid || '')}`;
  const displayId = pick(ticket || {}, ['BoletaID', 'TicketID'], '');
  const ticketTitle = pick(ticket || {}, ['Titulo', 'Título'], '');
  const customerName = pick(ticket || {}, ['Cliente', 'ClienteNombre'], '');

  return (
    <div className="page ticket-history-page">
      <header className="ticket-history-page__hero">
        <div className="ticket-history-page__head">
          <Link className="ticket-history-page__back" to={detailPath}>
            <Icon name="arrow_back" /> Volver al detalle de la boleta
          </Link>
          <span className="ticket-history-page__tag"><Icon name="verified_user" /> Auditoría de cambios</span>
        </div>
        <div className="ticket-history-page__intro">
          <div>
            <span className="eyebrow">DMS Boletas · Control administrativo</span>
            <h1>Historial de ediciones</h1>
            <p>Revise quién editó la boleta, cuándo ocurrió cada cambio y compare los valores originales con los actuales de esa edición.</p>
          </div>
          <span className="ticket-history-page__hero-icon" aria-hidden="true"><Icon name="history" /></span>
        </div>
        <div className="ticket-history-page__meta" aria-label="Información de la boleta">
          <span><Icon name="receipt_long" /><strong>Boleta {displayId ? `#${displayId}` : `· ${boletaUid}`}</strong></span>
          {ticketTitle && <span title={ticketTitle}><Icon name="description" />{ticketTitle}</span>}
          {customerName && <span title={customerName}><Icon name="corporate_fare" />{customerName}</span>}
        </div>
      </header>
      <TicketHistoryPanel boletaUid={boletaUid} sessionToken={sessionToken} />
    </div>
  );
}
