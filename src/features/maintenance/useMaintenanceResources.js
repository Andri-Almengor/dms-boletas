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
const CLIENT_SEARCH_PAGE_SIZE = 1000;
const CLIENT_CACHE_TTL_MS = 60_000;

async function loadClientPage({ sessionToken, signal, query = '', page = 1, pageSize = CLIENT_PAGE_SIZE }) {
  const normalizedQuery = String(query || '').trim();
  const result = await loadCatalogResource({
    routes: MODULE_ROUTES.clients.list,
    payload: {
      page,
      pageSize,
      ...(normalizedQuery ? { q: normalizedQuery } : {}),
    },
    sessionToken,
    signal,
    ttlMs: CLIENT_CACHE_TTL_MS,
  });
  return {
    items: result.items.map(maintenanceClientView),
    total: Number(result.total || result.items.length || 0),
    page: Number(result.page || page),
    pageSize: Number(result.pageSize || pageSize),
  };
}

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

  const mergeClients = useCallback((incoming, { replace = false } = {}) => {
    setClients((current) => (
      replace
        ? incoming
        : mergeCatalogItems(
          current,
          incoming,
          (item, index, source) => item.id || `${source}-${index}`,
        )
    ));
  }, []);

  const searchClients = useCallback(async (query = '') => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];

    clientSearchControllerRef.current?.abort();
    const controller = new AbortController();
    clientSearchControllerRef.current = controller;
    try {
      const result = await loadClientPage({
        sessionToken,
        signal: controller.signal,
        query: normalizedQuery,
        page: 1,
        pageSize: CLIENT_SEARCH_PAGE_SIZE,
      });
      if (controller.signal.aborted) return [];
      mergeClients(result.items);
      return result.items;
    } catch (error) {
      if (!isAbortError(error)) setError(error.message);
      return [];
    }
  }, [mergeClients, sessionToken, setError]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    Promise.all([
      loadClientPage({
        sessionToken,
        signal: controller.signal,
        page: 1,
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
    ]).then(([clientPage, userData, maintenanceData]) => {
      if (controller.signal.aborted) return;
      mergeClients(clientPage.items, { replace: true });
      setUsers(activeMaintenanceUsers(userData.items));

      if (maintenanceData) {
        const mappedForm = mapMaintenance(maintenanceData);
        const mappedDevices = (maintenanceData.dispositivos || maintenanceData.devices || []).map(mapMaintenanceDevice);
        setForm(mappedForm);
        setDevices(mappedDevices);

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
  }, [editing, maintenanceId, mergeClients, onInitialState, sessionToken, setDevices, setError, setForm]);

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
