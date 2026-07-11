import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import ErrorMessage from '../components/common/ErrorMessage';
import Icon from '../components/common/Icon';
import PasswordInput from '../components/common/PasswordInput';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await login(username, password);
      navigate(data.mustChangePassword ? '/cambiar-contrasena' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-page__glow" />
      <section className="login-panel">
        <div className="brand-lockup">
          <div className="brand-lockup__icon"><Icon name="description" /></div>
          <h1>DMS Boletas</h1>
        </div>

        <div className="auth-card">
          <div>
            <p className="eyebrow">Acceso seguro</p>
            <h2>Bienvenido</h2>
            <p className="muted">Inicia sesión para continuar con tus operaciones.</p>
          </div>

          {location.state?.passwordChanged && (
            <div className="alert alert--success">
              <Icon name="check_circle" filled />
              <span>Contraseña actualizada. Inicia sesión nuevamente.</span>
            </div>
          )}

          <form className="stack-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label className="field-label" htmlFor="username">Usuario o correo</label>
              <div className="input-shell">
                <Icon name="person" className="input-shell__leading" />
                <input
                  id="username"
                  className="form-control form-control--with-leading"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="nombre@empresa.com"
                  required
                />
              </div>
            </div>

            <PasswordInput
              id="password"
              label="Contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />

            <ErrorMessage message={error} />

            <button className="button button--primary button--wide" type="submit" disabled={submitting}>
              {submitting ? <><Icon name="progress_activity" className="spin" /> Ingresando...</> : <>Ingresar <Icon name="login" /></>}
            </button>
          </form>
        </div>

        <footer className="login-footer">
          <span>DMS Boletas</span>
          <span><Icon name="verified_user" /> Conexión segura</span>
        </footer>
      </section>
    </main>
  );
}
