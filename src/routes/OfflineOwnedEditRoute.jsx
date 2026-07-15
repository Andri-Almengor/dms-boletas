import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AuthContext, useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';

function isLocalRecord(record, type) {
  if (record?.OfflinePendiente) return true;
  const id = type === 'ticket'
    ? pick(record, ['BoletaUID', 'boletaUid'])
    : pick(record, ['MantenimientoID', 'maintenanceId']);
  return /^(boleta|mantenimiento)-/i.test(String(id || ''))
    && (type !== 'ticket' || String(record?.BoletaID || '').toLowerCase().includes('sin sincronizar'));
}

function ownerId(record) {
  return String(pick(record, ['OfflineOwnerID', 'offlineOwnerId', 'CreadoPor'], '') || '');
}

export default function OfflineOwnedEditRoute({ type, children }) {
  const params = useParams();
  const auth = useAuth();
  const { sessionToken, user, hasPermission } = auth;
  const [state, setState] = useState({ loading: true, allowed: false, localOwnerEdit: false, fallback: '/' });
  const entityId = type === 'ticket' ? params.boletaUid : params.maintenanceId;

  useEffect(() => {
    let active = true;
    const routes = type === 'ticket' ? MODULE_ROUTES.tickets.get : MODULE_ROUTES.maintenance.get;
    const payload = type === 'ticket' ? { boletaUid: entityId } : { maintenanceId: entityId };
    const fallback = type === 'ticket' ? `/boletas/${encodeURIComponent(entityId)}` : `/mantenimientos/${encodeURIComponent(entityId)}`;

    requestAvailable(routes, payload, sessionToken)
      .then((data) => {
        if (!active) return;
        const record = type === 'ticket' ? (data?.boleta || data || {}) : (data?.mantenimiento || data || {});
        const local = isLocalRecord(record, type);
        const currentUserId = String(user?.UsuarioID || user?.id || '');
        const administrator = hasPermission('USUARIOS_GESTIONAR');
        const normalPermission = type === 'ticket'
          ? hasPermission('BOLETAS_EDITAR')
          : (hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('MANTENIMIENTOS_GESTIONAR') || hasPermission('BOLETAS_EDITAR'));
        const createPermission = type === 'ticket'
          ? hasPermission('BOLETAS_CREAR')
          : (hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('MANTENIMIENTOS_GESTIONAR') || hasPermission('BOLETAS_CREAR'));
        const owner = ownerId(record);
        const ownsLocalRecord = local && Boolean(currentUserId) && Boolean(owner) && owner === currentUserId;
        const localOwnerEdit = ownsLocalRecord && createPermission && !normalPermission && !administrator;

        setState({
          loading: false,
          allowed: administrator || normalPermission || localOwnerEdit,
          localOwnerEdit,
          fallback,
        });
      })
      .catch(() => {
        if (active) setState({ loading: false, allowed: false, localOwnerEdit: false, fallback });
      });

    return () => { active = false; };
  }, [entityId, hasPermission, sessionToken, type, user]);

  const overriddenAuth = useMemo(() => {
    if (!state.localOwnerEdit) return auth;
    return {
      ...auth,
      hasPermission: (code) => {
        if (type === 'ticket' && ['BOLETAS_EDITAR', 'BOLETAS_EVIDENCIAS'].includes(code)) return true;
        if (type === 'maintenance' && ['MANTENIMIENTOS_EDITAR', 'MANTENIMIENTOS_CREAR'].includes(code)) return true;
        return auth.hasPermission(code);
      },
    };
  }, [auth, state.localOwnerEdit, type]);

  if (state.loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Comprobando permisos de edición...</div></div>;
  }
  if (!state.allowed) return <Navigate to={state.fallback} replace />;
  return <AuthContext.Provider value={overriddenAuth}>{children}</AuthContext.Provider>;
}
