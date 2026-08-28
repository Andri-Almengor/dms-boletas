import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import AgendaTicketExceptionsSettings from '../../components/admin/AgendaTicketExceptionsSettings';
import Icon from '../../components/common/Icon';

const EMPTY_CHAT_SETTINGS = Object.freeze({ configured: false, redactedWebhook: '' });
const EMPTY_EMAIL_SETTINGS = Object.freeze({
  caseCreatedTo: [],
  caseCreatedCc: [],
  caseAssignedCc: [],
  ticketDefaultCc: [],
  testRecipients: [],
  testCc: [],
});

const EMAIL_FIELDS = Object.freeze([
  {
    key: 'caseCreatedTo',
    icon: 'outgoing_mail',
    label: 'Destinatarios principales',
    description: 'Personas que reciben los avisos principales de casos y notificaciones administrativas.',
    placeholder: 'persona1@empresa.com\npersona2@empresa.com',
    required: true,
  },
  {
    key: 'caseCreatedCc',
    icon: 'group_add',
    label: 'Copias de casos nuevos',
    description: 'Direcciones que reciben copia cuando se registra un nuevo caso de cliente.',
    placeholder: 'supervisor@empresa.com',
  },
  {
    key: 'caseAssignedCc',
    icon: 'assignment_ind',
    label: 'Copias al asignar casos',
    description: 'Direcciones que reciben copia cuando un caso se asigna o cambia de responsable.',
    placeholder: 'coordinacion@empresa.com',
  },
  {
    key: 'ticketDefaultCc',
    icon: 'description',
    label: 'Copias de boletas',
    description: 'Copias predeterminadas utilizadas por las notificaciones de boletas.',
    placeholder: 'boletas@empresa.com',
  },
  {
    key: 'testRecipients',
    icon: 'science',
    label: 'Destinatarios de prueba',
    description: 'Correos utilizados por los envíos de prueba y validaciones de notificaciones.',
    placeholder: 'pruebas@empresa.com',
    required: true,
  },
  {
    key: 'testCc',
    icon: 'forward_to_inbox',
    label: 'Copias de prueba',
    description: 'Copias opcionales para los envíos realizados en modo de prueba.',
    placeholder: 'soporte@empresa.com',
  },
]);

function emailsToText(value) {
  if (Array.isArray(value)) return value.join('\n');
  return String(value || '').trim();
}

function emailSettingsToForm(settings = EMPTY_EMAIL_SETTINGS) {
  return Object.fromEntries(Object.keys(EMPTY_EMAIL_SETTINGS).map((key) => [key, emailsToText(settings?.[key])]));
}

