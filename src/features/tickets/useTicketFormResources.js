import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchClientRelations } from '../../services/clientRelations';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { isAbortError } from '../../services/requestErrors';
import { mapTicketForm } from './ticketFormDomain';

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

const CATALOG_JOBS = Object.freeze([
  ['clients', MODULE_ROUTES.clients.list],
  ['categories', MODULE_ROUTES.categories.list],
  ['failures', MODULE_ROUTES.failureTypes.list],
  ['devices', MODULE_ROUTES.deviceTypes.list],
  ['manufacturers', MODULE_ROUTES.manufacturers.list],
  ['models', MODULE_ROUTES.models.list],
  ['relations', MODULE_ROUTES.deviceManufacturers.list],
  ['users', MODULE_ROUTES.users.list],
]);

export default function useTicketFormResources({
  editing,
  boletaUid,
  sessionToken,
  clientId,
  equipmentLocationId,
  setForm,
  onError,
}) {
  const [catalogs, setCatalogs] = useState(() => ({ ...EMPTY_CATALOGS }));
  const [locations, setLocations] = useState([]);
  const [allEquipmentLocations, setAllEquipmentLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [existingEvidenceCount, setExistingEvidenceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const loadCatalogs = useCallback(async ({ signal } = {}) => {
    const results = await Promise.allSettled(
      CATALOG_JOBS.map(([, routes]) => requestAvailable(
        routes,
        { page: 1, pageSize: 1000, activo: true },
        sessionToken,
        signal ? { signal } : {},
      )),
    );
    if (signal?.aborted) return null;

    const next = {};
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[CATALOG_JOBS[index][0]] = normalizeItems(result.value);
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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      loadCatalogs({ signal: controller.signal }),
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
  }, [editing, boletaUid, sessionToken, loadCatalogs, setForm]);

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

  return {
    catalogs,
    locations,
    equipmentLocations,
    contacts,
    existingEvidenceCount,
    loading,
    reloadCatalogs: loadCatalogs,
    appendRelation,
  };
}
