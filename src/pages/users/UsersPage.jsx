import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import Loading from '../../components/common/Loading';
import PasswordResetFeedback from '../../components/users/PasswordResetFeedback';
import useRoles from '../../hooks/useRoles';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'U'}${parts[1]?.[0] || ''}`.toUpperCase();
}

export default function UsersPage() {
  const { sessionToken, hasPermission, user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { roles } = useRoles();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [resettingUserId, setResettingUserId] = useState('');
  const [resetResult, setResetResult] = useState(null);

  const roleById = useMemo(() => Object.fromEntries(roles.map((role) => [role.RolID, role.Nombre])), [roles]);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('users.list', { page: 1, pageSize: 200, search, sortBy: 'NombreCompleto', sortDir: 'asc' }, sessionToken);
      setUsers(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [sessionToken]);

  async function deactivateUser(record) {
    if (record.UsuarioID === currentUser.UsuarioID) {
      window.alert('No puede desactivar su propio usuario.');
      return;
    }
    if (!window.confirm(`¿Desactivar a ${record.NombreCompleto}?`)) return;
    try {
      await apiRequest('users.update', { usuarioId: record.UsuarioID, estado: 'INACTIVO' }, sessionToken);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(record) {
    if (record.UsuarioID === currentUser.UsuarioID) {
      window.alert('Para su propia cuenta utilice la opción Cambiar contraseña.');
      return;
    }
    const confirmed = window.confirm(
      `¿Restablecer la contraseña de ${record.NombreCompleto}?\n\n`
      + `Se generará una contraseña temporal, se enviará a ${record.Correo} y se cerrarán todas sus sesiones activas.`,
    );
    if (!confirmed) return;

    setResettingUserId(record.UsuarioID);
    setError('');
    setResetResult(null);
    try {
      const result = await apiRequest('users.password.reset', { usuarioId: record.UsuarioID }, sessionToken);
      setResetResult(result);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setResettingUserId('');
    }
  }

  function openCard(event, url) {
    if (event.target.closest('a, button, input, select, textarea, label')) return;
    navigate(url);
  }

  function openCardWithKeyboard(event, url) {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(url);
  }

  return (
    <div className="page">
      <header className="list-page-heading">
        <div><span className="eyebrow">Administración</span><h1>Usuarios</h1><p>Gestiona accesos, roles y estado de las cuentas.</p></div>
        {hasPermission('USUARIOS_GESTIONAR') && (
          <Link to="/usuarios/nuevo" className="button button--primary"><Icon name="person_add" /> Crear usuario</Link>
        )}
      </header>

      <form className="search-bar" onSubmit={(event) => { event.preventDefault(); loadUsers(); }}>
        <Icon name="search" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, usuario o correo..." aria-label="Buscar usuarios" />
        <button className="icon-button icon-button--primary" aria-label="Buscar"><Icon name="search" /></button>
      </form>

      <ErrorMessage message={error} />
      <PasswordResetFeedback result={resetResult} onClose={() => setResetResult(null)} />

      {loading ? <Loading label="Cargando usuarios..." /> : users.length === 0 ? (
        <div className="empty-state"><Icon name="person_off" /><h2>No hay usuarios</h2><p>No se encontraron resultados para la búsqueda actual.</p></div>
      ) : (
        <div className="user-grid">
          {users.map((record) => {
            const active = record.Estado === 'ACTIVO';
            const detailUrl = `/usuarios/${encodeURIComponent(record.UsuarioID)}`;
            const isCurrentUser = record.UsuarioID === currentUser.UsuarioID;
            const resetting = resettingUserId === record.UsuarioID;
            return (
              <article
                key={record.UsuarioID}
                className={`user-card detail-clickable-card${active ? '' : ' user-card--inactive'}`}
                onClick={(event) => openCard(event, detailUrl)}
                onKeyDown={(event) => openCardWithKeyboard(event, detailUrl)}
                role="link"
                tabIndex={0}
                aria-label={`Abrir detalle de ${record.NombreCompleto}`}
              >
                <span className={`user-card__stripe ${active ? 'is-active' : 'is-inactive'}`} />
                <div className="user-card__header">
                  <div className="avatar">{initials(record.NombreCompleto)}</div>
                  <div className="user-card__identity">
                    <strong>{record.NombreCompleto}</strong>
                    <span>@{record.NombreUsuario}</span>
                  </div>
                  <span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{record.Estado}</span>
                </div>
                <dl className="user-card__details">
                  <div><dt>Correo</dt><dd>{record.Correo}</dd></div>
                  <div><dt>Rol</dt><dd>{roleById[record.RolID] || record.RolID}</dd></div>
                </dl>
                <div className="card-actions">
                  <Link to={detailUrl} className="button button--primary button--compact">Ver detalle</Link>
                  {hasPermission('USUARIOS_GESTIONAR') && <Link to={`${detailUrl}/editar`} className="icon-button icon-button--outlined" aria-label="Editar"><Icon name="edit" /></Link>}
                  {hasPermission('USUARIOS_GESTIONAR') && active && !isCurrentUser && (
                    <button
                      type="button"
                      className="icon-button icon-button--outlined user-card__reset-password"
                      onClick={() => resetPassword(record)}
                      aria-label={`Restablecer contraseña de ${record.NombreCompleto}`}
                      title="Restablecer contraseña y enviarla por correo"
                      disabled={Boolean(resettingUserId)}
                    >
                      <Icon name={resetting ? 'progress_activity' : 'lock_reset'} />
                    </button>
                  )}
                  {hasPermission('USUARIOS_GESTIONAR') && active && (
                    <button type="button" className="icon-button icon-button--danger" onClick={() => deactivateUser(record)} aria-label="Desactivar"><Icon name="person_remove" /></button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
