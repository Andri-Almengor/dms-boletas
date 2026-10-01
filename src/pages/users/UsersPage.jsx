import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import Loading from '../../components/common/Loading';
import PasswordResetFeedback from '../../components/users/PasswordResetFeedback';
import usePaginatedResource from '../../hooks/usePaginatedResource';
import useRoles from '../../hooks/useRoles';

const PAGE_SIZE = 50;

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'U'}${parts[1]?.[0] || ''}`.toUpperCase();
}

export default function UsersPage() {
  const { sessionToken, hasPermission, user: currentUser } = useAuth();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSearch = searchParams.get('q') || '';
  const { roles } = useRoles();
  const [search, setSearch] = useState(requestedSearch);
  const [submittedSearch, setSubmittedSearch] = useState(requestedSearch);
  const [resettingUserId, setResettingUserId] = useState('');
  const [resetResult, setResetResult] = useState(null);

  const fetchUsers = useCallback(({ page, pageSize, signal }) => apiRequest('users.list', {
    page,
    pageSize,
    search: submittedSearch,
    sortBy: 'NombreCompleto',
    sortDir: 'asc',
  }, sessionToken, { signal }), [sessionToken, submittedSearch]);

  const {
    items: users,
    setItems: setUsers,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    setError,
    loadFirst,
    loadMore,
  } = usePaginatedResource({
    pageSize: PAGE_SIZE,
    fetchPage: fetchUsers,
    getItemKey: (user) => String(user.UsuarioID),
    resetKey: `${sessionToken}|${submittedSearch}`, 
  });

  const roleById = useMemo(() => Object.fromEntries(roles.map((role) => [role.RolID, role.Nombre])), [roles]);

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

  const currentListUrl = `${routeLocation.pathname}${routeLocation.search || ''}`;

  function listReturnState() {
    return {
      usersListReturnTo: currentListUrl,
      usersListScrollY: typeof window === 'undefined' ? 0 : Math.max(0, Number(window.scrollY || 0)),
    };
  }

  function submitSearch(event) {
    event.preventDefault();
    const nextSearch = search.trim();
    const next = new URLSearchParams(searchParams);
    if (nextSearch) next.set('q', nextSearch);
    else next.delete('q');
    setSearchParams(next, { replace: true });
    if (nextSearch === submittedSearch) loadFirst();
    else setSubmittedSearch(nextSearch);
  }

  function openCard(event, url) {
    if (event.target.closest('a, button, input, select, textarea, label')) return;
    navigate(url, { state: listReturnState() });
  }

  function openCardWithKeyboard(event, url) {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(url, { state: listReturnState() });
  }

  useEffect(() => {
    const restoreScrollY = Number(routeLocation.state?.restoreScrollY);
    if (loading || !Number.isFinite(restoreScrollY) || restoreScrollY <= 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScrollY, behavior: 'auto' });
      navigate(currentListUrl, { replace: true, state: null });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentListUrl, loading, navigate, routeLocation.state?.restoreScrollY]);

  return (
    <div className="page page--wide users-page">
      <header className="list-page-heading">
        <div><span className="eyebrow">Administración</span><h1>Usuarios</h1><p>Gestiona accesos, roles y estado de las cuentas.</p></div>
        {hasPermission('USUARIOS_GESTIONAR') && <Link to="/usuarios/nuevo" state={listReturnState()} className="button button--primary"><Icon name="person_add" /> Crear usuario</Link>}
      </header>

      <form className="search-bar users-search-bar" role="search" onSubmit={submitSearch}>
        <Icon name="search" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, usuario o correo..." aria-label="Buscar usuarios" enterKeyHint="search" autoComplete="off" />
        <button className="icon-button icon-button--primary" type="submit" aria-label="Buscar"><Icon name="arrow_forward" /></button>
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
                <div className="card-actions user-card__actions">
                  <Link to={detailUrl} state={listReturnState()} className="button button--primary button--compact user-card__primary-action">Ver detalle</Link>
                  <div className="user-card__secondary-actions">
                    {hasPermission('USUARIOS_GESTIONAR') && <Link to={`${detailUrl}/editar`} state={listReturnState()} className="icon-button icon-button--outlined" aria-label="Editar"><Icon name="edit" /></Link>}
                    {hasPermission('USUARIOS_GESTIONAR') && active && !isCurrentUser && <button type="button" className="icon-button icon-button--outlined user-card__reset-password" onClick={() => resetPassword(record)} aria-label={`Restablecer contraseña de ${record.NombreCompleto}`} title="Restablecer contraseña y enviarla por correo" disabled={Boolean(resettingUserId)}><Icon name={resetting ? 'progress_activity' : 'lock_reset'} /></button>}
                    {hasPermission('USUARIOS_GESTIONAR') && active && <button type="button" className="icon-button icon-button--danger" onClick={() => deactivateUser(record)} aria-label="Desactivar"><Icon name="person_remove" /></button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={loadMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más usuarios'}</button></div>}
      </>}
    </div>
  );
}
