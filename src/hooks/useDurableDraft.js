import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft, saveDraftBackup } from '../services/draftStore';

export default function useDurableDraft({ key, enabled = true, value, onRestore, delay = 250 }) {
  const storageKey = useMemo(() => `state:${key}`, [key]);
  const [status, setStatus] = useState('idle');
  const [readyKey, setReadyKey] = useState('');
  const restoredKeyRef = useRef('');
  const cancelledKeyRef = useRef('');
  const timerRef = useRef(0);
  const valueRef = useRef(value);
  const restoreRef = useRef(onRestore);
  const saveChainRef = useRef(Promise.resolve());
  valueRef.current = value;
  restoreRef.current = onRestore;

  useEffect(() => {
    if (!enabled || !key || restoredKeyRef.current === storageKey) return undefined;
    restoredKeyRef.current = storageKey;
    cancelledKeyRef.current = '';
    setReadyKey('');
    let active = true;
    loadDraft(storageKey)
      .then((entry) => {
        if (!active) return;
        if (entry?.data?.stateValue !== undefined) {
          restoreRef.current?.(entry.data.stateValue, entry);
          setStatus('restored');
          window.setTimeout(() => setStatus('local'), 3_500);
        }
        setReadyKey(storageKey);
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
        setReadyKey(storageKey);
      });
    return () => { active = false; };
  }, [enabled, key, storageKey]);

  useEffect(() => {
    if (!enabled
      || !key
      || readyKey !== storageKey
      || cancelledKeyRef.current === storageKey) return undefined;
    const entry = {
      key: storageKey,
      route: `state-hook:${key}`,
      data: { stateValue: value },
    };
    saveDraftBackup(entry);
    setStatus('saving');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (cancelledKeyRef.current === storageKey) return;
      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(() => saveDraft(entry));
      saveChainRef.current
        .then(() => {
          if (cancelledKeyRef.current === storageKey) return;
          setStatus('local');
          window.dispatchEvent(new CustomEvent('dms-offline-editing-complete', {
            detail: { source: 'durable-state', key: storageKey },
          }));
        })
        .catch(() => setStatus('error'));
    }, delay);
    return () => window.clearTimeout(timerRef.current);
  }, [delay, enabled, key, readyKey, storageKey, value]);

  useEffect(() => {
    if (!enabled || !key || readyKey !== storageKey) return undefined;
    const flush = () => {
      if (cancelledKeyRef.current === storageKey) return;
      saveDraftBackup({
        key: storageKey,
        route: `state-hook:${key}`,
        data: { stateValue: valueRef.current },
      });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, key, readyKey, storageKey]);

  const clearDraft = useCallback(async () => {
    cancelledKeyRef.current = storageKey;
    window.clearTimeout(timerRef.current);
    await saveChainRef.current.catch(() => {});
    await deleteDraft(storageKey).catch(() => {});
    setStatus('idle');
  }, [storageKey]);

  return { status, clearDraft, storageKey };
}
