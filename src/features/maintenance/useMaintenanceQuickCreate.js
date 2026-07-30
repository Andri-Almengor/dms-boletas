import { useState } from 'react';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import {
  createMaintenanceQuickModal,
  mapCreatedMaintenanceEquipment,
  mapCreatedMaintenanceLocation,
  validateMaintenanceQuickModal,
} from './maintenanceFormOrchestration';

export default function useMaintenanceQuickCreate({
  form,
  setForm,
  addLocation,
  addEquipment,
  sessionToken,
}) {
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function openModal(type) {
    setModal(createMaintenanceQuickModal(type));
    setError('');
  }

  function closeModal() {
    setModal(null);
    setError('');
  }

  function updateModal(event) {
    const { name, value } = event.target;
    setModal((current) => ({
      ...current,
      values: { ...current.values, [name]: value },
    }));
  }

  async function submitModal(event) {
    event.preventDefault();
    const validation = validateMaintenanceQuickModal(modal);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (modal.type === 'location') {
        const result = await requestAvailable(MODULE_ROUTES.clients.locationsCreate, {
          clienteId: form.clienteId,
          nombre: modal.values.nombre,
          direccion: modal.values.direccion,
          activo: true,
        }, sessionToken);
        const view = mapCreatedMaintenanceLocation(result, modal.values.nombre);
        addLocation(view);
        setForm((current) => ({ ...current, ubicacionId: view.id, ubicacion: view.name }));
      } else {
        const result = await requestAvailable(MODULE_ROUTES.clients.equipmentLocationsCreate, {
          ubicacionId: form.ubicacionId,
          nombre: modal.values.nombre,
          descripcion: modal.values.descripcion,
          activo: true,
        }, sessionToken);
        addEquipment({
          ...mapCreatedMaintenanceEquipment(result, modal.values.nombre),
          locationId: String(form.ubicacionId || ''),
        });
        setForm((current) => ({ ...current }));
      }
      setModal(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return {
    modal,
    error,
    saving,
    openModal,
    closeModal,
    updateModal,
    submitModal,
  };
}
