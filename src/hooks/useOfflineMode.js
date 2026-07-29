import { useEffect, useState } from 'react';
import {
  isOfflineModeEnabled,
  preserveExistingOfflineQueue,
  setOfflineModeEnabled,
  subscribeOfflineMode,
} from '../services/offlineMode';

export default function useOfflineMode() {
  const [enabled, setEnabledState] = useState(() => isOfflineModeEnabled());

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeOfflineMode((next) => {
      if (active) setEnabledState(next);
    });
    preserveExistingOfflineQueue().then((next) => {
      if (active) setEnabledState(Boolean(next));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function setEnabled(next) {
    const value = setOfflineModeEnabled(next);
    setEnabledState(value);
    return value;
  }

  return [enabled, setEnabled];
}
