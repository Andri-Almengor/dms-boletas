import { useCallback, useEffect, useState } from 'react';
import { MODULE_ROUTES } from '../services/moduleApi';
import { loadCatalogResource } from '../services/catalogResource';

const EMPTY = Object.freeze({
  deviceTypes: [],
  manufacturers: [],
  models: [],
  relations: [],
});

export default function useMaintenanceDeviceCatalogData(sessionToken, {
  enabled = true,
} = {}) {
  const [catalogs, setCatalogs] = useState(EMPTY);
  const [loading, setLoading] = useState(Boolean(enabled && sessionToken));
  const [error, setError] = useState('');

  const reload = useCallback(async ({ force = false } = {}) => {
    if (!enabled || !sessionToken) {
      setCatalogs(EMPTY);
      setLoading(false);
      return EMPTY;
    }

    setLoading(true);
    setError('');
    const jobs = [
      ['deviceTypes', MODULE_ROUTES.deviceTypes.list],
      ['manufacturers', MODULE_ROUTES.manufacturers.list],
      ['models', MODULE_ROUTES.models.list],
      ['relations', MODULE_ROUTES.deviceManufacturers.list],
    ];
    const results = await Promise.allSettled(jobs.map(([, routes]) => loadCatalogResource({
      routes,
      payload: { page: 1, pageSize: 1000, activo: true },
      sessionToken,
      force,
    })));
    const next = { ...EMPTY };
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[jobs[index][0]] = result.value.items || [];
      else failures.push(result.reason?.message || 'Error de catálogo');
    });
    setCatalogs(next);
    if (failures.length) setError(`Algunos catálogos no se cargaron: ${failures.join(' · ')}`);
    setLoading(false);
    return next;
  }, [enabled, sessionToken]);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setCatalogs(EMPTY);
      setLoading(false);
      return undefined;
    }
    reload().catch((loadError) => {
      if (!active) return;
      setError(loadError?.message || 'No se pudieron cargar los catálogos de dispositivos.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [enabled, reload]);

  return {
    catalogs,
    loading,
    error,
    reload,
  };
}
