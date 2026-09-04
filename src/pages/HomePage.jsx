import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import TicketCard from '../components/tickets/TicketCard';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../services/moduleApi';
import { getTicketId, sortTicketsNewestFirst } from '../utils/tickets';

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'Usuario';
}

function responseTotal(data) {
  const total = Number(data?.total);
  return Number.isFinite(total) && total >= 0 ? total : normalizeItems(data).length;
}

function hasStatusCounts(data) {
  return Boolean(data?.statusCounts)
    && typeof data.statusCounts === 'object'
    && !Array.isArray(data.statusCounts);
}

function responseStatusCount(data, aliases = []) {
  const counts = data?.statusCounts || {};
  for (const alias of aliases) {
    const value = Number(counts[String(alias || '').toUpperCase()]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

async function loadTicketStatusFallback(routes, sessionToken) {
  const countPayload = { page: 1, pageSize: 1 };
  const [pendingData, finalizedData, finishedData] = await Promise.all([
    requestAvailable(routes, {
      ...countPayload,
      status: 'PENDIENTE',
      estado: 'PENDIENTE',
    }, sessionToken),
    requestAvailable(routes, {
      ...countPayload,
      status: 'FINALIZADA',
      estado: 'FINALIZADA',
    }, sessionToken),
    requestAvailable(routes, {
      ...countPayload,
      status: 'FINALIZADO',
      estado: 'FINALIZADO',
    }, sessionToken),
  ]);
  return {
    pending: responseTotal(pendingData),
    finished: responseTotal(finalizedData) + responseTotal(finishedData),
  };
}

function scheduleAfterPaint(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1_200 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 350);
  return () => window.clearTimeout(id);
}

export default function HomePage() {
  const { user, hasPermission, sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, finished: 0 });
  const [maintenanceCounts, setMaintenanceCounts] = useState({ pending: 0, finished: 0 });
  const [loading, setLoading] = useState(true);
  const [finishedLoading, setFinishedLoading] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [error, setError] = useState('');
  const [maintenanceError, setMaintenanceError] = useState('');
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canViewTickets = hasPermission('BOLETAS_VER');
  const canCreateTickets = hasPermission('BOLETAS_CREAR');

  useEffect(() => {
    let active = true;
    if (!canViewTickets) {
      setTickets([]);
      setCounts({ pending: 0, finished: 0 });
      setLoading(false);
      setFinishedLoading(false);
      return undefined;
    }

    setLoading(true);
    setFinishedLoading(true);
    setError('');
    const ticketListRoutes = MODULE_ROUTES.tickets.list;

    requestAvailable(ticketListRoutes, {
      page: 1,
      pageSize: 3,
      sortBy: 'Fecha',
      sortDir: 'desc',
      includeStatusCounts: true,
    }, sessionToken)
      .then(async (data) => {
        if (!active) return;
        setTickets(sortTicketsNewestFirst(normalizeItems(data)).slice(0, 3));

        if (hasStatusCounts(data)) {
          setCounts({
            pending: responseStatusCount(data, ['PENDIENTE']),
            finished: responseStatusCount(data, ['FINALIZADA', 'FINALIZADO']),
          });
          return;
        }

        // Compatibilidad durante despliegues mixtos o respuestas cacheadas de una
        // versión anterior: si el resumen no existe, recupera los totales con las
        // mismas consultas pequeñas que usaba Inicio antes de la optimización.
        const fallbackCounts = await loadTicketStatusFallback(ticketListRoutes, sessionToken);
        if (active) setCounts(fallbackCounts);
      })
      .catch((loadError) => {
        if (!active) return;
        setTickets([]);
        setCounts({ pending: 0, finished: 0 });
        setError(loadError.message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setFinishedLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionToken, canViewTickets]);

  useEffect(() => {
    let active = true;
    if (!isAdmin) {
      setMaintenanceCounts({ pending: 0, finished: 0 });
      setMaintenanceLoading(false);
      setMaintenanceError('');
      return undefined;
    }

    setMaintenanceLoading(true);
    setMaintenanceError('');
    const cancelDeferred = scheduleAfterPaint(() => {
      requestAvailable(MODULE_ROUTES.maintenance.list, {
        page: 1,
        pageSize: 1,
        activo: true,
        includeStatusCounts: true,
      }, sessionToken)
        .then((data) => {
          if (!active) return;
          setMaintenanceCounts({
            pending: responseStatusCount(data, ['PENDIENTE']),
            finished: responseStatusCount(data, ['FINALIZADO', 'FINALIZADA']),
          });
        })
        .catch((loadError) => {
          if (!active) return;
          setMaintenanceCounts({ pending: 0, finished: 0 });
          setMaintenanceError(loadError.message);
        })
        .finally(() => {
          if (active) setMaintenanceLoading(false);
        });
    });

    return () => {
      active = false;
      cancelDeferred();
    };
  }, [sessionToken, isAdmin]);

  return (
    <div className="page page--home">
      <section className="welcome-block">
        <span className="eyebrow">Bienvenido</span>
        <h1>Hola, {firstName(user?.NombreCompleto)}</h1>
        <p><Icon name={isAdmin ? 'admin_panel_settings' : 'engineering'} /> {isAdmin ? 'Administrador' : 'Técnico de campo'}</p>
      </section>

      {error && <div className="alert alert--error"><Icon name="cloud_off" /><span>No se pudieron cargar las boletas: {error}</span></div>}
      {isAdmin && maintenanceError && <div className="alert alert--error"><Icon name="cloud_off" /><span>No se pudieron cargar los mantenimientos: {maintenanceError}</span></div>}

      {(canViewTickets || isAdmin) && <section className={`stats-grid${isAdmin ? ' stats-grid--admin' : ''}`}>
        {canViewTickets && <Link className="stat-card stat-card--warning" to="/boletas/pendientes">
          <Icon name="pending_actions" />
          <strong>{loading ? '—' : counts.pending}</strong>
          <span>Boletas pendientes</span>
        </Link>}
        {canViewTickets && <Link className="stat-card stat-card--success" to="/boletas/finalizadas">
          <Icon name="task_alt" filled />
          <strong>{finishedLoading ? '—' : counts.finished}</strong>
          <span>Boletas finalizadas</span>
        </Link>}
        {isAdmin && <Link className="stat-card stat-card--maintenance-pending" to="/mantenimientos?estado=PENDIENTE">
          <Icon name="engineering" />
          <strong>{maintenanceLoading ? '—' : maintenanceCounts.pending}</strong>
          <span>Mantenimientos pendientes</span>
        </Link>}
        {isAdmin && <Link className="stat-card stat-card--maintenance-finished" to="/mantenimientos?estado=FINALIZADO">
          <Icon name="verified" filled />
          <strong>{maintenanceLoading ? '—' : maintenanceCounts.finished}</strong>
          <span>Mantenimientos finalizados</span>
        </Link>}
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
        ) : tickets.length ? (
          <div className="ticket-stack">
            {tickets.map((ticket, index) => <TicketCard compact ticket={ticket} key={getTicketId(ticket, index)} />)}
          </div>
        ) : (
          <div className="empty-state"><Icon name="assignment" /><h2>Todavía no hay boletas</h2><p>{error ? 'Vuelve a intentar cuando la conexión esté disponible.' : 'Las boletas recientes aparecerán en esta sección.'}</p></div>
        )}
      </section>}

      {!canViewTickets && !isAdmin && <div className="empty-state"><Icon name="home" /><h2>Panel operativo</h2><p>Utiliza el menú para acceder a los módulos disponibles para tu cuenta.</p></div>}
    </div>
  );
}
