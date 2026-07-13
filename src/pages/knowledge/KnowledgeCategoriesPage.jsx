import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY = { id: '', name: '', description: '', active: true };

export default function KnowledgeCategoriesPage() {
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const canManage = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.knowledgeCategories.list, { page: 1, pageSize: 500, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setItems(normalizeItems(data));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (canManage) load(); }, [sessionToken, canManage]);

  function edit(record) {
    setForm({
      id: String(pick(record, ['CategoriaConocimientoID', 'CategoriaID', 'id'])),
      name: pick(record, ['Nombre', 'name']),
      description: pick(record, ['Descripcion', 'description']),
      active: toBoolean(pick(record, ['Activo', 'active'], true), true),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { categoriaId: form.id, CategoriaConocimientoID: form.id, nombre: form.name.trim(), Nombre: form.name.trim(), descripcion: form.description.trim(), Descripcion: form.description.trim(), activo: form.active, Activo: form.active };
      await requestAvailable(form.id ? MODULE_ROUTES.knowledgeCategories.update : MODULE_ROUTES.knowledgeCategories.create, payload, sessionToken);
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (!canManage) return <Navigate to="/conocimiento" replace />;

  return <div className="page page--narrow knowledge-categories-page">
    <div className="page-header"><button className="icon-button" type="button" onClick={() => navigate('/conocimiento')}><Icon name="arrow_back" /></button><div><span className="eyebrow">Base de conocimientos</span><h1>Categorías</h1></div></div>
    <div className="list-page-heading"><p>Organiza los tutoriales por plataforma, producto o tecnología: Lenel, Milestone, Axis, Barco y otras.</p><button className="button button--primary button--compact" type="button" onClick={() => { setForm(EMPTY); setShowForm((current) => !current); }}><Icon name="add" /> Nueva categoría</button></div>

    {showForm && <form className="form-card admin-inline-form" onSubmit={save}>
      <div className="form-card__heading"><span className="section-marker" /><div><h2>{form.id ? 'Editar categoría' : 'Crear categoría'}</h2><p>La categoría aparecerá en el selector de los tutoriales.</p></div></div>
      <div className="admin-form-grid">
        <label className="field-group"><span className="field-label">Nombre *</span><input className="form-control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Lenel" required /></label>
        <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.active ? 'ACTIVO' : 'INACTIVO'} onChange={(event) => setForm({ ...form, active: event.target.value === 'ACTIVO' })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
        <label className="field-group is-wide"><span className="field-label">Descripción</span><textarea className="form-control ticket-textarea" rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Plataforma de control de acceso LenelS2 OnGuard" /></label>
      </div>
      <div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar categoría'}</button></div>
    </form>}

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando categorías...</div> : <div className="knowledge-category-admin-grid">{items.length ? items.map((record, index) => { const active = toBoolean(pick(record, ['Activo', 'active'], true), true); return <article key={pick(record, ['CategoriaConocimientoID', 'CategoriaID', 'id'], index)}><span><Icon name="category" /></span><div><h2>{pick(record, ['Nombre', 'name'], 'Sin nombre')}</h2><p>{pick(record, ['Descripcion', 'description'], 'Sin descripción')}</p></div><span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{active ? 'ACTIVO' : 'INACTIVO'}</span><button type="button" className="icon-button icon-button--outlined" onClick={() => edit(record)} aria-label="Editar categoría"><Icon name="edit" /></button></article>; }) : <div className="empty-state"><Icon name="category" /><h2>Sin categorías</h2><p>Crea la primera categoría de documentación.</p></div>}</div>}
  </div>;
}
