import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import '../../styles/agenda-resend.css';

export default function AgendaResendActions({ item }) {
  const { sessionToken } = useAuth();
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    setBusy('');
    setFeedback(null);
  }, [item?.AgendaID]);

  async function resend(channel) {
    if (busy || !item?.AgendaID) return;
    setBusy(channel);
    setFeedback(null);
    try {
      const route = channel === 'chat' ? 'agenda.resend.chat' : 'agenda.resend.email';
      const response = await apiRequest(route, { agendaId: item.AgendaID }, sessionToken);
      const success = Boolean(response?.sent);
      setFeedback({
        tone: success ? 'success' : 'error',
        message: response?.message || (success ? 'Agenda reenviada correctamente.' : 'No se pudo reenviar la agenda.'),
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error?.message || 'No se pudo reenviar la agenda.',
      });
    } finally {
      setBusy('');
    }
  }

  return <section className="agenda-resend-panel" aria-label="Reenviar notificación de agenda">
    <div className="agenda-resend-panel__copy">
      <span className="eyebrow">Notificación manual</span>
      <strong>Reenviar agenda</strong>
      <small>Envíe nuevamente esta programación sin modificarla.</small>
    </div>

    <div className="agenda-resend-panel__actions">
      <button
        type="button"
        className="button button--secondary"
        onClick={() => resend('email')}
        disabled={Boolean(busy)}
      >
        <Icon name={busy === 'email' ? 'progress_activity' : 'mail'} />
        {busy === 'email' ? 'Reenviando correo...' : 'Reenviar correo'}
      </button>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => resend('chat')}
        disabled={Boolean(busy)}
      >
        <Icon name={busy === 'chat' ? 'progress_activity' : 'forum'} />
        {busy === 'chat' ? 'Reenviando Chat...' : 'Reenviar Chat'}
      </button>
    </div>

    {feedback && <div className={`agenda-resend-feedback is-${feedback.tone}`} role="status">
      <Icon name={feedback.tone === 'success' ? 'check_circle' : 'error'} />
      <span>{feedback.message}</span>
    </div>}
  </section>;
}
