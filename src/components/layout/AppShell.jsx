import React, { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { preloadRouteModule, preloadRouteModules } from '../../app/routeLoaders';
import useOfflineMode from '../../hooks/useOfflineMode';
import { preloadNavigationData, preloadNavigationDataBatch } from '../../services/navigationPreload';
import Icon from '../common/Icon';

const OfflineSyncManager = lazy(() => import('../offline/OfflineSyncRuntime'));
const ActivityTelemetryBridge = lazy(() => import('../system/ActivityTelemetryBridge'));

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'DMS';
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
}
function NavigationItem({ to, icon, label, end = false, prominent = false, onIntent }) {
  const warm = () => onIntent?.(to);
  return <NavLink to={to} end={end} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}${prominent ? ' bottom-nav__item--prominent' : ''}`}><span className={prominent ? 'bottom-nav__fab' : ''}><Icon name={icon} filled={!prominent} /></span><span>{label}</span></NavLink>;
}

export default function AppShell() {
  const { user, logout, hasPermission, sessionToken } = useAuth();
  const [offlineEnabled] = useOfflineMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canViewTickets = hasPermission('BOLETAS_VER');
  const canViewUsers = hasPermission('USUARIOS_VER');
  const canViewClients = hasPermission('CLIENTES_VER');
  const canViewCatalogs = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const canCreateTickets = hasPermission('BOLETAS_CREAR');
  const canCreateMaintenance = hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || isAdmin
    || canCreateTickets;
  const ticketListAdmin = hasPermission('BOLETAS_ELIMINAR') || isAdmin;
  const canManageKnowledge = hasPermission('CONOCIMIENTO_GESTIONAR') || isAdmin;
  const canViewMaintenance = hasPermission('MANTENIMIENTOS_VER') || hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('MANTENIMIENTOS_GESTIONAR') || canViewTickets;
  const isAssistantPage = location.pathname === '/asistente';
  const isWorkflowForm = location.pathname === '/boletas/nueva'
    || /^\/boletas\/[^/]+\/editar$/.test(location.pathname)
    || /\/boletas\/[^/]+\/editar-rapido\//.test(location.pathname)
    || /\/boletas\/[^/]+\/nueva-visita$/.test(location.pathname)
    || location.pathname === '/mantenimientos/nuevo'
    || /^\/mantenimientos\/[^/]+\/editar$/.test(location.pathname);
  const assistantUrl = `/asistente?from=${encodeURIComponent(location.pathname)}`;
  const assistantFrom = new URLSearchParams(location.search).get('from') || '/';
  const assistantReturnUrl = assistantFrom.startsWith('/') ? assistantFrom : '/';
  const showAssistantFab = !isAssistantPage && location.pathname !== '/cambiar-contrasena';

  function preloadContext() {
    return {
      sessionToken,
      userId: user?.UsuarioID || user?.id || '',
      isAdmin,
      ticketListAdmin,
      canManageKnowledge,
    };
  }

  function warmRoute(to) {
    preloadRouteModule(to).catch(() => {});
    preloadNavigationData(to, preloadContext()).catch(() => {});
  }

  function intentProps(to) {
    const warm = () => warmRoute(to);
    return { onPointerEnter: warm, onFocus: warm, onTouchStart: warm };
  }

  useEffect(() => {
    if (user?.CambioPasswordObligatorio && location.pathname !== '/cambiar-contrasena') navigate('/cambiar-contrasena', { replace: true });
  }, [user, location.pathname, navigate]);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => { if (event.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [drawerOpen]);
  useEffect(() => {
    if (!sessionToken || typeof window === 'undefined' || navigator.connection?.saveData) return undefined;
    const likelyRoutes = ['/agenda'];
    if (canViewTickets) likelyRoutes.push('/boletas/pendientes', '/boletas/finalizadas');
    if (canCreateTickets) likelyRoutes.push('/boletas/nueva');
    if (canViewMaintenance) likelyRoutes.push('/mantenimientos');
    if (canCreateMaintenance) likelyRoutes.push('/mantenimientos/nuevo');
    if (canViewClients) likelyRoutes.push('/clientes');
    likelyRoutes.push('/conocimiento', '/mas');

    // Además de los chunks JS/CSS, se calientan los payloads reales de las
    // pantallas y los catálogos de los flujos de creación. Así el primer toque
    // en móvil no tiene que iniciar desde cero varias lecturas de Sheets.
    const warm = () => {
      preloadRouteModules(likelyRoutes).catch(() => {});
      preloadNavigationDataBatch(likelyRoutes, preloadContext()).catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 1_200 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 450);
    return () => window.clearTimeout(id);
  }, [sessionToken, user?.UsuarioID, user?.id, isAdmin, ticketListAdmin, canManageKnowledge, canViewTickets, canCreateTickets, canViewMaintenance, canCreateMaintenance, canViewClients]);
  async function handleLogout() { await logout(); navigate('/login', { replace: true }); }

  return <div className={`app-shell${isWorkflowForm ? ' app-shell--form' : ''}${isAssistantPage ? ' app-shell--assistant' : ''}`}>
    <Suspense fallback={null}><ActivityTelemetryBridge /></Suspense>
    {!isWorkflowForm && !isAssistantPage && <header className="top-bar"><button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú" aria-expanded={drawerOpen}><Icon name="menu" /></button><NavLink to="/" {...intentProps('/')} className="top-bar__brand">DMS Boletas</NavLink><NavLink to="/mas" {...intentProps('/mas')} className="avatar avatar--small" aria-label="Abrir perfil">{initials(user?.NombreCompleto)}</NavLink></header>}
    {isAssistantPage && <header className="assistant-route-bar">
      <div className="assistant-route-bar__identity"><span className="assistant-route-bar__bot"><Icon name="smart_toy" filled /></span><div><strong>DMS Assistant</strong><span><i />En línea</span></div></div>
      <NavLink className="assistant-route-bar__close" to={assistantReturnUrl} {...intentProps(assistantReturnUrl)} aria-label="Cerrar Asistente DMS" title="Cerrar"><Icon name="close" /></NavLink>
    </header>}
    {offlineEnabled && <Suspense fallback={null}><OfflineSyncManager /></Suspense>}
    <div className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
    <aside className={`side-drawer${drawerOpen ? ' is-open' : ''}`} aria-hidden={!drawerOpen}>
      <div className="side-drawer__profile"><div className="avatar avatar--large">{initials(user?.NombreCompleto)}</div><div><strong>{user?.NombreCompleto}</strong><span>{isAdmin ? 'Administrador' : 'Técnico'}</span></div></div>
      <nav className="side-drawer__nav">
        <NavLink to="/" end {...intentProps('/')}><Icon name="home" /> Inicio</NavLink>
        <NavLink to="/agenda" {...intentProps('/agenda')}><Icon name="calendar_month" /> Agenda</NavLink>
        <NavLink to="/asistente" {...intentProps('/asistente')}><Icon name="smart_toy" /> Asistente DMS</NavLink>
        {canViewTickets && <NavLink to="/boletas/pendientes" {...intentProps('/boletas/pendientes')}><Icon name="pending_actions" /> Boletas pendientes</NavLink>}
        {canCreateTickets && <NavLink to="/boletas/nueva" {...intentProps('/boletas/nueva')}><Icon name="add_circle" /> Crear boleta</NavLink>}
        {canViewTickets && <NavLink to="/boletas/finalizadas" {...intentProps('/boletas/finalizadas')}><Icon name="task_alt" /> Boletas finalizadas</NavLink>}
        {canViewMaintenance && <NavLink to="/mantenimientos" {...intentProps('/mantenimientos')}><Icon name="engineering" /> Mantenimientos</NavLink>}
        {isAdmin && <NavLink to="/metricas" {...intentProps('/metricas')}><Icon name="monitoring" /> Métricas</NavLink>}
        {isAdmin && <NavLink to="/administracion/importar-boletas"><Icon name="upload_file" /> Importar boletas anteriores</NavLink>}
        <NavLink to="/conocimiento" {...intentProps('/conocimiento')}><Icon name="menu_book" /> Base de conocimientos</NavLink>
        {canViewClients && <NavLink to="/clientes" {...intentProps('/clientes')}><Icon name="groups" /> Clientes</NavLink>}
        {canViewCatalogs && <NavLink to="/catalogos" {...intentProps('/catalogos')}><Icon name="inventory_2" /> Catálogos</NavLink>}
        {canViewUsers && <NavLink to="/usuarios" {...intentProps('/usuarios')}><Icon name="person_search" /> Usuarios</NavLink>}
        <NavLink to="/cambiar-contrasena" {...intentProps('/cambiar-contrasena')}><Icon name="lock_reset" /> Cambiar contraseña</NavLink>
        <NavLink to="/mas" {...intentProps('/mas')}><Icon name="more_horiz" /> Más opciones</NavLink>
      </nav>
      <button type="button" className="drawer-logout" onClick={handleLogout}><Icon name="logout" /> Cerrar sesión</button>
    </aside>
    <main className="app-content"><Outlet /></main>
    {showAssistantFab && <NavLink className={`assistant-fab${isWorkflowForm ? ' assistant-fab--workflow' : ''}`} to={assistantUrl} {...intentProps('/asistente')} aria-label="Abrir Asistente DMS" title="Preguntar al Asistente DMS"><span className="assistant-fab__icon"><Icon name="smart_toy" filled /></span><span className="assistant-fab__label">Preguntar</span></NavLink>}
    {!isWorkflowForm && !isAssistantPage && <nav className="bottom-nav" aria-label="Navegación principal"><NavigationItem to="/" icon="home" label="Inicio" end onIntent={warmRoute} />{canViewTickets && <NavigationItem to="/boletas/pendientes" icon="pending_actions" label="Pendientes" onIntent={warmRoute} />}{canCreateTickets && <NavigationItem to="/boletas/nueva" icon="add" label="Crear" prominent onIntent={warmRoute} />}{canViewTickets && <NavigationItem to="/boletas/finalizadas" icon="task_alt" label="Finalizadas" onIntent={warmRoute} />}<NavigationItem to="/mas" icon="more_horiz" label="Más" onIntent={warmRoute} /></nav>}
  </div>;
}
