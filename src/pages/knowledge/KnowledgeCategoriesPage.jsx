import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import AdminEntityModal from '../../components/forms/AdminEntityModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY = { id: '', name: '', description: '', active: true };

function viewCategory(record = {}) {
  return {
    id: String(pick(record, ['CategoriaConocimientoID', 'CategoriaID', 'id'], '')),
    name: pick(record, ['Nombre', 'name'], 'Categoría sin nombre'),
    description: pick(record, ['Descripcion', 'description']),
    active: toBoolean(pick(record, ['Activo', 'active'], true), true),
  };
}

export default function KnowledgeCategoriesPage() {
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const canManage = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const [items, setItems] = useState([]);
  const [tutorials, setTutorials] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const [categoriesResult, tutorialsResult] = await Promise.allSettled([
      requestAvailable(MODULE_ROUTES.knowledgeCategories.list, { page: 1, pageSize: 1000, includeInactive: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
      requestAvailable(MODULE_ROUTES.knowledge.list, { page: 1, pageSize: 2000, includeInactive: true }, sessionToken),
    ]);
    if (categoriesResult.status === 'fulfilled') setItems(normalizeItems(categoriesResult.value));
    else setError(categoriesResult.reason?.message || 'No se pudieron cargar las categorías.');
    if (tutorialsResult.status === 'fulfilled') setTutorials(normalizeItems(tutorialsResult.value));
    setLoading(false);
  }

  useEffect(() => { if (canManage) load(); }, [sessionToken, canManage]);

  const counts = useMemo(() => tutorials.reduce((map, tutorial) => {
    const ids = [
      pick(tutorial, ['CategoriaConocimientoID', 'CategoriaID', 'categoriaId']),
      ...(Array.isArray(tutorial.Categorias) ? tutorial.Categorias : []),
    ].filter(Boolean).map(String);
    ids.forEach((id) => map.set(id, (map.get(id) || 0) + 1));
    return map;
  }, new Map()), [tutorials]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((record) => {
      const view = viewCategory(record);
      return `${view.name} ${view.description}`.toLowerCase().includes(query);
    });
  }, [items, search]);

  function openCreate() {
    setSelected({});
    setForm({ ...EMPTY });
    setEditing(true);
    setModalError('');
  }

  function openDetail(record) {
    setSelected(record);
    setForm(viewCategory(record));
    setEditing(false);
    setModalError('');
  }

  function closeModal() {
    if (saving) return;
    setSelected(null);
    setEditing(false);
    setModalError('');
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setModalError('El nombre de la categoría es obligatorio.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const payload = {
        categoriaId: form.id,
        CategoriaConocimientoID: form.id,
        nombre: form.name.trim(),
        Nombre: form.name.trim(),
        descripcion: form.description.trim(),
        Descripcion: form.description.trim(),
        activo: form.active,
        Activo: form.active,
        Estado: form.active ? 'ACTIVO' : 'INACTIVO',
      };
      const response = await requestAvailable(form.id ? MODULE_ROUTES.knowledgeCategories.update : MODULE_ROUTES.knowledgeCategories.create, payload, sessionToken);
      const saved = response?.item || response?.data || response;
      setSelected(saved);
      setForm(viewCategory(saved));
      setEditing(false);
      await load();
    } catch (saveError) {
      setModalError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!form.id) return;
    const nextActive = !form.active;
    if (!window.confirm(`${nextActive ? 'Reactivar' : 'Desactivar'} la categoría “${form.name}”?`)) return;
    setSaving(true);
    setModalError('');
    try {
      const response = await requestAvailable(MODULE_ROUTES.knowledgeCategories.update, {
        categoriaId: form.id,
        CategoriaConocimientoID: form.id,
        Activo: nextActive,
        activo: nextActive,
        Estado: nextActive ? 'ACTIVO' : 'INACTIVO',
      }, sessionToken);
      setSelected(response);
      setForm(viewCategory(response));
      await load();
    } catch (statusError) {
      setModalError(statusError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <Navigate to="/conocimiento" replace />;

  const tutorialCount = form.id ? counts.get(String(form.id)) || 0 : 0;

  return <div className="page knowledge-categories-page">
    <div className="page-header"><button className="icon-button" type="button" onClick={() => navigate('/conocimiento')}><Icon name="arrow_back" /></button><div><span className="eyebrow">Base de conocimientos</span><h1>Categorías</h1></div></div>
    <div className="list-page-heading"><p>Organiza los tutoriales por plataforma, producto o tecnología.</p><button className="button button--primary button--compact" type="button" onClick={openCreate}><Icon name="add" />Nueva categoría</button></div>

    <label className="search-bar"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar categoría o descripción..." /><button className="icon-button" type="button" onClick={load} aria-label="Actualizar"><Icon name="refresh" /></button></label>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando categorías...</div> : <div className="admin-mini-card-grid">
      {visible.map((record, index) => {
        const view = viewCategory(record);
        const count = counts.get(String(view.id)) || 0;
        return <article className={`admin-mini-card${view.active ? '' : ' is-inactive'}`} key={view.id || index}>
          <span className="admin-mini-card__icon"><Icon name="category" /></span>
          <div className="admin-mini-card__body"><strong>{view.name}</strong><span>{count} tutorial{count === 1 ? '' : 'es'}</span><small>{view.active ? 'ACTIVA' : 'INACTIVA'}</small></div>
          <button className="icon-button icon-button--outlined admin-mini-card__action" type="button" onClick={() => openDetail(record)} aria-label={`Editar ${view.name}`}><Icon name="edit" /></button>
        </article>;
      })}
      {!visible.length && <div className="empty-state"><Icon name="category" /><h2>Sin categorías</h2><p>No se encontraron categorías con la búsqueda actual.</p></div>}
    </div>}

    <AdminEntityModal
      open={Boolean(selected)}
      title={form.name || 'Nueva categoría'}
      subtitle={form.id ? `${tutorialCount} tutorial${tutorialCount === 1 ? '' : 'es'} relacionado${tutorialCount === 1 ? '' : 's'}` : 'La categoría aparecerá en los tutoriales'}
      eyebrow={editing ? (form.id ? 'Editar categoría' : 'Nueva categoría') : 'Detalle de categoría'}
      icon="category"
      onClose={closeModal}
      busy={saving}
      footer={!editing && form.id ? <><button className="button button--secondary" type="button" onClick={toggleStatus} disabled={saving}><Icon name={form.active ? 'block' : 'refresh'} />{form.active ? 'Desactivar' : 'Reactivar'}</button><button className="button button--primary" type="button" onClick={() => setEditing(true)} disabled={saving}><Icon name="edit" />Editar</button></> : null}
    >
      {modalError && <div className="alert alert--error"><Icon name="error" /><span>{modalError}</span></div>}
      {editing ? <form className="stack-form" onSubmit={save}>
        <label className="field-group"><span className="field-label">Nombre *</span><input className="form-control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label className="field-group"><span className="field-label">Descripción</span><textarea className="form-control ticket-textarea" rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.active ? 'ACTIVO' : 'INACTIVO'} onChange={(event) => setForm({ ...form, active: event.target.value === 'ACTIVO' })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
        <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => form.id ? setEditing(false) : closeModal()} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar categoría'}</button></div>
      </form> : <div className="admin-detail-grid"><div><span>Estado</span><strong>{form.active ? 'ACTIVA' : 'INACTIVA'}</strong></div><div><span>Tutoriales relacionados</span><strong>{tutorialCount}</strong></div><div className="is-wide"><span>Descripción</span><strong>{form.description || 'Sin descripción'}</strong></div></div>}
    </AdminEntityModal>
  </div>;
}
