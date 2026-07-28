import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import ClientRelationsManager from '../../components/clients/ClientRelationsManager';
import Icon from '../../components/common/Icon';
import AdminEntityModal from '../../components/forms/AdminEntityModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY = { id: '', name: '', contacto: '', telefono: '', correo: '', direccion: '', sitioWeb: '', chatWebhook: '', status: 'ACTIVO' };

function viewClient(record = {}) {
  return {
    id: String(pick(record, ['ClienteID', 'ID', 'RowID', 'id'], '')),
    name: pick(record, ['Clientes', 'Cliente', 'Nombre', 'name'], 'Cliente sin nombre'),
    contacto: pick(record, ['Contacto', 'contacto']),
    telefono: pick(record, ['Telefonos', 'Teléfonos', 'Telefono', 'Teléfono', 'telefono']),
    correo: pick(record, ['CorreoGeneral', 'Correo', 'correo']),
    direccion: pick(record, ['DireccionEnvio', 'Dirección envío', 'Direccion', 'Dirección', 'direccion']),
    sitioWeb: pick(record, ['SitioWeb', 'Sitio web', 'Web', 'sitioWeb']),
    chatWebhook: pick(record, ['ChatWebhook', 'ChatWebhookURL', 'chatWebhook']),
    chatConfigured: toBoolean(pick(record, ['ChatConfigurado'], false), false) || Boolean(pick(record, ['ChatWebhook', 'ChatWebhookURL', 'chatWebhook'])),
    status: String(pick(record, ['Estado', 'estado'], 'ACTIVO')).toUpperCase(),
  };
}

function clientPayload(form) {
  return {
    ClienteID: form.id,
    clienteId: form.id,
    Clientes: form.name.trim(),
    Nombre: form.name.trim(),
    Contacto: form.contacto.trim(),
    Telefonos: form.telefono.trim(),
    CorreoGeneral: form.correo.trim(),
    DireccionEnvio: form.direccion.trim(),
    SitioWeb: form.sitioWeb.trim(),
    ChatWebhook: form.chatWebhook.trim(),
    Estado: form.status,
    Activo: form.status === 'ACTIVO',
  };
}

function ClientFields({ form, setForm }) {
  const change = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <div className="admin-form-grid">
    <label className="field-group is-wide"><span className="field-label">Nombre o razón social *</span><input className="form-control" value={form.name} onChange={change('name')} required /></label>
    <label className="field-group"><span className="field-label">Contacto</span><input className="form-control" value={form.contacto} onChange={change('contacto')} /></label>
    <label className="field-group"><span className="field-label">Teléfono</span><input className="form-control" type="tel" value={form.telefono} onChange={change('telefono')} /></label>
    <label className="field-group"><span className="field-label">Correo</span><input className="form-control" type="email" value={form.correo} onChange={change('correo')} /></label>
    <label className="field-group"><span className="field-label">Sitio web</span><input className="form-control" type="url" value={form.sitioWeb} onChange={change('sitioWeb')} /></label>
    <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={form.status} onChange={change('status')}><option>ACTIVO</option><option>INACTIVO</option></select></label>
    <label className="field-group is-wide"><span className="field-label">Dirección</span><textarea className="form-control ticket-textarea" rows="3" value={form.direccion} onChange={change('direccion')} /></label>
    <label className="field-group is-wide"><span className="field-label">Webhook de Google Chat</span><input className="form-control" type="url" value={form.chatWebhook} onChange={change('chatWebhook')} /></label>
  </div>;
}

