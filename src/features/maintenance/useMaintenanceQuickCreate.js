import { useState } from 'react';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import {
  createMaintenanceQuickModal,
  maintenanceQuickCreateRoutes,
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
  const { hasPermission } = useAuth();
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const useAdminClientRoutes = hasPermission('USUARIOS_GESTIONAR');

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
        const routes = maintenanceQuickCreateRoutes(
          'location',
          MODULE_ROUTES.clients.locationsCreate,
          useAdminClientRoutes,
        );
        const result = await requestAvailable(routes, {
          clienteId: form.clienteId,
          nombre: modal.values.nombre,
          direccion: modal.values.direccion,
          activo: true,
        }, sessionToken);
        const view = mapCreatedMaintenanceLocation(result, modal.values.nombre);
        addLocation(view);
        setForm((current) => ({ ...current, ubicacionId: view.id, ubicacion: view.name }));
      } else {
        const routes = maintenanceQuickCreateRoutes(
          'equipment',
          MODULE_ROUTES.clients.equipmentLocationsCreate,
          useAdminClientRoutes,
        );
        const result = await requestAvailable(routes, {
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
