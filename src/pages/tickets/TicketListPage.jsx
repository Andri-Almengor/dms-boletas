import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import TicketCard from '../../components/tickets/TicketCard';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../../services/moduleApi';
import { getTicketId, groupTicketsByDate, normalizeTicketStatus } from '../../utils/tickets';

export default function TicketListPage({ status }) {
  const { sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isPending = status === 'PENDIENTE';

  async function loadTickets(query = search) {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.tickets.list, {
        page: 1,
        pageSize: 250,
        search: query,
        estado: status,
        status,
        sortBy: 'Fecha',
        sortDir: 'desc',
      }, sessionToken);
      const items = normalizeItems(data).filter((item) => normalizeTicketStatus(item) === status);
      setTickets(items);
    } catch (err) {
      setError(err.message);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets('');
  }, [sessionToken, status]);

  const groups = useMemo(() => groupTicketsByDate(tickets), [tickets]);

  return (
    <div className="page ticket-list-page">
      <div className="list-page-heading">
        <div>
          <span className="eyebrow">Gestión de servicios</span>
          <h1>{isPending ? 'Boletas pendientes' : 'Boletas finalizadas'}</h1>
          <p>{isPending ? 'Servicios que todavía requieren atención o cierre.' : 'Historial de trabajos completados.'}</p>
        </div>
        {isPending && <Link className="button button--primary button--compact" to="/boletas/nueva"><Icon name="add" /> Nueva</Link>}
      </div>

      <form className="search-bar" onSubmit={(event) => { event.preventDefault(); loadTickets(); }}>
        <Icon name="search" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar boleta o cliente..." />
        <button type="submit" className="icon-button icon-button--primary" aria-label="Buscar"><Icon name="tune" /></button>
      </form>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boletas...</span></div>
      ) : tickets.length ? (
        <div className="ticket-date-groups">
          {groups.map((group) => (
            <section className="ticket-date-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="ticket-stack">
                {group.items.map((ticket, index) => <TicketCard ticket={ticket} key={getTicketId(ticket, index)} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name={isPending ? 'pending_actions' : 'task_alt'} />
          <h2>{isPending ? 'No hay boletas pendientes' : 'No hay boletas finalizadas'}</h2>
          <p>{error ? 'Revisa que las rutas de boletas estén publicadas en Apps Script.' : 'Los registros aparecerán aquí automáticamente.'}</p>
          {isPending && <Link className="button button--primary" to="/boletas/nueva">Crear boleta</Link>}
        </div>
      )}
    </div>
  );
}
