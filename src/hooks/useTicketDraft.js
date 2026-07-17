import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft, saveDraftBackup } from '../services/draftStore';
import { todayInCostaRica } from '../utils/costaRicaDate';

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

export default function useTicketDraft({ keySuffix, enabled, value, onRestore }) {
  const storageKey = useMemo(() => `ticket-state:${keySuffix || 'new'}`, [keySuffix]);
  const legacyKey = useMemo(() => `dms_boleta_draft_${keySuffix || 'new'}`, [keySuffix]);
  const [status, setStatus] = useState('idle');
  const [readyKey, setReadyKey] = useState('');
  const restoredKeyRef = useRef('');
  const cancelledKeyRef = useRef('');
  const onRestoreRef = useRef(onRestore);
  const valueRef = useRef(value);
  const timerRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  onRestoreRef.current = onRestore;
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
        const legacy = safeParse(localStorage.getItem(legacyKey));
        if (legacy?.value) {
          draft = {
            key: storageKey,
            route: `legacy:${legacyKey}`,
            data: { hookValue: legacy.value },
            updatedAt: Number(legacy.savedAt || Date.now()),
          };
          await saveDraft(draft).catch(() => {});
          try { localStorage.removeItem(legacyKey); } catch { /* Sin efecto. */ }
        }
      }

      if (!active) return;
      const restoredValue = draft?.data?.hookValue;
      if (restoredValue) {
        onRestoreRef.current?.(restoredValue);
        setStatus('restored');
        window.setTimeout(() => setStatus('local'), 3_500);
      } else {
        const currentDate = String(valueRef.current?.form?.fecha || '');
        const utcToday = new Date().toISOString().slice(0, 10);
        const costaRicaToday = todayInCostaRica();
        if ((keySuffix || 'new') === 'new'
          && (!currentDate || currentDate === utcToday)
          && currentDate !== costaRicaToday) {
          onRestoreRef.current?.({
            form: { ...(valueRef.current?.form || {}), fecha: costaRicaToday },
          });
        }
      }
      setReadyKey(storageKey);
    };

    restore();
    return () => { active = false; };
  }, [enabled, keySuffix, legacyKey, storageKey]);

  useEffect(() => {
    if (!enabled
      || readyKey !== storageKey
      || cancelledKeyRef.current === storageKey) return undefined;
    const entry = {
      key: storageKey,
      route: `ticket-hook:${keySuffix || 'new'}`,
      data: { hookValue: value },
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
            detail: { source: 'ticket-draft', key: storageKey },
          }));
        })
        .catch(() => setStatus('error'));
    }, 250);
    return () => window.clearTimeout(timerRef.current);
  }, [enabled, keySuffix, readyKey, storageKey, value]);

  useEffect(() => {
    if (!enabled || readyKey !== storageKey) return undefined;
    const flush = () => {
      if (cancelledKeyRef.current === storageKey) return;
      saveDraftBackup({
        key: storageKey,
        route: `ticket-hook:${keySuffix || 'new'}`,
        data: { hookValue: valueRef.current },
      });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [enabled, keySuffix, readyKey, storageKey]);

  return {
    status,
    clearDraft: () => {
      cancelledKeyRef.current = storageKey;
      window.clearTimeout(timerRef.current);
      saveChainRef.current
        .catch(() => {})
        .then(() => deleteDraft(storageKey))
        .catch(() => {});
      try { localStorage.removeItem(legacyKey); } catch { /* Sin efecto. */ }
      setStatus('idle');
    },
    markServerSaved: () => setStatus('server'),
    storageKey,
  };
}
