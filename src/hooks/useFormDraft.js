import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft, saveDraftBackup } from '../services/draftStore';

const DEFAULT_SAVE_DELAY_MS = 250;
const DEFAULT_RESTORED_STATUS_MS = 3_500;

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeLegacyValue(parsed) {
  if (!parsed) return null;
  if (Object.prototype.hasOwnProperty.call(parsed, 'value')) return parsed.value;
  if (Object.prototype.hasOwnProperty.call(parsed, 'hookValue')) return parsed.hookValue;
  return null;
}

function legacyDraftEntry({ storageKey, legacyKey, parsed }) {
  const value = normalizeLegacyValue(parsed);
  if (value === null || value === undefined) return null;
  return {
    key: storageKey,
    route: `legacy:${legacyKey}`,
    data: { hookValue: value },
    updatedAt: Number(parsed?.savedAt || parsed?.updatedAt || Date.now()),
  };
}

export function controlledDraftKey(namespace, keySuffix) {
  const normalizedNamespace = String(namespace || 'form-state').trim() || 'form-state';
  const normalizedSuffix = String(keySuffix || 'new').trim() || 'new';
  return `${normalizedNamespace}:${normalizedSuffix}`;
}

export default function useFormDraft({
  namespace = 'form-state',
  keySuffix = 'new',
  routePrefix = namespace,
  legacyKeys = [],
  enabled = true,
  value,
  onRestore,
  onEmpty,
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
  restoredStatusMs = DEFAULT_RESTORED_STATUS_MS,
} = {}) {
  const storageKey = useMemo(() => controlledDraftKey(namespace, keySuffix), [keySuffix, namespace]);
  const normalizedLegacyKeys = useMemo(
    () => [...new Set((legacyKeys || []).map((key) => String(key || '').trim()).filter(Boolean))],
    [legacyKeys],
  );
  const legacySignature = normalizedLegacyKeys.join('|');
  const [status, setStatus] = useState('idle');
  const [readyKey, setReadyKey] = useState('');
  const restoredKeyRef = useRef('');
  const cancelledKeyRef = useRef('');
  const onRestoreRef = useRef(onRestore);
  const onEmptyRef = useRef(onEmpty);
  const valueRef = useRef(value);
  const timerRef = useRef(0);
  const statusTimerRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());

  onRestoreRef.current = onRestore;
  onEmptyRef.current = onEmpty;
  valueRef.current = value;

  useEffect(() => {
    if (!enabled || restoredKeyRef.current === storageKey) return undefined;
    restoredKeyRef.current = storageKey;
    cancelledKeyRef.current = '';
    setReadyKey('');
    let active = true;

    const restore = async () => {
      let draft = await loadDraft(storageKey).catch(() => null);
      if (!draft) {
        for (const legacyKey of normalizedLegacyKeys) {
          const parsed = safeParse(localStorage.getItem(legacyKey));
          const migrated = legacyDraftEntry({ storageKey, legacyKey, parsed });
          if (!migrated) continue;
          draft = migrated;
          await saveDraft(migrated).catch(() => {});
          try { localStorage.removeItem(legacyKey); } catch { /* Sin efecto. */ }
          break;
        }
      }

      if (!active) return;
      const restoredValue = draft?.data?.hookValue;
      if (restoredValue !== undefined && restoredValue !== null) {
        onRestoreRef.current?.(restoredValue, draft);
        setStatus('restored');
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = window.setTimeout(() => setStatus('local'), restoredStatusMs);
      } else {
        onEmptyRef.current?.(valueRef.current);
      }
      setReadyKey(storageKey);
    };

    restore();
    return () => { active = false; };
  }, [enabled, legacySignature, normalizedLegacyKeys, restoredStatusMs, storageKey]);

  useEffect(() => {
    if (!enabled || readyKey !== storageKey || cancelledKeyRef.current === storageKey) return undefined;
    const entry = {
      key: storageKey,
      route: `${routePrefix}:${keySuffix || 'new'}`,
      data: { hookValue: value },
    };
    saveDraftBackup(entry);
    setStatus('saving');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (cancelledKeyRef.current === storageKey) return;
      saveChainRef.current = saveChainRef.current.catch(() => {}).then(() => saveDraft(entry));
      saveChainRef.current
        .then(() => {
          if (cancelledKeyRef.current === storageKey) return;
          setStatus('local');
          window.dispatchEvent(new CustomEvent('dms-offline-editing-complete', {
            detail: { source: `${namespace}-draft`, key: storageKey },
          }));
        })
        .catch(() => setStatus('error'));
    }, Math.max(0, Number(saveDelayMs) || 0));
    return () => window.clearTimeout(timerRef.current);
  }, [enabled, keySuffix, namespace, readyKey, routePrefix, saveDelayMs, storageKey, value]);

  useEffect(() => {
    if (!enabled || readyKey !== storageKey) return undefined;
    const flush = () => {
      if (cancelledKeyRef.current === storageKey) return;
      saveDraftBackup({
        key: storageKey,
        route: `${routePrefix}:${keySuffix || 'new'}`,
        data: { hookValue: valueRef.current },
      });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [enabled, keySuffix, readyKey, routePrefix, storageKey]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(statusTimerRef.current);
  }, []);

  return {
    status,
    clearDraft: () => {
      cancelledKeyRef.current = storageKey;
      window.clearTimeout(timerRef.current);
      saveChainRef.current.catch(() => {}).then(() => deleteDraft(storageKey)).catch(() => {});
      normalizedLegacyKeys.forEach((legacyKey) => {
        try { localStorage.removeItem(legacyKey); } catch { /* Sin efecto. */ }
      });
      setStatus('idle');
    },
    markServerSaved: () => setStatus('server'),
    storageKey,
  };
}
