import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import DependentSelect from '../forms/DependentSelect';
import InlineCreateModal from '../forms/InlineCreateModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

function toOption(row) {
  const value = String(pick(row, ['UbicacionEquipoID', 'id', 'RowID'], '')).trim();
  const label = String(pick(row, ['Nombre'], value)).trim();
  return value ? { value, label } : null;
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

export default function MaintenanceEquipmentLocationSelect({
  locationId,
  value,
  options = [],
  disabled = false,
  onChange,
}) {
  const { sessionToken, hasPermission } = useAuth();
  const [loadedOptions, setLoadedOptions] = useState(options);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValues, setModalValues] = useState({ nombre: '', descripcion: '' });
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const canCreate = Boolean(locationId) && (
    hasPermission('CLIENTES_DATOS_OPERATIVOS_CREAR')
    || hasPermission('CLIENTES_EDITAR')
    || hasPermission('MANTENIMIENTOS_CREAR')
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('BOLETAS_CREAR')
    || hasPermission('BOLETAS_EDITAR')
  );

  useEffect(() => {
    setLoadedOptions((current) => uniqueOptions([...current, ...options]));
  }, [options]);

  useEffect(() => {
    if (!locationId || !sessionToken) {
      if (!locationId) setLoadedOptions(options);
      return undefined;
    }

    let active = true;
    setLoading(true);
    requestAvailable(
      MODULE_ROUTES.clients.equipmentLocationsList,
      { ubicacionId: locationId, activo: true, page: 1, pageSize: 1000 },
      sessionToken,
    )
      .then((data) => {
        if (!active) return;
        setLoadedOptions(uniqueOptions([
          ...options,
          ...normalizeItems(data).map(toOption).filter(Boolean),
        ]));
      })
      .catch(() => {
        // Las opciones recibidas del formulario siguen disponibles aunque falle la recarga.
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [locationId, sessionToken, options]);

  const currentOptions = useMemo(() => uniqueOptions(loadedOptions), [loadedOptions]);

  function select(event) {
    const nextValue = String(event.target.value || '');
    const selected = currentOptions.find((option) => option.value === nextValue);
    onChange?.(nextValue, selected?.label || '');
  }

  function openModal() {
    setModalValues({ nombre: '', descripcion: '' });
    setModalError('');
    setModalOpen(true);
  }

  async function submitModal(event) {
    event.preventDefault();
    const nombre = modalValues.nombre.trim();
    if (!locationId) {
      setModalError('Primero debe seleccionarse una ubicación general en el mantenimiento.');
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
          ubicacionId: locationId,
          nombre,
          descripcion: modalValues.descripcion,
          activo: true,
        },
        sessionToken,
      );
      const created = toOption(result);
      if (!created) throw new Error('El servidor no devolvió la ubicación creada.');
      setLoadedOptions((current) => uniqueOptions([...current, created]));
      onChange?.(created.value, created.label);
      setModalOpen(false);
    } catch (error) {
      setModalError(error.message || 'No se pudo crear la ubicación del equipo.');
    } finally {
      setModalSaving(false);
    }
  }

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
      placeholder={locationId ? 'Seleccione una opción' : 'Seleccione una ubicación general primero'}
    />
    <InlineCreateModal
      open={modalOpen}
      title="Agregar ubicación del equipo"
      description="La nueva ubicación quedará ligada a la ubicación general de este mantenimiento."
      saving={modalSaving}
      error={modalError}
      onClose={() => setModalOpen(false)}
      onSubmit={submitModal}
    >
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
