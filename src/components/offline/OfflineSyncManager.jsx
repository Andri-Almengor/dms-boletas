import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
  getEntityQueueState,
  listQueuedOperations,
  queuedOperationCount,
  removeQueuedOperation,
  updateQueuedOperation,
} from '../../services/offlineStore';
import {
  isNetworkError,
  preloadOfflineCatalogs,
  replayQueuedOperation,
} from '../../services/moduleApi';

function isAuthenticationError(error) {
  return Number(error?.status || 0) === 401
    || String(error?.code || '').toUpperCase() === 'UNAUTHORIZED';
}

function currentEntity(pathname) {
  const ticket = pathname.match(/^\/boletas\/([^/]+)(?:\/editar)?$/);
  if (ticket && ticket[1] !== 'nueva' && !['pendientes', 'finalizadas'].includes(ticket[1])) {
    return { type: 'boleta', id: decodeURIComponent(ticket[1]) };
  }
  const maintenance = pathname.match(/^\/mantenimientos\/([^/]+)(?:\/editar)?$/);
  if (maintenance && maintenance[1] !== 'nuevo') {
    return { type: 'mantenimiento', id: decodeURIComponent(maintenance[1]) };
  }
  return null;
}

function isCreateWorkflow(pathname) {
  return pathname === '/boletas/nueva' || pathname === '/mantenimientos/nuevo';
}

export default function OfflineSyncManager() {
  const { sessionToken } = useAuth();
  const location = useLocation();
  const entity = useMemo(() => currentEntity(location.pathname), [location.pathname]);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [pending, setPending] = useState(0);
  const [entityPending, setEntityPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const refreshCount = useCallback(async () => {
    const count = await queuedOperationCount().catch(() => 0);
    setPending(count);
    return count;
  }, []);

  const refreshEntityState = useCallback(async () => {
    if (!entity?.id) {
      setEntityPending(0);
      return 0;
    }
    const state = await getEntityQueueState(entity.id).catch(() => ({ pending: 0 }));
    setEntityPending(Number(state.pending || 0));
    return Number(state.pending || 0);
  }, [entity?.id]);

  const synchronize = useCallback(async () => {
    if (!sessionToken || navigator.onLine === false || syncing) return;
    const operations = await listQueuedOperations().catch(() => []);
    if (!operations.length) {
      setMessage('');
      await Promise.all([
        preloadOfflineCatalogs(sessionToken).catch(() => {}),
        refreshEntityState(),
      ]);
      return;
    }

    setSyncing(true);
    setMessage('Sincronizando cambios pendientes...');
    try {
      for (const operation of operations) {
        await updateQueuedOperation(operation.id, {
          status: 'SYNCING',
          attempts: Number(operation.attempts || 0) + 1,
          lastError: '',
        });
        try {
          await replayQueuedOperation(operation, sessionToken);
          await removeQueuedOperation(operation.id);
          await Promise.all([refreshCount(), refreshEntityState()]);
        } catch (error) {
          await updateQueuedOperation(operation.id, {
            status: 'ERROR',
            lastError: String(error?.message || error),
          });
          await Promise.all([refreshCount(), refreshEntityState()]);
          if (isNetworkError(error)) {
            setOnline(false);
            setMessage('La conexión se interrumpió. Los cambios permanecen guardados y la finalización sigue bloqueada.');
          } else if (isAuthenticationError(error)) {
            setMessage('Inicie sesión nuevamente para sincronizar los cambios guardados.');
          } else {
            setMessage(`No se pudo sincronizar: ${error?.message || error}`);
          }
          return;
        }
      }

      await preloadOfflineCatalogs(sessionToken).catch(() => {});
      setMessage('Todos los cambios fueron sincronizados correctamente. Ya puede finalizar.');
      window.dispatchEvent(new CustomEvent('dms-offline-sync-complete'));
      window.setTimeout(() => setMessage(''), 4500);
    } finally {
      setSyncing(false);
      await Promise.all([refreshCount(), refreshEntityState()]);
    }
  }, [sessionToken, syncing, refreshCount, refreshEntityState]);

  useEffect(() => {
    refreshCount();
    refreshEntityState();
    const handleOnline = () => {
      setOnline(true);
      window.setTimeout(() => synchronize(), 250);
    };
    const handleOffline = () => {
      setOnline(false);
      setMessage('Sin conexión. Puede continuar editando y agregando evidencias; se enviarán al reconectarse.');
    };
    const handleQueueChange = () => {
      refreshCount();
      refreshEntityState();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', handleQueueChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', handleQueueChange);
    };
  }, [refreshCount, refreshEntityState, synchronize]);

  useEffect(() => {
    if (!sessionToken) return;
    Promise.all([refreshCount(), refreshEntityState()]).then(() => {
      if (navigator.onLine !== false) synchronize();
    });
  }, [sessionToken, location.pathname]);

  const finalizationBlocked = navigator.onLine === false
    || entityPending > 0
    || (isCreateWorkflow(location.pathname) && navigator.onLine === false);

  useEffect(() => {
    document.body.classList.toggle('dms-entity-unsynced', finalizationBlocked);
    return () => document.body.classList.remove('dms-entity-unsynced');
  }, [finalizationBlocked]);

  if (online && !pending && !syncing && !message) return null;

  const pendingText = entityPending
    ? `${entityPending} cambio${entityPending === 1 ? '' : 's'} de este ${entity?.type || 'registro'} pendiente${entityPending === 1 ? '' : 's'}. Finalizar aparecerá al terminar.`
    : pending
      ? `${pending} cambio${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'} de envío.`
      : 'Los catálogos guardados continúan disponibles.';

  return (
    <aside className={`offline-status${online ? ' is-online' : ' is-offline'}${syncing ? ' is-syncing' : ''}`} role="status" aria-live="polite">
      <span className="offline-status__icon">
        <Icon name={syncing ? 'sync' : online ? 'cloud_done' : 'cloud_off'} />
      </span>
      <div className="offline-status__body">
        <strong>{syncing ? 'Sincronizando' : online ? 'Conexión disponible' : 'Trabajando sin conexión'}</strong>
        <small>{message || pendingText}</small>
      </div>
      {online && pending > 0 && !syncing && (
        <button type="button" onClick={synchronize}>Reintentar</button>
      )}
    </aside>
  );
}
