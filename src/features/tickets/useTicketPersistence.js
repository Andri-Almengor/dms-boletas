import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { deleteDraft } from '../../services/draftStore';
import { isAbortError } from '../../services/requestErrors';
import { createLocalId } from '../../utils/localId';
import { releaseLocalFiles } from '../../utils/localFileLifecycle';
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
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [activeAction, setActiveAction] = useState('');
  const [serverStatus, setServerStatus] = useState('idle');
  const createTicketUidRef = useRef('');
  const createActionInFlightRef = useRef(false);
  const recoveryScope = String(user?.UsuarioID || user?.Correo || 'public');
  const recoveryRoute = editing ? `/boletas/${boletaUid}/editar` : '/boletas/nueva';
  const recoveryDraftKey = `${recoveryScope}:${recoveryRoute}`;

  // La creación conserva un único identificador durante toda la vida del
  // formulario. Así, incluso si una solicitud se repite por doble toque o por
  // una respuesta ambigua de red, el backend reconoce la misma boleta y no
  // consume un consecutivo adicional.
  if (!editing && !createTicketUidRef.current) {
    createTicketUidRef.current = createLocalId('boleta');
  }

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

    // setState no bloquea de forma sincrónica dos eventos táctiles consecutivos.
    // El ref sí se actualiza antes de iniciar la primera solicitud y evita que
    // un segundo toque llegue al backend mientras React actualiza el botón.
    if (!editing && createActionInFlightRef.current) return null;
    if (!editing) createActionInFlightRef.current = true;

    setActiveAction(type);
    setSaving(true);
    setError('');
    let completed = false;
    try {
      const uid = await saveTicketBase({
        editing,
        boletaUid: editing ? boletaUid : createTicketUidRef.current,
        form,
        evidences,
        sessionToken,
        actionType: type,
      });
      await runTicketPostSaveAction({ type, uid, form, sessionToken });
      releaseLocalFiles(evidences);

      // Hay dos capas de recuperación: el borrador controlado del formulario
      // y la captura global por ruta. Ambas deben desaparecer antes de navegar.
      // Esperar las eliminaciones evita que una nueva boleta alcance a leer el
      // borrador anterior mientras IndexedDB todavía lo está borrando.
      await clearDraft();
      await deleteDraft(recoveryDraftKey);

      completed = true;
      navigate(`/boletas/${encodeURIComponent(uid)}`);
      return uid;
    } catch (error) {
      // Un fallo real permite reintentar, pero conserva el mismo BoletaUID para
      // que el backend devuelva la creación anterior si Google sí alcanzó a
      // guardar antes de producirse el error.
      if (!editing) createActionInFlightRef.current = false;
      setError(error.message);
      return null;
    } finally {
      // Después de una creación exitosa el bloqueo permanece hasta que la
      // navegación desmonte el formulario. En edición se conserva el flujo
      // anterior y, ante error de creación, el usuario puede reintentar.
      if (editing || !completed) {
        setSaving(false);
        setActiveAction('');
      }
    }
  }, [boletaUid, clearDraft, editing, evidences, form, navigate, recoveryDraftKey, sessionToken, setError]);

  return {
    action,
    saving,
    activeAction,
    serverStatus,
  };
}
