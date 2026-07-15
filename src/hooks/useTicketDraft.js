import { useEffect, useMemo, useRef, useState } from 'react';
import { todayInCostaRica } from '../utils/costaRicaDate';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function safeParse(value) { try { return JSON.parse(value); } catch { return null; } }

export default function useTicketDraft({ keySuffix, enabled, value, onRestore }) {
  const storageKey = useMemo(() => `dms_boleta_draft_${keySuffix || 'new'}`, [keySuffix]);
  const [status, setStatus] = useState('idle');
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    const draft = safeParse(localStorage.getItem(storageKey));

    if (!draft) {
      const currentDate = String(value?.form?.fecha || '');
      const utcToday = new Date().toISOString().slice(0, 10);
      const costaRicaToday = todayInCostaRica();
      if ((keySuffix || 'new') === 'new' && (!currentDate || currentDate === utcToday) && currentDate !== costaRicaToday) {
        onRestore?.({ form: { ...(value?.form || {}), fecha: costaRicaToday } });
      }
      return;
    }

    if (!draft.savedAt || Date.now() - draft.savedAt > MAX_AGE_MS) { localStorage.removeItem(storageKey); return; }
    if (window.confirm('Se encontró un borrador guardado automáticamente. ¿Desea recuperarlo?')) { onRestore?.(draft.value || {}); setStatus('restored'); }
    else localStorage.removeItem(storageKey);
  }, [enabled, storageKey, keySuffix, onRestore, value]);

  useEffect(() => {
    if (!enabled || !restoredRef.current) return undefined;
    setStatus('saving');
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), value })); setStatus('local'); }
      catch { setStatus('error'); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [enabled, storageKey, value]);

  return {
    status,
    clearDraft: () => { localStorage.removeItem(storageKey); setStatus('idle'); },
    markServerSaved: () => setStatus('server'),
    storageKey,
  };
}
