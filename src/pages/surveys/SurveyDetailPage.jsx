import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function formatDate(value) {
  if (!value) return 'Sin registrar';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function SurveyDetailPage() {
  const { encuestaId = '' } = useParams();
  const { sessionToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    requestAvailable(MODULE_ROUTES.surveys.responsesGet, { surveyId: encuestaId }, sessionToken)
      .then((response) => { if (active) setData(response); })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [encuestaId, sessionToken]);

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando detalle...</div></div>;
  if (error || !data?.survey) return <div className="page"><div className="alert alert--error"><Icon name="error" /><span>{error || 'No se encontró la encuesta.'}</span></div></div>;

  const { survey, answers = [], ticket = {} } = data;
  const ticketUid = pick(ticket, ['BoletaUID'], survey.ticketUid);

  return (
    <div className="page survey-detail-page">
      <div className="page-header">
        <Link className="icon-button" to="/encuestas" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div><span className="eyebrow">Detalle de encuesta</span><h1>{survey.clientName}</h1></div>
      </div>

      <section className="survey-detail-summary">
        <div><span>Boleta</span><strong>#{survey.ticketNumber}</strong></div>
        <div><span>Estado</span><strong>{survey.status}</strong></div>
        <div><span>Promedio</span><strong>{survey.average ?? '—'} / 5</strong></div>
        <div><span>Respondida</span><strong>{formatDate(survey.answeredAt)}</strong></div>
      </section>

      <section className="form-card survey-detail-ticket">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Boleta relacionada</h2><p>{survey.ticketTitle}</p></div></div>
        <div className="ticket-info-grid">
          <div><dt>Cliente</dt><dd>{survey.clientName}</dd></div>
          <div><dt>Número</dt><dd>#{survey.ticketNumber}</dd></div>
          <div><dt>Fecha de creación</dt><dd>{formatDate(survey.createdAt)}</dd></div>
          <div><dt>Fecha de expiración</dt><dd>{formatDate(survey.expiresAt)}</dd></div>
          <div className="is-wide"><dt>Resultado de la boleta</dt><dd>{pick(ticket, ['Resultado'], 'Sin información adicional')}</dd></div>
        </div>
        {ticketUid && <Link className="button button--primary button--compact" to={`/boletas/${encodeURIComponent(ticketUid)}`}><Icon name="description" /> Abrir detalle de la boleta</Link>}
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Respuestas del cliente</h2><p>Calificaciones registradas de 1 a 5.</p></div></div>
        {answers.length ? <div className="survey-answer-list">{answers.map((answer) => (
          <article className="survey-answer-card" key={answer.id || answer.questionId}>
            <span className="survey-answer-card__order">{answer.order}</span>
            <div><strong>{answer.question}</strong><span>{formatDate(answer.answeredAt)}</span></div>
            <div className="survey-answer-card__rating"><strong>{answer.rating}</strong><span>/ 5</span></div>
          </article>
        ))}</div> : <div className="empty-state"><Icon name="hourglass_empty" /><h2>Encuesta pendiente</h2><p>El cliente todavía no ha enviado sus respuestas.</p></div>}
      </section>
    </div>
  );
}
