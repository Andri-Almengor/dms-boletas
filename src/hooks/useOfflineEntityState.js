import { useCallback, useEffect, useState } from 'react';
import { queuedOperationsForEntity } from '../services/offlineStore';

export default function useOfflineEntityState(entityId) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [operations, setOperations] = useState([]);

  const refresh = useCallback(async () => {
    if (!entityId) {
      setOperations([]);
      return [];
    }
    const rows = await queuedOperationsForEntity(entityId).catch(() => []);
    setOperations(rows);
    return rows;
  }, [entityId]);

  useEffect(() => {
    refresh();
    const handleOnline = () => { setOnline(true); refresh(); };
    const handleOffline = () => { setOnline(false); refresh(); };
    const handleQueue = () => refresh();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', handleQueue);
    window.addEventListener('dms-offline-sync-complete', handleQueue);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', handleQueue);
      window.removeEventListener('dms-offline-sync-complete', handleQueue);
    };
  }, [refresh]);

  return {
    online,
    operations,
    pendingCount: operations.length,
    hasPendingChanges: operations.length > 0,
    synchronized: online && operations.length === 0,
    refresh,
  };
}
