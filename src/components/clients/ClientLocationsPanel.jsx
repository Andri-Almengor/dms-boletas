import React, { useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const EMPTY_LOCATION = {
  id: '',
  nombre: '',
  direccion: '',
  notas: '',
  status: 'ACTIVO',
};

const EMPTY_EQUIPMENT_LOCATION = {
  id: '',
  nombre: '',
  descripcion: '',
  parentId: '',
  originalParentId: '',
  anchorId: '',
  status: 'ACTIVO',
};

function recordStatus(record) {
  if (record?.Activo === false || record?.activo === false) return 'INACTIVO';
  return String(pick(record, ['Estado', 'estado'], 'ACTIVO')).toUpperCase();
}

function locationView(record) {
  return {
    id: pick(record, ['UbicacionID', 'ubicacionId', 'id']),
    nombre: pick(record, ['Nombre', 'nombre']),
    direccion: pick(record, ['Direccion', 'Dirección', 'direccion']),
    notas: pick(record, ['Notas', 'notas']),
    status: recordStatus(record),
  };
}

function equipmentLocationView(record, fallbackParentId = '') {
  return {
    id: pick(record, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id']),
    nombre: pick(record, ['Nombre', 'nombre']),
    descripcion: pick(record, ['Descripcion', 'Descripción', 'descripcion']),
    parentId: pick(record, ['UbicacionID', 'ubicacionId'], fallbackParentId),
    status: recordStatus(record),
  };
}

export default function ClientLocationsPanel({ clientId, clientName }) {
  const { sessionToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [locationForm, setLocationForm] = useState(null);
  const [equipmentForm, setEquipmentForm] = useState(null);
  const [equipmentByLocation, setEquipmentByLocation] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingEquipment, setLoadingEquipment] = useState({});
  const [savingScope, setSavingScope] = useState('');
  const [error, setError] = useState('');

  const saving = Boolean(savingScope);

  async function loadLocations() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.locationsList, {
        clienteId: clientId,
        page: 1,
        pageSize: 500,
        includeInactive: true,
        sortBy: 'Nombre',
        sortDir: 'asc',
      }, sessionToken);
      setItems(normalizeItems(data));
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadEquipment(locationId) {
    setLoadingEquipment((current) => ({ ...current, [locationId]: true }));
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsList, {
        ubicacionId: locationId,
        UbicacionID: locationId,
        page: 1,
        pageSize: 500,
        includeInactive: true,
        sortBy: 'Nombre',
        sortDir: 'asc',
      }, sessionToken);
      setEquipmentByLocation((current) => ({ ...current, [locationId]: normalizeItems(data) }));
    } catch (err) {
      setError(err.message);
      setEquipmentByLocation((current) => ({ ...current, [locationId]: [] }));
    } finally {
      setLoadingEquipment((current) => ({ ...current, [locationId]: false }));
    }
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      setLocationForm(null);
      setEquipmentForm(null);
      setError('');
      return;
    }
    setOpen(true);
    await loadLocations();
  }

  async function toggleEquipment(locationId) {
    const willOpen = !expanded[locationId];
    setExpanded((current) => ({ ...current, [locationId]: willOpen }));
    if (willOpen && !Object.prototype.hasOwnProperty.call(equipmentByLocation, locationId)) {
      await loadEquipment(locationId);
    }
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
    setEquipmentForm({
      ...view,
      originalParentId: view.parentId,
      anchorId: parentId,
    });
    setLocationForm(null);
    setExpanded((current) => ({ ...current, [parentId]: true }));
    setError('');
  }

  async function saveLocation(event) {
    event.preventDefault();
    if (!locationForm?.nombre.trim()) {
      setError('El nombre de la ubicación es obligatorio.');
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
        status: locationForm.status,
        Activo: locationForm.status === 'ACTIVO',
        activo: locationForm.status === 'ACTIVO',
      };
      await requestAvailable(
        locationForm.id ? MODULE_ROUTES.clients.locationsUpdate : MODULE_ROUTES.clients.locationsCreate,
        payload,
        sessionToken,
      );
      setLocationForm(null);
      await loadLocations();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  async function saveEquipment(event) {
    event.preventDefault();
    if (!equipmentForm?.nombre.trim()) {
      setError('El nombre de la ubicación del dispositivo es obligatorio.');
      return;
    }
    if (!equipmentForm.parentId) {
      setError('Seleccione la ubicación principal a la que pertenece.');
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
        status: equipmentForm.status,
        Activo: equipmentForm.status === 'ACTIVO',
        activo: equipmentForm.status === 'ACTIVO',
      };
      await requestAvailable(
        equipmentForm.id ? MODULE_ROUTES.clients.equipmentLocationsUpdate : MODULE_ROUTES.clients.equipmentLocationsCreate,
        payload,
        sessionToken,
      );

      const locationsToRefresh = new Set([
        equipmentForm.originalParentId,
        equipmentForm.parentId,
      ].filter(Boolean));
      const selectedParent = equipmentForm.parentId;
      setEquipmentForm(null);
      setExpanded((current) => ({ ...current, [selectedParent]: true }));
      await Promise.all([...locationsToRefresh].map((locationId) => loadEquipment(locationId)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScope('');
    }
  }

  return (
    <section className={`client-locations${open ? ' is-open' : ''}`}>
      <button className="client-locations__toggle" type="button" onClick={toggle} aria-expanded={open}>
        <span><Icon name="location_city" /> Ubicaciones</span>
        <span>{open ? 'Ocultar' : 'Administrar'} <Icon name={open ? 'expand_less' : 'expand_more'} /></span>
      </button>

      {open && (
        <div className="client-locations__content">
          <div className="client-locations__heading">
            <div>
              <strong>Ubicaciones de {clientName}</strong>
              <small>Relaciona cada sede con las ubicaciones específicas de sus dispositivos.</small>
            </div>
            <button className="button button--primary button--compact client-relations__add" type="button" onClick={openLocationCreate} disabled={saving}>
              <Icon name="add_location_alt" /> Agregar
            </button>
          </div>

          {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

          {locationForm && (
            <form className="client-location-form" onSubmit={saveLocation}>
              <div className="client-location-form__title">
                <div>
                  <strong>{locationForm.id ? 'Editar ubicación' : 'Agregar ubicación'}</strong>
                  <small>Esta ubicación quedará ligada al cliente seleccionado.</small>
                </div>
                <button className="icon-button" type="button" onClick={() => { setLocationForm(null); setError(''); }} aria-label="Cerrar formulario">
                  <Icon name="close" />
                </button>
              </div>
              <div className="client-location-form__grid">
                <label className="field-group">
                  <span className="field-label">Nombre</span>
                  <input className="form-control" value={locationForm.nombre} onChange={(event) => setLocationForm((current) => ({ ...current, nombre: event.target.value }))} required />
                </label>
                <label className="field-group">
                  <span className="field-label">Estado</span>
                  <select className="form-control" value={locationForm.status} onChange={(event) => setLocationForm((current) => ({ ...current, status: event.target.value }))}>
                    <option value="ACTIVO">ACTIVO</option>
                    <option value="INACTIVO">INACTIVO</option>
                  </select>
                </label>
                <label className="field-group is-wide">
                  <span className="field-label">Dirección</span>
                  <input className="form-control" value={locationForm.direccion} onChange={(event) => setLocationForm((current) => ({ ...current, direccion: event.target.value }))} />
                </label>
                <label className="field-group is-wide">
                  <span className="field-label">Notas</span>
                  <textarea className="form-control ticket-textarea" rows="3" value={locationForm.notas} onChange={(event) => setLocationForm((current) => ({ ...current, notas: event.target.value }))} />
                </label>
              </div>
              <div className="form-actions">
                <button className="button button--secondary" type="button" onClick={() => setLocationForm(null)} disabled={saving}>Cancelar</button>
                <button className="button button--primary" disabled={saving}>{savingScope === 'location' ? 'Guardando...' : 'Guardar ubicación'}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando ubicaciones...</span></div>
          ) : items.length ? (
            <div className="client-locations__list">
              {items.map((record) => {
                const view = locationView(record);
                const isExpanded = Boolean(expanded[view.id]);
                const equipmentItems = equipmentByLocation[view.id] || [];
                return (
                  <article className="client-location-card" key={view.id}>
                    <div className="client-location-card__main">
                      <span className="client-location-card__icon"><Icon name="location_on" /></span>
                      <div className="client-location-card__body">
                        <div className="client-location-card__title">
                          <strong>{view.nombre || 'Sin nombre'}</strong>
                          <span className={`status-chip ${view.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{view.status}</span>
                        </div>
                        <span>{view.direccion || 'Sin dirección registrada'}</span>
                        {view.notas && <small>{view.notas}</small>}
                      </div>
                      <div className="client-location-card__actions">
                        <button className="icon-button icon-button--outlined" type="button" onClick={() => editLocation(record)} disabled={saving} aria-label={`Editar ${view.nombre}`}><Icon name="edit" /></button>
                        <button className="icon-button icon-button--outlined" type="button" onClick={() => toggleEquipment(view.id)} disabled={saving} aria-label={`${isExpanded ? 'Ocultar' : 'Mostrar'} ubicaciones de dispositivos de ${view.nombre}`}><Icon name={isExpanded ? 'expand_less' : 'account_tree'} /></button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="client-equipment-locations">
                        <div className="client-equipment-locations__heading">
                          <div>
                            <strong>Ubicaciones de dispositivos</strong>
                            <small>Equipos relacionados con {view.nombre}.</small>
                          </div>
                          <button className="button button--secondary button--compact" type="button" onClick={() => openEquipmentCreate(view)} disabled={saving}>
                            <Icon name="add" /> Agregar
                          </button>
                        </div>

                        {equipmentForm?.anchorId === view.id && (
                          <form className="client-equipment-location-form" onSubmit={saveEquipment}>
                            <div className="client-location-form__title">
                              <div>
                                <strong>{equipmentForm.id ? 'Editar ubicación del dispositivo' : 'Agregar ubicación del dispositivo'}</strong>
                                <small>La ubicación padre define la relación dentro del cliente.</small>
                              </div>
                              <button className="icon-button" type="button" onClick={() => { setEquipmentForm(null); setError(''); }} aria-label="Cerrar formulario">
                                <Icon name="close" />
                              </button>
                            </div>
                            <div className="client-location-form__grid">
                              <label className="field-group">
                                <span className="field-label">Nombre</span>
                                <input className="form-control" value={equipmentForm.nombre} onChange={(event) => setEquipmentForm((current) => ({ ...current, nombre: event.target.value }))} required />
                              </label>
                              <label className="field-group">
                                <span className="field-label">Ubicación padre</span>
                                <select className="form-control" value={equipmentForm.parentId} onChange={(event) => setEquipmentForm((current) => ({ ...current, parentId: event.target.value }))} required>
                                  {items.map((locationRecord) => {
                                    const option = locationView(locationRecord);
                                    return <option key={option.id} value={option.id}>{option.nombre || 'Sin nombre'}{option.status === 'INACTIVO' ? ' (INACTIVA)' : ''}</option>;
                                  })}
                                </select>
                              </label>
                              <label className="field-group">
                                <span className="field-label">Estado</span>
                                <select className="form-control" value={equipmentForm.status} onChange={(event) => setEquipmentForm((current) => ({ ...current, status: event.target.value }))}>
                                  <option value="ACTIVO">ACTIVO</option>
                                  <option value="INACTIVO">INACTIVO</option>
                                </select>
                              </label>
                              <label className="field-group is-wide">
                                <span className="field-label">Descripción</span>
                                <textarea className="form-control ticket-textarea" rows="3" value={equipmentForm.descripcion} onChange={(event) => setEquipmentForm((current) => ({ ...current, descripcion: event.target.value }))} />
                              </label>
                            </div>
                            <div className="form-actions">
                              <button className="button button--secondary" type="button" onClick={() => setEquipmentForm(null)} disabled={saving}>Cancelar</button>
                              <button className="button button--primary" disabled={saving}>{savingScope === 'equipment' ? 'Guardando...' : 'Guardar relación'}</button>
                            </div>
                          </form>
                        )}

                        {loadingEquipment[view.id] ? (
                          <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando ubicaciones de dispositivos...</span></div>
                        ) : equipmentItems.length ? (
                          <div className="client-equipment-locations__list">
                            {equipmentItems.map((equipmentRecord) => {
                              const equipmentView = equipmentLocationView(equipmentRecord, view.id);
                              return (
                                <article className="client-equipment-location-card" key={equipmentView.id}>
                                  <span><Icon name="my_location" /></span>
                                  <div>
                                    <div>
                                      <strong>{equipmentView.nombre || 'Sin nombre'}</strong>
                                      <span className={`status-chip ${equipmentView.status === 'INACTIVO' ? 'status-chip--inactive' : 'status-chip--active'}`}>{equipmentView.status}</span>
                                    </div>
                                    <small>{equipmentView.descripcion || 'Sin descripción'}</small>
                                  </div>
                                  <button className="icon-button icon-button--outlined" type="button" onClick={() => editEquipment(equipmentRecord, view.id)} disabled={saving} aria-label={`Editar ${equipmentView.nombre}`}><Icon name="edit" /></button>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="client-locations__empty"><Icon name="location_off" /><span>Esta ubicación todavía no tiene ubicaciones de dispositivos relacionadas.</span></div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="client-locations__empty"><Icon name="location_off" /><span>Este cliente todavía no tiene ubicaciones registradas.</span></div>
          )}
        </div>
      )}
    </section>
  );
}
