import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
  getEntityQueueState,
  listQueuedOperations,
  queuedOperationCount,
  removeQueuedOperation,
  updateQueuedOperation,
} from '../../services/offlineStore';
import {
  isNetworkError,
  preloadOfflineCatalogs,
  replayQueuedOperation,
} from '../../services/moduleApi';

const AUTO_SYNC_DELAY_MS = 8_000;
const AUTO_SYNC_IDLE_MS = 12_000;
const SAVE_GRACE_PERIOD_MS = 20_000;
const PERIODIC_RETRY_MS = 60_000;

const EDITABLE_SELECTOR = [
  'input:not([readonly]):not([disabled])',
  'textarea:not([readonly]):not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  'canvas',
].join(',');

function isAuthenticationError(error) {
  return Number(error?.status || 0) === 401
    || String(error?.code || '').toUpperCase() === 'UNAUTHORIZED';
}

function currentEntity(pathname) {
  const ticket = pathname.match(/^\/boletas\/([^/]+)/);
  if (ticket && ticket[1] !== 'nueva' && !['pendientes', 'finalizadas'].includes(ticket[1])) {
    return { type: 'boleta', id: decodeURIComponent(ticket[1]) };
  }
  const maintenance = pathname.match(/^\/mantenimientos\/([^/]+)/);
  if (maintenance && maintenance[1] !== 'nuevo') {
    return { type: 'mantenimiento', id: decodeURIComponent(maintenance[1]) };
  }
  return null;
}

function isCreateWorkflow(pathname) {
  return pathname === '/boletas/nueva'
    || pathname === '/mantenimientos/nuevo'
    || /\/boletas\/[^/]+\/nueva-visita$/.test(pathname);
}

function isEditingElement(target) {
  if (!(target instanceof Element)) return false;
  if (!target.matches(EDITABLE_SELECTOR) && !target.closest(EDITABLE_SELECTOR)) return false;
  return Boolean(
    target.closest('form')
    || target.closest('.signature-pad')
    || target.closest('.evidence-uploader')
    || target.closest('[data-offline-editing-surface]')
    || target.matches('input[type="file"]'),
  );
}

function hasFocusedEditor() {
  const active = document.activeElement;
  return active instanceof Element && isEditingElement(active);
}

