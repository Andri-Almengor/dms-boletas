import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import DependentSelect from '../forms/DependentSelect';
import InlineCreateModal from '../forms/InlineCreateModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const LOCATION_GET_ROUTES = [
  'clientLocations.get',
  'clients.locations.get',
  'clientes.ubicaciones.get',
  'ubicacionesCliente.get',
];

function locationView(row) {
  const id = String(pick(row, ['UbicacionID', 'ubicacionId', 'id', 'RowID'], '')).trim();
  const name = String(pick(row, ['Nombre', 'nombre'], id)).trim();
  return id ? { id, name } : null;
}

function optionFromRow(row, locationMap, fallbackLocationId = '', showParent = false) {
  const value = String(pick(row, ['UbicacionEquipoID', 'ubicacionEquipoId', 'id', 'RowID'], '')).trim();
  const name = String(pick(row, ['Nombre', 'nombre'], value)).trim();
  const parentId = String(pick(row, ['UbicacionID', 'ubicacionId'], fallbackLocationId)).trim();
  const parentName = locationMap.get(parentId)?.name || '';
  const label = showParent && parentName ? `${parentName} · ${name}` : name;
  return value ? {
    value,
    label,
    name,
    locationId: parentId,
    locationName: parentName,
  } : null;
}

function seedOption(option, locationMap, fallbackLocationId = '', showParent = false) {
  const value = String(option?.value || '').trim();
  if (!value) return null;
  const name = String(option?.name || option?.rawLabel || option?.label || value).trim();
  const parentId = String(option?.locationId || fallbackLocationId || '').trim();
  const parentName = String(option?.locationName || locationMap.get(parentId)?.name || '').trim();
  const label = showParent && parentName ? `${parentName} · ${name}` : name;
  return { ...option, value, label, name, locationId: parentId, locationName: parentName };
}

