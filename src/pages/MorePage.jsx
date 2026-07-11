import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'D'}${parts[1]?.[0] || 'M'}`.toUpperCase();
}

function MenuRow({ to, icon, label, note, disabled = false }) {
  if (disabled) {
    return (
      <div className="menu-row is-disabled" aria-disabled="true">
        <span className="menu-row__icon"><Icon name={icon} /></span>
        <div><strong>{label}</strong><small>{note}</small></div>
        <span className="status-chip status-chip--neutral">Preparado</span>
      </div>
    );
  }
  return (
    <Link to={to} className="menu-row">
      <span className="menu-row__icon"><Icon name={icon} /></span>
      <div><strong>{label}</strong>{note && <small>{note}</small>}</div>
      <Icon name="chevron_right" />
    </Link>
  );
}

export default function MorePage() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page page--narrow">
      <section className="profile-card">
        <span className="profile-card__accent" />
        <div className="avatar avatar--xlarge">{initials(user?.NombreCompleto)}</div>
        <div>
          <h1>{user?.NombreCompleto}</h1>
          <p>{isAdmin ? 'Administrador' : 'Técnico'}</p>
          <span className="status-chip status-chip--active">{user?.Estado || 'ACTIVO'}</span>
        </div>
      </section>

      <section className="menu-section">
        <h2>Administración</h2>
        <div className="menu-list">
          <MenuRow icon="groups" label="Clientes" note="Diseño listo; sin alterar el backend anterior" disabled />
          {hasPermission('USUARIOS_VER') && <MenuRow to="/usuarios" icon="person_search" label="Usuarios" note="Consulta y administra accesos" />}
          <MenuRow icon="category" label="Categorías" note="Diseño listo; sin alterar el backend anterior" disabled />
          <MenuRow to="/cambiar-contrasena" icon="lock_reset" label="Cambiar contraseña" note="Seguridad de la cuenta" />
        </div>
      </section>

      <section className="menu-section">
        <h2>Sesión</h2>
        <button type="button" className="logout-row" onClick={handleLogout}>
          <span className="menu-row__icon"><Icon name="logout" /></span>
          <div><strong>Cerrar sesión</strong><small>Salir de forma segura</small></div>
        </button>
      </section>

      <footer className="app-meta">DMS Boletas · React + Apps Script</footer>
    </div>
  );
}
