import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import Loading from '../../components/common/Loading';
import useRoles from '../../hooks/useRoles';

export default function UserDetailPage() {
  const { usuarioId } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const { roles } = useRoles();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('users.get', { usuarioId }, sessionToken)
      .then(setRecord)
      .catch((err) => setError(err.message));
  }, [usuarioId, sessionToken]);

  if (error) return <div className="page page--narrow"><ErrorMessage message={error} /></div>;
  if (!record) return <div className="page page--narrow"><Loading label="Cargando detalle..." /></div>;

  const role = roles.find((item) => item.RolID === record.user.RolID);
  const active = record.user.Estado === 'ACTIVO';

  return (
    <div className="page page--narrow">
      <header className="page-header">
        <Link to="/usuarios" className="icon-button" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div><span className="eyebrow">Usuarios</span><h1>Detalle del usuario</h1></div>
      </header>

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

      {hasPermission('USUARIOS_GESTIONAR') && (
        <Link to={`/usuarios/${usuarioId}/editar`} className="button button--primary button--wide"><Icon name="edit" /> Editar usuario</Link>
      )}
    </div>
  );
}
