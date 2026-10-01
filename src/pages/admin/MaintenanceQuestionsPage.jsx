import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import useOverlaySurface from '../../hooks/useOverlaySurface';
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

function upsertQuestion(items, record) {
  const id = questionId(record);
  if (!id) return items;
  const index = items.findIndex((item) => questionId(item) === id);
  if (index < 0) return [record, ...items];
  return items.map((item, currentIndex) => currentIndex === index ? { ...item, ...record } : item);
}

const RESPONSE_TYPE_OPTIONS = [
  ['SI_NO', 'Sí / No'],
  ['TEXTO', 'Texto'],
  ['NUMERO', 'Número'],
  ['CANTIDAD', 'Cantidad'],
  ['MAC', 'Dirección MAC'],
  ['OPCIONES', 'Lista de opciones'],
  ['RELACION_DISPOSITIVO', 'Relacionar otro dispositivo'],
];

const RELATED_FIELD_OPTIONS = [
  ['cantidad', 'Cantidad'],
  ['nombre', 'Nombre / identificador'],
  ['fabricante', 'Marca / fabricante'],
  ['modelo', 'Modelo'],
  ['serie', 'Serie'],
  ['mac', 'Dirección MAC'],
];

function parseQuestionConfig(row = {}) {
  const raw = row.config || row.ConfiguracionJSON || {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function emptyValues(typeIdentifier = '') {
  return {
    tipoDispositivoId: typeIdentifier,
    pregunta: '',
    orden: '',
    aplicaModo: 'MANTENIMIENTO',
    tipoRespuesta: 'SI_NO',
    tipoDispositivoRelacionadoId: '',
    camposRelacionados: ['cantidad', 'fabricante', 'modelo', 'serie'],
    opcionesTexto: '',
    obligatoria: true,
  };
}

function QuestionEditorFields({ values, setValues, deviceName, deviceTypes }) {
  function change(event) {
    const { name, value, type, checked } = event.target;
    setValues((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'tipoRespuesta' && value === 'RELACION_DISPOSITIVO'
        ? {
          obligatoria: false,
          aplicaModo: current.aplicaModo === 'MANTENIMIENTO' ? 'PROYECTO' : current.aplicaModo,
        }
        : {}),
    }));
  }

  function toggleRelatedField(field) {
    setValues((current) => {
      const selected = new Set(current.camposRelacionados || []);
      if (selected.has(field)) selected.delete(field);
      else selected.add(field);
      return { ...current, camposRelacionados: [...selected] };
    });
  }

  return <>
    <div className="maintenance-question-fixed-type">
      <span className="field-label">Tipo de dispositivo</span>
      <strong>{deviceName}</strong>
      <small>La pregunta quedará relacionada permanentemente con este tipo.</small>
    </div>
    <label className="field-group">
      <span className="field-label">Pregunta o campo *</span>
      <textarea className="form-control ticket-textarea" rows="4" name="pregunta" value={values.pregunta} onChange={change} placeholder="Ej. ¿Tiene lectores?" required maxLength="500" />
    </label>
    <div className="ticket-form-grid">
      <label className="field-group">
        <span className="field-label">Aplica en</span>
        <select className="form-control" name="aplicaModo" value={values.aplicaModo} onChange={change}>
          <option value="MANTENIMIENTO" disabled={values.tipoRespuesta === 'RELACION_DISPOSITIVO'}>Mantenimiento</option>
          <option value="PROYECTO">Proyecto</option>
          <option value="AMBOS">Ambos</option>
        </select>
      </label>
      <label className="field-group">
        <span className="field-label">Tipo de respuesta</span>
        <select className="form-control" name="tipoRespuesta" value={values.tipoRespuesta} onChange={change}>
          {RESPONSE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    {values.tipoRespuesta === 'OPCIONES' && <label className="field-group">
      <span className="field-label">Opciones *</span>
      <textarea
        className="form-control ticket-textarea"
        rows="4"
        name="opcionesTexto"
        value={values.opcionesTexto}
        onChange={change}
        placeholder={'Ej.\nLector\nBotón\nOtro'}
        required
      />
      <small className="field-hint">Escriba una opción por línea. En Proyecto se mostrará como un selector, no como texto libre.</small>
    </label>}
    <label className="maintenance-question-required-toggle">
      <input type="checkbox" name="obligatoria" checked={Boolean(values.obligatoria)} onChange={change} />
      <span><strong>Campo obligatorio</strong><small>Si está desactivado, el dispositivo puede guardarse aunque esta respuesta o relación no aplique.</small></span>
    </label>
    {values.tipoRespuesta === 'RELACION_DISPOSITIVO' && <>
      <label className="field-group">
        <span className="field-label">Tipo de dispositivo relacionado *</span>
        <select className="form-control" name="tipoDispositivoRelacionadoId" value={values.tipoDispositivoRelacionadoId} onChange={change} required>
          <option value="">Seleccione...</option>
          {deviceTypes.filter(activeRecord).map((item) => <option key={typeId(item)} value={typeId(item)}>{typeName(item)}</option>)}
        </select>
        <small className="field-hint">Ejemplo: una Puerta puede relacionar Lectores, Magnetos u otros tipos ya existentes en el catálogo.</small>
      </label>
      <div className="field-group">
        <span className="field-label">Datos que se pedirán para cada dispositivo relacionado</span>
        <div className="maintenance-question-related-fields">
          {RELATED_FIELD_OPTIONS.map(([field, label]) => <label key={field} className="checkbox-row">
            <input type="checkbox" checked={(values.camposRelacionados || []).includes(field)} onChange={() => toggleRelatedField(field)} />
            <span>{label}</span>
          </label>)}
        </div>
      </div>
    </>}
    <label className="field-group">
      <span className="field-label">Orden</span>
      <input className="form-control" type="number" min="0" step="1" name="orden" value={values.orden} onChange={change} placeholder="Se asigna automáticamente" />
      <small className="field-hint">Los números menores aparecen primero en el formulario y en el reporte de Excel.</small>
    </label>
  </>;
}

export default function MaintenanceQuestionsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSearch = searchParams.get('q') || '';
  const requestedTypeId = searchParams.get('device') || '';
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canView = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const canManage = hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [search, setSearch] = useState(requestedSearch);
  const [selectedTypeId, setSelectedTypeId] = useState(requestedTypeId);
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
        requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 1000, includeTotal: false, includeInactive: canManage, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        requestAvailable(QUESTION_ROUTES.list, { page: 1, pageSize: 1000, includeTotal: false, includeTypeName: false, includeInactive: canManage, sortBy: 'Orden', sortDir: 'asc' }, sessionToken),
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

  useOverlaySurface({
    open: Boolean(selectedGroup),
    busy: saving,
    onClose: () => {
      if (editor) {
        setEditor(null);
        setManagerError('');
      } else {
        closeManager();
      }
    },
  });

  function updateQuestionViewQuery({ nextSearch = search, nextTypeId = selectedTypeId } = {}) {
    const next = new URLSearchParams(searchParams);
    if (nextSearch) next.set('q', nextSearch);
    else next.delete('q');
    if (nextTypeId) next.set('device', nextTypeId);
    else next.delete('device');
    setSearchParams(next, { replace: true });
  }

  function changeSearch(nextSearch) {
    setSearch(nextSearch);
    updateQuestionViewQuery({ nextSearch });
  }

  function openManager(group) {
    setSelectedTypeId(group.id);
    setEditor(null);
    setManagerError('');
    updateQuestionViewQuery({ nextTypeId: group.id });
  }

  function closeManager() {
    if (saving) return;
    setEditor(null);
    setSelectedTypeId('');
    setManagerError('');
    updateQuestionViewQuery({ nextTypeId: '' });
  }

  function openCreate(group = selectedGroup) {
    if (!group?.id || !canManage) return;
    setSelectedTypeId(group.id);
    updateQuestionViewQuery({ nextTypeId: group.id });
    setEditor({ mode: 'create', record: null, values: emptyValues(group.id) });
    setManagerError('');
  }

  function openEdit(question) {
    if (!canManage) return;
    const identifier = clean(question.TipoDispositivoID);
    setSelectedTypeId(identifier);
    updateQuestionViewQuery({ nextTypeId: identifier });
    setEditor({
      mode: 'edit',
      record: question,
      values: {
        tipoDispositivoId: identifier,
        pregunta: questionText(question),
        orden: String(question.Orden ?? ''),
        aplicaModo: clean(question.AplicaModo || question.appliesTo || 'MANTENIMIENTO').toUpperCase(),
        tipoRespuesta: clean(question.TipoRespuesta || question.responseType || 'SI_NO').toUpperCase(),
        tipoDispositivoRelacionadoId: clean(question.TipoDispositivoRelacionadoID || question.relatedTypeId),
        camposRelacionados: Array.isArray(parseQuestionConfig(question).fields)
          ? parseQuestionConfig(question).fields
          : ['cantidad', 'fabricante', 'modelo', 'serie'],
        opcionesTexto: Array.isArray(parseQuestionConfig(question).options)
          ? parseQuestionConfig(question).options.join('\n')
          : '',
        obligatoria: typeof parseQuestionConfig(question).required === 'boolean'
          ? parseQuestionConfig(question).required
          : clean(question.TipoRespuesta || question.responseType || 'SI_NO').toUpperCase() !== 'RELACION_DISPOSITIVO',
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
      setManagerError('Escriba la pregunta o campo que desea configurar.');
      return;
    }
    if (editor.values.tipoRespuesta === 'RELACION_DISPOSITIVO' && !editor.values.tipoDispositivoRelacionadoId) {
      setManagerError('Seleccione el tipo de dispositivo relacionado.');
      return;
    }
    const configuredOptions = editor.values.opcionesTexto
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (editor.values.tipoRespuesta === 'OPCIONES' && !configuredOptions.length) {
      setManagerError('Agregue al menos una opción.');
      return;
    }

    setSaving(true);
    setManagerError('');
    try {
      const payload = {
        tipoDispositivoId: identifier,
        Pregunta: editor.values.pregunta.trim(),
        AplicaModo: editor.values.aplicaModo,
        TipoRespuesta: editor.values.tipoRespuesta,
        TipoDispositivoRelacionadoID: editor.values.tipoRespuesta === 'RELACION_DISPOSITIVO'
          ? editor.values.tipoDispositivoRelacionadoId
          : '',
        ConfiguracionJSON: JSON.stringify({
          fields: editor.values.tipoRespuesta === 'RELACION_DISPOSITIVO'
            ? editor.values.camposRelacionados
            : [],
          options: editor.values.tipoRespuesta === 'OPCIONES'
            ? configuredOptions
            : [],
          required: Boolean(editor.values.obligatoria),
        }),
        ...(editor.values.orden !== '' ? { Orden: Number(editor.values.orden) } : {}),
      };
      const response = editor.mode === 'edit'
        ? await requestAvailable(QUESTION_ROUTES.update, {
          ...payload,
          questionId: questionId(editor.record),
          PreguntaDispositivoID: questionId(editor.record),
        }, sessionToken)
        : await requestAvailable(QUESTION_ROUTES.create, payload, sessionToken);
      setQuestions((current) => upsertQuestion(current, response));
      setEditor(null);
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
      const response = await requestAvailable(QUESTION_ROUTES.update, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
        Activo: !active,
        Estado: active ? 'INACTIVO' : 'ACTIVO',
      }, sessionToken);
      setQuestions((current) => upsertQuestion(current, response));
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
      const response = await requestAvailable(QUESTION_ROUTES.delete, {
        questionId: questionId(question),
        PreguntaDispositivoID: questionId(question),
      }, sessionToken);
      setQuestions((current) => upsertQuestion(current, response));
    } catch (requestError) {
      setManagerError(requestError?.message || 'No se pudo eliminar la pregunta.');
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <Navigate to="/mas" replace />;

  return <div className="page page--wide maintenance-questions-page">
    <div className="list-page-heading maintenance-questions-heading">
      <div>
        <span className="eyebrow">Catálogos relacionados</span>
        <h1>Preguntas de mantenimiento</h1>
        <p>Configure preguntas, campos y relaciones reutilizables para cada tipo de dispositivo.</p>
      </div>
    </div>

    <section className="maintenance-question-explanation">
      <Icon name="account_tree" />
      <div><strong>Una tarjeta por tipo de dispositivo</strong><span>Cada tipo nuevo aparece automáticamente. La edición se realiza en una ventana independiente para mantener el panel limpio y ordenado.</span></div>
    </section>

    <label className="maintenance-question-search">
      <Icon name="search" />
      <input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Buscar dispositivo o pregunta" aria-label="Buscar preguntas de mantenimiento" enterKeyHint="search" autoComplete="off" />
      {search && <button type="button" className="maintenance-question-search__clear" onClick={() => changeSearch('')} aria-label="Limpiar búsqueda"><Icon name="close" /></button>}
    </label>

    {!canManage && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede revisar las preguntas relacionadas, pero no agregarlas, editarlas ni eliminarlas.</span></div>}
    {error && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{error}</span></div>}

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

        {managerError && <div className="alert alert--error maintenance-question-manager__alert" role="alert"><Icon name="error" /><span>{managerError}</span></div>}

        {editor ? <form className="maintenance-question-manager__editor stack-form" onSubmit={submit}>
          <div className="maintenance-question-manager__editor-heading">
            <button className="icon-button" type="button" onClick={() => { setEditor(null); setManagerError(''); }} disabled={saving} aria-label="Volver a las preguntas"><Icon name="arrow_back" /></button>
            <div><span className="eyebrow">{editor.mode === 'edit' ? 'Editar registro' : 'Nuevo registro'}</span><h3>{editor.mode === 'edit' ? 'Editar pregunta' : 'Agregar pregunta'}</h3></div>
          </div>
          <QuestionEditorFields values={editor.values} setValues={(updater) => setEditor((current) => ({ ...current, values: typeof updater === 'function' ? updater(current.values) : updater }))} deviceName={selectedGroup.name} deviceTypes={deviceTypes} />
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
                <div><strong>{questionText(question)}</strong><small>{clean(question.AplicaModo || question.appliesTo || 'MANTENIMIENTO')} · {clean(question.TipoRespuesta || question.responseType || 'SI_NO')} · {parseQuestionConfig(question).required === false ? 'Opcional' : 'Obligatoria'} · Clave interna: {clean(question.Clave)}</small></div>
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
