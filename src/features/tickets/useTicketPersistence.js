import { useCallback, useEffect, useState } from 'react';
import { isAbortError } from '../../services/requestErrors';
import { validateTicketForm } from './ticketFormDomain';
import {
  autosaveTicket,
  runTicketPostSaveAction,
  saveTicketBase,
} from './ticketPersistenceService';

export default function useTicketPersistence({
  editing,
  loading,
  boletaUid,
  form,
  evidences,
  sessionToken,
  clearDraft,
  navigate,
  setError,
}) {
  const [saving, setSaving] = useState(false);
  const [serverStatus, setServerStatus] = useState('idle');

  useEffect(() => {
    if (!editing || loading) return undefined;
    const controller = new AbortController();
    setServerStatus('saving');
    const timer = setTimeout(() => {
      autosaveTicket({
        form,
        boletaUid,
        sessionToken,
        signal: controller.signal,
      })
        .then(() => {
          if (!controller.signal.aborted) setServerStatus('server');
        })
        .catch((error) => {
          if (!controller.signal.aborted && !isAbortError(error)) setServerStatus('error');
        });
    }, 1800);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [editing, loading, boletaUid, form, sessionToken]);

  const action = useCallback(async (type) => {
    const message = validateTicketForm(form);
    if (message) {
      setError(message);
      return null;
    }
    if (['finalize', 'test'].includes(type) && !form.firma && !editing) {
      setError('Registre la firma antes de continuar.');
      return null;
    }

    setSaving(true);
    setError('');
    try {
      const uid = await saveTicketBase({
        editing,
        boletaUid,
        form,
        evidences,
        sessionToken,
      });
      await runTicketPostSaveAction({ type, uid, form, sessionToken });
      await clearDraft();
      navigate(`/boletas/${encodeURIComponent(uid)}`);
      return uid;
    } catch (error) {
      setError(error.message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [boletaUid, clearDraft, editing, evidences, form, navigate, sessionToken, setError]);

  return {
    action,
    saving,
    serverStatus,
  };
}