function uniqueOptions(options = []) {
  const seen = new Set();
  return options.filter((option) => {
    const key = String(option?.value || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortOptions(options = [], preferredLocationId = '') {
  return [...options].sort((a, b) => {
    const aPreferred = String(a.locationId || '') === String(preferredLocationId || '') ? 0 : 1;
    const bPreferred = String(b.locationId || '') === String(preferredLocationId || '') ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return String(a.label || '').localeCompare(String(b.label || ''), 'es', { sensitivity: 'base' });
  });
}

export default function MaintenanceEquipmentLocationSelect({
  locationId,
  value,
  options = [],
  disabled = false,
  onChange,
}) {
  const { sessionToken, hasPermission } = useAuth();
  const [loadedOptions, setLoadedOptions] = useState(options);
  const [clientLocations, setClientLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValues, setModalValues] = useState({ nombre: '', descripcion: '', ubicacionId: '' });
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const canManageOperationalData = hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR')
    || hasPermission('CLIENTES_EDITAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR')
    || hasPermission('BOLETAS_EDITAR');

  useEffect(() => {
    if (!sessionToken) {
      setLoadedOptions(options);
      setClientLocations([]);
      return undefined;
    }

    let active = true;

    async function loadClientEquipmentCatalog() {
      setLoading(true);
      try {
        let resolvedClientId = '';
        let locations = [];

        if (locationId) {
          try {
            const currentLocation = await requestAvailable(
              LOCATION_GET_ROUTES,
              { id: locationId, ubicacionId: locationId, UbicacionID: locationId },
              sessionToken,
            );
            resolvedClientId = String(pick(currentLocation, ['ClienteID', 'clienteId'], '')).trim();
          } catch {
            // Se conserva la ubicación actual aunque no sea posible resolver el cliente.
          }
        }

        if (resolvedClientId) {
          const locationData = await requestAvailable(
            MODULE_ROUTES.clients.locationsList,
            { clienteId: resolvedClientId, activo: true, page: 1, pageSize: 1000, sortBy: 'Nombre', sortDir: 'asc' },
            sessionToken,
          );
          locations = normalizeItems(locationData).map(locationView).filter(Boolean);
        }

        if (!locations.length && locationId) {
          locations = [{ id: String(locationId), name: '' }];
        }

        if (!active) return;
        setClientLocations(locations);

        const locationMap = new Map(locations.map((location) => [location.id, location]));
        const showParent = locations.length > 1;
        const results = await Promise.allSettled(locations.map((location) => requestAvailable(
          MODULE_ROUTES.clients.equipmentLocationsList,
          { ubicacionId: location.id, UbicacionID: location.id, activo: true, page: 1, pageSize: 1000, sortBy: 'Nombre', sortDir: 'asc' },
          sessionToken,
        )));

        const fetched = results.flatMap((result, index) => {
          if (result.status !== 'fulfilled') return [];
          const parentId = locations[index]?.id || '';
          return normalizeItems(result.value)
            .map((row) => optionFromRow(row, locationMap, parentId, showParent))
            .filter(Boolean);
        });
        const seeded = options
          .map((option) => seedOption(option, locationMap, locationId, showParent))
          .filter(Boolean);

        if (!active) return;
        setLoadedOptions(sortOptions(uniqueOptions([...fetched, ...seeded]), locationId));
      } catch {
        if (!active) return;
        const fallbackMap = new Map();
        setLoadedOptions(sortOptions(uniqueOptions(options.map((option) => seedOption(option, fallbackMap, locationId, false)).filter(Boolean)), locationId));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadClientEquipmentCatalog();
    return () => { active = false; };
  }, [locationId, sessionToken, options]);

  const currentOptions = useMemo(() => uniqueOptions(loadedOptions), [loadedOptions]);
  const canCreate = canManageOperationalData && clientLocations.length > 0;

  function select(event) {
    const nextValue = String(event.target.value || '');
    const selected = currentOptions.find((option) => option.value === nextValue);
    onChange?.(
      nextValue,
      selected?.name || selected?.label || '',
      selected?.locationId || '',
      selected?.locationName || '',
    );
  }

  function openModal() {
    const selected = currentOptions.find((option) => option.value === String(value || ''));
    const preferredLocationId = selected?.locationId
      || (clientLocations.some((location) => location.id === String(locationId || '')) ? String(locationId) : '')
      || clientLocations[0]?.id
      || '';
    setModalValues({ nombre: '', descripcion: '', ubicacionId: preferredLocationId });
    setModalError('');
    setModalOpen(true);
  }

  async function submitModal(event) {
    event.preventDefault();
    const nombre = modalValues.nombre.trim();
    const parentLocationId = String(modalValues.ubicacionId || '').trim();
    if (!parentLocationId) {
      setModalError('Seleccione la ubicación principal del cliente.');
      return;
    }
    if (!nombre) {
      setModalError('Escriba el nombre de la ubicación del equipo.');
      return;
    }

    setModalSaving(true);
    setModalError('');
    try {
      const result = await requestAvailable(
        MODULE_ROUTES.clients.equipmentLocationsCreate,
        {
          ubicacionId: parentLocationId,
          UbicacionID: parentLocationId,
          nombre,
          Nombre: nombre,
          descripcion: modalValues.descripcion,
          Descripcion: modalValues.descripcion,
          activo: true,
          Activo: true,
        },
        sessionToken,
      );
      const locationMap = new Map(clientLocations.map((location) => [location.id, location]));
      const created = optionFromRow(result, locationMap, parentLocationId, clientLocations.length > 1);
      if (!created) throw new Error('El servidor no devolvió la ubicación creada.');
      setLoadedOptions((current) => sortOptions(uniqueOptions([...current, created]), locationId));
      onChange?.(created.value, created.name, created.locationId, created.locationName);
      setModalOpen(false);

      // Actualiza también el catálogo maestro utilizado por boletas, mantenimientos y modo offline.
      requestAvailable(
        MODULE_ROUTES.clients.equipmentLocationsList,
        { page: 1, pageSize: 1000, activo: true, sortBy: 'Nombre', sortDir: 'asc' },
        sessionToken,
      ).catch(() => {});
      window.dispatchEvent(new CustomEvent('dms-client-equipment-catalog-updated', {
        detail: { locationId: parentLocationId, equipmentLocationId: created.value },
      }));
    } catch (error) {
      setModalError(error.message || 'No se pudo crear la ubicación del equipo.');
    } finally {
      setModalSaving(false);
    }
  }

  const placeholder = loading
    ? 'Cargando ubicaciones del cliente...'
    : clientLocations.length
      ? 'Seleccione una ubicación del equipo'
      : locationId
        ? 'No hay ubicaciones de equipo registradas'
        : 'Seleccione una ubicación general primero';

  return <>
    <DependentSelect
      label="Ubicación del equipo"
      value={value || ''}
      options={currentOptions}
      loading={loading}
      disabled={disabled}
      canAdd={canCreate}
      onAdd={openModal}
      onChange={select}
      placeholder={placeholder}
    />
    <InlineCreateModal
      open={modalOpen}
      title="Agregar ubicación del equipo"
      description="El nuevo valor se guardará en la ficha del cliente y quedará disponible para boletas y mantenimientos."
      saving={modalSaving}
      error={modalError}
      onClose={() => setModalOpen(false)}
      onSubmit={submitModal}
    >
      {clientLocations.length > 0 && (
        <label className="field-group">
          <span className="field-label">Ubicación principal</span>
          <select
            className="form-control"
            value={modalValues.ubicacionId}
            onChange={(event) => setModalValues((current) => ({ ...current, ubicacionId: event.target.value }))}
          >
            {clientLocations.map((location) => <option key={location.id} value={location.id}>{location.name || 'Ubicación del mantenimiento'}</option>)}
          </select>
        </label>
      )}
      <label className="field-group">
        <span className="field-label">Nombre</span>
        <input
          className="form-control"
          value={modalValues.nombre}
          onChange={(event) => setModalValues((current) => ({ ...current, nombre: event.target.value }))}
          autoComplete="off"
        />
      </label>
      <label className="field-group">
        <span className="field-label">Descripción</span>
        <textarea
          className="form-control ticket-textarea"
          rows="4"
          value={modalValues.descripcion}
          onChange={(event) => setModalValues((current) => ({ ...current, descripcion: event.target.value }))}
        />
      </label>
    </InlineCreateModal>
  </>;
}
