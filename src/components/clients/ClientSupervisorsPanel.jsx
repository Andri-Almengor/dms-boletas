import React, { useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY = { id: '', nombre: '', correo: '', puesto: '', telefono: '', recibeCorreo: true };

function supervisorView(record) {
  return {
    id: pick(record, ['ContactoID', 'contactoId', 'id']),
    nombre: pick(record, ['Nombre', 'nombre']),
    correo: pick(record, ['Correo', 'correo']),
    puesto: pick(record, ['Puesto', 'puesto']),
    telefono: pick(record, ['Telefono', 'Teléfono', 'telefono']),
    recibeCorreo: toBoolean(pick(record, ['RecibeCorreo', 'recibeCorreo'], true), true),
  };
}

export default function ClientSupervisorsPanel({ clientId, clientName }) {
  const { sessionToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.contactsList, {
        clienteId: clientId,
        page: 1,
        pageSize: 500,
        includeInactive: true,
        sortBy: 'Nombre',
        sortDir: 'asc',
      }, sessionToken);
      setItems(normalizeItems(data).filter((record) => (
        toBoolean(pick(record, ['EsSupervisor', 'esSupervisor'], false), false)
        && record.Activo !== false
        && String(pick(record, ['Estado', 'estado'], 'ACTIVO')).toUpperCase() !== 'INACTIVO'
      )));
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      setShowForm(false);
      setError('');
      return;
    }
    setOpen(true);
    await load();
  }

  function openCreate() {
    setForm(EMPTY);
    setShowForm(true);
    setError('');
  }

  function editSupervisor(record) {
    setForm(supervisorView(record));
    setShowForm(true);
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    if (!form.nombre.trim()) {
      setError('El nombre del supervisor es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        ContactoID: form.id,
        contactoId: form.id,
        ClienteID: clientId,
        clienteId: clientId,
        Nombre: form.nombre.trim(),
        nombre: form.nombre.trim(),
        Correo: form.correo.trim(),
        correo: form.correo.trim(),
        Puesto: form.puesto.trim(),
        puesto: form.puesto.trim(),
        Telefono: form.telefono.trim(),
        telefono: form.telefono.trim(),
        EsSupervisor: true,
        esSupervisor: true,
        RecibeCorreo: form.recibeCorreo,
        recibeCorreo: form.recibeCorreo,
        Activo: true,
        Estado: 'ACTIVO',
      };
      await requestAvailable(
        form.id ? MODULE_ROUTES.clients.contactsUpdate : MODULE_ROUTES.clients.contactsCreate,
        payload,
        sessionToken,
      );
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(record) {
    const view = supervisorView(record);
    if (!window.confirm(`¿Eliminar al supervisor ${view.nombre || ''} de ${clientName}?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.contactsDelete, {
        ContactoID: view.id,
        contactoId: view.id,
      }, sessionToken);
      if (form.id === view.id) {
        setForm(EMPTY);
        setShowForm(false);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`client-supervisors${open ? ' is-open' : ''}`}>
      <button className="client-supervisors__toggle" type="button" onClick={toggle} aria-expanded={open}>
        <span><Icon name="supervisor_account" /> Supervisores</span>
        <span>{open ? 'Ocultar' : 'Administrar'} <Icon name={open ? 'expand_less' : 'expand_more'} /></span>
      </button>

      {open && (
        <div className="client-supervisors__content">
          <div className="client-supervisors__heading">
            <div>
              <strong>Supervisores de {clientName}</strong>
              <small>Se utilizan en las boletas y en los correos de notificación.</small>
            </div>
            <button className="button button--primary button--compact" type="button" onClick={openCreate} disabled={saving}>
              <Icon name="person_add" /> Agregar
            </button>
          </div>

          {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

          {showForm && (
            <form className="client-supervisor-form" onSubmit={save}>
              <div className="client-supervisor-form__title">
                <strong>{form.id ? 'Editar supervisor' : 'Agregar supervisor'}</strong>
                <button className="icon-button" type="button" onClick={() => { setShowForm(false); setForm(EMPTY); setError(''); }} aria-label="Cerrar formulario">
                  <Icon name="close" />
                </button>
              </div>
              <div className="client-supervisor-form__grid">
                <label className="field-group"><span className="field-label">Nombre completo</span><input className="form-control" value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required /></label>
                <label className="field-group"><span className="field-label">Correo</span><input className="form-control" type="email" value={form.correo} onChange={(event) => setForm((current) => ({ ...current, correo: event.target.value }))} /></label>
                <label className="field-group"><span className="field-label">Puesto</span><input className="form-control" value={form.puesto} onChange={(event) => setForm((current) => ({ ...current, puesto: event.target.value }))} /></label>
                <label className="field-group"><span className="field-label">Teléfono</span><input className="form-control" type="tel" value={form.telefono} onChange={(event) => setForm((current) => ({ ...current, telefono: event.target.value }))} /></label>
              </div>
              <label className="check-card client-supervisor-form__check">
                <input type="checkbox" checked={form.recibeCorreo} onChange={(event) => setForm((current) => ({ ...current, recibeCorreo: event.target.checked }))} />
                <Icon name={form.recibeCorreo ? 'check_box' : 'check_box_outline_blank'} />
                <div><strong>Recibe correos</strong><small>Incluir a este supervisor en las notificaciones relacionadas.</small></div>
              </label>
              <div className="form-actions">
                <button className="button button--secondary" type="button" onClick={() => { setShowForm(false); setForm(EMPTY); }} disabled={saving}>Cancelar</button>
                <button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar supervisor'}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando supervisores...</span></div>
          ) : items.length ? (
            <div className="client-supervisors__list">
              {items.map((record) => {
                const view = supervisorView(record);
                return (
                  <article className="client-supervisor-card" key={view.id}>
                    <span className="client-supervisor-card__avatar"><Icon name="person" /></span>
                    <div className="client-supervisor-card__body">
                      <strong>{view.nombre || 'Sin nombre'}</strong>
                      <span>{view.puesto || 'Sin puesto'}</span>
                      <div>
                        {view.correo && <span><Icon name="mail" /> {view.correo}</span>}
                        {view.telefono && <span><Icon name="call" /> {view.telefono}</span>}
                        <span><Icon name={view.recibeCorreo ? 'notifications_active' : 'notifications_off'} /> {view.recibeCorreo ? 'Recibe correos' : 'No recibe correos'}</span>
                      </div>
                    </div>
                    <div className="client-supervisor-card__actions">
                      <button className="icon-button icon-button--outlined" type="button" onClick={() => editSupervisor(record)} disabled={saving} aria-label={`Editar ${view.nombre}`}><Icon name="edit" /></button>
                      <button className="icon-button icon-button--danger" type="button" onClick={() => remove(record)} disabled={saving} aria-label={`Eliminar ${view.nombre}`}><Icon name="delete" /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="client-supervisors__empty"><Icon name="person_off" /><span>Este cliente todavía no tiene supervisores registrados.</span></div>
          )}
        </div>
      )}
    </section>
  );
}
