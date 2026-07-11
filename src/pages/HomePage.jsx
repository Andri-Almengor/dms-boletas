import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'Usuario';
}

export default function HomePage() {
  const { user, permissions, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canViewUsers = hasPermission('USUARIOS_VER');

  return (
    <div className="page page--home">
      <section className="welcome-block">
        <span className="eyebrow">Bienvenido</span>
        <h1>Hola, {firstName(user?.NombreCompleto)}</h1>
        <p><Icon name={isAdmin ? 'admin_panel_settings' : 'engineering'} /> {isAdmin ? 'Administrador' : 'Técnico'}</p>
      </section>

      <section className="stats-grid">
        <article className="stat-card stat-card--warning">
          <Icon name="verified_user" />
          <strong>{permissions.length}</strong>
          <span>Permisos habilitados</span>
        </article>
        <article className="stat-card stat-card--success">
          <Icon name="task_alt" filled />
          <strong>Activa</strong>
          <span>Sesión del usuario</span>
        </article>
      </section>

      {isAdmin && (
        <Link to="/usuarios/nuevo" className="primary-cta">
          <Icon name="person_add" />
          <span>Crear nuevo usuario</span>
        </Link>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Panel principal</span>
            <h2>Accesos rápidos</h2>
          </div>
        </div>

        <div className="quick-grid">
          {canViewUsers && (
            <Link to="/usuarios" className="quick-card">
              <span className="quick-card__icon"><Icon name="person_search" /></span>
              <div><strong>Usuarios</strong><span>Consultar y administrar accesos</span></div>
              <Icon name="chevron_right" />
            </Link>
          )}
          <Link to="/cambiar-contrasena" className="quick-card">
            <span className="quick-card__icon"><Icon name="lock_reset" /></span>
            <div><strong>Cambiar contraseña</strong><span>Actualiza tus credenciales</span></div>
            <Icon name="chevron_right" />
          </Link>
          <Link to="/mas" className="quick-card">
            <span className="quick-card__icon"><Icon name="more_horiz" /></span>
            <div><strong>Más opciones</strong><span>Perfil, módulos y sesión</span></div>
            <Icon name="chevron_right" />
          </Link>
        </div>
      </section>

      <section className="profile-summary-card">
        <div className="profile-summary-card__accent" />
        <Icon name="account_circle" />
        <div>
          <span className="eyebrow">Usuario conectado</span>
          <strong>{user?.NombreCompleto}</strong>
          <span>{user?.Correo}</span>
          <small>@{user?.NombreUsuario}</small>
        </div>
      </section>
    </div>
  );
}
