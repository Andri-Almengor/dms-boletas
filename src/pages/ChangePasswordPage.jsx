import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';
import ErrorMessage from '../components/common/ErrorMessage';
import Icon from '../components/common/Icon';
import PasswordInput from '../components/common/PasswordInput';

export default function ChangePasswordPage() {
  const { user, sessionToken, clearSession } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('auth.changePassword', { currentPassword, newPassword }, sessionToken);
      clearSession();
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page--narrow">
      <header className="page-header">
        <Link to="/mas" className="icon-button" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div><span className="eyebrow">Seguridad</span><h1>Cambiar contraseña</h1></div>
      </header>

      {user?.CambioPasswordObligatorio && (
        <div className="alert alert--warning">
          <Icon name="priority_high" filled />
          <span>Debes cambiar la contraseña temporal antes de continuar.</span>
        </div>
      )}

      <section className="form-card">
        <div className="form-card__heading">
          <span className="section-marker" />
          <div><h2>Nueva credencial</h2><p>Utiliza una contraseña segura que puedas recordar.</p></div>
        </div>

        <form className="stack-form" onSubmit={handleSubmit}>
          <PasswordInput id="currentPassword" label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          <PasswordInput id="newPassword" label="Nueva contraseña" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} />
          <PasswordInput id="confirmPassword" label="Confirmar contraseña" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} />

          <div className="info-box">
            <Icon name="info" />
            <p>Debe incluir al menos 8 caracteres, una mayúscula, una minúscula y un número.</p>
          </div>

          <ErrorMessage message={error} />

          <button className="button button--primary button--wide" disabled={submitting}>
            {submitting ? <><Icon name="progress_activity" className="spin" /> Guardando...</> : <><Icon name="lock_reset" /> Cambiar contraseña</>}
          </button>
        </form>
      </section>
    </div>
  );
}
