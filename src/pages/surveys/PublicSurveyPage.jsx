import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

const DMS_LOGO_URL = 'https://res.cloudinary.com/dj73vkht6/image/upload/v1784169860/DMS_logo_2_dusshv.jpg';

const SCALE = [
  { value: 1, label: 'Debe mejorar' },
  { value: 2, label: 'Regular' },
  { value: 3, label: 'Bueno' },
  { value: 4, label: 'Muy bueno' },
  { value: 5, label: 'Excelente' },
];

export default function PublicSurveyPage() {
  const { token = '' } = useParams();
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    requestAvailable(MODULE_ROUTES.surveys.publicGet, { token })
      .then((data) => {
        if (!active) return;
        setSurvey(data.survey || null);
        setQuestions(Array.isArray(data.questions) ? data.questions : []);
        setSubmitted(Boolean(data.alreadySubmitted));
        setExpired(Boolean(data.expired));
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const current = questions[step];
  const selected = current ? answers[current.id] : undefined;
  const progress = questions.length ? Math.round(((step + 1) / questions.length) * 100) : 0;
  const completed = useMemo(() => questions.filter((question) => answers[question.id]).length, [answers, questions]);

  function next() {
    if (!selected) {
      setError('Seleccione una calificación para continuar.');
      return;
    }
    setError('');
    setStep((value) => Math.min(value + 1, questions.length - 1));
  }

  function previous() {
    setError('');
    setStep((value) => Math.max(0, value - 1));
  }

  async function submit() {
    if (completed !== questions.length) {
      setError('Debe responder todas las preguntas antes de enviar la encuesta.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.surveys.publicSubmit, {
        token,
        answers: questions.map((question) => ({ questionId: question.id, rating: Number(answers[question.id]) })),
      });
      setSubmitted(true);
    } catch (submitError) {
      if (submitError.code === 'SURVEY_ALREADY_ANSWERED') setSubmitted(true);
      else setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="public-survey-page">
      <header className="public-survey-brand">
        <span className="public-survey-brand__mark"><Icon name="assignment_turned_in" /></span>
        <div><strong>DMS Boletas</strong><span>Encuesta de satisfacción</span></div>
      </header>

      <section className="public-survey-shell">
        {loading ? (
          <div className="public-survey-state"><Icon name="progress_activity" /><h1>Cargando encuesta...</h1><p>Estamos preparando las preguntas.</p></div>
        ) : submitted ? (
          <div className="public-survey-thanks">
            <img className="public-completion-logo" src={DMS_LOGO_URL} alt="Digital Management Systems" />
            <div className="eyebrow">Respuesta recibida</div>
            <h1>¡Muchas gracias!</h1>
            <p>Su opinión fue registrada correctamente y nos ayudará a seguir mejorando nuestro servicio.</p>
            {survey?.clientName && <strong>{survey.clientName}</strong>}
          </div>
        ) : expired ? (
          <div className="public-survey-state public-survey-state--warning"><Icon name="event_busy" /><h1>Encuesta vencida</h1><p>Este enlace ya no se encuentra disponible.</p></div>
        ) : error && !current ? (
          <div className="public-survey-state public-survey-state--error"><Icon name="link_off" /><h1>No pudimos abrir la encuesta</h1><p>{error}</p></div>
        ) : current ? (
          <>
            <div className="public-survey-heading">
              <span className="eyebrow">{survey?.clientName || 'Cliente'}</span>
              <h1>Califique el servicio recibido</h1>
              <p>Boleta #{survey?.ticketNumber || '—'} · {survey?.ticketTitle || 'Servicio técnico'}</p>
            </div>

            <div className="public-survey-progress" aria-label={`Pregunta ${step + 1} de ${questions.length}`}>
              <div><strong>Pregunta {step + 1} de {questions.length}</strong><span>{progress}%</span></div>
              <div className="public-survey-progress__track"><span style={{ width: `${progress}%` }} /></div>
            </div>

            <section className="public-survey-question" key={current.id}>
              <span className="public-survey-question__number">{step + 1}</span>
              <h2>{current.text}</h2>
              <p>Seleccione una opción del 1 al 5.</p>
              <div className="public-survey-scale" role="radiogroup" aria-label={current.text}>
                {SCALE.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={Number(selected) === option.value ? 'is-selected' : ''}
                    onClick={() => { setAnswers((values) => ({ ...values, [current.id]: option.value })); setError(''); }}
                    role="radio"
                    aria-checked={Number(selected) === option.value}
                  >
                    <strong>{option.value}</strong>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            {error && <div className="public-survey-error"><Icon name="error" /><span>{error}</span></div>}

            <div className="public-survey-actions">
              <button type="button" className="button button--secondary" onClick={previous} disabled={step === 0 || submitting}>
                <Icon name="arrow_back" /> Regresar
              </button>
              {step < questions.length - 1 ? (
                <button type="button" className="button button--primary" onClick={next} disabled={!selected || submitting}>
                  Siguiente <Icon name="arrow_forward" />
                </button>
              ) : (
                <button type="button" className="button button--primary" onClick={submit} disabled={!selected || completed !== questions.length || submitting}>
                  {submitting ? 'Enviando...' : 'Enviar encuesta'} <Icon name={submitting ? 'progress_activity' : 'send'} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="public-survey-state"><Icon name="quiz" /><h1>Sin preguntas disponibles</h1><p>Comuníquese con DMS para recibir asistencia.</p></div>
        )}
      </section>
      <footer className="public-survey-footer">Digital Management Systems · Su opinión es confidencial y se relaciona únicamente con esta boleta.</footer>
    </main>
  );
}
