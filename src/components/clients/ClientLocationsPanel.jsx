import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const EMPTY_LOCATION = { id: '', nombre: '', direccion: '', notas: '', status: 'ACTIVO' };
const EMPTY_EQUIPMENT_LOCATION = {
  id: '', nombre: '', descripcion: '', parentId: '', originalParentId: '', anchorId: '', status: 'ACTIVO',
};

function unwrap(response) {
  return response?.item || response?.data || response;
}

function recordStatus(record) {
  if (record?.Activo === false || record?.activo === false) return 'INACTIVO';
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

function equipmentLocationView(record = {}, fallbackParentId = '') {
  return {
    id: String(pick(record, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id'], '')),
    nombre: pick(record, ['Nombre', 'nombre']),
    descripcion: pick(record, ['Descripcion', 'Descripción', 'descripcion']),
    parentId: String(pick(record, ['UbicacionID', 'ubicacionId'], fallbackParentId)),
    status: recordStatus(record),
  };
}

function groupEquipment(items = []) {
  return items.reduce((groups, record) => {
    const parentId = String(pick(record, ['UbicacionID', 'ubicacionId'], ''));
    if (!parentId) return groups;
    groups[parentId] = [...(groups[parentId] || []), record];
    return groups;
  }, {});
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default function ClientLocationsPanel({
  clientId,
  clientName,
  embedded = false,
  canDelete = false,
  initialLocations = [],
  initialEquipment = [],
  onChanged,
}) {
  const { sessionToken } = useAuth();
  const [open, setOpen] = useState(embedded);
  const [items, setItems] = useState(initialLocations);
  const [locationForm, setLocationForm] = useState(null);
  const [equipmentForm, setEquipmentForm] = useState(null);
  const [equipmentByLocation, setEquipmentByLocation] = useState(() => groupEquipment(initialEquipment));
  const [expanded, setExpanded] = useState(() => Object.fromEntries(initialLocations.map((record) => [locationView(record).id, embedded])));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingScope, setSavingScope] = useState('');
  const [error, setError] = useState('');

  const saving = Boolean(savingScope);

  useEffect(() => {
    setItems(initialLocations);
    setEquipmentByLocation(groupEquipment(initialEquipment));
    setExpanded((current) => {
      const next = { ...current };
      initialLocations.forEach((record) => {
        const id = locationView(record).id;
        if (!(id in next)) next[id] = embedded;
      });
      return next;
    });
  }, [initialLocations, initialEquipment, embedded]);

  useEffect(() => {
    setOpen(embedded);
    setLocationForm(null);
    setEquipmentForm(null);
    setQuery('');
    setError('');
  }, [clientId, embedded]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [locationsData, equipmentData] = await Promise.all([
        requestAvailable(MODULE_ROUTES.clients.locationsList, {
          clienteId: clientId, page: 1, pageSize: 1000, includeInactive: true, sortBy: 'Nombre', sortDir: 'asc',
        }, sessionToken),
        requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, {
          page: 1, pageSize: 3000, includeInactive: true, sortBy: 'Nombre', sortDir: 'asc',
        }, sessionToken),
      ]);
      const locations = normalizeItems(locationsData);
      const ids = new Set(locations.map((record) => locationView(record).id));
      const equipment = normalizeItems(equipmentData).filter((record) => ids.has(equipmentLocationView(record).parentId));
      setItems(locations);
      setEquipmentByLocation(groupEquipment(equipment));
      setExpanded(Object.fromEntries(locations.map((record) => [locationView(record).id, embedded])));
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
      setLocationForm(null);
      setEquipmentForm(null);
      setError('');
      return;
    }
    setOpen(true);
    await loadAll();
  }

  function openLocationCreate() {
    setLocationForm({ ...EMPTY_LOCATION });
    setEquipmentForm(null);
    setError('');
  }

  function editLocation(record) {
    setLocationForm(locationView(record));
    setEquipmentForm(null);
    setError('');
  }

  function openEquipmentCreate(location) {
    setEquipmentForm({
      ...EMPTY_EQUIPMENT_LOCATION,
      parentId: location.id,
      originalParentId: location.id,
      anchorId: location.id,
    });
    setLocationForm(null);
    setExpanded((current) => ({ ...current, [location.id]: true }));
    setError('');
  }

  function editEquipment(record, parentId) {
    const view = equipmentLocationView(record, parentId);
    setEquipmentForm({ ...view, originalParentId: view.parentId, anchorId: parentId });
    setLocationForm(null);
    setExpanded((current) => ({ ...current, [parentId]: true }));
    setError('');
  }

  async function saveLocation(event) {
    event.preventDefault();
    if (!locationForm?.nombre.trim()) {
      setError('El nombre de la sede es obligatorio.');
      return;
    }
    setSavingScope('location');
    setError('');
    try {
      const payload = {
        UbicacionID: locationForm.id,
        ubicacionId: locationForm.id,
        ClienteID: clientId,
        clienteId: clientId,
        Nombre: locationForm.nombre.trim(),
        nombre: locationForm.nombre.trim(),
        Direccion: locationForm.direccion.trim(),
        direccion: locationForm.direccion.trim(),
        Notas: locationForm.notas.trim(),
        notas: locationForm.notas.trim(),
        Estado: locationForm.status,
        Activo: locationForm.status === 'ACTIVO',
      };
      const saved = unwrap(await requestAvailable(
        locationForm.id ? MODULE_ROUTES.clients.locationsUpdate : MODULE_ROUTES.clients.locationsCreate,
        payload,
        sessionToken,
      ));
      const savedView = locationView(saved);
      setItems((current) => {
        const exists = current.some((record) => locationView(record).id === savedView.id);
        return exists
          ? current.map((record) => locationView(record).id === savedView.id ? saved : record)
          : [...current, saved].sort((left, right) => locationView(left).nombre.localeCompare(locationView(right).nombre, 'es'));
      });
      setExpanded((current) => ({ ...current, [savedView.id]: true }));
      setLocationForm(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  async function saveEquipment(event) {
    event.preventDefault();
    if (!equipmentForm?.nombre.trim()) {
      setError('El nombre de la zona del equipo es obligatorio.');
      return;
    }
    if (!equipmentForm.parentId) {
      setError('Seleccione la sede principal a la que pertenece.');
      return;
    }
    setSavingScope('equipment');
    setError('');
    try {
      const payload = {
        UbicacionEquipoID: equipmentForm.id,
        ubicacionEquipoId: equipmentForm.id,
        UbicacionID: equipmentForm.parentId,
        ubicacionId: equipmentForm.parentId,
        Nombre: equipmentForm.nombre.trim(),
        nombre: equipmentForm.nombre.trim(),
        Descripcion: equipmentForm.descripcion.trim(),
        descripcion: equipmentForm.descripcion.trim(),
        Estado: equipmentForm.status,
        Activo: equipmentForm.status === 'ACTIVO',
      };
      const saved = unwrap(await requestAvailable(
        equipmentForm.id ? MODULE_ROUTES.clients.equipmentLocationsUpdate : MODULE_ROUTES.clients.equipmentLocationsCreate,
        payload,
        sessionToken,
      ));
      const savedView = equipmentLocationView(saved, equipmentForm.parentId);
      setEquipmentByLocation((current) => {
        const next = Object.fromEntries(Object.entries(current).map(([key, records]) => [
          key,
          records.filter((record) => equipmentLocationView(record, key).id !== savedView.id),
        ]));
        next[savedView.parentId] = [...(next[savedView.parentId] || []), saved]
          .sort((left, right) => equipmentLocationView(left).nombre.localeCompare(equipmentLocationView(right).nombre, 'es'));
        return next;
      });
      setExpanded((current) => ({ ...current, [savedView.parentId]: true }));
      setEquipmentForm(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  async function removeEquipment(record, parentId) {
    if (!canDelete) return;
    const view = equipmentLocationView(record, parentId);
    if (!window.confirm(`¿Eliminar la zona de equipo “${view.nombre || 'Sin nombre'}”? La eliminación será lógica y los registros históricos conservarán su referencia.`)) return;
    setSavingScope(`equipment-delete:${view.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsDelete, {
        UbicacionEquipoID: view.id,
        ubicacionEquipoId: view.id,
      }, sessionToken);
      setEquipmentByLocation((current) => ({
        ...current,
        [parentId]: (current[parentId] || []).filter((item) => equipmentLocationView(item, parentId).id !== view.id),
      }));
      if (equipmentForm?.id === view.id) setEquipmentForm(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  async function removeLocation(record) {
    if (!canDelete) return;
    const view = locationView(record);
    const activeChildren = (equipmentByLocation[view.id] || []).filter((item) => equipmentLocationView(item, view.id).status !== 'INACTIVO');
    if (activeChildren.length) {
      setExpanded((current) => ({ ...current, [view.id]: true }));
      setError(`La sede “${view.nombre || 'Sin nombre'}” tiene ${activeChildren.length} zona(s) activa(s). Elimine o desactive primero esas zonas para evitar relaciones huérfanas.`);
      return;
    }
    if (!window.confirm(`¿Eliminar la sede “${view.nombre || 'Sin nombre'}”? La eliminación será lógica y los registros históricos conservarán su referencia.`)) return;
    setSavingScope(`location-delete:${view.id}`);
    setError('');
    try {
      await requestAvailable(MODULE_ROUTES.clients.locationsDelete, {
        UbicacionID: view.id,
        ubicacionId: view.id,
      }, sessionToken);
      setItems((current) => current.filter((item) => locationView(item).id !== view.id));
      setEquipmentByLocation((current) => {
        const next = { ...current };
        delete next[view.id];
        return next;
      });
      setExpanded((current) => {
        const next = { ...current };
        delete next[view.id];
        return next;
      });
      if (locationForm?.id === view.id) setLocationForm(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  const visibleItems = useMemo(() => {
    const term = normalized(query);
    if (!term) return items;
    return items.filter((record) => {
      const view = locationView(record);
      const equipmentText = (equipmentByLocation[view.id] || [])
        .map((item) => {
          const equipment = equipmentLocationView(item, view.id);
          return `${equipment.nombre} ${equipment.descripcion} ${equipment.status}`;
        }).join(' ');
      return normalized(`${view.nombre} ${view.direccion} ${view.notas} ${view.status} ${equipmentText}`).includes(term);
    });
  }, [items, equipmentByLocation, query]);

  const allVisibleExpanded = visibleItems.length > 0 && visibleItems.every((record) => expanded[locationView(record).id]);
  const totalEquipment = Object.values(equipmentByLocation).reduce((sum, records) => sum + records.length, 0);

  const content = (
    <div className={`client-locations__content${embedded ? ' client-locations__content--embedded' : ''}`}>
      <div className="client-relations-manager__summary">
        <div>
          <strong>Sedes y zonas de {clientName}</strong>
          <small>{items.length} sede{items.length === 1 ? '' : 's'} · {totalEquipment} zona{totalEquipment === 1 ? '' : 's'} de equipos</small>
        </div>
        <div className="client-relations-manager__summary-actions">
          <button className="icon-button icon-button--outlined" type="button" onClick={loadAll} disabled={saving || loading} aria-label="Actualizar sedes y zonas"><Icon name="refresh" /></button>
          <button className="button button--primary button--compact" type="button" onClick={openLocationCreate} disabled={saving}><Icon name="add_location_alt" />Agregar sede</button>
        </div>
      </div>

      <div className="client-relations-manager__toolbar">
        <label className="client-relations-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar sede, zona, dirección o descripción..." /></label>
        <button className="button button--secondary button--compact" type="button" disabled={!visibleItems.length} onClick={() => setExpanded((current) => ({
          ...current,
          ...Object.fromEntries(visibleItems.map((record) => [locationView(record).id, !allVisibleExpanded])),
        }))}><Icon name={allVisibleExpanded ? 'unfold_less' : 'unfold_more'} />{allVisibleExpanded ? 'Contraer todo' : 'Ver todas las zonas'}</button>
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {locationForm && (
        <form className="client-location-form" onSubmit={saveLocation}>
          <div className="client-location-form__title">
            <div><strong>{locationForm.id ? 'Editar sede' : 'Agregar sede'}</strong><small>La sede quedará ligada al cliente seleccionado.</small></div>
            <button className="icon-button" type="button" onClick={() => { setLocationForm(null); setError(''); }} aria-label="Cerrar formulario"><Icon name="close" /></button>
          </div>
          <div className="client-location-form__grid">
            <label className="field-group"><span className="field-label">Nombre</span><input className="form-control" value={locationForm.nombre} onChange={(event) => setLocationForm((current) => ({ ...current, nombre: event.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={locationForm.status} onChange={(event) => setLocationForm((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
            <label className="field-group is-wide"><span className="field-label">Dirección</span><input className="form-control" value={locationForm.direccion} onChange={(event) => setLocationForm((current) => ({ ...current, direccion: event.target.value }))} /></label>
            <label className="field-group is-wide"><span className="field-label">Notas</span><textarea className="form-control ticket-textarea" rows="3" value={locationForm.notas} onChange={(event) => setLocationForm((current) => ({ ...current, notas: event.target.value }))} /></label>
          </div>
          <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setLocationForm(null)} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{savingScope === 'location' ? 'Guardando...' : 'Guardar sede'}</button></div>
        </form>
      )}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando sedes y zonas...</span></div>
      ) : visibleItems.length ? (
        <div className="client-locations__list">
          {visibleItems.map((record) => {
            const view = locationView(record);
            const isExpanded = Boolean(expanded[view.id]);
            const equipmentItems = equipmentByLocation[view.id] || [];
            return (
              <article className={`client-location-card${view.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={view.id}>
                <div className="client-location-card__main">
                  <span className="client-location-card__icon"><Icon name="location_on" /></span>
                  <div className="client-location-card__body">
                    <div className="client-location-card__title"><strong>{view.nombre || 'Sin nombre'}</strong><span className={`status-chip ${view.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{view.status}</span></div>
                    <span>{view.direccion || 'Sin dirección registrada'}</span>
                    <small>{equipmentItems.length} zona{equipmentItems.length === 1 ? '' : 's'} de equipos{view.notas ? ` · ${view.notas}` : ''}</small>
                  </div>
                  <div className="client-location-card__actions">
                    <button className="icon-button icon-button--outlined" type="button" onClick={() => editLocation(record)} disabled={saving} aria-label={`Editar ${view.nombre}`}><Icon name="edit" /></button>
                    {canDelete && <button className="icon-button icon-button--danger" type="button" onClick={() => removeLocation(record)} disabled={saving} aria-label={`Eliminar ${view.nombre}`}><Icon name={savingScope === `location-delete:${view.id}` ? 'progress_activity' : 'delete'} /></button>}
                    <button className="icon-button icon-button--outlined" type="button" onClick={() => setExpanded((current) => ({ ...current, [view.id]: !isExpanded }))} disabled={saving} aria-label={`${isExpanded ? 'Ocultar' : 'Mostrar'} zonas de ${view.nombre}`}><Icon name={isExpanded ? 'expand_less' : 'account_tree'} /></button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="client-equipment-locations">
                    <div className="client-equipment-locations__heading">
                      <div><strong>Zonas o ubicaciones de equipos</strong><small>Estos valores alimentan el dropdown utilizado en boletas y mantenimientos.</small></div>
                      <button className="button button--secondary button--compact" type="button" onClick={() => openEquipmentCreate(view)} disabled={saving}><Icon name="add" />Agregar zona</button>
                    </div>

                    {equipmentForm?.anchorId === view.id && (
                      <form className="client-equipment-location-form" onSubmit={saveEquipment}>
                        <div className="client-location-form__title">
                          <div><strong>{equipmentForm.id ? 'Editar zona del equipo' : 'Agregar zona del equipo'}</strong><small>La sede padre define dónde aparecerá esta zona.</small></div>
                          <button className="icon-button" type="button" onClick={() => { setEquipmentForm(null); setError(''); }} aria-label="Cerrar formulario"><Icon name="close" /></button>
                        </div>
                        <div className="client-location-form__grid">
                          <label className="field-group"><span className="field-label">Nombre</span><input className="form-control" value={equipmentForm.nombre} onChange={(event) => setEquipmentForm((current) => ({ ...current, nombre: event.target.value }))} required /></label>
                          <label className="field-group"><span className="field-label">Sede padre</span><select className="form-control" value={equipmentForm.parentId} onChange={(event) => setEquipmentForm((current) => ({ ...current, parentId: event.target.value }))} required>{items.map((locationRecord) => { const option = locationView(locationRecord); return <option key={option.id} value={option.id}>{option.nombre || 'Sin nombre'}{option.status === 'INACTIVO' ? ' (INACTIVA)' : ''}</option>; })}</select></label>
                          <label className="field-group"><span className="field-label">Estado</span><select className="form-control" value={equipmentForm.status} onChange={(event) => setEquipmentForm((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
                          <label className="field-group is-wide"><span className="field-label">Descripción</span><textarea className="form-control ticket-textarea" rows="3" value={equipmentForm.descripcion} onChange={(event) => setEquipmentForm((current) => ({ ...current, descripcion: event.target.value }))} /></label>
                        </div>
                        <div className="form-actions"><button className="button button--secondary" type="button" onClick={() => setEquipmentForm(null)} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{savingScope === 'equipment' ? 'Guardando...' : 'Guardar zona'}</button></div>
                      </form>
                    )}

                    {equipmentItems.length ? (
                      <div className="client-equipment-locations__list">
                        {equipmentItems.map((equipmentRecord) => {
                          const equipment = equipmentLocationView(equipmentRecord, view.id);
                          return (
                            <article className={`client-equipment-location-card${equipment.status === 'INACTIVO' ? ' is-inactive' : ''}`} key={equipment.id}>
                              <span><Icon name="my_location" /></span>
                              <div><div><strong>{equipment.nombre || 'Sin nombre'}</strong><span className={`status-chip ${equipment.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{equipment.status}</span></div><small>{equipment.descripcion || 'Sin descripción'}</small></div>
                              <div className="client-equipment-location-card__actions">
                                <button className="icon-button icon-button--outlined" type="button" onClick={() => editEquipment(equipmentRecord, view.id)} disabled={saving} aria-label={`Editar ${equipment.nombre}`}><Icon name="edit" /></button>
                                {canDelete && <button className="icon-button icon-button--danger" type="button" onClick={() => removeEquipment(equipmentRecord, view.id)} disabled={saving} aria-label={`Eliminar ${equipment.nombre}`}><Icon name={savingScope === `equipment-delete:${equipment.id}` ? 'progress_activity' : 'delete'} /></button>}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : <div className="client-locations__empty"><Icon name="location_off" /><span>Esta sede todavía no tiene zonas de equipos relacionadas.</span></div>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="client-locations__empty"><Icon name="location_off" /><span>{items.length ? 'No hay coincidencias con la búsqueda.' : 'Este cliente todavía no tiene sedes registradas.'}</span></div>
      )}
    </div>
  );

  if (embedded) return <section className="client-locations client-locations--embedded is-open">{content}</section>;

  return (
    <section className={`client-locations${open ? ' is-open' : ''}`}>
      <button className="client-locations__toggle" type="button" onClick={toggle} aria-expanded={open}>
        <span><Icon name="location_city" />Ubicaciones</span>
        <span>{open ? 'Ocultar' : 'Administrar'} <Icon name={open ? 'expand_less' : 'expand_more'} /></span>
      </button>
      {open && content}
    </section>
  );
}