function countEmails(value) {
  return String(value || '')
    .split(/[;,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function chatFailureMessage(test = {}) {
  const status = Number(test.status || 0);
  const statusText = status ? ` (HTTP ${status})` : '';
  const provider = String(test.providerResponse || '').trim();
  const providerText = provider ? ` Respuesta de Google: ${provider.slice(0, 220)}` : '';
  return `${test.error || 'Google Chat no recibió el mensaje de prueba.'}${statusText}.${providerText}`.replace(/\.\./g, '.');
}

function StatusPill({ active, activeLabel = 'Configurado', inactiveLabel = 'Desactivado' }) {
  return <span className={`notification-status-pill${active ? ' is-active' : ''}`}>
    <span />
    {active ? activeLabel : inactiveLabel}
  </span>;
}

function LoadingState() {
  return <div className="notification-settings-loading" role="status">
    <span><Icon name="progress_activity" /></span>
    <div><strong>Cargando notificaciones</strong><small>Consultando destinatarios, copias y canales configurados.</small></div>
  </div>;
}

export default function NotificationSettingsPage() {
  const { sessionToken } = useAuth();
  const [chatSettings, setChatSettings] = useState(EMPTY_CHAT_SETTINGS);
  const [emailForm, setEmailForm] = useState(() => emailSettingsToForm());
  const [webhook, setWebhook] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingEmails, setSavingEmails] = useState(false);
  const [savingChat, setSavingChat] = useState(false);
  const [testingChat, setTestingChat] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const totalEmails = useMemo(() => (
    Object.values(emailForm).reduce((total, value) => total + countEmails(value), 0)
  ), [emailForm]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [emailResponse, chatResponse] = await Promise.all([
        apiRequest('config.get', { section: 'NOTIFICATION_EMAILS' }, sessionToken),
        apiRequest('config.get', { section: 'AGENDA_CHAT' }, sessionToken),
      ]);
      setEmailForm(emailSettingsToForm(emailResponse?.settings || EMPTY_EMAIL_SETTINGS));
      setChatSettings(chatResponse?.settings || EMPTY_CHAT_SETTINGS);
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo cargar la configuración de notificaciones.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  function clearMessages() {
    setError('');
    setNotice('');
  }

  function updateEmailField(key, value) {
    setEmailForm((current) => ({ ...current, [key]: value }));
    clearMessages();
  }

  async function requestChatTest(candidateWebhook = '') {
    const response = await apiRequest('config.get', {
      section: 'AGENDA_CHAT',
      operation: 'TEST',
      settings: candidateWebhook ? { webhook: candidateWebhook } : {},
    }, sessionToken);
    return response?.test || {};
  }

  async function saveEmails(event) {
    event.preventDefault();
    if (savingEmails) return;

    if (!emailForm.caseCreatedTo.trim()) {
      setError('Debe configurar al menos un destinatario principal.');
      return;
    }
    if (!emailForm.testRecipients.trim()) {
      setError('Debe configurar al menos un destinatario para pruebas.');
      return;
    }

    setSavingEmails(true);
    clearMessages();
    try {
      const response = await apiRequest('config.get', {
        section: 'NOTIFICATION_EMAILS',
        operation: 'UPDATE',
        settings: emailForm,
      }, sessionToken);
      setEmailForm(emailSettingsToForm(response?.settings || EMPTY_EMAIL_SETTINGS));
      setNotice('Destinatarios y copias actualizados correctamente.');
    } catch (requestError) {
      setError(requestError?.message || 'No se pudieron guardar los destinatarios y copias.');
    } finally {
      setSavingEmails(false);
    }
  }

  async function saveWebhook(event) {
    event.preventDefault();
    if (savingChat || testingChat) return;
    const value = webhook.trim();
    if (!value) {
      setError('Pegue el webhook de Google Chat que desea usar para la Agenda.');
      return;
    }

    setSavingChat(true);
    clearMessages();
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_CHAT',
        operation: 'UPDATE',
        settings: { webhook: value },
      }, sessionToken);
      setChatSettings(response?.settings || EMPTY_CHAT_SETTINGS);

      const test = await requestChatTest(value);
      if (test.sent) {
        setWebhook('');
        setNotice(`Google Chat de Agenda configurado y probado correctamente${test.status ? ` (HTTP ${test.status})` : ''}. Debe haber recibido un mensaje de prueba en el espacio.`);
      } else {
        setError(`El webhook quedó guardado, pero la prueba falló. ${chatFailureMessage(test)}`);
      }
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo guardar o probar el webhook de Agenda.');
    } finally {
      setSavingChat(false);
    }
  }

  async function testChat() {
    if (savingChat || testingChat) return;
    if (!chatSettings.configured && !webhook.trim()) {
      setError('Configure o pegue un webhook antes de realizar la prueba.');
      return;
    }

    setTestingChat(true);
    clearMessages();
    try {
      const test = await requestChatTest(webhook.trim());
      if (test.sent) {
        setNotice(`Mensaje de prueba enviado correctamente a Google Chat${test.status ? ` (HTTP ${test.status})` : ''}.`);
      } else {
        setError(chatFailureMessage(test));
      }
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo probar el envío a Google Chat.');
    } finally {
      setTestingChat(false);
    }
  }

  async function disableChat() {
    if (savingChat || testingChat || !chatSettings.configured) return;
    if (!window.confirm('¿Desea desactivar el envío de Agenda a Google Chat? Los correos seguirán funcionando normalmente.')) return;

    setSavingChat(true);
    clearMessages();
    try {
      const response = await apiRequest('config.get', {
        section: 'AGENDA_CHAT',
        operation: 'UPDATE',
        settings: { webhook: '' },
      }, sessionToken);
      setChatSettings(response?.settings || EMPTY_CHAT_SETTINGS);
      setWebhook('');
      setNotice('Google Chat de Agenda quedó desactivado. Los correos continúan funcionando.');
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo desactivar el chat de Agenda.');
    } finally {
      setSavingChat(false);
    }
  }

  return <div className="page notification-settings-page">
    <div className="notification-settings-shell">
      <header className="notification-settings-hero">
        <div className="notification-settings-hero__copy">
          <Link to="/mas" className="notification-back-link"><Icon name="arrow_back" /> Volver a Más</Link>
          <span className="eyebrow">Administración</span>
          <h1>Notificaciones</h1>
          <p>Administre en un solo lugar los destinatarios, las copias de correo, el Google Chat y las excepciones de boleta utilizadas por Agenda DMS.</p>
        </div>
        <div className="notification-channel-summary" aria-label="Resumen de canales">
          <div className="notification-summary-card">
            <span className="notification-summary-card__icon"><Icon name="mail" /></span>
            <div><small>Correo</small><strong>{totalEmails} dirección{totalEmails === 1 ? '' : 'es'}</strong></div>
            <StatusPill active activeLabel="Activo" />
          </div>
          <div className="notification-summary-card">
            <span className="notification-summary-card__icon"><Icon name="forum" /></span>
            <div><small>Agenda Chat</small><strong>{chatSettings.configured ? 'Webhook listo' : 'Sin configurar'}</strong></div>
            <StatusPill active={chatSettings.configured} />
          </div>
        </div>
      </header>

      {notice && <div className="notification-feedback is-success"><Icon name="check_circle" /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Cerrar mensaje"><Icon name="close" /></button></div>}
      {error && <div className="notification-feedback is-error"><Icon name="error" /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Cerrar mensaje"><Icon name="close" /></button></div>}

      {loading ? <LoadingState /> : <div className="notification-settings-layout">
        <form className="notification-panel notification-panel--email" onSubmit={saveEmails}>
          <header className="notification-panel__header">
            <div className="notification-panel__title">
              <span className="notification-panel__icon"><Icon name="alternate_email" /></span>
              <div><span className="eyebrow">Correo electrónico</span><h2>Destinatarios y copias</h2><p>Puede escribir un correo por línea o separarlos por coma o punto y coma.</p></div>
            </div>
            <StatusPill active activeLabel="Configurado" />
          </header>

          <div className="notification-email-grid">
            {EMAIL_FIELDS.map((field) => <label className="notification-field-card" key={field.key}>
              <span className="notification-field-card__heading">
                <span><Icon name={field.icon} /></span>
                <span><strong>{field.label}{field.required ? ' *' : ''}</strong><small>{field.description}</small></span>
              </span>
              <textarea
                rows="4"
                value={emailForm[field.key] || ''}
                onChange={(event) => updateEmailField(field.key, event.target.value)}
                placeholder={field.placeholder}
                disabled={savingEmails}
                spellCheck="false"
              />
              <span className="notification-field-card__count">{countEmails(emailForm[field.key])} correo{countEmails(emailForm[field.key]) === 1 ? '' : 's'}</span>
            </label>)}
          </div>

          <footer className="notification-panel__actions">
            <span><Icon name="shield" /> Los cambios se guardan en la configuración actual de DMS.</span>
            <button type="submit" className="button button--primary" disabled={savingEmails}>
              <Icon name={savingEmails ? 'progress_activity' : 'save'} /> {savingEmails ? 'Guardando correos...' : 'Guardar destinatarios y copias'}
            </button>
          </footer>
        </form>

        <aside className="notification-panel notification-panel--chat">
          <header className="notification-panel__header">
            <div className="notification-panel__title">
              <span className="notification-panel__icon"><Icon name="forum" /></span>
              <div><span className="eyebrow">Agenda DMS</span><h2>Google Chat</h2><p>Reciba en el chat las agendas nuevas, modificaciones y redistribuciones.</p></div>
            </div>
            <StatusPill active={chatSettings.configured} />
          </header>

          <div className={`notification-chat-state${chatSettings.configured ? ' is-active' : ''}`}>
            <span><Icon name={chatSettings.configured ? 'check_circle' : 'notifications_off'} /></span>
            <div>
              <small>Estado actual</small>
              <strong>{chatSettings.configured ? 'Chat de Agenda activo' : 'Chat de Agenda desactivado'}</strong>
              <p>{chatSettings.configured
                ? (chatSettings.redactedWebhook || 'Webhook de Google Chat configurado')
                : 'Configure un webhook para comenzar a enviar las agendas al chat.'}</p>
            </div>
          </div>

          <form onSubmit={saveWebhook} className="notification-chat-form">
            <label>
              <span>{chatSettings.configured ? 'Reemplazar webhook' : 'Webhook de Google Chat'}</span>
              <input
                type="url"
                value={webhook}
                onChange={(event) => { setWebhook(event.target.value); clearMessages(); }}
                placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=..."
                autoComplete="off"
                spellCheck="false"
                disabled={savingChat || testingChat}
              />
              <small>Use el webhook creado dentro del espacio de Google Chat; el enlace normal para abrir una sala (`chat.google.com/...`) no sirve para enviar mensajes. Por seguridad, el webhook guardado nunca se muestra completo.</small>
            </label>

            <div className="notification-chat-actions">
              {chatSettings.configured && <button type="button" className="button button--secondary" onClick={disableChat} disabled={savingChat || testingChat}>
                <Icon name="notifications_off" /> Desactivar
              </button>}
              <button type="button" className="button button--secondary" onClick={testChat} disabled={savingChat || testingChat || (!chatSettings.configured && !webhook.trim())}>
                <Icon name={testingChat ? 'progress_activity' : 'send'} /> {testingChat ? 'Probando...' : 'Probar envío'}
              </button>
              <button type="submit" className="button button--primary" disabled={savingChat || testingChat || !webhook.trim()}>
                <Icon name={savingChat ? 'progress_activity' : 'save'} /> {savingChat ? 'Guardando y probando...' : chatSettings.configured ? 'Reemplazar webhook' : 'Guardar webhook'}
              </button>
            </div>
          </form>

          <div className="notification-behavior-note">
            <Icon name="info" />
            <div><strong>Prueba real del canal</strong><p>Al guardar un webhook se envía una prueba automáticamente. También puede usar “Probar envío” cuando quiera. Si Google Chat falla, verá el código HTTP sin afectar las agendas ni los correos.</p></div>
          </div>
        </aside>

        <AgendaTicketExceptionsSettings
          sessionToken={sessionToken}
          onNotice={(message) => { setError(''); setNotice(message); }}
          onError={(message) => { setNotice(''); setError(message); }}
        />
      </div>}
    </div>
  </div>;
}
