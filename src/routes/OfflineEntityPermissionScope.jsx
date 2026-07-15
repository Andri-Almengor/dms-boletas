import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthContext, useAuth } from '../AuthContext';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';

function localRecord(record, type) {
  if (record?.OfflinePendiente) return true;
  const id = type === 'ticket'
    ? pick(record, ['BoletaUID', 'boletaUid'])
    : pick(record, ['MantenimientoID', 'maintenanceId']);
  return /^(boleta|mantenimiento)-/i.test(String(id || ''));
}

export default function OfflineEntityPermissionScope({ type, children }) {
  const params = useParams();
  const auth = useAuth();
  const [record, setRecord] = useState(null);
  const entityId = type === 'ticket' ? params.boletaUid : params.maintenanceId;

  useEffect(() => {
    let active = true;
    const routes = type === 'ticket' ? MODULE_ROUTES.tickets.get : MODULE_ROUTES.maintenance.get;
    const payload = type === 'ticket' ? { boletaUid: entityId } : { maintenanceId: entityId };
    requestAvailable(routes, payload, auth.sessionToken)
      .then((data) => {
        if (!active) return;
        setRecord(type === 'ticket' ? (data?.boleta || data || {}) : (data?.mantenimiento || data || {}));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [auth.sessionToken, entityId, type]);

  const scopedAuth = useMemo(() => {
    if (!record || !localRecord(record, type)) return auth;
    const currentUserId = String(auth.user?.UsuarioID || auth.user?.id || '');
    const owner = String(pick(record, ['OfflineOwnerID', 'offlineOwnerId', 'CreadoPor'], '') || '');
    const ownsRecord = Boolean(currentUserId) && Boolean(owner) && currentUserId === owner;
    const administrator = auth.hasPermission('USUARIOS_GESTIONAR');

    return {
      ...auth,
      hasPermission: (code) => {
        if (administrator) return auth.hasPermission(code);
        if (type === 'ticket' && ['BOLETAS_EDITAR', 'BOLETAS_EVIDENCIAS', 'BOLETAS_FINALIZAR', 'NOTIFICACIONES_PRUEBA'].includes(code)) {
          if (!ownsRecord) return false;
          if (['BOLETAS_EDITAR', 'BOLETAS_EVIDENCIAS'].includes(code)) return auth.hasPermission(code) || auth.hasPermission('BOLETAS_CREAR');
          return auth.hasPermission(code);
        }
        if (type === 'maintenance' && ['MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_FINALIZAR', 'MANTENIMIENTOS_GESTIONAR', 'BOLETAS_EDITAR', 'BOLETAS_FINALIZAR'].includes(code)) {
          if (!ownsRecord) return false;
          if (['MANTENIMIENTOS_EDITAR', 'BOLETAS_EDITAR'].includes(code)) {
            return auth.hasPermission(code) || auth.hasPermission('MANTENIMIENTOS_CREAR') || auth.hasPermission('BOLETAS_CREAR');
          }
          return auth.hasPermission(code);
        }
        return auth.hasPermission(code);
      },
    };
  }, [auth, record, type]);

  return <AuthContext.Provider value={scopedAuth}>{children}</AuthContext.Provider>;
}
