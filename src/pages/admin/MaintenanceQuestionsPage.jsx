import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const QUESTION_ROUTES = {
  list: ['maintenance.questions.list', 'mantenimientos.preguntas.list', 'catalog.maintenanceQuestions.list'],
  create: ['maintenance.questions.create', 'mantenimientos.preguntas.create', 'catalog.maintenanceQuestions.create'],
  update: ['maintenance.questions.update', 'mantenimientos.preguntas.update', 'catalog.maintenanceQuestions.update'],
  delete: ['maintenance.questions.delete', 'mantenimientos.preguntas.delete', 'catalog.maintenanceQuestions.delete'],
};

function clean(value) {
  return String(value ?? '').trim();
}

function activeRecord(row = {}) {
  return toBoolean(pick(row, ['Activo', 'activo'], true), true)
    && clean(pick(row, ['Estado', 'estado'], 'ACTIVO')).toUpperCase() !== 'INACTIVO';
}

function typeId(row = {}) {
  return clean(pick(row, ['TipoDispositivoID', 'id']));
}

function typeName(row = {}) {
  return clean(pick(row, ['Nombre', 'TipoDispositivo'], 'Tipo de dispositivo'));
}

function questionId(row = {}) {
  return clean(pick(row, ['PreguntaDispositivoID', 'questionId', 'id']));
}

function questionText(row = {}) {
  return clean(pick(row, ['Pregunta', 'pregunta', 'label'], 'Pregunta sin texto'));
}

function emptyValues(type = '') {
  return { tipoDispositivoId: type, pregunta: '', orden: '' };
}

