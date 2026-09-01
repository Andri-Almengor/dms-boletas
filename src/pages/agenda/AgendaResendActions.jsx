import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import '../../styles/agenda-resend.css';

function joinEmails(values = []) {
  return Array.isArray(values) && values.length ? values.join(', ') : 'Ninguno';
}

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
      const payload = channel === 'pending'
        ? { agendaId: item.AgendaID, notificationType: 'PENDING_TICKET_TEST' }
        : { agendaId: item.AgendaID };
      const response = await apiRequest(route, payload, sessionToken);
      const success = Boolean(response?.sent);
      setFeedback({
        tone: success ? 'success' : 'error',
        message: response?.message || (success ? 'Notificación enviada correctamente.' : 'No se pudo enviar la notificación.'),
        details: channel === 'pending' ? response?.diagnostics || null : null,
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error?.message || 'No se pudo reenviar la agenda.',
        details: null,
      });
    } finally {
      setBusy('');
    }
  }

  const diagnostics = feedback?.details;

  return <section className="agenda-resend-panel" aria-label="Reenviar notificación de agenda">
    <div className="agenda-resend-panel__copy">
      <span className="eyebrow">Notificación manual</span>
      <strong>Reenviar y probar correos</strong>
      <small>Puede reenviar la agenda o ejecutar el correo real de boleta pendiente en modo de prueba, sin modificar el estado.</small>
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
      <button
        type="button"
        className="button button--secondary agenda-resend-panel__test-button"
        onClick={() => resend('pending')}
        disabled={Boolean(busy)}
      >
        <Icon name={busy === 'pending' ? 'progress_activity' : 'science'} />
        {busy === 'pending' ? 'Enviando prueba...' : 'Probar boleta pendiente'}
      </button>
    </div>

    {feedback && <div className={`agenda-resend-feedback is-${feedback.tone}`} role="status">
      <Icon name={feedback.tone === 'success' ? 'check_circle' : 'error'} />
      <span>{feedback.message}</span>
    </div>}

    {diagnostics && <div className="agenda-resend-diagnostics" aria-label="Detalle de la prueba de boleta pendiente">
      <div className="agenda-resend-diagnostics__header">
        <span className="eyebrow">Diagnóstico de la prueba</span>
        <strong>Correo de boleta pendiente</strong>
        <small>No cambia RecordatorioEnviado, RecordatorioEnviadoEn, RecordatorioDia ni BoletaUID.</small>
      </div>
      <dl>
        <div><dt>Remitente</dt><dd>{diagnostics.sender || '—'}</dd></div>
        <div><dt>Apps Script</dt><dd>{diagnostics.scriptVersion || '—'}</dd></div>
        <div><dt>Para</dt><dd>{joinEmails(diagnostics.to)}</dd></div>
        <div><dt>CC</dt><dd>{joinEmails(diagnostics.cc)}</dd></div>
        <div><dt>Correos de asignados</dt><dd>{joinEmails(diagnostics.assignedEmails)}</dd></div>
        <div><dt>Asunto</dt><dd>{diagnostics.subject || '—'}</dd></div>
        <div><dt>Boleta relacionada</dt><dd>{diagnostics.hasTicket ? 'Sí' : 'No'}</dd></div>
        <div><dt>Recordatorio previo</dt><dd>{diagnostics.reminderAlreadySent ? 'Sí' : 'No'}</dd></div>
        <div><dt>Cuota restante</dt><dd>{Number.isFinite(diagnostics.remainingDailyQuota) ? diagnostics.remainingDailyQuota : '—'}</dd></div>
      </dl>
      {Array.isArray(diagnostics.assignedUsers) && diagnostics.assignedUsers.length > 0 && <div className="agenda-resend-diagnostics__people">
        <strong>Personas de la agenda</strong>
        {diagnostics.assignedUsers.map((user) => <span key={user.UsuarioID || `${user.nombre}-${user.correo}`}>
          {user.nombre || 'Usuario'} · {user.correo || 'sin correo'}
        </span>)}
      </div>}
    </div>}
  </section>;
}
