import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function text(value) {
  return String(value ?? '').trim();
}

function formatDate(value) {
  if (!value) return 'Sin registrar';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatTicketDate(value) {
  const source = text(value);
  if (!source) return 'Sin registrar';
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return source;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeZone: 'America/Costa_Rica' }).format(date);
}

function formatHours(value) {
  if (value === '' || value === null || value === undefined) return 'Sin registrar';
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value} h`;
  return `${number.toFixed(2)} h`;
}

function fallbackTicketView(ticket = {}, survey = {}) {
  const uid = text(pick(ticket, ['BoletaUID'], survey.ticketUid));
  return {
    uid,
    number: text(pick(ticket, ['BoletaID'], survey.ticketNumber || uid)),
    visitNumber: 1,
    isPrimary: true,
    title: text(pick(ticket, ['Titulo'], survey.ticketTitle || 'Boleta de servicio')),
    date: pick(ticket, ['Fecha']),
    startTime: pick(ticket, ['HoraInicio']),
    endTime: pick(ticket, ['HoraFinal']),
    totalHours: pick(ticket, ['HorasTotales']),
    status: text(pick(ticket, ['Estado'], 'PENDIENTE')).toUpperCase(),
    result: text(pick(ticket, ['Resultado'], 'Sin información adicional')),
    location: text(pick(ticket, ['Ubicacion'])),
    equipmentLocation: text(pick(ticket, ['UbicacionEquipo', 'Ubicacion_equipo'])),
    deviceName: text(pick(ticket, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo'])),
    deviceType: text(pick(ticket, ['TipoDispositivo'])),
    manufacturer: text(pick(ticket, ['Fabricante'])),
    model: text(pick(ticket, ['Modelo'])),
  };
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

  const tickets = useMemo(() => {
    if (Array.isArray(data?.tickets) && data.tickets.length) return data.tickets;
    if (data?.ticket || data?.survey) return [fallbackTicketView(data?.ticket, data?.survey)];
    return [];
  }, [data]);

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando detalle...</div></div>;
  if (error || !data?.survey) return <div className="page"><div className="alert alert--error"><Icon name="error" /><span>{error || 'No se encontró la encuesta.'}</span></div></div>;

  const { survey, answers = [] } = data;
  const isMultiple = Boolean(data.visitGroup?.isMultiple || survey.isMultipleTickets || tickets.length > 1);
  const ticketNumbers = tickets.map((ticket) => ticket.number).filter(Boolean);
  const consecutiveText = ticketNumbers.length
    ? ticketNumbers.map((number) => `#${number}`).join(', ')
    : `#${survey.ticketNumber}`;

  return (
    <div className="page survey-detail-page">
      <div className="page-header">
        <Link className="icon-button" to="/encuestas" aria-label="Volver"><Icon name="arrow_back" /></Link>
        <div>
          <span className="eyebrow">Detalle de encuesta</span>
          <h1>{survey.clientName}</h1>
          {isMultiple && <p className="survey-detail-page__subtitle">Encuesta única para varias boletas relacionadas.</p>}
        </div>
      </div>

      <section className="survey-detail-summary">
        <div><span>Tipo</span><strong>{isMultiple ? `${tickets.length} boletas relacionadas` : 'Boleta individual'}</strong></div>
        <div><span>{isMultiple ? 'Consecutivos' : 'Consecutivo'}</span><strong>{consecutiveText}</strong></div>
        <div><span>Estado</span><strong>{survey.status}</strong></div>
        <div><span>Promedio</span><strong>{survey.average ?? '—'} / 5</strong></div>
        <div><span>Respondida</span><strong>{formatDate(survey.answeredAt)}</strong></div>
      </section>

      <section className="form-card survey-detail-ticket">
        <div className="form-card__heading survey-related-heading">
          <span className="section-marker" />
          <div>
            <h2>{isMultiple ? `Boletas relacionadas (${tickets.length})` : 'Boleta relacionada'}</h2>
            <p>{isMultiple
              ? `Esta encuesta califica en conjunto las boletas ${consecutiveText}.`
              : survey.ticketTitle}</p>
          </div>
        </div>

        <div className="survey-related-ticket-list">
          {tickets.map((ticket, index) => {
            const location = [ticket.location, ticket.equipmentLocation].filter(Boolean).join(' · ');
            const device = [ticket.deviceName, ticket.deviceType, ticket.manufacturer, ticket.model].filter(Boolean).join(' · ');
            const schedule = [ticket.startTime, ticket.endTime].filter(Boolean).join(' - ');
            return (
              <article className="survey-related-ticket-card" key={ticket.uid || `${ticket.number}-${index}`}>
                <header>
                  <span className="survey-related-ticket-card__visit">Visita {ticket.visitNumber || index + 1}</span>
                  <div>
                    <strong>Boleta #{ticket.number || ticket.uid}</strong>
                    {ticket.isPrimary && isMultiple && <span className="status-chip">Principal</span>}
                    <span className={`status-chip survey-ticket-status survey-ticket-status--${text(ticket.status).toLowerCase()}`}>{ticket.status || 'PENDIENTE'}</span>
                  </div>
                  <p>{ticket.title || survey.ticketTitle}</p>
                </header>

                <dl className="ticket-info-grid survey-related-ticket-card__info">
                  <div><dt>Cliente</dt><dd>{survey.clientName}</dd></div>
                  <div><dt>Consecutivo</dt><dd>#{ticket.number || ticket.uid}</dd></div>
                  <div><dt>Fecha de la visita</dt><dd>{formatTicketDate(ticket.date)}</dd></div>
                  <div><dt>Horario</dt><dd>{schedule || 'Sin registrar'}</dd></div>
                  <div><dt>Horas totales</dt><dd>{formatHours(ticket.totalHours)}</dd></div>
                  <div><dt>Ubicación</dt><dd>{location || 'Sin especificar'}</dd></div>
                  <div className="is-wide"><dt>Dispositivo</dt><dd>{device || 'Sin especificar'}</dd></div>
                  <div className="is-wide"><dt>Resultado de la boleta</dt><dd>{ticket.result || 'Sin información adicional'}</dd></div>
                </dl>

                {ticket.uid && (
                  <Link className="button button--secondary button--compact" to={`/boletas/${encodeURIComponent(ticket.uid)}`}>
                    <Icon name="description" /> Abrir boleta #{ticket.number || ticket.uid}
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        <div className="survey-detail-dates">
          <div><span>Encuesta creada</span><strong>{formatDate(survey.createdAt)}</strong></div>
          <div><span>Fecha de expiración</span><strong>{formatDate(survey.expiresAt)}</strong></div>
        </div>
      </section>

      <section className="form-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h2>Respuestas del cliente</h2><p>{isMultiple ? 'Una sola calificación aplicada a todas las boletas relacionadas.' : 'Calificaciones registradas de 1 a 5.'}</p></div></div>
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
