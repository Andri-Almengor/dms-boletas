import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../../services/moduleApi';

const EMPTY = { id: '', text: '', order: 1, status: 'ACTIVO' };

function formatDate(value) {
  if (!value) return 'Pendiente';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function SurveysAdminPage() {
  const { sessionToken } = useAuth();
  const [tab, setTab] = useState('responses');
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState([]);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [questionData, responseData] = await Promise.all([
        requestAvailable(MODULE_ROUTES.surveys.questionsList, { includeInactive: true }, sessionToken),
        requestAvailable(MODULE_ROUTES.surveys.responsesList, { page: 1, pageSize: 1000, sortBy: 'FechaCreacion', sortDir: 'desc' }, sessionToken),
      ]);
      setQuestions(normalizeItems(questionData));
      setResponses(normalizeItems(responseData));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken]);

  const visibleResponses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return responses.filter((item) => {
      if (status && item.status !== status) return false;
      if (!query) return true;
      return `${item.clientName} ${item.ticketNumber} ${item.ticketTitle}`.toLowerCase().includes(query);
    });
  }, [responses, search, status]);

  function openCreate() {
    const maxOrder = questions.reduce((max, question) => Math.max(max, Number(question.order || 0)), 0);
    setForm({ ...EMPTY, order: maxOrder + 1 });
    setTab('questions');
  }

  function editQuestion(question) {
    setForm({ ...question });
    setTab('questions');
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (!form?.text.trim()) {
      setError('El texto de la pregunta es obligatorio.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await requestAvailable(
        form.id ? MODULE_ROUTES.surveys.questionsUpdate : MODULE_ROUTES.surveys.questionsCreate,
        { questionId: form.id, text: form.text.trim(), order: Number(form.order), status: form.status },
        sessionToken,
      );
      setForm(null);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(question) {
    if (!window.confirm(`¿Desactivar la pregunta “${question.text}”?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.surveys.questionsDelete, { questionId: question.id }, sessionToken);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page survey-admin-page">
      <div className="list-page-heading">
        <div><span className="eyebrow">Experiencia del cliente</span><h1>Encuestas de servicio</h1><p>Administra las preguntas y revisa las respuestas relacionadas con cada boleta.</p></div>
        <button className="button button--primary button--compact" type="button" onClick={openCreate}><Icon name="add" /> Nueva pregunta</button>
      </div>

      <div className="survey-admin-tabs" role="tablist">
        <button type="button" className={tab === 'responses' ? 'is-active' : ''} onClick={() => setTab('responses')}><Icon name="analytics" /> Respuestas</button>
        <button type="button" className={tab === 'questions' ? 'is-active' : ''} onClick={() => setTab('questions')}><Icon name="quiz" /> Preguntas</button>
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando encuestas...</div> : tab === 'questions' ? (
        <>
          {form && (
            <form className="form-card survey-question-form" onSubmit={saveQuestion}>
              <div className="form-card__heading"><span className="section-marker" /><div><h2>{form.id ? 'Editar pregunta' : 'Agregar pregunta'}</h2><p>El cliente calificará esta pregunta del 1 al 5.</p></div></div>
              <label className="field-group"><span className="field-label">Pregunta</span><textarea className="form-control ticket-textarea" rows="3" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} required /></label>
              <div className="survey-question-form__grid">
                <label className="field-group"><span className="field-label">Orden</span><input className="form-control" type="number" min="1" value={form.order} onChange={(event) => setForm({ ...form, order: event.target.value })} required /></label>
                <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
              </div>
              <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setForm(null)} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar pregunta'}</button></div>
            </form>
          )}

          <div className="survey-question-list">
            {questions.map((question) => (
              <article className={`survey-question-admin-card${question.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={question.id}>
                <span className="survey-question-admin-card__order">{question.order}</span>
                <div><strong>{question.text}</strong><span className={`status-chip ${question.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{question.status}</span></div>
                <div className="survey-question-admin-card__actions"><button className="icon-button icon-button--outlined" type="button" onClick={() => editQuestion(question)} aria-label="Editar pregunta"><Icon name="edit" /></button>{question.status !== 'INACTIVO' && <button className="icon-button icon-button--danger" type="button" onClick={() => deactivate(question)} aria-label="Desactivar pregunta"><Icon name="delete" /></button>}</div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <section className="survey-response-filters">
            <div className="knowledge-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, boleta o título..." /></div>
            <select className="form-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option><option value="PENDIENTE">Pendientes</option><option value="RESPONDIDA">Respondidas</option><option value="EXPIRADA">Expiradas</option></select>
          </section>

          <div className="survey-response-grid">
            {visibleResponses.length ? visibleResponses.map((item) => (
              <Link className="survey-response-card" to={`/encuestas/${encodeURIComponent(item.id)}`} key={item.id}>
                <div className="survey-response-card__top"><span className="survey-response-card__icon"><Icon name="rate_review" /></span><span className={`status-chip ${item.status === 'RESPONDIDA' ? 'status-chip--active' : item.status === 'EXPIRADA' ? 'status-chip--inactive' : 'status-chip--pending'}`}>{item.status}</span></div>
                <span className="eyebrow">Boleta #{item.ticketNumber}</span>
                <h2>{item.clientName}</h2>
                <p>{item.ticketTitle}</p>
                <div className="survey-response-card__score"><strong>{item.average ?? '—'}</strong><span>Promedio / 5</span></div>
                <div className="survey-response-card__meta"><span><Icon name="event" /> Creada: {formatDate(item.createdAt)}</span><span><Icon name="task_alt" /> Respondida: {formatDate(item.answeredAt)}</span></div>
                <span className="survey-response-card__open">Ver detalle <Icon name="arrow_forward" /></span>
              </Link>
            )) : <div className="empty-state"><Icon name="rate_review" /><h2>No hay encuestas</h2><p>Las encuestas se crearán automáticamente al finalizar las boletas.</p></div>}
          </div>
        </>
      )}
    </div>
  );
}
