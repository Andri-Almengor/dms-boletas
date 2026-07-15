import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import TicketCard from '../components/tickets/TicketCard';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../services/moduleApi';
import { getTicketId, normalizeTicketStatus, sortTicketsNewestFirst } from '../utils/tickets';

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'Usuario';
}

export default function HomePage() {
  const { user, hasPermission, sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canViewTickets = hasPermission('BOLETAS_VER');
  const canCreateTickets = hasPermission('BOLETAS_CREAR');

  useEffect(() => {
    let active = true;
    if (!canViewTickets) {
      setTickets([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError('');
    requestAvailable(MODULE_ROUTES.tickets.list, {
      page: 1,
      pageSize: 200,
      sortBy: 'Fecha',
      sortDir: 'desc',
    }, sessionToken)
      .then((data) => { if (active) setTickets(sortTicketsNewestFirst(normalizeItems(data))); })
      .catch((loadError) => { if (active) { setTickets([]); setError(loadError.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionToken, canViewTickets]);

  const pending = useMemo(() => tickets.filter((ticket) => normalizeTicketStatus(ticket) === 'PENDIENTE'), [tickets]);
  const finished = useMemo(() => tickets.filter((ticket) => normalizeTicketStatus(ticket) === 'FINALIZADA'), [tickets]);
  const recent = useMemo(() => sortTicketsNewestFirst(tickets).slice(0, 3), [tickets]);

  return (
    <div className="page page--home">
      <section className="welcome-block">
        <span className="eyebrow">Bienvenido</span>
        <h1>Hola, {firstName(user?.NombreCompleto)}</h1>
        <p><Icon name={isAdmin ? 'admin_panel_settings' : 'engineering'} /> {isAdmin ? 'Administrador' : 'Técnico de campo'}</p>
      </section>

      {error && <div className="alert alert--error"><Icon name="cloud_off" /><span>No se pudieron cargar las boletas: {error}</span></div>}

      {canViewTickets && <section className="stats-grid">
        <Link className="stat-card stat-card--warning" to="/boletas/pendientes">
          <Icon name="pending_actions" />
          <strong>{loading ? '—' : pending.length}</strong>
          <span>Boletas pendientes</span>
        </Link>
        <Link className="stat-card stat-card--success" to="/boletas/finalizadas">
          <Icon name="task_alt" filled />
          <strong>{loading ? '—' : finished.length}</strong>
          <span>Boletas finalizadas</span>
        </Link>
      </section>}

      {canCreateTickets && <Link to="/boletas/nueva" className="primary-cta">
        <Icon name="add_circle" />
        <span>Crear nueva boleta</span>
      </Link>}

      {canViewTickets && <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">Actividad reciente</span><h2>Últimas boletas asignadas</h2></div>
          <Link to="/boletas/pendientes">Ver todas</Link>
        </div>

        {loading ? (
          <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boletas...</span></div>
        ) : recent.length ? (
          <div className="ticket-stack">
            {recent.map((ticket, index) => <TicketCard compact ticket={ticket} key={getTicketId(ticket, index)} />)}
          </div>
        ) : (
          <div className="empty-state"><Icon name="assignment" /><h2>Todavía no hay boletas</h2><p>{error ? 'Vuelve a intentar cuando la conexión esté disponible.' : 'Las boletas recientes aparecerán en esta sección.'}</p></div>
        )}
      </section>}

      {!canViewTickets && <div className="empty-state"><Icon name="home" /><h2>Panel operativo</h2><p>Utiliza el menú para acceder a los módulos disponibles para tu cuenta.</p></div>}
    </div>
  );
}
