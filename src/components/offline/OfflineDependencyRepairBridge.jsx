import { useCallback, useEffect, useRef } from 'react';
import {
  listOfflineIdMappings,
  listQueuedOperations,
  saveOfflineIdMapping,
} from '../../services/offlineStore';
import { repairOfflineIdentityMappings } from '../../services/offlineDependencyRepair';

export default function OfflineDependencyRepairBridge() {
  const repairingRef = useRef(false);

  const repair = useCallback(async () => {
    if (repairingRef.current) return 0;
    repairingRef.current = true;
    try {
      const operations = await listQueuedOperations().catch(() => []);
      if (!operations.length) return 0;
      const mappings = await listOfflineIdMappings().catch(() => []);
      const repairs = await repairOfflineIdentityMappings({
        operations,
        mappings,
        saveMapping: saveOfflineIdMapping,
      });

      if (repairs.length && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dms-offline-dependency-repaired', {
          detail: { repaired: repairs.map((item) => item.localId) },
        }));
        window.dispatchEvent(new CustomEvent('dms-offline-sync-request'));
      }
      return repairs.length;
    } finally {
      repairingRef.current = false;
    }
  }, []);

  useEffect(() => {
    repair();

    const handleRepair = () => repair();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') repair();
    };

    window.addEventListener('online', handleRepair);
    window.addEventListener('focus', handleRepair);
    window.addEventListener('dms-offline-queue-change', handleRepair);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleRepair);
      window.removeEventListener('focus', handleRepair);
      window.removeEventListener('dms-offline-queue-change', handleRepair);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [repair]);

  return null;
}