function ReadonlyRelations({ related }) {
  return <div className="client-detail-related-grid">
    <section className="admin-related-section">
      <header><div><h3>Sedes y ubicaciones del equipo</h3><p>Ubicaciones principales y espacios relacionados con equipos.</p></div><span className="status-chip status-chip--neutral">{related.locations.length}</span></header>
      <div className="admin-related-section__content">{related.locations.map((location) => {
        const locationId = String(pick(location, ['UbicacionID', 'ubicacionId', 'id']));
        const equipment = related.equipment.filter((item) => String(pick(item, ['UbicacionID', 'ubicacionId'])) === locationId);
        return <article className="admin-related-card" key={locationId}><div className="admin-related-card__title"><strong>{pick(location, ['Nombre', 'nombre'], 'Sin nombre')}</strong><span>{pick(location, ['Estado'], 'ACTIVO')}</span></div><span>{pick(location, ['Direccion', 'direccion'], 'Sin dirección')}</span><small>{equipment.length ? `Ubicaciones del equipo: ${equipment.map((item) => pick(item, ['Nombre', 'nombre'])).join(', ')}` : 'Sin ubicaciones del equipo'}</small></article>;
      })}{!related.locations.length && <span>Este cliente no tiene sedes registradas.</span>}</div>
    </section>

    <section className="admin-related-section">
      <header><div><h3>Supervisores y contactos</h3><p>Personas relacionadas con boletas y notificaciones.</p></div><span className="status-chip status-chip--neutral">{related.contacts.length}</span></header>
      <div className="admin-related-section__content">{related.contacts.map((contact, index) => <article className="admin-related-card" key={pick(contact, ['ContactoID', 'id'], index)}><div className="admin-related-card__title"><strong>{pick(contact, ['Nombre', 'nombre'], 'Sin nombre')}</strong><span>{toBoolean(pick(contact, ['EsSupervisor'], false), false) ? 'Supervisor' : 'Contacto'}</span></div><span>{pick(contact, ['Puesto', 'puesto'], 'Sin puesto')}</span><small>{[pick(contact, ['Correo', 'correo']), pick(contact, ['Telefono', 'telefono'])].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small></article>)}{!related.contacts.length && <span>Este cliente no tiene contactos registrados.</span>}</div>
    </section>
  </div>;
}

export default function ClientsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [related, setRelated] = useState({ locations: [], equipment: [], contacts: [] });
  const [loading, setLoading] = useState(true);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 1000, includeInactive: isAdmin, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setItems(normalizeItems(data));
    } catch (loadError) {
      setError(loadError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken, isAdmin]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((record) => {
      const view = viewClient(record);
      return `${view.name} ${view.contacto} ${view.correo} ${view.telefono} ${view.direccion}`.toLowerCase().includes(query);
    });
  }, [items, search]);

  async function loadRelated(clientId) {
    if (!clientId) return;
    setLoadingRelated(true);
    setModalError('');
    try {
      const [locationsResult, equipmentResult, contactsResult] = await Promise.allSettled([
        requestAvailable(MODULE_ROUTES.clients.locationsList, { clienteId: clientId, page: 1, pageSize: 1000, includeInactive: false, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, { page: 1, pageSize: 3000, includeInactive: false, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        requestAvailable(MODULE_ROUTES.clients.contactsList, { clienteId: clientId, page: 1, pageSize: 1000, includeInactive: false, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
      ]);
      const locations = locationsResult.status === 'fulfilled' ? normalizeItems(locationsResult.value) : [];
      const locationIds = new Set(locations.map((row) => String(pick(row, ['UbicacionID', 'ubicacionId', 'id']))));
      const equipment = equipmentResult.status === 'fulfilled'
        ? normalizeItems(equipmentResult.value).filter((row) => locationIds.has(String(pick(row, ['UbicacionID', 'ubicacionId']))))
        : [];
      const contacts = contactsResult.status === 'fulfilled' ? normalizeItems(contactsResult.value) : [];
      setRelated({ locations, equipment, contacts });
      const failures = [locationsResult, equipmentResult, contactsResult].filter((result) => result.status === 'rejected');
      if (failures.length) setModalError('Algunos datos relacionados no pudieron cargarse. Pulse actualizar o vuelva a abrir el cliente.');
    } finally {
      setLoadingRelated(false);
    }
  }

  async function openDetail(record) {
    const view = viewClient(record);
    setSelected(record);
    setForm(view);
    setEditing(false);
    setRelated({ locations: [], equipment: [], contacts: [] });
    await loadRelated(view.id);
  }

  function openCreate() {
    if (!isAdmin) return;
    setSelected({});
    setForm({ ...EMPTY });
    setEditing(true);
    setRelated({ locations: [], equipment: [], contacts: [] });
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
    if (!isAdmin) return;
    if (!form.name.trim()) {
      setModalError('El nombre del cliente es obligatorio.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const response = await requestAvailable(form.id ? MODULE_ROUTES.clients.update : MODULE_ROUTES.clients.create, clientPayload(form), sessionToken);
      const saved = response?.item || response?.data || response;
      setSelected(saved);
      setForm(viewClient(saved));
      setEditing(false);
      await load();
      await loadRelated(viewClient(saved).id);
    } catch (saveError) {
      setModalError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus() {
    if (!isAdmin || !form.id) return;
    const nextStatus = form.status === 'INACTIVO' ? 'ACTIVO' : 'INACTIVO';
    if (!window.confirm(`${nextStatus === 'INACTIVO' ? 'Desactivar' : 'Reactivar'} a ${form.name}?`)) return;
    setSaving(true);
    setModalError('');
    try {
      const updated = await requestAvailable(MODULE_ROUTES.clients.update, { ClienteID: form.id, clienteId: form.id, Estado: nextStatus, Activo: nextStatus === 'ACTIVO' }, sessionToken);
      setSelected(updated);
      setForm(viewClient(updated));
      await load();
    } catch (statusError) {
      setModalError(statusError.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeClient() {
    if (!isAdmin || !form.id || !window.confirm(`¿Eliminar lógicamente a ${form.name}? Los registros históricos conservarán la relación.`)) return;
    setSaving(true);
    setModalError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.delete, { ClienteID: form.id, clienteId: form.id }, sessionToken);
      setSelected(null);
      setEditing(false);
      setModalError('');
      await load();
    } catch (deleteError) {
      setModalError(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedView = selected ? form : null;
  const supervisors = related.contacts.filter((row) => toBoolean(pick(row, ['EsSupervisor', 'esSupervisor'], false), false));

  return <div className="page admin-module-page">
    <div className="list-page-heading">
      <div><span className="eyebrow">Administración</span><h1>Clientes</h1><p>Consulta clientes, sedes, ubicaciones del equipo y supervisores relacionados.</p></div>
      {isAdmin && <button className="button button--primary button--compact" type="button" onClick={openCreate}><Icon name="add" />Nuevo cliente</button>}
    </div>

    {!isAdmin && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede revisar toda la información del cliente, pero solo un administrador puede modificarla.</span></div>}

    <label className="search-bar">
      <Icon name="search" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, contacto, correo o dirección..." />
      <button className="icon-button" type="button" onClick={load} aria-label="Actualizar"><Icon name="refresh" /></button>
    </label>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando clientes...</div> : (
      <div className="admin-mini-card-grid">
        {visible.map((record, index) => {
          const view = viewClient(record);
          return <article className={`admin-mini-card${view.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={view.id || index}>
            <span className="admin-mini-card__icon"><Icon name="corporate_fare" /></span>
            <div className="admin-mini-card__body"><strong>{view.name}</strong><span>{view.contacto || view.correo || 'Sin contacto principal'}</span><small>{view.status}</small></div>
            <button className="icon-button icon-button--outlined admin-mini-card__action" type="button" onClick={() => openDetail(record)} aria-label={`${isAdmin ? 'Administrar' : 'Ver'} ${view.name}`}><Icon name={isAdmin ? 'edit' : 'visibility'} /></button>
          </article>;
        })}
        {!visible.length && <div className="empty-state"><Icon name="groups" /><h2>Sin clientes</h2><p>No se encontraron registros con la búsqueda actual.</p></div>}
      </div>
    )}

    <AdminEntityModal
      open={Boolean(selected)}
      title={selectedView?.name || 'Nuevo cliente'}
      subtitle={selectedView?.id ? `${related.locations.length} sedes · ${related.equipment.length} ubicaciones del equipo · ${supervisors.length} supervisores` : 'Complete los datos para crear el cliente'}
      eyebrow={editing ? (selectedView?.id ? 'Editar cliente' : 'Nuevo cliente') : 'Detalle del cliente'}
      icon="corporate_fare"
      onClose={closeModal}
      busy={saving}
      className="admin-entity-modal-layer--client client-detail-modal"
      footer={!editing && isAdmin && selectedView?.id ? <>
        <button className="button button--danger" type="button" onClick={removeClient} disabled={saving}><Icon name="delete" />Eliminar</button>
        <button className="button button--secondary" type="button" onClick={changeStatus} disabled={saving}><Icon name={selectedView.status === 'INACTIVO' ? 'refresh' : 'block'} />{selectedView.status === 'INACTIVO' ? 'Reactivar' : 'Desactivar'}</button>
        <button className="button button--primary" type="button" onClick={() => setEditing(true)} disabled={saving}><Icon name="edit" />Editar datos</button>
      </> : null}
    >
      {modalError && <div className="alert alert--error"><Icon name="error" /><span>{modalError}</span></div>}
      {editing ? <form className="stack-form" onSubmit={save}>
        <ClientFields form={form} setForm={setForm} />
        <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => selectedView?.id ? setEditing(false) : closeModal()} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar cliente'}</button></div>
      </form> : <div className="client-detail-layout">
        <div className="admin-detail-grid">
          <div><span>Estado</span><strong>{selectedView?.status || 'ACTIVO'}</strong></div>
          <div><span>Contacto</span><strong>{selectedView?.contacto || 'Sin contacto'}</strong></div>
          <div><span>Teléfono</span><strong>{selectedView?.telefono || 'Sin teléfono'}</strong></div>
          <div><span>Correo</span><strong>{selectedView?.correo || 'Sin correo'}</strong></div>
          <div className="is-wide"><span>Dirección</span><strong>{selectedView?.direccion || 'Sin dirección'}</strong></div>
          <div><span>Sitio web</span><strong>{selectedView?.sitioWeb || 'Sin sitio web'}</strong></div>
          <div><span>Google Chat</span><strong>{selectedView?.chatConfigured ? 'Configurado' : 'Sin configurar'}</strong></div>
        </div>

        {loadingRelated ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando información relacionada...</div> : isAdmin && selectedView?.id ? <ClientRelationsManager
          clientId={selectedView.id}
          clientName={selectedView.name}
          locations={related.locations}
          equipment={related.equipment}
          contacts={related.contacts}
          onRefresh={() => loadRelated(selectedView.id)}
        /> : <ReadonlyRelations related={related} />}
      </div>}
    </AdminEntityModal>
  </div>;
}
