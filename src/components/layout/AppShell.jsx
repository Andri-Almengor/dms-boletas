import React, { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import useOfflineMode from '../../hooks/useOfflineMode';
import Icon from '../common/Icon';

const OfflineSyncManager = lazy(() => import('../offline/OfflineSyncRuntime'));
const ActivityTelemetryBridge = lazy(() => import('../system/ActivityTelemetryBridge'));

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'DMS';
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
}
function NavigationItem({ to, icon, label, end = false, prominent = false }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}${prominent ? ' bottom-nav__item--prominent' : ''}`}><span className={prominent ? 'bottom-nav__fab' : ''}><Icon name={icon} filled={!prominent} /></span><span>{label}</span></NavLink>;
}

export default function AppShell() {
  const { user, logout, hasPermission } = useAuth();
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
  async function handleLogout() { await logout(); navigate('/login', { replace: true }); }

  return <div className={`app-shell${isWorkflowForm ? ' app-shell--form' : ''}${isAssistantPage ? ' app-shell--assistant' : ''}`}>
    <Suspense fallback={null}><ActivityTelemetryBridge /></Suspense>
    {!isWorkflowForm && !isAssistantPage && <header className="top-bar"><button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú" aria-expanded={drawerOpen}><Icon name="menu" /></button><NavLink to="/" className="top-bar__brand">DMS Boletas</NavLink><NavLink to="/mas" className="avatar avatar--small" aria-label="Abrir perfil">{initials(user?.NombreCompleto)}</NavLink></header>}
    {isAssistantPage && <header className="assistant-route-bar">
      <div className="assistant-route-bar__identity"><span className="assistant-route-bar__bot"><Icon name="smart_toy" filled /></span><div><strong>DMS Assistant</strong><span><i />En línea</span></div></div>
      <NavLink className="assistant-route-bar__close" to={assistantReturnUrl} aria-label="Cerrar Asistente DMS" title="Cerrar"><Icon name="close" /></NavLink>
    </header>}
    {offlineEnabled && <Suspense fallback={null}><OfflineSyncManager /></Suspense>}
    <div className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
    <aside className={`side-drawer${drawerOpen ? ' is-open' : ''}`} aria-hidden={!drawerOpen}>
      <div className="side-drawer__profile"><div className="avatar avatar--large">{initials(user?.NombreCompleto)}</div><div><strong>{user?.NombreCompleto}</strong><span>{isAdmin ? 'Administrador' : 'Técnico'}</span></div></div>
      <nav className="side-drawer__nav">
        <NavLink to="/" end><Icon name="home" /> Inicio</NavLink>
        <NavLink to="/agenda"><Icon name="calendar_month" /> Agenda</NavLink>
        <NavLink to="/asistente"><Icon name="smart_toy" /> Asistente DMS</NavLink>
        {canViewTickets && <NavLink to="/boletas/pendientes"><Icon name="pending_actions" /> Boletas pendientes</NavLink>}
        {canCreateTickets && <NavLink to="/boletas/nueva"><Icon name="add_circle" /> Crear boleta</NavLink>}
        {canViewTickets && <NavLink to="/boletas/finalizadas"><Icon name="task_alt" /> Boletas finalizadas</NavLink>}
        {canViewMaintenance && <NavLink to="/mantenimientos"><Icon name="engineering" /> Mantenimientos</NavLink>}
        {isAdmin && <NavLink to="/metricas"><Icon name="monitoring" /> Métricas</NavLink>}
        {isAdmin && <NavLink to="/administracion/importar-boletas"><Icon name="upload_file" /> Importar boletas anteriores</NavLink>}
        <NavLink to="/conocimiento"><Icon name="menu_book" /> Base de conocimientos</NavLink>
        {canViewClients && <NavLink to="/clientes"><Icon name="groups" /> Clientes</NavLink>}
        {canViewCatalogs && <NavLink to="/catalogos"><Icon name="inventory_2" /> Catálogos</NavLink>}
        {canViewUsers && <NavLink to="/usuarios"><Icon name="person_search" /> Usuarios</NavLink>}
        <NavLink to="/cambiar-contrasena"><Icon name="lock_reset" /> Cambiar contraseña</NavLink>
        <NavLink to="/mas"><Icon name="more_horiz" /> Más opciones</NavLink>
      </nav>
      <button type="button" className="drawer-logout" onClick={handleLogout}><Icon name="logout" /> Cerrar sesión</button>
    </aside>
    <main className="app-content"><Outlet /></main>
    {showAssistantFab && <NavLink className={`assistant-fab${isWorkflowForm ? ' assistant-fab--workflow' : ''}`} to={assistantUrl} aria-label="Abrir Asistente DMS" title="Preguntar al Asistente DMS"><span className="assistant-fab__icon"><Icon name="smart_toy" filled /></span><span className="assistant-fab__label">Preguntar</span></NavLink>}
    {!isWorkflowForm && !isAssistantPage && <nav className="bottom-nav" aria-label="Navegación principal"><NavigationItem to="/" icon="home" label="Inicio" end />{canViewTickets && <NavigationItem to="/boletas/pendientes" icon="pending_actions" label="Pendientes" />}{canCreateTickets && <NavigationItem to="/boletas/nueva" icon="add" label="Crear" prominent />}{canViewTickets && <NavigationItem to="/boletas/finalizadas" icon="task_alt" label="Finalizadas" />}<NavigationItem to="/mas" icon="more_horiz" label="Más" /></nav>}
  </div>;
}