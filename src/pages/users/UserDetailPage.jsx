import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import Loading from '../../components/common/Loading';
import PasswordResetFeedback from '../../components/users/PasswordResetFeedback';
import useRoles from '../../hooks/useRoles';

export default function UserDetailPage() {
  const { usuarioId } = useParams();
  const { sessionToken, hasPermission, user: currentUser } = useAuth();
  const { roles } = useRoles();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState(null);

  async function loadUser() {
    setError('');
    try {
      const data = await apiRequest('users.get', { usuarioId }, sessionToken);
      setRecord(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadUser();
  }, [usuarioId, sessionToken]);

  async function resetPassword() {
    if (!record?.user) return;
    const confirmed = window.confirm(
      `¿Restablecer la contraseña de ${record.user.NombreCompleto}?\n\n`
      + `Se generará una contraseña temporal, se enviará a ${record.user.Correo} y se cerrarán todas sus sesiones activas.`,
    );
    if (!confirmed) return;

    setResetting(true);
    setError('');
    setResetResult(null);
    try {
      const result = await apiRequest('users.password.reset', { usuarioId }, sessionToken);
      setResetResult(result);
      await loadUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (error && !record) return <div className="page page--narrow"><ErrorMessage message={error} /></div>;
  if (!record) return <div className="page page--narrow"><Loading label="Cargando detalle..." /></div>;

  const role = roles.find((item) => item.RolID === record.user.RolID);
  const active = record.user.Estado === 'ACTIVO';
  const canManage = hasPermission('USUARIOS_GESTIONAR');
  const isCurrentUser = String(record.user.UsuarioID) === String(currentUser?.UsuarioID);

  return (
    <div className="page page--narrow">
      <header className="page-header">
        <Link to="/usuarios" className="icon-button" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div><span className="eyebrow">Usuarios</span><h1>Detalle del usuario</h1></div>
      </header>

      <ErrorMessage message={error} />
      <PasswordResetFeedback result={resetResult} onClose={() => setResetResult(null)} />

      <section className="detail-hero">
        <div className="avatar avatar--xlarge"><Icon name="person" /></div>
        <div><h2>{record.user.NombreCompleto}</h2><p>@{record.user.NombreUsuario}</p></div>
        <span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{record.user.Estado}</span>
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker" /><h2>Información general</h2></div>
        <dl className="detail-grid">
          <div><dt><Icon name="mail" /> Correo</dt><dd>{record.user.Correo}</dd></div>
          <div><dt><Icon name="badge" /> Rol</dt><dd>{role?.Nombre || record.user.RolID}</dd></div>
          <div><dt><Icon name="password" /> Cambio obligatorio</dt><dd>{record.user.CambioPasswordObligatorio ? 'Sí' : 'No'}</dd></div>
        </dl>
      </section>

      <section className="detail-card">
        <div className="detail-card__heading"><span className="section-marker section-marker--secondary" /><h2>Permisos efectivos</h2></div>
        <div className="permission-list">
          {(record.permissions || []).length ? record.permissions.map((permission) => (
            <span className="permission-chip" key={permission}><Icon name="check_circle" filled /> {permission}</span>
          )) : <p className="muted">Este usuario no tiene permisos adicionales.</p>}
        </div>
      </section>

      {canManage && (
        <div className="user-detail-actions">
          <Link to={`/usuarios/${usuarioId}/editar`} className="button button--primary"><Icon name="edit" /> Editar usuario</Link>
          {active && !isCurrentUser && (
            <button type="button" className="button button--secondary" onClick={resetPassword} disabled={resetting}>
              <Icon name={resetting ? 'progress_activity' : 'lock_reset'} /> {resetting ? 'Restableciendo...' : 'Restablecer contraseña'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
