import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'DMS';
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
}

function NavigationItem({ to, icon, label, end = false, prominent = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}${prominent ? ' bottom-nav__item--prominent' : ''}`}
    >
      <span className={prominent ? 'bottom-nav__fab' : ''}><Icon name={icon} filled={!prominent} /></span>
      <span>{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const canViewUsers = hasPermission('USUARIOS_VER');
  const canManageUsers = hasPermission('USUARIOS_GESTIONAR');

  useEffect(() => {
    if (user?.CambioPasswordObligatorio && location.pathname !== '/cambiar-contrasena') {
      navigate('/cambiar-contrasena', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú"><Icon name="menu" /></button>
        <NavLink to="/" className="top-bar__brand">DMS Boletas</NavLink>
        <NavLink to="/mas" className="avatar avatar--small" aria-label="Abrir perfil">{initials(user?.NombreCompleto)}</NavLink>
      </header>

      <div className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden={!drawerOpen} />
      <aside className={`side-drawer${drawerOpen ? ' is-open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="side-drawer__profile">
          <div className="avatar avatar--large">{initials(user?.NombreCompleto)}</div>
          <div><strong>{user?.NombreCompleto}</strong><span>{canManageUsers ? 'Administrador' : 'Técnico'}</span></div>
        </div>
        <nav className="side-drawer__nav">
          <NavLink to="/" end><Icon name="home" /> Inicio</NavLink>
          <NavLink to="/boletas/pendientes"><Icon name="pending_actions" /> Boletas pendientes</NavLink>
          <NavLink to="/boletas/nueva"><Icon name="add_circle" /> Crear boleta</NavLink>
          <NavLink to="/boletas/finalizadas"><Icon name="task_alt" /> Boletas finalizadas</NavLink>
          <NavLink to="/clientes"><Icon name="groups" /> Clientes</NavLink>
          <NavLink to="/categorias"><Icon name="category" /> Categorías</NavLink>
          {canViewUsers && <NavLink to="/usuarios"><Icon name="person_search" /> Usuarios</NavLink>}
          <NavLink to="/cambiar-contrasena"><Icon name="lock_reset" /> Cambiar contraseña</NavLink>
          <NavLink to="/mas"><Icon name="more_horiz" /> Más opciones</NavLink>
        </nav>
        <button type="button" className="drawer-logout" onClick={handleLogout}><Icon name="logout" /> Cerrar sesión</button>
      </aside>

      <main className="app-content"><Outlet /></main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        <NavigationItem to="/" icon="home" label="Inicio" end />
        <NavigationItem to="/boletas/pendientes" icon="pending_actions" label="Pendientes" />
        <NavigationItem to="/boletas/nueva" icon="add" label="Crear" prominent />
        <NavigationItem to="/boletas/finalizadas" icon="task_alt" label="Finalizadas" />
        <NavigationItem to="/mas" icon="more_horiz" label="Más" />
      </nav>
    </div>
  );
}
