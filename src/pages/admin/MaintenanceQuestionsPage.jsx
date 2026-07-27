import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
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

function typeIcon(row = {}) {
  return clean(pick(row, ['Icono', 'Icon', 'icon'])) || getMaintenanceCategory(typeName(row)).icon;
}

function questionId(row = {}) {
  return clean(pick(row, ['PreguntaDispositivoID', 'questionId', 'id']));
}

function questionText(row = {}) {
  return clean(pick(row, ['Pregunta', 'pregunta', 'label'], 'Pregunta sin texto'));
}

function emptyValues(typeIdentifier = '') {
  return { tipoDispositivoId: typeIdentifier, pregunta: '', orden: '' };
}

function QuestionEditorFields({ values, setValues, deviceName }) {
  function change(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  return <>
    <div className="maintenance-question-fixed-type">
      <span className="field-label">Tipo de dispositivo</span>
      <strong>{deviceName}</strong>
      <small>La pregunta quedará relacionada permanentemente con este tipo.</small>
    </div>
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
  const [search, setSearch] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [editor, setEditor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [managerError, setManagerError] = useState('');

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

  useEffect(() => {
    if (!selectedTypeId) return undefined;
    document.body.classList.add('maintenance-question-manager-open');
    function handleKey(event) {
      if (event.key === 'Escape' && !saving) {
        if (editor) setEditor(null);
        else setSelectedTypeId('');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.classList.remove('maintenance-question-manager-open');
      window.removeEventListener('keydown', handleKey);
    };
  }, [selectedTypeId, editor, saving]);

  const allGroups = useMemo(() => deviceTypes.map((type) => {
    const id = typeId(type);
    const rows = questions
      .filter((question) => clean(question.TipoDispositivoID) === id)
      .sort((left, right) => Number(left.Orden || 0) - Number(right.Orden || 0) || questionText(left).localeCompare(questionText(right), 'es'));
    return {
      type,
      id,
      name: typeName(type),
      icon: typeIcon(type),
      active: activeRecord(type),
      questions: rows,
      activeCount: rows.filter(activeRecord).length,
    };
  }), [deviceTypes, questions]);

  const groups = useMemo(() => {
    const query = clean(search).toLowerCase();
    if (!query) return allGroups;
    return allGroups.filter((group) => group.name.toLowerCase().includes(query)
      || group.questions.some((question) => questionText(question).toLowerCase().includes(query)));
  }, [allGroups, search]);

  const selectedGroup = useMemo(
    () => allGroups.find((group) => group.id === selectedTypeId) || null,
    [allGroups, selectedTypeId],
  );

  function openManager(group) {
    setSelectedTypeId(group.id);
    setEditor(null);
    setManagerError('');
  }

  function closeManager() {
    if (saving) return;
    setEditor(null);
    setSelectedTypeId('');
    setManagerError('');
  }

  function openCreate(group = selectedGroup) {
    if (!group?.id || !canManage) return;
    setSelectedTypeId(group.id);
    setEditor({ mode: 'create', record: null, values: emptyValues(group.id) });
    setManagerError('');
  }

  function openEdit(question) {
    if (!canManage) return;
    const identifier = clean(question.TipoDispositivoID);
    setSelectedTypeId(identifier);
    setEditor({
      mode: 'edit',
      record: question,
      values: {
        tipoDispositivoId: identifier,
        pregunta: questionText(question),
        orden: String(question.Orden ?? ''),
      },
    });
    setManagerError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!editor || !canManage) return;
    const identifier = editor.values.tipoDispositivoId;
    const type = deviceTypes.find((item) => typeId(item) === identifier);
    if (!type || !identifier) {
      setManagerError('No se encontró el tipo de dispositivo relacionado.');
      return;
    }
    if (!editor.values.pregunta.trim()) {
      setManagerError('Escriba la pregunta que se responderá con Sí o No.');
      return;
    }

    setSaving(true);
    setManagerError('');
    try {
      const payload = {
        tipoDispositivoId: identifier,
        Pregunta: editor.values.pregunta.trim(),
        ...(editor.values.orden !== '' ? { Orden: Number(editor.values.orden) } : {}),
      };
      if (editor.mode === 'edit') {
        await requestAvailable(QUESTION_ROUTES.update, {
          ...payload,
          questionId: questionId(editor.record),
          PreguntaDispositivoID: questionId(editor.record),
        }, sessionToken);
      } else {
        await requestAvailable(QUESTION_ROUTES.create, payload, sessionToken);
      }
      setEditor(null);
      await load();
    } catch (requestError) {
      setManagerError(requestError?.message || 'No se pudo guardar la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(question) {
    if (!canManage) return;
    const active = activeRecord(question);
    if (!window.confirm(`${active ? 'Desactivar' : 'Reactivar'} la pregunta “${questionText(question)}”?`)) return;
    setSaving(true);
    setManagerError('');
    try {
      await requestAvailable(QUESTION_ROUTES.update, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
        Activo: !active,
        Estado: active ? 'INACTIVO' : 'ACTIVO',
      }, sessionToken);
      await load();
    } catch (requestError) {
      setManagerError(requestError?.message || 'No se pudo cambiar el estado de la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(question) {
    if (!canManage) return;
    if (!window.confirm(`¿Eliminar “${questionText(question)}”? La eliminación será lógica y los mantenimientos anteriores conservarán la pregunta histórica.`)) return;
    setSaving(true);
    setManagerError('');
    try {
      await requestAvailable(QUESTION_ROUTES.delete, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
      }, sessionToken);
      await load();
    } catch (requestError) {
      setManagerError(requestError?.message || 'No se pudo eliminar la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <Navigate to="/mas" replace />;

  return <div className="page maintenance-questions-page">
    <div className="list-page-heading maintenance-questions-heading">
      <div>
        <span className="eyebrow">Catálogos relacionados</span>
        <h1>Preguntas de mantenimiento</h1>
        <p>Seleccione el lápiz de un dispositivo para administrar sus preguntas de Sí o No.</p>
      </div>
    </div>

    <section className="maintenance-question-explanation">
      <Icon name="account_tree" />
      <div><strong>Una tarjeta por tipo de dispositivo</strong><span>Cada tipo nuevo aparece automáticamente. La edición se realiza en una ventana independiente para mantener el panel limpio y ordenado.</span></div>
    </section>

    <label className="maintenance-question-search">
      <Icon name="search" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar dispositivo o pregunta" aria-label="Buscar preguntas de mantenimiento" />
      {search && <button type="button" className="maintenance-question-search__clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><Icon name="close" /></button>}
    </label>

    {!canManage && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede revisar las preguntas relacionadas, pero no agregarlas, editarlas ni eliminarlas.</span></div>}
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando tipos y preguntas...</div> : (
      <div className="maintenance-question-device-grid">
        {groups.map((group) => <article key={group.id} className={`maintenance-question-device-card${group.active ? '' : ' is-inactive'}`}>
          <span className="maintenance-question-device-card__icon"><Icon name={group.icon} /></span>
          <div className="maintenance-question-device-card__content">
            <strong>{group.name}</strong>
            <span>{group.activeCount} pregunta{group.activeCount === 1 ? '' : 's'} activa{group.activeCount === 1 ? '' : 's'}</span>
          </div>
          <button className="icon-button icon-button--outlined maintenance-question-device-card__edit" type="button" onClick={() => openManager(group)} aria-label={`${canManage ? 'Editar' : 'Ver'} preguntas de ${group.name}`}>
            <Icon name={canManage ? 'edit' : 'visibility'} />
          </button>
        </article>)}
        {!groups.length && <div className="empty-state maintenance-question-device-grid__empty"><Icon name="search_off" /><h2>Sin coincidencias</h2><p>No hay tipos o preguntas que coincidan con la búsqueda.</p></div>}
      </div>
    )}

    {selectedGroup && <div className="maintenance-question-manager-layer" role="dialog" aria-modal="true" aria-label={`Preguntas de ${selectedGroup.name}`}>
      <button type="button" className="maintenance-question-manager-backdrop" onClick={closeManager} aria-label="Cerrar ventana de preguntas" />
      <section className="maintenance-question-manager">
        <header className="maintenance-question-manager__header">
          <span className="maintenance-question-manager__icon"><Icon name={selectedGroup.icon} /></span>
          <div>
            <span className="eyebrow">Preguntas del dispositivo</span>
            <h2>{selectedGroup.name}</h2>
            <p>{selectedGroup.activeCount} activa{selectedGroup.activeCount === 1 ? '' : 's'} · {selectedGroup.questions.length} registrada{selectedGroup.questions.length === 1 ? '' : 's'}</p>
          </div>
          <button className="icon-button" type="button" onClick={closeManager} disabled={saving} aria-label="Cerrar"><Icon name="close" /></button>
        </header>

        {managerError && <div className="alert alert--error maintenance-question-manager__alert"><Icon name="error" /><span>{managerError}</span></div>}

        {editor ? <form className="maintenance-question-manager__editor stack-form" onSubmit={submit}>
          <div className="maintenance-question-manager__editor-heading">
            <button className="icon-button" type="button" onClick={() => { setEditor(null); setManagerError(''); }} disabled={saving} aria-label="Volver a las preguntas"><Icon name="arrow_back" /></button>
            <div><span className="eyebrow">{editor.mode === 'edit' ? 'Editar registro' : 'Nuevo registro'}</span><h3>{editor.mode === 'edit' ? 'Editar pregunta' : 'Agregar pregunta'}</h3></div>
          </div>
          <QuestionEditorFields values={editor.values} setValues={(updater) => setEditor((current) => ({ ...current, values: typeof updater === 'function' ? updater(current.values) : updater }))} deviceName={selectedGroup.name} />
          <footer className="maintenance-question-manager__editor-actions">
            <button className="button button--secondary" type="button" onClick={() => { setEditor(null); setManagerError(''); }} disabled={saving}>Cancelar</button>
            <button className="button button--primary" type="submit" disabled={saving}><Icon name={saving ? 'progress_activity' : 'save'} />{saving ? 'Guardando...' : 'Guardar pregunta'}</button>
          </footer>
        </form> : <>
          <div className="maintenance-question-manager__toolbar">
            {!selectedGroup.active && <span className="status-chip status-chip--inactive">TIPO INACTIVO</span>}
            {canManage && selectedGroup.active && <button className="button button--primary button--compact" type="button" onClick={() => openCreate(selectedGroup)} disabled={saving}><Icon name="add" />Nueva pregunta</button>}
          </div>

          <div className="maintenance-question-manager__list maintenance-question-list">
            {selectedGroup.questions.length ? selectedGroup.questions.map((question) => {
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
            }) : <div className="maintenance-question-empty"><Icon name="rule" /><span>Este tipo todavía no tiene preguntas específicas.</span>{canManage && selectedGroup.active && <button type="button" onClick={() => openCreate(selectedGroup)}>Agregar la primera</button>}</div>}
          </div>
        </>}
      </section>
    </div>}
  </div>;
}
