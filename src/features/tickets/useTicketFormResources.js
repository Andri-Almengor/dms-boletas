import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalogResource, clearCatalogResourceCache } from '../../services/catalogResource';
import { fetchClientRelations } from '../../services/clientRelations';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { isAbortError } from '../../services/requestErrors';
import { mergeCatalogItems } from '../../utils/catalogCollection';
import { mapTicketForm } from './ticketFormDomain';

const CLIENT_PAGE_SIZE = 80;

const EMPTY_CATALOGS = Object.freeze({
  clients: [],
  categories: [],
  failures: [],
  devices: [],
  manufacturers: [],
  models: [],
  relations: [],
  users: [],
});

const INITIAL_CATALOG_JOBS = Object.freeze({
  clients: { routes: MODULE_ROUTES.clients.list, payload: { page: 1, pageSize: CLIENT_PAGE_SIZE, activo: true } },
  categories: { routes: MODULE_ROUTES.categories.list, payload: { page: 1, pageSize: 1000, activo: true } },
  failures: { routes: MODULE_ROUTES.failureTypes.list, payload: { page: 1, pageSize: 1000, activo: true } },
  devices: { routes: MODULE_ROUTES.deviceTypes.list, payload: { page: 1, pageSize: 1000, activo: true } },
  users: { routes: MODULE_ROUTES.users.list, payload: { page: 1, pageSize: 1000, activo: true } },
});

const CATALOG_ID_KEYS = Object.freeze({
  clients: ['ClienteID', 'ID', 'id'],
  categories: ['CategoriaID', 'ID', 'id'],
  failures: ['TipoFallaID', 'ID', 'id'],
  devices: ['TipoDispositivoID', 'ID', 'id'],
  manufacturers: ['FabricanteID', 'ID', 'id'],
  models: ['ModeloID', 'ID', 'id'],
  relations: ['RelacionID', 'ID', 'id'],
  users: ['UsuarioID', 'ID', 'id'],
});

function catalogItemKey(catalog, item, index, source) {
  return String(pick(item, CATALOG_ID_KEYS[catalog] || ['id'], `${source}-${index}`));
}

function manufacturersForType(manufacturers, relations, typeId) {
  const normalizedTypeId = String(typeId || '').trim();
  if (!normalizedTypeId) return { manufacturers: [], relations: [] };

  const selectedRelations = relations.filter((item) => (
    String(pick(item, ['TipoDispositivoID', 'tipoDispositivoId'])) === normalizedTypeId
  ));
  const allowedIds = new Set(selectedRelations.map((item) => String(
    pick(item, ['FabricanteID', 'fabricanteId']),
  )));

  return {
    relations: selectedRelations,
    manufacturers: allowedIds.size
      ? manufacturers.filter((item) => allowedIds.has(String(pick(item, ['FabricanteID', 'fabricanteId']))))
      : manufacturers,
  };
}

