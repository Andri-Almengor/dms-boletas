import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  mapMaintenance,
  mapMaintenanceDevice,
} from '../../pages/maintenance/maintenanceFormData';
import { loadCatalogResource } from '../../services/catalogResource';
import { fetchClientRelations } from '../../services/clientRelations';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import { isAbortError } from '../../services/requestErrors';
import { mergeCatalogItems } from '../../utils/catalogCollection';
import {
  activeMaintenanceUsers,
  filterMaintenanceEquipment,
  maintenanceClientView,
  maintenanceEquipmentView,
  maintenanceLocationView,
} from './maintenanceFormDomain';

const CLIENT_PAGE_SIZE = 80;

function initialEquipmentFromDevices(devices, form) {
  const byId = new Map();
  devices.forEach((device) => {
    const id = String(device.ubicacionEquipoId || '').trim();
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      name: String(device.ubicacionEquipoNombre || device.zona || 'Ubicación del equipo'),
      locationId: String(form.ubicacionId || ''),
    });
  });
  return [...byId.values()];
}

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
  const clientSearchControllerRef = useRef(null);

  const searchClients = useCallback(async (query = '') => {
    clientSearchControllerRef.current?.abort();
    const controller = new AbortController();
    clientSearchControllerRef.current = controller;
    try {
      const result = await loadCatalogResource({
        routes: MODULE_ROUTES.clients.list,
        payload: { page: 1, pageSize: CLIENT_PAGE_SIZE, activo: true, q: String(query || '').trim() },
        sessionToken,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return [];
      const incoming = result.items.map(maintenanceClientView);
      setClients((current) => mergeCatalogItems(
        current,
        incoming,
        (item, index, source) => item.id || `${source}-${index}`,
      ));
      return incoming;
    } catch (error) {
      if (!isAbortError(error)) setError(error.message);
      return [];
    }
  }, [sessionToken, setError]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    Promise.all([
      loadCatalogResource({
        routes: MODULE_ROUTES.clients.list,
        payload: { page: 1, pageSize: CLIENT_PAGE_SIZE, activo: true },
        sessionToken,
        signal: controller.signal,
      }),
      loadCatalogResource({
        routes: ['users.assignment.list', 'users.list'],
        payload: { page: 1, pageSize: 1000 },
        sessionToken,
        signal: controller.signal,
      }),
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
      setClients(clientData.items.map(maintenanceClientView));
      setUsers(activeMaintenanceUsers(userData.items));

      if (maintenanceData) {
        const mappedForm = mapMaintenance(maintenanceData);
        const mappedDevices = (maintenanceData.dispositivos || maintenanceData.devices || []).map(mapMaintenanceDevice);
        setForm(mappedForm);
        setDevices(mappedDevices);

        // La ubicación seleccionada y las ubicaciones usadas por los dispositivos
        // se muestran inmediatamente. La relación completa del cliente continúa
        // cargándose en segundo plano y reemplaza estos datos provisionales.
        setLocations(mappedForm.ubicacionId ? [{
          id: String(mappedForm.ubicacionId),
          name: String(mappedForm.ubicacion || 'Ubicación seleccionada'),
        }] : []);
        setAllEquipment(initialEquipmentFromDevices(mappedDevices, mappedForm));

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

  useEffect(() => () => clientSearchControllerRef.current?.abort(), []);

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
    searchClients,
    addLocation,
    addEquipment,
  };
}
