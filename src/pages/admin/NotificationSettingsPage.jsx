import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';

const EMPTY_SETTINGS = Object.freeze({ configured: false, redactedWebhook: '' });

export default function NotificationSettingsPage() {
  const { sessionToken } = useAuth();
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [webhook, setWebhook] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest('config.get', { section: 'AGENDA_CHAT' }, sessionToken);
      setSettings(response?.settings || EMPTY_SETTINGS);
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo cargar la configuración de notificaciones.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  async function saveWebhook(event) {
    event.preventDefault();
    if (saving) return;
    const value = webhook.trim();
    if (!value) {
      setError('Pegue el webhook de Google Chat que desea usar para la Agenda.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_CHAT',
        operation: 'UPDATE',
        settings: { webhook: value },
      }, sessionToken);
      setSettings(response?.settings || EMPTY_SETTINGS);
      setWebhook('');
      setNotice('El chat de Agenda quedó configurado correctamente. Las próximas agendas se enviarán también a Google Chat.');
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo guardar el webhook de Agenda.');
    } finally {
      setSaving(false);
    }
  }

  async function disableChat() {
    if (saving || !settings.configured) return;
    if (!window.confirm('¿Desea desactivar el envío de Agenda a Google Chat? Los correos seguirán funcionando normalmente.')) return;

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_CHAT',
        operation: 'UPDATE',
        settings: { webhook: '' },
      }, sessionToken);
      setSettings(response?.settings || EMPTY_SETTINGS);
      setWebhook('');
      setNotice('El chat de Agenda quedó desactivado. El envío de correos no fue modificado.');
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo desactivar el chat de Agenda.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="page">
    <header className="page-header">
      <div>
        <span className="eyebrow">Administración</span>
        <h1>Notificaciones</h1>
        <p>Configure los canales utilizados por los módulos operativos de DMS.</p>
      </div>
      <Link to="/mas" className="button button--secondary"><Icon name="arrow_back" /> Volver</Link>
    </header>

    {notice && <div className="state-card state-card--success"><Icon name="check_circle" /><span>{notice}</span></div>}
    {error && <div className="state-card state-card--error"><Icon name="error" /><span>{error}</span><button type="button" className="button button--secondary button--compact" onClick={load}>Reintentar</button></div>}

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando configuración...</span></div> : <section className="content-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Agenda DMS</span>
          <h2>Google Chat de Agenda</h2>
          <p>Las agendas nuevas y las modificaciones se enviarán a este chat además del correo habitual.</p>
        </div>
        <span className={`status-chip ${settings.configured ? 'status-chip--active' : 'status-chip--pending'}`}>
          {settings.configured ? 'Configurado' : 'Desactivado'}
        </span>
      </div>

      {settings.configured && <div className="state-card">
        <Icon name="forum" />
        <div>
          <strong>Webhook activo</strong>
          <span>{settings.redactedWebhook || 'Google Chat configurado'}</span>
        </div>
      </div>}

      <form onSubmit={saveWebhook} className="form-stack">
        <label className="field">
          <span>{settings.configured ? 'Reemplazar webhook' : 'Webhook de Google Chat'}</span>
          <input
            type="url"
            value={webhook}
            onChange={(event) => { setWebhook(event.target.value); setError(''); setNotice(''); }}
            placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=..."
            autoComplete="off"
            spellCheck="false"
            disabled={saving}
          />
          <small>Por seguridad, el webhook guardado nunca se muestra completo. Pegue uno nuevo para configurarlo o reemplazarlo.</small>
        </label>

        <div className="form-actions">
          {settings.configured && <button type="button" className="button button--secondary" onClick={disableChat} disabled={saving}>
            <Icon name="notifications_off" /> Desactivar chat
          </button>}
          <button type="submit" className="button button--primary" disabled={saving || !webhook.trim()}>
            <Icon name={saving ? 'progress_activity' : 'save'} /> {saving ? 'Guardando...' : settings.configured ? 'Reemplazar webhook' : 'Guardar webhook'}
          </button>
        </div>
      </form>

      <div className="state-card">
        <Icon name="info" />
        <div>
          <strong>Comportamiento del envío</strong>
          <span>Crear, modificar y separar agendas utiliza el mismo flujo de notificación. Si Google Chat falla, la agenda permanece guardada y el correo continúa funcionando de forma independiente.</span>
        </div>
      </div>
    </section>}
  </div>;
}
