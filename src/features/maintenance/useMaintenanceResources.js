import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  mapMaintenance,
  mapMaintenanceDevice,
} from '../../pages/maintenance/maintenanceFormData';
import { fetchClientRelations } from '../../services/clientRelations';
import { MODULE_ROUTES, normalizeItems, requestAvailable } from '../../services/moduleApi';
import { isAbortError } from '../../services/requestErrors';
import {
  activeMaintenanceUsers,
  filterMaintenanceEquipment,
  maintenanceClientView,
  maintenanceEquipmentView,
  maintenanceLocationView,
} from './maintenanceFormDomain';

export default function useMaintenanceResources({
  editing,
  maintenanceId,
  sessionToken,
  clientId,
  locationId,
  setForm,
  setDevices,
  setError,
  onInitialState,
}) {
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [allEquipment, setAllEquipment] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    Promise.all([
      requestAvailable(
        MODULE_ROUTES.clients.list,
        { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        { signal: controller.signal },
      ),
      requestAvailable(
        ['users.assignment.list', 'users.list'],
        { page: 1, pageSize: 1000 },
        sessionToken,
        { signal: controller.signal },
      ),
      editing
        ? requestAvailable(
          MODULE_ROUTES.maintenance.get,
          { maintenanceId },
          sessionToken,
          { signal: controller.signal },
        )
        : Promise.resolve(null),
    ]).then(([clientData, userData, maintenanceData]) => {
      if (controller.signal.aborted) return;
      setClients(normalizeItems(clientData).map(maintenanceClientView));
      setUsers(activeMaintenanceUsers(normalizeItems(userData)));

      if (maintenanceData) {
        const mappedForm = mapMaintenance(maintenanceData);
        const mappedDevices = (maintenanceData.dispositivos || maintenanceData.devices || []).map(mapMaintenanceDevice);
        setForm(mappedForm);
        setDevices(mappedDevices);
        onInitialState(mappedForm, mappedDevices);
        return;
      }

      setForm((current) => {
        onInitialState(current, []);
        return current;
      });
    }).catch((error) => {
      if (!isAbortError(error) && !controller.signal.aborted) setError(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [editing, maintenanceId, onInitialState, sessionToken, setDevices, setError, setForm]);

  useEffect(() => {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      setLocations([]);
      setAllEquipment([]);
      return undefined;
    }

    const controller = new AbortController();
    fetchClientRelations({
      clientId: normalizedClientId,
      sessionToken,
      signal: controller.signal,
    }).then((relations) => {
      if (controller.signal.aborted) return;
      setLocations((relations.locations || []).map(maintenanceLocationView));
      setAllEquipment((relations.equipment || []).map(maintenanceEquipmentView));
    }).catch((error) => {
      if (!isAbortError(error) && !controller.signal.aborted) setError(error.message);
    });

    return () => controller.abort();
  }, [clientId, sessionToken, setError]);

  const equipment = useMemo(
    () => filterMaintenanceEquipment(allEquipment, locationId),
    [allEquipment, locationId],
  );

  const addLocation = useCallback((location) => {
    setLocations((current) => [...current, location]);
  }, []);

  const addEquipment = useCallback((item) => {
    setAllEquipment((current) => [...current, item]);
  }, []);

  return {
    clients,
    users,
    locations,
    equipment,
    loading,
    addLocation,
    addEquipment,
  };
}
