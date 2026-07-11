import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import ErrorMessage from '../../components/common/ErrorMessage';
import Icon from '../../components/common/Icon';
import useRoles from '../../hooks/useRoles';

export default function UserFormPage({ mode }) {
  const { usuarioId } = useParams();
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const { roles, error: rolesError } = useRoles();
  const [form, setForm] = useState({ nombreCompleto: '', nombreUsuario: '', correo: '', rolId: '', estado: 'ACTIVO' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  useEffect(() => {
    if (mode !== 'edit') return;
    apiRequest('users.get', { usuarioId }, sessionToken)
      .then((data) => setForm({
        nombreCompleto: data.user.NombreCompleto || '',
        nombreUsuario: data.user.NombreUsuario || '',
        correo: data.user.Correo || '',
        rolId: data.user.RolID || '',
        estado: data.user.Estado || 'ACTIVO',
      }))
      .catch((err) => setError(err.message));
  }, [mode, usuarioId, sessionToken]);

  useEffect(() => {
    if (mode === 'create' && !form.rolId && roles.length) {
      const tecnico = roles.find((role) => role.Nombre === 'Técnico');
      setForm((current) => ({ ...current, rolId: tecnico?.RolID || roles[0].RolID }));
    }
  }, [roles, mode, form.rolId]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        const result = await apiRequest('users.create', form, sessionToken);
        setTemporaryPassword(result.temporaryPassword);
      } else {
        await apiRequest('users.update', { usuarioId, ...form }, sessionToken);
        navigate(`/usuarios/${usuarioId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (temporaryPassword) {
    return (
      <div className="page page--narrow">
        <section className="success-card">
          <span className="success-card__icon"><Icon name="check_circle" filled /></span>
          <h1>Usuario creado</h1>
          <p>Guarda la contraseña temporal ahora. El usuario deberá cambiarla al iniciar sesión.</p>
          <div className="temporary-password"><span>Contraseña temporal</span><code>{temporaryPassword}</code></div>
          <Link to="/usuarios" className="button button--primary button--wide">Volver a usuarios</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <header className="page-header">
        <Link to="/usuarios" className="icon-button" aria-label="Cancelar"><Icon name="close" /></Link>
        <div><span className="eyebrow">Administración</span><h1>{mode === 'create' ? 'Crear usuario' : 'Editar usuario'}</h1></div>
      </header>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Información del usuario</h2><p>Completa los datos requeridos para guardar la cuenta.</p></div></div>
        <ErrorMessage message={rolesError || error} />

        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field-group"><label className="field-label" htmlFor="nombreCompleto">Nombre completo</label><input id="nombreCompleto" className="form-control" name="nombreCompleto" value={form.nombreCompleto} onChange={updateField} required /></div>
          <div className="field-group"><label className="field-label" htmlFor="nombreUsuario">Nombre de usuario</label><input id="nombreUsuario" className="form-control" name="nombreUsuario" value={form.nombreUsuario} onChange={updateField} required /></div>
          <div className="field-group"><label className="field-label" htmlFor="correo">Correo</label><input id="correo" className="form-control" type="email" name="correo" value={form.correo} onChange={updateField} required /></div>
          <div className="field-group"><label className="field-label" htmlFor="rolId">Rol</label><select id="rolId" className="form-control" name="rolId" value={form.rolId} onChange={updateField} required><option value="">Seleccione</option>{roles.map((role) => <option key={role.RolID} value={role.RolID}>{role.Nombre}</option>)}</select></div>
          {mode === 'edit' && <div className="field-group"><label className="field-label" htmlFor="estado">Estado</label><select id="estado" className="form-control" name="estado" value={form.estado} onChange={updateField}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></div>}

          <div className="form-actions">
            <Link to="/usuarios" className="button button--secondary">Cancelar</Link>
            <button className="button button--primary" disabled={saving}>{saving ? <><Icon name="progress_activity" className="spin" /> Guardando...</> : <><Icon name="save" /> Guardar</>}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
