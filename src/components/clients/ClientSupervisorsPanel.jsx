import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY = {
  id: '',
  nombre: '',
  correo: '',
  puesto: '',
  telefono: '',
  recibeCorreo: true,
  status: 'ACTIVO',
};

function unwrap(response) {
  return response?.item || response?.data || response;
}

function recordStatus(record) {
  if (record?.Activo === false || record?.activo === false) return 'INACTIVO';
  return String(pick(record, ['Estado', 'estado'], 'ACTIVO')).toUpperCase();
}

function supervisorView(record = {}) {
  return {
    id: String(pick(record, ['ContactoID', 'contactoId', 'id'], '')),
    nombre: pick(record, ['Nombre', 'nombre']),
    correo: pick(record, ['Correo', 'correo']),
    puesto: pick(record, ['Puesto', 'puesto']),
    telefono: pick(record, ['Telefono', 'Teléfono', 'telefono']),
    recibeCorreo: toBoolean(pick(record, ['RecibeCorreo', 'recibeCorreo'], true), true),
    status: recordStatus(record),
  };
}

function isSupervisor(record) {
  return toBoolean(pick(record, ['EsSupervisor', 'esSupervisor'], false), false);
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default function ClientSupervisorsPanel({
  clientId,
  clientName,
  canDelete = false,
  embedded = false,
  initialItems = [],
  onChanged,
}) {
  const { sessionToken } = useAuth();
  const [open, setOpen] = useState(embedded);
  const [items, setItems] = useState(() => initialItems.filter(isSupervisor));
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingScope, setSavingScope] = useState('');
  const [error, setError] = useState('');

  const saving = Boolean(savingScope);

  useEffect(() => {
    setItems(initialItems.filter(isSupervisor));
  }, [initialItems]);

  useEffect(() => {
    setOpen(embedded);
    setForm(EMPTY);
    setShowForm(false);
    setQuery('');
    setError('');
  }, [clientId, embedded]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.contactsList, {
        clienteId: clientId,
        page: 1,
        pageSize: 1000,
        includeInactive: true,
        sortBy: 'Nombre',
        sortDir: 'asc',
      }, sessionToken);
      setItems(normalizeItems(data).filter(isSupervisor));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (embedded) return;
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
    setForm({ ...EMPTY });
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

    setSavingScope('save');
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
        Estado: form.status,
        Activo: form.status === 'ACTIVO',
      };
      const saved = unwrap(await requestAvailable(
        form.id ? MODULE_ROUTES.clients.contactsUpdate : MODULE_ROUTES.clients.contactsCreate,
        payload,
        sessionToken,
      ));
      const savedView = supervisorView(saved);
      setItems((current) => {
        const exists = current.some((record) => supervisorView(record).id === savedView.id);
        return exists
          ? current.map((record) => supervisorView(record).id === savedView.id ? saved : record)
          : [...current, saved].sort((left, right) => supervisorView(left).nombre.localeCompare(supervisorView(right).nombre, 'es'));
      });
      setForm(EMPTY);
      setShowForm(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  async function remove(record) {
    if (!canDelete) return;
    const view = supervisorView(record);
    if (!window.confirm(`¿Eliminar al supervisor “${view.nombre || 'Sin nombre'}” de ${clientName}? La eliminación será lógica y los registros históricos conservarán su referencia.`)) return;
    setSavingScope(`delete:${view.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.contactsDelete, {
        ContactoID: view.id,
        contactoId: view.id,
      }, sessionToken);
      setItems((current) => current.filter((item) => supervisorView(item).id !== view.id));
      if (form.id === view.id) {
        setForm(EMPTY);
        setShowForm(false);
      }
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  const visible = useMemo(() => {
    const term = normalized(query);
    if (!term) return items;
    return items.filter((record) => {
      const view = supervisorView(record);
      return normalized(`${view.nombre} ${view.puesto} ${view.correo} ${view.telefono} ${view.status}`).includes(term);
    });
  }, [items, query]);

  const activeCount = items.filter((record) => supervisorView(record).status !== 'INACTIVO').length;

  const content = (
    <div className={`client-supervisors__content${embedded ? ' client-supervisors__content--embedded' : ''}`}>
      <div className="client-relations-manager__summary">
        <div>
          <strong>Supervisores de {clientName}</strong>
          <small>{items.length} registrado{items.length === 1 ? '' : 's'} · {activeCount} activo{activeCount === 1 ? '' : 's'}</small>
        </div>
        <div className="client-relations-manager__summary-actions">
          <button className="icon-button icon-button--outlined" type="button" onClick={load} disabled={saving || loading} aria-label="Actualizar supervisores"><Icon name="refresh" /></button>
          <button className="button button--primary button--compact" type="button" onClick={openCreate} disabled={saving}><Icon name="person_add" />Agregar supervisor</button>
        </div>
      </div>

      <label className="client-relations-search client-relations-search--single">
        <Icon name="search" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar supervisor, puesto, correo o teléfono..." />
      </label>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {showForm && (
        <form className="client-supervisor-form" onSubmit={save}>
          <div className="client-supervisor-form__title">
            <div><strong>{form.id ? 'Editar supervisor' : 'Agregar supervisor'}</strong><small>El supervisor podrá relacionarse con boletas y notificaciones.</small></div>
            <button className="icon-button" type="button" onClick={() => { setShowForm(false); setForm(EMPTY); setError(''); }} aria-label="Cerrar formulario"><Icon name="close" /></button>
          </div>
          <div className="client-supervisor-form__grid">
            <label className="field-group"><span className="field-label">Nombre completo</span><input className="form-control" value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
            <label className="field-group"><span className="field-label">Correo</span><input className="form-control" type="email" value={form.correo} onChange={(event) => setForm((current) => ({ ...current, correo: event.target.value }))} /></label>
            <label className="field-group"><span className="field-label">Puesto</span><input className="form-control" value={form.puesto} onChange={(event) => setForm((current) => ({ ...current, puesto: event.target.value }))} /></label>
            <label className="field-group"><span className="field-label">Teléfono</span><input className="form-control" type="tel" value={form.telefono} onChange={(event) => setForm((current) => ({ ...current, telefono: event.target.value }))} /></label>
          </div>
          <label className="check-card client-supervisor-form__check">
            <input type="checkbox" checked={form.recibeCorreo} onChange={(event) => setForm((current) => ({ ...current, recibeCorreo: event.target.checked }))} />
            <Icon name={form.recibeCorreo ? 'check_box' : 'check_box_outline_blank'} />
            <div><strong>Recibe correos</strong><small>Incluir a este supervisor en las notificaciones relacionadas.</small></div>
          </label>
          <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => { setShowForm(false); setForm(EMPTY); }} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{savingScope === 'save' ? 'Guardando...' : 'Guardar supervisor'}</button></div>
        </form>
      )}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando supervisores...</span></div>
      ) : visible.length ? (
        <div className="client-supervisors__list client-supervisors__list--management">
          {visible.map((record) => {
            const view = supervisorView(record);
            return (
              <article className={`client-supervisor-card${view.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={view.id}>
                <span className="client-supervisor-card__avatar"><Icon name="person" /></span>
                <div className="client-supervisor-card__body">
                  <div className="client-supervisor-card__title"><strong>{view.nombre || 'Sin nombre'}</strong><span className={`status-chip ${view.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{view.status}</span></div>
                  <span>{view.puesto || 'Sin puesto'}</span>
                  <div>
                    {view.correo && <span><Icon name="mail" />{view.correo}</span>}
                    {view.telefono && <span><Icon name="call" />{view.telefono}</span>}
                    <span><Icon name={view.recibeCorreo ? 'notifications_active' : 'notifications_off'} />{view.recibeCorreo ? 'Recibe correos' : 'No recibe correos'}</span>
                  </div>
                </div>
                <div className="client-supervisor-card__actions">
                  <button className="icon-button icon-button--outlined" type="button" onClick={() => editSupervisor(record)} disabled={saving} aria-label={`Editar ${view.nombre}`}><Icon name="edit" /></button>
                  {canDelete && <button className="icon-button icon-button--danger" type="button" onClick={() => remove(record)} disabled={saving} aria-label={`Eliminar ${view.nombre}`}><Icon name={savingScope === `delete:${view.id}` ? 'progress_activity' : 'delete'} /></button>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="client-supervisors__empty"><Icon name="person_off" /><span>{items.length ? 'No hay coincidencias con la búsqueda.' : 'Este cliente todavía no tiene supervisores registrados.'}</span></div>
      )}
    </div>
  );

  if (embedded) return <section className="client-supervisors client-supervisors--embedded is-open">{content}</section>;

  return (
    <section className={`client-supervisors${open ? ' is-open' : ''}`}>
      <button className="client-supervisors__toggle" type="button" onClick={toggle} aria-expanded={open}>
        <span><Icon name="supervisor_account" />Supervisores</span>
        <span>{open ? 'Ocultar' : 'Administrar'} <Icon name={open ? 'expand_less' : 'expand_more'} /></span>
      </button>
      {open && content}
    </section>
  );
}