export default function useTicketFormResources({
  editing,
  boletaUid,
  sessionToken,
  clientId,
  equipmentLocationId,
  deviceTypeId,
  manufacturerId,
  setForm,
  onError,
}) {
  const [catalogs, setCatalogs] = useState(() => ({ ...EMPTY_CATALOGS }));
  const [catalogLoading, setCatalogLoading] = useState({ manufacturers: false, models: false });
  const [manufacturerMaster, setManufacturerMaster] = useState([]);
  const [relationMaster, setRelationMaster] = useState([]);
  const [manufacturerMasterStatus, setManufacturerMasterStatus] = useState('idle');
  const [locations, setLocations] = useState([]);
  const [allEquipmentLocations, setAllEquipmentLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [existingEvidenceCount, setExistingEvidenceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  const clientSearchControllerRef = useRef(null);
  onErrorRef.current = onError;

  const loadInitialCatalogs = useCallback(async ({ signal, force = false } = {}) => {
    const entries = Object.entries(INITIAL_CATALOG_JOBS);
    const results = await Promise.allSettled(entries.map(([, job]) => loadCatalogResource({
      ...job,
      sessionToken,
      signal,
      force,
    })));
    if (signal?.aborted) return null;

    const next = {};
    const failures = [];
    results.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === 'fulfilled') next[key] = result.value.items;
      else if (!isAbortError(result.reason)) failures.push(result.reason?.message);
    });
    next.users = (next.users || []).filter(
      (item) => String(pick(item, ['Estado'], 'ACTIVO')).toUpperCase() === 'ACTIVO',
    );
    setCatalogs((current) => ({ ...current, ...next }));
    if (failures.length) {
      onErrorRef.current?.(`Algunos catálogos no se cargaron: ${failures.filter(Boolean).join(' · ')}`);
    }

    requestAvailable(MODULE_ROUTES.config.get, {}, sessionToken, signal ? { signal } : {})
      .then((cfg) => {
        if (signal?.aborted) return;
        setForm((current) => ({
          ...current,
          correosCC: current.correosCC || pick(cfg, ['DEFAULT_CC_EMAILS', 'defaultCcEmails'], ''),
        }));
      })
      .catch(() => {});

    return next;
  }, [sessionToken, setForm]);

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
      setCatalogs((current) => ({
        ...current,
        clients: mergeCatalogItems(
          current.clients,
          result.items,
          (item, index, source) => catalogItemKey('clients', item, index, source),
        ),
      }));
      return result.items;
    } catch (error) {
      if (!isAbortError(error)) onErrorRef.current?.(error.message);
      return [];
    }
  }, [sessionToken]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      loadInitialCatalogs({ signal: controller.signal }),
      editing
        ? requestAvailable(
          MODULE_ROUTES.tickets.get,
          { boletaUid },
          sessionToken,
          { signal: controller.signal },
        )
        : Promise.resolve(null),
    ])
      .then(([, data]) => {
        if (controller.signal.aborted || !data) return;
        setForm(mapTicketForm(data));
        setExistingEvidenceCount((data.evidencias || []).length);
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isAbortError(error)) onErrorRef.current?.(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [editing, boletaUid, sessionToken, loadInitialCatalogs, setForm]);

  useEffect(() => () => clientSearchControllerRef.current?.abort(), []);

  // Se inicia al abrir el formulario, sin retrasar la pantalla inicial. De esta
  // manera el fabricante normalmente ya está disponible al llegar al paso 3.
  useEffect(() => {
    const controller = new AbortController();
    setManufacturerMasterStatus('loading');
    Promise.all([
      loadCatalogResource({
        routes: MODULE_ROUTES.manufacturers.list,
        payload: { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        signal: controller.signal,
      }),
      loadCatalogResource({
        routes: MODULE_ROUTES.deviceManufacturers.list,
        payload: { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        signal: controller.signal,
      }),
    ]).then(([manufacturerData, relationData]) => {
      if (controller.signal.aborted) return;
      setManufacturerMaster(manufacturerData.items);
      setRelationMaster(relationData.items);
      setManufacturerMasterStatus('ready');
    }).catch((error) => {
      if (controller.signal.aborted || isAbortError(error)) return;
      setManufacturerMasterStatus('error');
    });
    return () => controller.abort();
  }, [sessionToken]);

  useEffect(() => {
    const normalizedTypeId = String(deviceTypeId || '').trim();
    if (!normalizedTypeId) {
      setCatalogs((current) => ({ ...current, manufacturers: [], models: [], relations: [] }));
      setCatalogLoading((current) => ({ ...current, manufacturers: false, models: false }));
      return undefined;
    }

    if (manufacturerMasterStatus === 'loading' || manufacturerMasterStatus === 'idle') {
      setCatalogLoading((current) => ({ ...current, manufacturers: true }));
      return undefined;
    }

    if (manufacturerMasterStatus === 'ready') {
      const filtered = manufacturersForType(manufacturerMaster, relationMaster, normalizedTypeId);
      setCatalogs((current) => ({ ...current, ...filtered }));
      setCatalogLoading((current) => ({ ...current, manufacturers: false }));
      return undefined;
    }

    // Respaldo para una precarga fallida: conserva el comportamiento histórico.
    const controller = new AbortController();
    setCatalogLoading((current) => ({ ...current, manufacturers: true }));
    Promise.all([
      loadCatalogResource({
        routes: MODULE_ROUTES.manufacturers.list,
        payload: { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        signal: controller.signal,
        force: true,
      }),
      loadCatalogResource({
        routes: MODULE_ROUTES.deviceManufacturers.list,
        payload: { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        signal: controller.signal,
        force: true,
      }),
    ]).then(([manufacturerData, relationData]) => {
      if (controller.signal.aborted) return;
      setManufacturerMaster(manufacturerData.items);
      setRelationMaster(relationData.items);
      setManufacturerMasterStatus('ready');
      const filtered = manufacturersForType(manufacturerData.items, relationData.items, normalizedTypeId);
      setCatalogs((current) => ({ ...current, ...filtered }));
    }).catch((error) => {
      if (!controller.signal.aborted && !isAbortError(error)) onErrorRef.current?.(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading((current) => ({ ...current, manufacturers: false }));
    });
    return () => controller.abort();
  }, [deviceTypeId, manufacturerMaster, manufacturerMasterStatus, relationMaster, sessionToken]);

  useEffect(() => {
    const normalizedTypeId = String(deviceTypeId || '').trim();
    const normalizedManufacturerId = String(manufacturerId || '').trim();
    if (!normalizedTypeId || !normalizedManufacturerId) {
      setCatalogs((current) => ({ ...current, models: [] }));
      setCatalogLoading((current) => ({ ...current, models: false }));
      return undefined;
    }

    const controller = new AbortController();
    setCatalogLoading((current) => ({ ...current, models: true }));
    loadCatalogResource({
      routes: MODULE_ROUTES.models.list,
      payload: {
        page: 1,
        pageSize: 1000,
        activo: true,
        tipoDispositivoId: normalizedTypeId,
        fabricanteId: normalizedManufacturerId,
      },
      sessionToken,
      signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) setCatalogs((current) => ({ ...current, models: result.items }));
    }).catch((error) => {
      if (!controller.signal.aborted && !isAbortError(error)) onErrorRef.current?.(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading((current) => ({ ...current, models: false }));
    });
    return () => controller.abort();
  }, [deviceTypeId, manufacturerId, sessionToken]);

  useEffect(() => {
    if (!clientId) {
      setLocations([]);
      setAllEquipmentLocations([]);
      setContacts([]);
      return undefined;
    }

    const controller = new AbortController();
    fetchClientRelations({ clientId, sessionToken, signal: controller.signal })
      .then((relations) => {
        if (controller.signal.aborted) return;
        setLocations(relations.locations);
        setAllEquipmentLocations(relations.equipment);
        setContacts(relations.contacts);
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isAbortError(error)) onErrorRef.current?.(error.message);
      });
    return () => controller.abort();
  }, [clientId, sessionToken]);

  const equipmentLocations = useMemo(() => {
    if (!equipmentLocationId) return [];
    return allEquipmentLocations.filter((item) => String(
      pick(item, ['UbicacionID', 'ubicacionId']),
    ) === String(equipmentLocationId));
  }, [allEquipmentLocations, equipmentLocationId]);

  const appendRelation = useCallback((type, record) => {
    if (type === 'location') setLocations((rows) => [...rows, record]);
    if (type === 'equipment') setAllEquipmentLocations((rows) => [...rows, record]);
    if (type === 'supervisor') setContacts((rows) => [...rows, record]);
  }, []);

  const appendCatalog = useCallback((catalog, record) => {
    clearCatalogResourceCache();
    if (catalog === 'manufacturers') {
      setManufacturerMaster((current) => mergeCatalogItems(
        current,
        [record],
        (item, index, source) => catalogItemKey(catalog, item, index, source),
      ));
    }
    if (catalog === 'relations') {
      setRelationMaster((current) => mergeCatalogItems(
        current,
        [record],
        (item, index, source) => catalogItemKey(catalog, item, index, source),
      ));
    }
    setCatalogs((current) => ({
      ...current,
      [catalog]: mergeCatalogItems(
        current[catalog] || [],
        [record],
        (item, index, source) => catalogItemKey(catalog, item, index, source),
      ),
    }));
  }, []);

  return {
    catalogs,
    catalogLoading,
    locations,
    equipmentLocations,
    contacts,
    existingEvidenceCount,
    loading,
    reloadCatalogs: loadInitialCatalogs,
    searchClients,
    appendRelation,
    appendCatalog,
  };
}
