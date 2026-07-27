import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import AdminEntityModal from '../../components/forms/AdminEntityModal';
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
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');

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

  const sortedQuestions = useMemo(() => [...questions].sort((left, right) => Number(left.order || 0) - Number(right.order || 0)), [questions]);

  function openCreate() {
    const maxOrder = questions.reduce((max, question) => Math.max(max, Number(question.order || 0)), 0);
    setSelectedQuestion({});
    setForm({ ...EMPTY, order: maxOrder + 1 });
    setEditing(true);
    setModalError('');
    setTab('questions');
  }

  function openQuestion(question) {
    setSelectedQuestion(question);
    setForm({ ...question });
    setEditing(false);
    setModalError('');
  }

  function closeQuestion() {
    if (saving) return;
    setSelectedQuestion(null);
    setEditing(false);
    setModalError('');
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (!form?.text.trim()) {
      setModalError('El texto de la pregunta es obligatorio.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const response = await requestAvailable(
        form.id ? MODULE_ROUTES.surveys.questionsUpdate : MODULE_ROUTES.surveys.questionsCreate,
        { questionId: form.id, text: form.text.trim(), order: Number(form.order), status: form.status },
        sessionToken,
      );
      const saved = response?.item || response?.data || response;
      setSelectedQuestion(saved);
      setForm({ ...saved });
      setEditing(false);
      await load();
    } catch (saveError) {
      setModalError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeQuestionStatus() {
    if (!form.id) return;
    const nextStatus = form.status === 'INACTIVO' ? 'ACTIVO' : 'INACTIVO';
    if (!window.confirm(`${nextStatus === 'INACTIVO' ? 'Desactivar' : 'Reactivar'} la pregunta “${form.text}”?`)) return;
    setSaving(true);
    setModalError('');
    try {
      let response;
      if (nextStatus === 'INACTIVO') {
        response = await requestAvailable(MODULE_ROUTES.surveys.questionsDelete, { questionId: form.id }, sessionToken);
      } else {
        response = await requestAvailable(MODULE_ROUTES.surveys.questionsUpdate, { questionId: form.id, text: form.text, order: Number(form.order), status: 'ACTIVO' }, sessionToken);
      }
      const saved = response?.item || response?.data || response;
      setSelectedQuestion(saved);
      setForm({ ...form, ...saved, status: nextStatus });
      await load();
    } catch (statusError) {
      setModalError(statusError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="page survey-admin-page">
    <div className="list-page-heading">
      <div><span className="eyebrow">Experiencia del cliente</span><h1>Encuestas de servicio</h1><p>Administra las preguntas y revisa las respuestas relacionadas con cada boleta.</p></div>
      {tab === 'questions' && <button className="button button--primary button--compact" type="button" onClick={openCreate}><Icon name="add" />Nueva pregunta</button>}
    </div>

    <div className="survey-admin-tabs" role="tablist">
      <button type="button" className={tab === 'responses' ? 'is-active' : ''} onClick={() => setTab('responses')}><Icon name="analytics" />Respuestas</button>
      <button type="button" className={tab === 'questions' ? 'is-active' : ''} onClick={() => setTab('questions')}><Icon name="quiz" />Preguntas</button>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando encuestas...</div> : tab === 'questions' ? (
      <div className="admin-mini-card-grid">
        {sortedQuestions.map((question) => <article className={`admin-mini-card${question.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={question.id}>
          <span className="admin-mini-card__icon"><Icon name="quiz" /></span>
          <div className="admin-mini-card__body"><strong>{question.text}</strong><span>Orden {question.order}</span><small>{question.status}</small></div>
          <button className="icon-button icon-button--outlined admin-mini-card__action" type="button" onClick={() => openQuestion(question)} aria-label="Editar pregunta"><Icon name="edit" /></button>
        </article>)}
        {!sortedQuestions.length && <div className="empty-state"><Icon name="quiz" /><h2>Sin preguntas</h2><p>Agregue la primera pregunta de satisfacción.</p></div>}
      </div>
    ) : <>
      <section className="survey-response-filters">
        <div className="knowledge-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, boleta o título..." /></div>
        <select className="form-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option><option value="PENDIENTE">Pendientes</option><option value="RESPONDIDA">Respondidas</option><option value="EXPIRADA">Expiradas</option></select>
      </section>
      <div className="survey-response-grid">
        {visibleResponses.length ? visibleResponses.map((item) => <Link className="survey-response-card" to={`/encuestas/${encodeURIComponent(item.id)}`} key={item.id}>
          <div className="survey-response-card__top"><span className="survey-response-card__icon"><Icon name="rate_review" /></span><span className={`status-chip ${item.status === 'RESPONDIDA' ? 'status-chip--active' : item.status === 'EXPIRADA' ? 'status-chip--inactive' : 'status-chip--pending'}`}>{item.status}</span></div>
          <span className="eyebrow">Boleta #{item.ticketNumber}</span><h2>{item.clientName}</h2><p>{item.ticketTitle}</p>
          <div className="survey-response-card__score"><strong>{item.average ?? '—'}</strong><span>Promedio / 5</span></div>
          <div className="survey-response-card__meta"><span><Icon name="event" />Creada: {formatDate(item.createdAt)}</span><span><Icon name="task_alt" />Respondida: {formatDate(item.answeredAt)}</span></div>
          <span className="survey-response-card__open">Ver detalle <Icon name="arrow_forward" /></span>
        </Link>) : <div className="empty-state"><Icon name="rate_review" /><h2>No hay encuestas</h2><p>Las encuestas se crearán automáticamente al finalizar las boletas.</p></div>}
      </div>
    </>}

    <AdminEntityModal
      open={Boolean(selectedQuestion)}
      title={form.text || 'Nueva pregunta'}
      subtitle={form.id ? `Orden ${form.order} · ${form.status}` : 'El cliente calificará esta pregunta del 1 al 5'}
      eyebrow={editing ? (form.id ? 'Editar pregunta' : 'Nueva pregunta') : 'Detalle de pregunta'}
      icon="quiz"
      onClose={closeQuestion}
      busy={saving}
      footer={!editing && form.id ? <><button className="button button--secondary" type="button" onClick={changeQuestionStatus} disabled={saving}><Icon name={form.status === 'INACTIVO' ? 'refresh' : 'block'} />{form.status === 'INACTIVO' ? 'Reactivar' : 'Desactivar'}</button><button className="button button--primary" type="button" onClick={() => setEditing(true)} disabled={saving}><Icon name="edit" />Editar</button></> : null}
    >
      {modalError && <div className="alert alert--error"><Icon name="error" /><span>{modalError}</span></div>}
      {editing ? <form className="stack-form" onSubmit={saveQuestion}>
        <label className="field-group"><span className="field-label">Pregunta *</span><textarea className="form-control ticket-textarea" rows="4" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} required /></label>
        <div className="ticket-form-grid"><label className="field-group"><span className="field-label">Orden</span><input className="form-control" type="number" min="1" value={form.order} onChange={(event) => setForm({ ...form, order: event.target.value })} required /></label><label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>ACTIVO</option><option>INACTIVO</option></select></label></div>
        <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => form.id ? setEditing(false) : closeQuestion()} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar pregunta'}</button></div>
      </form> : <div className="admin-detail-grid"><div><span>Orden</span><strong>{form.order}</strong></div><div><span>Estado</span><strong>{form.status}</strong></div><div className="is-wide"><span>Pregunta</span><strong>{form.text}</strong></div></div>}
    </AdminEntityModal>
  </div>;
}