function panelId(typeIdentifier) {
  return `maintenance-questions-${clean(typeIdentifier).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function QuestionModalFields({ values, setValues, deviceTypes, editing }) {
  function change(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  return <>
    <label className="field-group">
      <span className="field-label">Tipo de dispositivo *</span>
      <select className="form-control" name="tipoDispositivoId" value={values.tipoDispositivoId} onChange={change} required disabled={editing}>
        <option value="">Seleccione</option>
        {deviceTypes.map((type) => <option key={typeId(type)} value={typeId(type)}>{typeName(type)}</option>)}
      </select>
      {editing && <small className="field-hint">La relación no se cambia al editar para conservar el historial. Cree otra pregunta en el tipo correcto cuando sea necesario.</small>}
    </label>
    <label className="field-group">
      <span className="field-label">Pregunta de Sí o No *</span>
      <textarea className="form-control ticket-textarea" rows="4" name="pregunta" value={values.pregunta} onChange={change} placeholder="Ej. ¿La grabación funciona correctamente?" required maxLength="500" />
    </label>
    <label className="field-group">
      <span className="field-label">Orden</span>
      <input className="form-control" type="number" min="0" step="1" name="orden" value={values.orden} onChange={change} placeholder="Se asigna automáticamente" />
      <small className="field-hint">Los números menores aparecen primero en el formulario y en el reporte de Excel.</small>
    </label>
  </>;
}

export default function MaintenanceQuestionsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canView = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const canManage = hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [expandedTypes, setExpandedTypes] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [modal, setModal] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [typeData, questionData] = await Promise.all([
        requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, includeInactive: canManage, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        requestAvailable(QUESTION_ROUTES.list, { page: 1, pageSize: 1000, includeInactive: canManage, sortBy: 'Orden', sortDir: 'asc' }, sessionToken),
      ]);
      setDeviceTypes(normalizeItems(typeData).sort((left, right) => typeName(left).localeCompare(typeName(right), 'es')));
      setQuestions(normalizeItems(questionData));
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo cargar el panel de preguntas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canView) load();
    // La recarga depende únicamente de sesión y permisos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, canView, canManage]);

  const groups = useMemo(() => {
    const query = clean(search).toLowerCase();
    return deviceTypes
      .map((type) => {
        const id = typeId(type);
        const rows = questions
          .filter((question) => clean(question.TipoDispositivoID) === id)
          .sort((left, right) => Number(left.Orden || 0) - Number(right.Orden || 0) || questionText(left).localeCompare(questionText(right), 'es'));
        return { type, id, name: typeName(type), active: activeRecord(type), questions: rows };
      })
      .filter((group) => !query
        || group.name.toLowerCase().includes(query)
        || group.questions.some((question) => questionText(question).toLowerCase().includes(query)));
  }, [deviceTypes, questions, search]);

  function expandType(id) {
    if (!id) return;
    setExpandedTypes((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function toggleType(id) {
    setExpandedTypes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(group = null) {
    if (group?.id) expandType(group.id);
    setModal({ mode: 'create', record: null, values: emptyValues(group?.id || '') });
    setModalError('');
  }

  function openEdit(question) {
    expandType(clean(question.TipoDispositivoID));
    setModal({
      mode: 'edit',
      record: question,
      values: {
        tipoDispositivoId: clean(question.TipoDispositivoID),
        pregunta: questionText(question),
        orden: String(question.Orden ?? ''),
      },
    });
    setModalError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!modal || !canManage) return;
    const selectedTypeId = modal.values.tipoDispositivoId;
    const type = deviceTypes.find((item) => typeId(item) === selectedTypeId);
    if (!type || !selectedTypeId) {
      setModalError('Seleccione un tipo de dispositivo válido.');
      return;
    }
    if (!modal.values.pregunta.trim()) {
      setModalError('Escriba la pregunta que se responderá con Sí o No.');
      return;
    }

    setSaving(true);
    setModalError('');
    try {
      const payload = {
        tipoDispositivoId: selectedTypeId,
        Pregunta: modal.values.pregunta.trim(),
        ...(modal.values.orden !== '' ? { Orden: Number(modal.values.orden) } : {}),
      };
      if (modal.mode === 'edit') {
        await requestAvailable(QUESTION_ROUTES.update, {
          ...payload,
          questionId: questionId(modal.record),
          PreguntaDispositivoID: questionId(modal.record),
        }, sessionToken);
      } else {
        await requestAvailable(QUESTION_ROUTES.create, payload, sessionToken);
      }
      setModal(null);
      expandType(selectedTypeId);
      await load();
    } catch (requestError) {
      setModalError(requestError?.message || 'No se pudo guardar la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(question) {
    if (!canManage) return;
    const active = activeRecord(question);
    if (!window.confirm(`${active ? 'Desactivar' : 'Reactivar'} la pregunta “${questionText(question)}”?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestAvailable(QUESTION_ROUTES.update, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
        Activo: !active,
        Estado: active ? 'INACTIVO' : 'ACTIVO',
      }, sessionToken);
      await load();
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo cambiar el estado de la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(question) {
    if (!canManage) return;
    if (!window.confirm(`¿Eliminar “${questionText(question)}”? La eliminación será lógica y los mantenimientos anteriores conservarán la pregunta histórica.`)) return;
    setSaving(true);
    setError('');
    try {
      await requestAvailable(QUESTION_ROUTES.delete, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
      }, sessionToken);
      await load();
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo eliminar la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <Navigate to="/mas" replace />;

  const searching = Boolean(clean(search));

  return <div className="page maintenance-questions-page">
    <div className="list-page-heading maintenance-questions-heading">
      <div>
        <span className="eyebrow">Catálogos relacionados</span>
        <h1>Preguntas de mantenimiento</h1>
        <p>Seleccione un tipo de dispositivo para desplegar y administrar sus preguntas de Sí o No.</p>
      </div>
      {canManage && <button className="button button--primary button--compact" type="button" onClick={() => openCreate()} disabled={saving}><Icon name="add" /> Nueva pregunta</button>}
    </div>

    <section className="maintenance-question-explanation">
      <Icon name="account_tree" />
      <div><strong>Relación automática con el catálogo</strong><span>Los tipos se mantienen agrupados y cerrados para facilitar la navegación. Los resultados de búsqueda se despliegan automáticamente.</span></div>
    </section>

    <label className="maintenance-question-search">
      <Icon name="search" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar dispositivo o pregunta" aria-label="Buscar preguntas de mantenimiento" />
      {search && <button type="button" className="maintenance-question-search__clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><Icon name="close" /></button>}
    </label>

    {!canManage && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede revisar las preguntas relacionadas, pero no agregarlas, editarlas ni eliminarlas.</span></div>}
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando tipos y preguntas...</div> : (
      <div className="maintenance-question-type-grid">
        {groups.map((group) => {
          const open = searching || expandedTypes.has(group.id);
          const activeCount = group.questions.filter(activeRecord).length;
          const contentId = panelId(group.id);
          return <section key={group.id} className={`maintenance-question-type-card${group.active ? '' : ' is-inactive'}${open ? ' is-open' : ''}`}>
            <button
              className="maintenance-question-type-toggle"
              type="button"
              onClick={() => toggleType(group.id)}
              aria-expanded={open}
              aria-controls={contentId}
            >
              <span className="maintenance-question-type-card__icon"><Icon name="devices" /></span>
              <span className="maintenance-question-type-card__name">{group.name}</span>
              <span className="maintenance-question-type-count" aria-label={`${activeCount} preguntas activas`}>{activeCount}</span>
              <Icon name="expand_more" />
            </button>

            {open && <div className="maintenance-question-type-content" id={contentId}>
              <div className="maintenance-question-type-toolbar">
                <div>
                  <strong>{activeCount} pregunta{activeCount === 1 ? '' : 's'} activa{activeCount === 1 ? '' : 's'}</strong>
                  <span>{group.questions.length} registrada{group.questions.length === 1 ? '' : 's'} en total</span>
                </div>
                <div className="maintenance-question-type-toolbar__actions">
                  {!group.active && <span className="status-chip status-chip--inactive">TIPO INACTIVO</span>}
                  {canManage && group.active && <button className="button button--secondary button--compact" type="button" onClick={() => openCreate(group)} disabled={saving}><Icon name="add" />Agregar pregunta</button>}
                </div>
              </div>

              <div className="maintenance-question-list">
                {group.questions.length ? group.questions.map((question) => {
                  const active = activeRecord(question);
                  return <article key={questionId(question)} className={active ? '' : 'is-inactive'}>
                    <span className="maintenance-question-order">{Number(question.Orden || 0)}</span>
                    <div><strong>{questionText(question)}</strong><small>Respuesta: Sí / No · Clave interna: {clean(question.Clave)}</small></div>
                    <span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{active ? 'ACTIVA' : 'INACTIVA'}</span>
                    {canManage && <div className="maintenance-question-actions">
                      <button className="icon-button" type="button" onClick={() => openEdit(question)} disabled={saving} aria-label="Editar pregunta"><Icon name="edit" /></button>
                      <button className="icon-button" type="button" onClick={() => toggle(question)} disabled={saving} aria-label={active ? 'Desactivar pregunta' : 'Reactivar pregunta'}><Icon name={active ? 'block' : 'refresh'} /></button>
                      <button className="icon-button icon-button--danger" type="button" onClick={() => remove(question)} disabled={saving} aria-label="Eliminar pregunta"><Icon name="delete" /></button>
                    </div>}
                  </article>;
                }) : <div className="maintenance-question-empty"><Icon name="rule" /><span>Este tipo todavía no tiene preguntas específicas.</span>{canManage && group.active && <button type="button" onClick={() => openCreate(group)}>Agregar la primera</button>}</div>}
              </div>
            </div>}
          </section>;
        })}
        {!groups.length && <div className="empty-state"><Icon name="search_off" /><h2>Sin coincidencias</h2><p>No hay tipos o preguntas que coincidan con la búsqueda.</p></div>}
      </div>
    )}

    <InlineCreateModal open={Boolean(modal)} title={modal?.mode === 'edit' ? 'Editar pregunta de mantenimiento' : 'Nueva pregunta de mantenimiento'} saving={saving} error={modalError} onClose={() => { setModal(null); setModalError(''); }} onSubmit={submit}>
      {modal && <QuestionModalFields values={modal.values} setValues={(updater) => setModal((current) => ({ ...current, values: typeof updater === 'function' ? updater(current.values) : updater }))} deviceTypes={deviceTypes.filter(activeRecord)} editing={modal.mode === 'edit'} />}
    </InlineCreateModal>
  </div>;
}
