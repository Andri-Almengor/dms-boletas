import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../AuthContext';
import {
  MODULE_ROUTES,
  OFFLINE_CATALOG_PAYLOAD,
  requestAvailable,
} from '../../services/moduleApi';

const ROUTES_BY_SCOPE = Object.freeze({
  clients: MODULE_ROUTES.clients.list,
  locations: MODULE_ROUTES.clients.locationsList,
  equipment: MODULE_ROUTES.clients.equipmentLocationsList,
  contacts: MODULE_ROUTES.clients.contactsList,
});

function scopesForRoute(route) {
  const value = String(route || '').toLowerCase();
  const scopes = new Set();
  if (/(equipmentlocations|ubicacionesequipo)/.test(value)) scopes.add('equipment');
  if (/(clientlocations|clients\.locations|ubicacionescliente|clientes\.ubicaciones)/.test(value)
    && !/(equipmentlocations|ubicacionesequipo)/.test(value)) scopes.add('locations');
  if (/(contacts|contactos)/.test(value)) scopes.add('contacts');
  if (/(^|\.)(clients|clientes)(\.|$)/.test(value)
    && !/(locations|ubicaciones|contacts|contactos)/.test(value)) scopes.add('clients');
  return scopes;
}

export default function ClientCatalogSyncBridge() {
  const { sessionToken } = useAuth();
  const pendingScopes = useRef(new Set());
  const pendingDetails = useRef([]);
  const timer = useRef(null);

  useEffect(() => {
    if (!sessionToken) return undefined;

    async function flush() {
      timer.current = null;
      const scopes = [...pendingScopes.current];
      const details = [...pendingDetails.current];
      pendingScopes.current.clear();
      pendingDetails.current = [];
      if (!scopes.length) return;

      await Promise.allSettled(scopes.map((scope) => requestAvailable(
        ROUTES_BY_SCOPE[scope],
        {
          ...OFFLINE_CATALOG_PAYLOAD,
          sortBy: 'Nombre',
          sortDir: 'asc',
        },
        sessionToken,
      )));

      const detail = {
        scopes,
        changes: details,
        refreshedAt: new Date().toISOString(),
      };
      window.dispatchEvent(new CustomEvent('dms-client-catalog-refreshed', { detail }));
      if (scopes.includes('locations') || scopes.includes('equipment')) {
        window.dispatchEvent(new CustomEvent('dms-client-equipment-catalog-updated', { detail }));
      }
      if (scopes.includes('contacts')) {
        window.dispatchEvent(new CustomEvent('dms-client-contacts-catalog-updated', { detail }));
      }
    }

    function schedule(event) {
      const scopes = scopesForRoute(event.detail?.route);
      if (!scopes.size) return;
      scopes.forEach((scope) => pendingScopes.current.add(scope));
      pendingDetails.current.push(event.detail || {});
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 220);
    }

    window.addEventListener('dms-client-relations-updated', schedule);
    return () => {
      window.removeEventListener('dms-client-relations-updated', schedule);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      pendingScopes.current.clear();
      pendingDetails.current = [];
    };
  }, [sessionToken]);

  return null;
}
