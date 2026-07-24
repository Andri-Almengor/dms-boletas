import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useMaintenanceForm from './useMaintenanceForm';
import { maintenancePayload } from '../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';

export default function useOptimizedMaintenanceForm({ editing, maintenanceId }) {
  const navigate = useNavigate();
  const base = useMaintenanceForm({ editing, maintenanceId });
  const [headerSaving, setHeaderSaving] = useState(false);

  const persist = useCallback(async (action) => {
    if (!editing) return base.persist(action);
    if (!base.form.titulo.trim()) { base.setError('El título es obligatorio.'); return null; }
    if (!base.form.clienteId) { base.setError('Selecciona un cliente.'); return null; }
    if (!base.form.responsables.length) { base.setError('Selecciona al menos un responsable.'); return null; }

    setHeaderSaving(true);
    base.setError('');
    try {
      // En modo edición cada dispositivo se guarda al cerrar su propio formulario.
      // Aquí solo se actualiza la cabecera para no reenviar decenas de dispositivos sin cambios.
      const saved = await requestAvailable(
        MODULE_ROUTES.maintenance.update,
        maintenancePayload(base.form, maintenanceId),
        base.sessionToken,
      );
      const id = String(pick(saved?.mantenimiento || saved, ['MantenimientoID', 'maintenanceId', 'id'], maintenanceId));
      if (!id) throw new Error('El backend no devolvió MantenimientoID.');

      if (action === 'finalize') {
        await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId: id }, base.sessionToken);
      }
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
      return saved;
    } catch (error) {
      base.setError(error.message);
      return null;
    } finally {
      setHeaderSaving(false);
    }
  }, [base, editing, maintenanceId, navigate]);

  return {
    ...base,
    saving: base.saving || headerSaving,
    persist,
  };
}
