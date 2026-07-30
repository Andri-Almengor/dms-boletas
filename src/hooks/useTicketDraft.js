import { useCallback, useMemo } from 'react';
import useFormDraft from './useFormDraft';
import { todayInCostaRica } from '../utils/costaRicaDate';

export default function useTicketDraft({ keySuffix, enabled, value, onRestore }) {
  const normalizedSuffix = keySuffix || 'new';
  const legacyKeys = useMemo(() => [`dms_boleta_draft_${normalizedSuffix}`], [normalizedSuffix]);

  const handleEmpty = useCallback((currentValue) => {
    const currentDate = String(currentValue?.form?.fecha || '');
    const utcToday = new Date().toISOString().slice(0, 10);
    const costaRicaToday = todayInCostaRica();
    if (normalizedSuffix === 'new'
      && (!currentDate || currentDate === utcToday)
      && currentDate !== costaRicaToday) {
      onRestore?.({
        form: { ...(currentValue?.form || {}), fecha: costaRicaToday },
      });
    }
  }, [normalizedSuffix, onRestore]);

  return useFormDraft({
    namespace: 'ticket-state',
    keySuffix: normalizedSuffix,
    routePrefix: 'ticket-hook',
    legacyKeys,
    enabled,
    value,
    onRestore,
    onEmpty: handleEmpty,
    saveDelayMs: 250,
  });
}
