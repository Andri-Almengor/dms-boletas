import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import Loading from '../../components/common/Loading';
import PasswordResetFeedback from '../../components/users/PasswordResetFeedback';
import useRoles from '../../hooks/useRoles';
import { mergePaginatedItems, paginationMeta } from '../../utils/paginatedCollection';

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resettingUserId, setResettingUserId] = useState('');
  const [resetResult, setResetResult] = useState(null);
  const requestSequence = useRef(0);

  const roleById = useMemo(() => Object.fromEntries(roles.map((role) => [role.RolID, role.Nombre])), [roles]);

  const loadUsers = useCallback(async ({ targetPage = 1, append = false, query = search } = {}) => {
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const data = await apiRequest('users.list', {
        page: targetPage,
        pageSize: PAGE_SIZE,
        search: query.trim(),
        sortBy: 'NombreCompleto',
        sortDir: 'asc',
      }, sessionToken);
      if (sequence !== requestSequence.current) return;
      const incoming = data.items || [];
      setUsers((current) => {
        const next = append
          ? mergePaginatedItems(current, incoming, (user) => String(user.UsuarioID))
          : incoming;
        const meta = paginationMeta(data, {
          loadedCount: next.length,
          incomingCount: incoming.length,
          pageSize: PAGE_SIZE,
        });
        setTotal(meta.total);
        setHasMore(meta.hasMore);
        return next;
      });
      setPage(targetPage);
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setError(err.message);
      if (!append) {
        setUsers([]);
        setTotal(0);
        setHasMore(false);
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [search, sessionToken]);

  useEffect(() => {
    setUsers([]);
    setPage(1);
    loadUsers({ targetPage: 1, append: false, query: '' });
  }, [sessionToken]);

  async function deactivateUser(record) {
    if (record.UsuarioID === currentUser.UsuarioID) {
      window.alert('No puede desactivar su propio usuario.');
      return;
    }
    if (!window.confirm(`¿Desactivar a ${record.NombreCompleto}?`)) return;
    try {
      await apiRequest('users.update', { usuarioId: record.UsuarioID, estado: 'INACTIVO' }, sessionToken);
      setUsers((current) => current.map((item) => item.UsuarioID === record.UsuarioID ? { ...item, Estado: 'INACTIVO' } : item));
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
        {hasPermission('USUARIOS_GESTIONAR') && <Link to="/usuarios/nuevo" className="button button--primary"><Icon name="person_add" /> Crear usuario</Link>}
      </header>

      <form className="search-bar" onSubmit={(event) => { event.preventDefault(); setPage(1); loadUsers({ targetPage: 1, append: false }); }}>
        <Icon name="search" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, usuario o correo..." aria-label="Buscar usuarios" />
        <button className="icon-button icon-button--primary" aria-label="Buscar"><Icon name="search" /></button>
      </form>

      <ErrorMessage message={error} />
      <PasswordResetFeedback result={resetResult} onClose={() => setResetResult(null)} />

      {loading ? <Loading label="Cargando usuarios..." /> : users.length === 0 ? (
        <div className="empty-state"><Icon name="person_off" /><h2>No hay usuarios</h2><p>No se encontraron resultados para la búsqueda actual.</p></div>
      ) : <>
        <div className="ticket-list-result-count"><span>Mostrando <strong>{users.length}</strong>{total > users.length ? ` de ${total}` : ''} usuarios</span></div>
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
                  <div className="user-card__identity"><strong>{record.NombreCompleto}</strong><span>@{record.NombreUsuario}</span></div>
                  <span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{record.Estado}</span>
                </div>
                <dl className="user-card__details"><div><dt>Correo</dt><dd>{record.Correo}</dd></div><div><dt>Rol</dt><dd>{roleById[record.RolID] || record.RolID}</dd></div></dl>
                <div className="card-actions">
                  <Link to={detailUrl} className="button button--primary button--compact">Ver detalle</Link>
                  {hasPermission('USUARIOS_GESTIONAR') && <Link to={`${detailUrl}/editar`} className="icon-button icon-button--outlined" aria-label="Editar"><Icon name="edit" /></Link>}
                  {hasPermission('USUARIOS_GESTIONAR') && active && !isCurrentUser && <button type="button" className="icon-button icon-button--outlined user-card__reset-password" onClick={() => resetPassword(record)} aria-label={`Restablecer contraseña de ${record.NombreCompleto}`} title="Restablecer contraseña y enviarla por correo" disabled={Boolean(resettingUserId)}><Icon name={resetting ? 'progress_activity' : 'lock_reset'} /></button>}
                  {hasPermission('USUARIOS_GESTIONAR') && active && <button type="button" className="icon-button icon-button--danger" onClick={() => deactivateUser(record)} aria-label="Desactivar"><Icon name="person_remove" /></button>}
                </div>
              </article>
            );
          })}
        </div>
        {hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={() => loadUsers({ targetPage: page + 1, append: true })}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más usuarios'}</button></div>}
      </>}
    </div>
  );
}
