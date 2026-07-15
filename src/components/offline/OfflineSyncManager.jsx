import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
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

export default function OfflineSyncManager() {
  const { sessionToken } = useAuth();
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const refreshCount = useCallback(async () => {
    const count = await queuedOperationCount().catch(() => 0);
    setPending(count);
    return count;
  }, []);

  const synchronize = useCallback(async () => {
    if (!sessionToken || navigator.onLine === false || syncing) return;
    const operations = await listQueuedOperations().catch(() => []);
    if (!operations.length) {
      setMessage('');
      await preloadOfflineCatalogs(sessionToken).catch(() => {});
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
          await refreshCount();
        } catch (error) {
          await updateQueuedOperation(operation.id, {
            status: 'ERROR',
            lastError: String(error?.message || error),
          });
          if (isNetworkError(error)) {
            setOnline(false);
            setMessage('La conexión se interrumpió. Los cambios permanecen guardados.');
          } else if (isAuthenticationError(error)) {
            setMessage('Inicie sesión nuevamente para sincronizar los cambios guardados.');
          } else {
            setMessage(`No se pudo sincronizar: ${error?.message || error}`);
          }
          return;
        }
      }

      await preloadOfflineCatalogs(sessionToken).catch(() => {});
      setMessage('Todos los cambios fueron sincronizados correctamente.');
      window.dispatchEvent(new CustomEvent('dms-offline-sync-complete'));
      window.setTimeout(() => setMessage(''), 4500);
    } finally {
      setSyncing(false);
      await refreshCount();
    }
  }, [sessionToken, syncing, refreshCount]);

  useEffect(() => {
    refreshCount();
    const handleOnline = () => {
      setOnline(true);
      window.setTimeout(() => synchronize(), 250);
    };
    const handleOffline = () => {
      setOnline(false);
      setMessage('Sin conexión. Puede continuar trabajando; los cambios se enviarán al reconectarse.');
    };
    const handleQueueChange = () => refreshCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', handleQueueChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', handleQueueChange);
    };
  }, [refreshCount, synchronize]);

  useEffect(() => {
    if (!sessionToken) return;
    refreshCount().then(() => {
      if (navigator.onLine !== false) synchronize();
    });
  }, [sessionToken]);

  if (online && !pending && !syncing && !message) return null;

  return (
    <aside className={`offline-status${online ? ' is-online' : ' is-offline'}${syncing ? ' is-syncing' : ''}`} role="status" aria-live="polite">
      <span className="offline-status__icon">
        <Icon name={syncing ? 'sync' : online ? 'cloud_done' : 'cloud_off'} />
      </span>
      <div className="offline-status__body">
        <strong>{syncing ? 'Sincronizando' : online ? 'Conexión disponible' : 'Trabajando sin conexión'}</strong>
        <small>{message || (pending ? `${pending} cambio${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'} de envío.` : 'Los catálogos guardados continúan disponibles.')}</small>
      </div>
      {online && pending > 0 && !syncing && (
        <button type="button" onClick={synchronize}>Reintentar</button>
      )}
    </aside>
  );
}
