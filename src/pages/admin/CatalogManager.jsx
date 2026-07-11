import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { normalizeItems, requestAvailable } from '../../services/moduleApi';

export default function CatalogManager({ config }) {
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(config.empty);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load(query = search) {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(config.routes.list, { page: 1, pageSize: 300, search: query, sortBy: config.sortBy, sortDir: 'asc' }, sessionToken);
      setItems(normalizeItems(data));
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(''); }, [sessionToken]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const editing = Boolean(form.id);
      await requestAvailable(editing ? config.routes.update : config.routes.create, config.toPayload(form), sessionToken);
      setForm(config.empty);
      setShowForm(false);
      await load('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function edit(record) {
    setForm(config.fromRecord(record));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="page admin-module-page">
      <div className="page-header">
        <button className="icon-button" type="button" onClick={() => navigate('/mas')}><Icon name="arrow_back" /></button>
        <div><span className="eyebrow">Administración</span><h1>{config.title}</h1></div>
      </div>

      <div className="list-page-heading">
        <p>{config.description}</p>
        <button className="button button--primary button--compact" type="button" onClick={() => { setForm(config.empty); setShowForm((current) => !current); }}><Icon name="add" /> Nuevo</button>
      </div>

      {showForm && (
        <form className="form-card admin-inline-form" onSubmit={save}>
          <div className="form-card__heading"><span className="section-marker" /><div><h2>{form.id ? `Editar ${config.singular}` : `Crear ${config.singular}`}</h2><p>Completa la información solicitada.</p></div></div>
          <div className="admin-form-grid">
            {config.fields.map((field) => (
              <label className={`field-group${field.wide ? ' is-wide' : ''}`} key={field.name}>
                <span className="field-label">{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea className="form-control ticket-textarea" rows="3" value={form[field.name] || ''} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} />
                ) : field.type === 'select' ? (
                  <select className="form-control" value={form[field.name] || ''} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
                ) : (
                  <input className="form-control" type={field.type || 'text'} value={form[field.name] || ''} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} required={field.required} />
                )}
              </label>
            ))}
          </div>
          <div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></div>
        </form>
      )}

      <form className="search-bar" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${config.singular}...`} /><button className="icon-button icon-button--primary"><Icon name="search" /></button>
      </form>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando...</span></div> : items.length ? (
        <div className="admin-record-grid">
          {items.map((record, index) => {
            const view = config.fromRecord(record);
            return (
              <article className="module-record-card" key={view.id || index}>
                <span className="module-record-card__icon"><Icon name={config.icon} /></span>
                <div className="module-record-card__body">
                  <div className="module-record-card__title"><h2>{view.name || `Sin ${config.singular}`}</h2><span className={`status-chip ${view.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{view.status || 'ACTIVO'}</span></div>
                  {config.summary(view).map((line) => <p key={line.label}>{line.icon && <Icon name={line.icon} />} {line.value || line.empty}</p>)}
                </div>
                <button className="icon-button icon-button--outlined" type="button" onClick={() => edit(record)} aria-label="Editar"><Icon name="edit" /></button>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state"><Icon name={config.icon} /><h2>Sin registros</h2><p>{config.emptyMessage}</p></div>}
    </div>
  );
}
