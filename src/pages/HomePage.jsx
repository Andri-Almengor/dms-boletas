import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import TicketCard from '../components/tickets/TicketCard';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../services/moduleApi';
import {
  patchTicketItemsForQuery,
  requestSynchronizedCollection,
  subscribeSyncResource,
} from '../services/syncManager';
import { getTicketId, sortTicketsNewestFirst } from '../utils/tickets';

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'Usuario';
}

function responseTotal(data) {
  const total = Number(data?.total);
  return Number.isFinite(total) && total >= 0 ? total : normalizeItems(data).length;
}

function summaryCounts(data) {
  const pending = Number(data?.homeSummary?.pending);
  const finished = Number(data?.homeSummary?.finished);
  if (!Number.isFinite(pending) || pending < 0 || !Number.isFinite(finished) || finished < 0) return null;
  return { pending, finished };
}

function scheduleAfterPaint(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1_200 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 350);
  return () => window.clearTimeout(id);
}

const HOME_TICKET_QUERY = Object.freeze({
  page: 1,
  pageSize: 3,
  sortBy: 'Fecha',
  sortDir: 'desc',
  homeSummary: true,
});

async function loadTicketHome(sessionToken, userId, permissions, signal) {
  const recentData = await requestSynchronizedCollection(
    MODULE_ROUTES.tickets.list,
    HOME_TICKET_QUERY,
    sessionToken,
    { resource: 'ticket', userId, permissions, signal },
  );
  const summary = summaryCounts(recentData);
  if (summary) return { recentData, summary };

  // Compatibilidad con un backend anterior que todavía ignore homeSummary.
  const countPayload = { page: 1, pageSize: 1 };
  const [pendingData, finishedData] = await Promise.all([
    requestSynchronizedCollection(MODULE_ROUTES.tickets.list, {
      ...countPayload,
      status: 'PENDIENTE',
      estado: 'PENDIENTE',
    }, sessionToken, { resource: 'ticket', userId, permissions, signal }),
    requestSynchronizedCollection(MODULE_ROUTES.tickets.list, {
      ...countPayload,
      status: 'FINALIZADA',
      estado: 'FINALIZADA',
    }, sessionToken, { resource: 'ticket', userId, permissions, signal }),
  ]);
  return {
    recentData,
    summary: {
      pending: responseTotal(pendingData),
      finished: responseTotal(finishedData),
    },
  };
}

async function loadMaintenanceHome(sessionToken, signal) {
  const summaryData = await requestAvailable(MODULE_ROUTES.maintenance.list, {
    page: 1,
    pageSize: 1,
    activo: true,
    homeSummary: true,
  }, sessionToken, { signal });
  const summary = summaryCounts(summaryData);
  if (summary) return summary;

  // Compatibilidad con un backend anterior que todavía ignore homeSummary.
  const countPayload = { page: 1, pageSize: 1, activo: true };
  const [pendingData, finishedData] = await Promise.all([
    requestAvailable(MODULE_ROUTES.maintenance.list, {
      ...countPayload,
      status: 'PENDIENTE',
      estado: 'PENDIENTE',
    }, sessionToken, { signal }),
    requestAvailable(MODULE_ROUTES.maintenance.list, {
      ...countPayload,
      status: 'FINALIZADO',
      estado: 'FINALIZADO',
    }, sessionToken, { signal }),
  ]);
  return {
    pending: responseTotal(pendingData),
    finished: responseTotal(finishedData),
  };
}

export default function HomePage() {
  const { user, permissions, hasPermission, sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ pending: null, finished: null });
  const [maintenanceCounts, setMaintenanceCounts] = useState({ pending: null, finished: null });
  const [loading, setLoading] = useState(true);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [error, setError] = useState('');
  const [maintenanceError, setMaintenanceError] = useState('');
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canViewTickets = hasPermission('BOLETAS_VER');
  const canCreateTickets = hasPermission('BOLETAS_CREAR');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!canViewTickets) {
      setTickets([]);
      setCounts({ pending: 0, finished: 0 });
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    setError('');
    setCounts({ pending: null, finished: null });

    loadTicketHome(sessionToken, user?.UsuarioID, permissions, controller.signal)
      .then(({ recentData, summary }) => {
        if (!active) return;
        setCounts(summary);
        setTickets(sortTicketsNewestFirst(normalizeItems(recentData)).slice(0, 3));
      })
      .catch((loadError) => {
        if (!active) return;
        setTickets([]);
        setCounts({ pending: null, finished: null });
        setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionToken, canViewTickets, user?.UsuarioID, permissions]);

  useEffect(() => subscribeSyncResource('ticket', ({ type, delta }) => {
    if (!canViewTickets || type !== 'delta' || !delta) return;
    if (delta.counts) {
      const pending = Number(delta.counts.pending);
      const finished = Number(delta.counts.finished);
      if (Number.isFinite(pending) && Number.isFinite(finished)) setCounts({ pending, finished });
    }
    setTickets((current) => patchTicketItemsForQuery(current, HOME_TICKET_QUERY, delta, 3));
  }), [canViewTickets]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!isAdmin) {
      setMaintenanceCounts({ pending: 0, finished: 0 });
      setMaintenanceLoading(false);
      setMaintenanceError('');
      return () => controller.abort();
    }

    setMaintenanceLoading(true);
    setMaintenanceError('');
    setMaintenanceCounts({ pending: null, finished: null });
    const cancelDeferred = scheduleAfterPaint(() => {
      loadMaintenanceHome(sessionToken, controller.signal)
        .then((summary) => {
          if (active) setMaintenanceCounts(summary);
        })
        .catch((loadError) => {
          if (!active) return;
          setMaintenanceCounts({ pending: null, finished: null });
          setMaintenanceError(loadError.message);
        })
        .finally(() => {
          if (active) setMaintenanceLoading(false);
        });
    });

    return () => {
      active = false;
      cancelDeferred();
      controller.abort();
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
          <strong>{loading || counts.pending === null ? '—' : counts.pending}</strong>
          <span>Boletas pendientes</span>
        </Link>}
        {canViewTickets && <Link className="stat-card stat-card--success" to="/boletas/finalizadas">
          <Icon name="task_alt" filled />
          <strong>{loading || counts.finished === null ? '—' : counts.finished}</strong>
          <span>Boletas finalizadas</span>
        </Link>}
        {isAdmin && <Link className="stat-card stat-card--maintenance-pending" to="/mantenimientos?estado=PENDIENTE">
          <Icon name="engineering" />
          <strong>{maintenanceLoading || maintenanceCounts.pending === null ? '—' : maintenanceCounts.pending}</strong>
          <span>Mantenimientos pendientes</span>
        </Link>}
        {isAdmin && <Link className="stat-card stat-card--maintenance-finished" to="/mantenimientos?estado=FINALIZADO">
          <Icon name="verified" filled />
          <strong>{maintenanceLoading || maintenanceCounts.finished === null ? '—' : maintenanceCounts.finished}</strong>
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