export default function OfflineSyncManager() {
  const { sessionToken } = useAuth();
  const location = useLocation();
  const entity = useMemo(() => currentEntity(location.pathname), [location.pathname]);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [pending, setPending] = useState(0);
  const [entityPending, setEntityPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [message, setMessage] = useState('');
  const syncingRef = useRef(false);
  const retryTimerRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastInteractionRef = useRef(0);
  const holdUntilRef = useRef(0);

  const refreshCount = useCallback(async () => {
    const count = await queuedOperationCount().catch(() => 0);
    setPending(count);
    return count;
  }, []);

  const refreshEntityState = useCallback(async () => {
    if (!entity?.id) {
      setEntityPending(0);
      return 0;
    }
    const state = await getEntityQueueState(entity.id).catch(() => ({ pending: 0 }));
    setEntityPending(Number(state.pending || 0));
    return Number(state.pending || 0);
  }, [entity?.id]);

  const shouldPauseAutomaticSync = useCallback(() => {
    if (dirtyRef.current) return true;
    if (Date.now() < holdUntilRef.current) return true;
    if (Date.now() - lastInteractionRef.current < AUTO_SYNC_IDLE_MS) return true;
    return hasFocusedEditor();
  }, []);

  const synchronize = useCallback(async ({ forced = false } = {}) => {
    if (!sessionToken || navigator.onLine === false || syncingRef.current) {
      if (forced && navigator.onLine === false) {
        setMessage('No hay conexión. Los cambios permanecen guardados en este dispositivo.');
        window.dispatchEvent(new CustomEvent('dms-offline-sync-error', {
          detail: { message: 'No hay conexión a internet.' },
        }));
      }
      return;
    }

    if (!forced && shouldPauseAutomaticSync()) {
      setAutoPaused(true);
      return;
    }

    syncingRef.current = true;
    setSyncing(true);
    setAutoPaused(false);
    setOnline(true);
    setMessage(forced ? 'Sincronización manual iniciada...' : 'Sincronizando cambios pendientes...');
    window.dispatchEvent(new CustomEvent('dms-offline-sync-start', { detail: { forced } }));

    try {
      const operations = await listQueuedOperations().catch(() => []);
      if (!operations.length) {
        await Promise.all([
          preloadOfflineCatalogs(sessionToken).catch(() => {}),
          refreshCount(),
          refreshEntityState(),
        ]);
        setMessage(forced ? 'No había cambios pendientes. El contenido offline quedó actualizado.' : '');
        window.dispatchEvent(new CustomEvent('dms-offline-sync-complete', {
          detail: { forced, synchronized: 0, refreshMode: 'non-destructive' },
        }));
        if (forced) window.setTimeout(() => setMessage(''), 3500);
        return;
      }

      let synchronized = 0;
      for (const operation of operations) {
        await updateQueuedOperation(operation.id, {
          status: 'SYNCING',
          attempts: Number(operation.attempts || 0) + 1,
          lastError: '',
        });
        try {
          await replayQueuedOperation(operation, sessionToken);
          await removeQueuedOperation(operation.id);
          synchronized += 1;
          await Promise.all([refreshCount(), refreshEntityState()]);
        } catch (error) {
          await updateQueuedOperation(operation.id, {
            status: 'ERROR',
            lastError: String(error?.message || error),
          });
          await Promise.all([refreshCount(), refreshEntityState()]);
          let nextMessage = '';
          if (isNetworkError(error)) {
            setOnline(false);
            nextMessage = 'La conexión se interrumpió. Los cambios permanecen guardados y la finalización sigue bloqueada.';
          } else if (isAuthenticationError(error)) {
            nextMessage = 'Inicie sesión nuevamente para sincronizar los cambios guardados.';
          } else {
            nextMessage = `No se pudo sincronizar: ${error?.message || error}`;
          }
          setMessage(nextMessage);
          window.dispatchEvent(new CustomEvent('dms-offline-sync-error', {
            detail: { message: nextMessage, operationId: operation.id },
          }));
          return;
        }
      }

      await preloadOfflineCatalogs(sessionToken).catch(() => {});
      setMessage('Todos los cambios fueron sincronizados correctamente.');
      window.dispatchEvent(new CustomEvent('dms-offline-sync-complete', {
        detail: { forced, synchronized, refreshMode: 'non-destructive' },
      }));
      window.setTimeout(() => setMessage(''), 4500);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await Promise.all([refreshCount(), refreshEntityState()]);
    }
  }, [sessionToken, refreshCount, refreshEntityState, shouldPauseAutomaticSync]);

  const scheduleSync = useCallback((delay = AUTO_SYNC_DELAY_MS, options = {}) => {
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      if (navigator.onLine !== false) synchronize(options);
    }, delay);
  }, [synchronize]);

  useEffect(() => {
    dirtyRef.current = false;
    holdUntilRef.current = 0;
    lastInteractionRef.current = Date.now();
    setAutoPaused(false);
    setMessage('');

    Promise.all([refreshCount(), refreshEntityState()]).then(([count]) => {
      if (count > 0 && navigator.onLine !== false) scheduleSync(2_500);
    });
  }, [location.pathname, refreshCount, refreshEntityState, scheduleSync]);

  useEffect(() => {
    const markEditing = (event) => {
      if (!isEditingElement(event.target)) return;
      dirtyRef.current = true;
      lastInteractionRef.current = Date.now();
      setAutoPaused(true);
      window.clearTimeout(retryTimerRef.current);
    };

    const markInteraction = (event) => {
      if (!isEditingElement(event.target)) return;
      lastInteractionRef.current = Date.now();
    };

    const markSaving = (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      dirtyRef.current = false;
      lastInteractionRef.current = Date.now();
      holdUntilRef.current = Date.now() + SAVE_GRACE_PERIOD_MS;
      setAutoPaused(true);
      scheduleSync(SAVE_GRACE_PERIOD_MS + 1_000);
    };

    const releaseEditing = () => {
      dirtyRef.current = false;
      holdUntilRef.current = Date.now() + 1_500;
      setAutoPaused(false);
      scheduleSync(2_000);
    };

    document.addEventListener('input', markEditing, true);
    document.addEventListener('change', markEditing, true);
    document.addEventListener('pointerdown', markInteraction, true);
    document.addEventListener('submit', markSaving, true);
    window.addEventListener('dms-offline-editing-complete', releaseEditing);

    return () => {
      document.removeEventListener('input', markEditing, true);
      document.removeEventListener('change', markEditing, true);
      document.removeEventListener('pointerdown', markInteraction, true);
      document.removeEventListener('submit', markSaving, true);
      window.removeEventListener('dms-offline-editing-complete', releaseEditing);
    };
  }, [scheduleSync]);

  useEffect(() => {
    refreshCount();
    refreshEntityState();

    const handleOnline = () => {
      setOnline(true);
      scheduleSync(AUTO_SYNC_DELAY_MS);
    };
    const handleOffline = () => {
      setOnline(false);
      setMessage('Sin conexión. Puede continuar editando y agregando evidencias; se enviarán al reconectarse.');
    };
    const handleQueueChange = () => {
      Promise.all([refreshCount(), refreshEntityState()]).then(([count]) => {
        if (count > 0 && navigator.onLine !== false) scheduleSync(AUTO_SYNC_DELAY_MS);
      });
    };
    const handleManualSync = () => synchronize({ forced: true });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) scheduleSync(5_000);
    };
    const handleFocus = () => {
      if (navigator.onLine !== false) scheduleSync(5_000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('dms-offline-queue-change', handleQueueChange);
    window.addEventListener('dms-offline-sync-request', handleManualSync);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(retryTimerRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('dms-offline-queue-change', handleQueueChange);
      window.removeEventListener('dms-offline-sync-request', handleManualSync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshCount, refreshEntityState, scheduleSync, synchronize]);

  useEffect(() => {
    if (!sessionToken) return undefined;
    Promise.all([refreshCount(), refreshEntityState()]).then(([count]) => {
      if (navigator.onLine !== false && count > 0) scheduleSync(5_000);
      else if (navigator.onLine !== false) preloadOfflineCatalogs(sessionToken).catch(() => {});
    });

    const intervalId = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false || syncingRef.current) return;
      const count = await queuedOperationCount().catch(() => 0);
      if (count > 0 && !shouldPauseAutomaticSync()) synchronize();
    }, PERIODIC_RETRY_MS);

    return () => window.clearInterval(intervalId);
  }, [sessionToken, refreshCount, refreshEntityState, scheduleSync, shouldPauseAutomaticSync, synchronize]);

  const finalizationBlocked = navigator.onLine === false
    || entityPending > 0
    || (isCreateWorkflow(location.pathname) && navigator.onLine === false);

  useEffect(() => {
    document.body.classList.toggle('dms-entity-unsynced', finalizationBlocked);
    return () => document.body.classList.remove('dms-entity-unsynced');
  }, [finalizationBlocked]);

  if (online && !pending && !syncing && !message) return null;

  const pendingText = autoPaused && pending
    ? `Sincronización pausada mientras termina de editar. ${pending} cambio${pending === 1 ? '' : 's'} permanece${pending === 1 ? '' : 'n'} guardado${pending === 1 ? '' : 's'}.`
    : entityPending
      ? `${entityPending} cambio${entityPending === 1 ? '' : 's'} de este ${entity?.type || 'registro'} pendiente${entityPending === 1 ? '' : 's'}. Finalizar aparecerá al terminar.`
      : pending
        ? `${pending} cambio${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'} de envío.`
        : 'Los catálogos guardados continúan disponibles.';

  return (
    <aside className={`offline-status${online ? ' is-online' : ' is-offline'}${syncing ? ' is-syncing' : ''}`} role="status" aria-live="polite">
      <span className="offline-status__icon">
        <Icon name={syncing ? 'sync' : autoPaused ? 'edit_note' : online ? 'cloud_done' : 'cloud_off'} />
      </span>
      <div className="offline-status__body">
        <strong>{syncing ? 'Sincronizando' : autoPaused && pending ? 'Sincronización en pausa' : online ? 'Conexión disponible' : 'Trabajando sin conexión'}</strong>
        <small>{message || pendingText}</small>
      </div>
      {online && pending > 0 && !syncing && (
        <button type="button" onClick={() => synchronize({ forced: true })}>Sincronizar ahora</button>
      )}
    </aside>
  );
}
