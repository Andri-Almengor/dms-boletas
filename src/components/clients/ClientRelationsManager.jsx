import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY_LOCATION = {
  id: '',
  nombre: '',
  direccion: '',
  notas: '',
  status: 'ACTIVO',
};

const EMPTY_EQUIPMENT = {
  id: '',
  parentId: '',
  nombre: '',
  descripcion: '',
  status: 'ACTIVO',
};

const EMPTY_SUPERVISOR = {
  id: '',
  nombre: '',
  correo: '',
  puesto: '',
  telefono: '',
  recibeCorreo: true,
  status: 'ACTIVO',
};

function recordStatus(record = {}) {
  if (record.Activo === false || record.activo === false) return 'INACTIVO';
  return String(pick(record, ['Estado', 'estado'], 'ACTIVO')).toUpperCase();
}

function locationView(record = {}) {
  return {
    id: String(pick(record, ['UbicacionID', 'ubicacionId', 'id'], '')),
    nombre: pick(record, ['Nombre', 'nombre']),
    direccion: pick(record, ['Direccion', 'Dirección', 'direccion']),
    notas: pick(record, ['Notas', 'notas']),
    status: recordStatus(record),
  };
}

function equipmentView(record = {}) {
  return {
    id: String(pick(record, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'], '')),
    parentId: String(pick(record, ['UbicacionID', 'ubicacionId'], '')),
    nombre: pick(record, ['Nombre', 'nombre']),
    descripcion: pick(record, ['Descripcion', 'Descripción', 'descripcion']),
    status: recordStatus(record),
  };
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

function relationId(record, type) {
  if (type === 'location') return String(pick(record, ['UbicacionID', 'ubicacionId', 'id'], ''));
  if (type === 'equipment') return String(pick(record, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'], ''));
  return String(pick(record, ['ContactoID', 'contactoId', 'id'], ''));
}

export default function ClientRelationsManager({
  clientId,
  clientName,
  locations = [],
  equipment = [],
  contacts = [],
  onRefresh,
}) {
  const { sessionToken } = useAuth();
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [openLocations, setOpenLocations] = useState(() => new Set());

  const locationItems = useMemo(() => locations.map(locationView), [locations]);
  const equipmentItems = useMemo(() => equipment.map(equipmentView), [equipment]);
  const supervisorItems = useMemo(() => contacts
    .filter((record) => toBoolean(pick(record, ['EsSupervisor', 'esSupervisor'], false), false))
    .map(supervisorView), [contacts]);

  const equipmentByLocation = useMemo(() => {
    const grouped = new Map();
    locationItems.forEach((location) => grouped.set(location.id, []));
    equipmentItems.forEach((item) => {
      if (!grouped.has(item.parentId)) grouped.set(item.parentId, []);
      grouped.get(item.parentId).push(item);
    });
    return grouped;
  }, [locationItems, equipmentItems]);

  useEffect(() => {
    setOpenLocations(new Set(locationItems.map((item) => item.id)));
    setEditor(null);
    setError('');
  }, [clientId]);

  useEffect(() => {
    setOpenLocations((current) => {
      const next = new Set(current);
      locationItems.forEach((item) => next.add(item.id));
      return next;
    });
  }, [locationItems]);

  function toggleLocation(locationId) {
    setOpenLocations((current) => {
      const next = new Set(current);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  }

  function editLocation(item = EMPTY_LOCATION) {
    setEditor({ type: 'location', values: { ...EMPTY_LOCATION, ...item } });
    setError('');
  }

  function editEquipment(item = EMPTY_EQUIPMENT, parentId = '') {
    setEditor({
      type: 'equipment',
      values: { ...EMPTY_EQUIPMENT, ...item, parentId: item.parentId || parentId || locationItems[0]?.id || '' },
    });
    setError('');
  }

  function editSupervisor(item = EMPTY_SUPERVISOR) {
    setEditor({ type: 'supervisor', values: { ...EMPTY_SUPERVISOR, ...item } });
    setError('');
  }

  function updateEditor(values) {
    setEditor((current) => current ? ({ ...current, values: { ...current.values, ...values } }) : current);
  }

  async function refreshRelations() {
    await onRefresh?.();
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editor) return;
    const { type, values } = editor;
    const nombre = String(values.nombre || '').trim();
    if (!nombre) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (type === 'equipment' && !values.parentId) {
      setError('Seleccione la sede o zona principal a la que pertenece la ubicación del equipo.');
      return;
    }

    setBusy(`save-${type}`);
    setError('');
    try {
      if (type === 'location') {
        await requestAvailable(
          values.id ? MODULE_ROUTES.clients.locationsUpdate : MODULE_ROUTES.clients.locationsCreate,
          {
            UbicacionID: values.id,
            ubicacionId: values.id,
            ClienteID: clientId,
            clienteId: clientId,
            Nombre: nombre,
            nombre,
            Direccion: String(values.direccion || '').trim(),
            direccion: String(values.direccion || '').trim(),
            Notas: String(values.notas || '').trim(),
            notas: String(values.notas || '').trim(),
            Estado: values.status,
            status: values.status,
            Activo: values.status === 'ACTIVO',
            activo: values.status === 'ACTIVO',
          },
          sessionToken,
        );
      } else if (type === 'equipment') {
        await requestAvailable(
          values.id ? MODULE_ROUTES.clients.equipmentLocationsUpdate : MODULE_ROUTES.clients.equipmentLocationsCreate,
          {
            UbicacionEquipoID: values.id,
            ubicacionEquipoId: values.id,
            UbicacionID: values.parentId,
            ubicacionId: values.parentId,
            Nombre: nombre,
            nombre,
            Descripcion: String(values.descripcion || '').trim(),
            descripcion: String(values.descripcion || '').trim(),
            Estado: values.status,
            status: values.status,
            Activo: values.status === 'ACTIVO',
            activo: values.status === 'ACTIVO',
          },
          sessionToken,
        );
        setOpenLocations((current) => new Set([...current, values.parentId]));
      } else {
        await requestAvailable(
          values.id ? MODULE_ROUTES.clients.contactsUpdate : MODULE_ROUTES.clients.contactsCreate,
          {
            ContactoID: values.id,
            contactoId: values.id,
            ClienteID: clientId,
            clienteId: clientId,
            Nombre: nombre,
            nombre,
            Correo: String(values.correo || '').trim(),
            correo: String(values.correo || '').trim(),
            Puesto: String(values.puesto || '').trim(),
            puesto: String(values.puesto || '').trim(),
            Telefono: String(values.telefono || '').trim(),
            telefono: String(values.telefono || '').trim(),
            EsSupervisor: true,
            esSupervisor: true,
            RecibeCorreo: Boolean(values.recibeCorreo),
            recibeCorreo: Boolean(values.recibeCorreo),
            Estado: values.status,
            status: values.status,
            Activo: values.status === 'ACTIVO',
            activo: values.status === 'ACTIVO',
          },
          sessionToken,
        );
      }
      setEditor(null);
      await refreshRelations();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la relación.');
    } finally {
      setBusy('');
    }
  }

  async function removeEquipment(item) {
    if (!window.confirm(`¿Eliminar la ubicación del equipo “${item.nombre || 'Sin nombre'}”?`)) return;
    setBusy(`equipment-${item.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsDelete, {
        UbicacionEquipoID: item.id,
        ubicacionEquipoId: item.id,
      }, sessionToken);
      if (editor?.type === 'equipment' && editor.values.id === item.id) setEditor(null);
      await refreshRelations();
    } catch (deleteError) {
      setError(deleteError.message || 'No se pudo eliminar la ubicación del equipo.');
    } finally {
      setBusy('');
    }
  }

  async function removeLocation(item) {
    const children = equipmentByLocation.get(item.id) || [];
    if (children.length) {
      setOpenLocations((current) => new Set([...current, item.id]));
      setError(`La sede “${item.nombre || 'Sin nombre'}” tiene ${children.length} ubicación${children.length === 1 ? '' : 'es'} del equipo. Elimínelas primero para no dejar relaciones huérfanas.`);
      return;
    }
    if (!window.confirm(`¿Eliminar la sede o zona “${item.nombre || 'Sin nombre'}”?`)) return;
    setBusy(`location-${item.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.locationsDelete, {
        UbicacionID: item.id,
        ubicacionId: item.id,
      }, sessionToken);
      if (editor?.type === 'location' && editor.values.id === item.id) setEditor(null);
      await refreshRelations();
    } catch (deleteError) {
      setError(deleteError.message || 'No se pudo eliminar la sede o zona.');
    } finally {
      setBusy('');
    }
  }

  async function removeSupervisor(item) {
    if (!window.confirm(`¿Eliminar al supervisor “${item.nombre || 'Sin nombre'}” de ${clientName}?`)) return;
    setBusy(`supervisor-${item.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.contactsDelete, {
        ContactoID: item.id,
        contactoId: item.id,
      }, sessionToken);
      if (editor?.type === 'supervisor' && editor.values.id === item.id) setEditor(null);
      await refreshRelations();
    } catch (deleteError) {
      setError(deleteError.message || 'No se pudo eliminar el supervisor.');
    } finally {
      setBusy('');
    }
  }

  const saving = busy.startsWith('save-');

  return (
    <section className="client-relations-manager">
      <header className="client-relations-manager__header">
        <div>
          <span className="eyebrow">RELACIONES DEL CLIENTE</span>
          <h3>Administrar sedes, ubicaciones del equipo y supervisores</h3>
          <p>Las ubicaciones del equipo quedan vinculadas a una sede o zona principal del cliente.</p>
        </div>
        <div className="client-relations-manager__counts" aria-label="Resumen de relaciones">
          <span><strong>{locationItems.length}</strong> sedes</span>
          <span><strong>{equipmentItems.length}</strong> ubicaciones del equipo</span>
          <span><strong>{supervisorItems.length}</strong> supervisores</span>
        </div>
      </header>

      <div className="client-relations-manager__toolbar">
        <button className="button button--primary button--compact" type="button" onClick={() => editLocation()} disabled={Boolean(busy)}><Icon name="add_location_alt" />Agregar sede o zona</button>
        <button className="button button--secondary button--compact" type="button" onClick={() => editEquipment()} disabled={Boolean(busy) || !locationItems.length}><Icon name="add_location" />Agregar ubicación del equipo</button>
        <button className="button button--secondary button--compact" type="button" onClick={() => editSupervisor()} disabled={Boolean(busy)}><Icon name="person_add" />Agregar supervisor</button>
      </div>

      {error && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{error}</span></div>}

      {editor && (
        <form className="client-relation-editor" onSubmit={saveEditor}>
          <div className="client-relation-editor__heading">
            <div>
              <span className="eyebrow">{editor.values.id ? 'EDITAR' : 'NUEVO REGISTRO'}</span>
              <h4>{editor.type === 'location' ? 'Sede o zona principal' : editor.type === 'equipment' ? 'Ubicación del equipo' : 'Supervisor'}</h4>
            </div>
            <button className="icon-button" type="button" onClick={() => { setEditor(null); setError(''); }} disabled={saving} aria-label="Cerrar formulario"><Icon name="close" /></button>
          </div>

          <div className="client-relation-editor__grid">
            <label className="field-group"><span className="field-label">Nombre *</span><input className="form-control" value={editor.values.nombre} onChange={(event) => updateEditor({ nombre: event.target.value })} required /></label>
            {editor.type === 'equipment' && <label className="field-group"><span className="field-label">Sede o zona principal *</span><select className="form-control" value={editor.values.parentId} onChange={(event) => updateEditor({ parentId: event.target.value })} required><option value="">Seleccione una opción</option>{locationItems.map((location) => <option key={location.id} value={location.id}>{location.nombre || 'Sin nombre'}</option>)}</select></label>}
            {editor.type === 'supervisor' && <>
              <label className="field-group"><span className="field-label">Puesto</span><input className="form-control" value={editor.values.puesto} onChange={(event) => updateEditor({ puesto: event.target.value })} /></label>
              <label className="field-group"><span className="field-label">Correo</span><input className="form-control" type="email" value={editor.values.correo} onChange={(event) => updateEditor({ correo: event.target.value })} /></label>
              <label className="field-group"><span className="field-label">Teléfono</span><input className="form-control" type="tel" value={editor.values.telefono} onChange={(event) => updateEditor({ telefono: event.target.value })} /></label>
            </>}
            {editor.type === 'location' && <>
              <label className="field-group"><span className="field-label">Dirección</span><input className="form-control" value={editor.values.direccion} onChange={(event) => updateEditor({ direccion: event.target.value })} /></label>
              <label className="field-group is-wide"><span className="field-label">Notas</span><textarea className="form-control ticket-textarea" rows="3" value={editor.values.notas} onChange={(event) => updateEditor({ notas: event.target.value })} /></label>
            </>}
            {editor.type === 'equipment' && <label className="field-group is-wide"><span className="field-label">Descripción</span><textarea className="form-control ticket-textarea" rows="3" value={editor.values.descripcion} onChange={(event) => updateEditor({ descripcion: event.target.value })} /></label>}
            <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={editor.values.status} onChange={(event) => updateEditor({ status: event.target.value })}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
          </div>

          {editor.type === 'supervisor' && <label className="check-card client-relation-editor__check"><input type="checkbox" checked={Boolean(editor.values.recibeCorreo)} onChange={(event) => updateEditor({ recibeCorreo: event.target.checked })} /><Icon name={editor.values.recibeCorreo ? 'check_box' : 'check_box_outline_blank'} /><div><strong>Recibe correos</strong><small>Incluir a este supervisor en las notificaciones del cliente.</small></div></label>}

          <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setEditor(null)} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}><Icon name={saving ? 'progress_activity' : 'save'} />{saving ? 'Guardando...' : 'Guardar'}</button></div>
        </form>
      )}

      <div className="client-relations-manager__grid">
        <section className="client-relations-group client-relations-group--locations">
          <header><div><h4>Sedes y ubicaciones del equipo</h4><p>Cada ubicación del equipo aparece debajo de su sede o zona principal.</p></div><span className="status-chip status-chip--neutral">{locationItems.length}</span></header>
          <div className="client-relations-group__content">
            {locationItems.map((location) => {
              const children = equipmentByLocation.get(location.id) || [];
              const opened = openLocations.has(location.id);
              return <article className="client-site-card" key={location.id}>
                <div className="client-site-card__main">
                  <button className="client-site-card__toggle" type="button" onClick={() => toggleLocation(location.id)} aria-expanded={opened} aria-label={`${opened ? 'Ocultar' : 'Mostrar'} ubicaciones del equipo de ${location.nombre}`}><span><Icon name="location_city" /></span><Icon name={opened ? 'expand_less' : 'expand_more'} /></button>
                  <div className="client-site-card__body"><div><strong>{location.nombre || 'Sin nombre'}</strong><span className={`status-chip ${location.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{location.status}</span></div><span>{location.direccion || 'Sin dirección'}</span>{location.notas && <small>{location.notas}</small>}<small>{children.length} ubicación{children.length === 1 ? '' : 'es'} del equipo</small></div>
                  <div className="client-relation-actions"><button className="icon-button icon-button--outlined" type="button" onClick={() => editEquipment(undefined, location.id)} disabled={Boolean(busy)} aria-label={`Agregar ubicación del equipo en ${location.nombre}`}><Icon name="add_location" /></button><button className="icon-button icon-button--outlined" type="button" onClick={() => editLocation(location)} disabled={Boolean(busy)} aria-label={`Editar ${location.nombre}`}><Icon name="edit" /></button><button className="icon-button icon-button--danger" type="button" onClick={() => removeLocation(location)} disabled={Boolean(busy)} aria-label={`Eliminar ${location.nombre}`}><Icon name={busy === `location-${location.id}` ? 'progress_activity' : 'delete'} /></button></div>
                </div>
                {opened && <div className="client-site-card__equipment">
                  {children.length ? children.map((item) => <article className="client-equipment-relation-card" key={item.id}><span className="client-equipment-relation-card__icon"><Icon name="my_location" /></span><div><div><strong>{item.nombre || 'Sin nombre'}</strong><span className={`status-chip ${item.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status}</span></div><small>{item.descripcion || 'Sin descripción'}</small></div><div className="client-relation-actions"><button className="icon-button icon-button--outlined" type="button" onClick={() => editEquipment(item, location.id)} disabled={Boolean(busy)} aria-label={`Editar ${item.nombre}`}><Icon name="edit" /></button><button className="icon-button icon-button--danger" type="button" onClick={() => removeEquipment(item)} disabled={Boolean(busy)} aria-label={`Eliminar ${item.nombre}`}><Icon name={busy === `equipment-${item.id}` ? 'progress_activity' : 'delete'} /></button></div></article>) : <div className="client-relations-empty"><Icon name="location_off" /><span>Esta sede todavía no tiene ubicaciones del equipo.</span><button className="button button--secondary button--compact" type="button" onClick={() => editEquipment(undefined, location.id)} disabled={Boolean(busy)}>Agregar ubicación</button></div>}
                </div>}
              </article>;
            })}
            {!locationItems.length && <div className="client-relations-empty"><Icon name="location_off" /><span>Este cliente todavía no tiene sedes o zonas registradas.</span><button className="button button--primary button--compact" type="button" onClick={() => editLocation()} disabled={Boolean(busy)}>Agregar la primera</button></div>}
          </div>
        </section>

        <section className="client-relations-group client-relations-group--supervisors">
          <header><div><h4>Supervisores</h4><p>Personas relacionadas con boletas, firmas y notificaciones.</p></div><span className="status-chip status-chip--neutral">{supervisorItems.length}</span></header>
          <div className="client-relations-group__content client-relations-group__content--supervisors">
            {supervisorItems.map((item) => <article className="client-supervisor-relation-card" key={item.id}><span className="client-supervisor-relation-card__avatar"><Icon name="person" /></span><div><div><strong>{item.nombre || 'Sin nombre'}</strong><span className={`status-chip ${item.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status}</span></div><span>{item.puesto || 'Sin puesto'}</span><small>{[item.correo, item.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small><small><Icon name={item.recibeCorreo ? 'notifications_active' : 'notifications_off'} /> {item.recibeCorreo ? 'Recibe correos' : 'No recibe correos'}</small></div><div className="client-relation-actions"><button className="icon-button icon-button--outlined" type="button" onClick={() => editSupervisor(item)} disabled={Boolean(busy)} aria-label={`Editar ${item.nombre}`}><Icon name="edit" /></button><button className="icon-button icon-button--danger" type="button" onClick={() => removeSupervisor(item)} disabled={Boolean(busy)} aria-label={`Eliminar ${item.nombre}`}><Icon name={busy === `supervisor-${item.id}` ? 'progress_activity' : 'delete'} /></button></div></article>)}
            {!supervisorItems.length && <div className="client-relations-empty"><Icon name="person_off" /><span>Este cliente todavía no tiene supervisores registrados.</span><button className="button button--primary button--compact" type="button" onClick={() => editSupervisor()} disabled={Boolean(busy)}>Agregar el primero</button></div>}
          </div>
        </section>
      </div>
    </section>
  );
}
