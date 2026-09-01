import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { getEntityQueueState, listQueuedOperations } from '../../services/offlineStore';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  cancelScheduledMaintenanceFinalization,
  requestMaintenanceFinalization,
} from '../../services/maintenanceFinalization';
import {
  MAINTENANCE_FINALIZATION_MODES,
  maintenanceFinalizationView,
} from '../../services/maintenanceFinalizationDomain';
import './MaintenanceFinalizationCenter.css';

function currentMaintenanceId(pathname) {
  const match = pathname.match(/^\/mantenimientos\/([^/]+)(?:\/editar)?\/?$/);
  if (!match || ['nuevo'].includes(String(match[1] || '').toLowerCase())) return '';
  return decodeURIComponent(match[1]);
}

function isMaintenanceDetailRoute(pathname) {
  return /^\/mantenimientos\/[^/]+\/?$/.test(pathname);
}

function clean(value) {
  return String(value ?? '').trim();
}

function mergeStatus(current, data) {
  const maintenance = data?.mantenimiento || data || null;
  if (!maintenance) return current;
  return { ...(current || {}), ...maintenance };
}

function formattedSchedule(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'hoy a las 5:00 p. m.';
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function costaRicaHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Costa_Rica',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  return Number.isFinite(hour) ? hour : 0;
}

function canScheduleForFiveToday() {
  return costaRicaHour() < 17;
}

export default function MaintenanceFinalizationCenter() {
  const { pathname } = useLocation();
  const { sessionToken, hasPermission } = useAuth();
  const maintenanceId = useMemo(() => currentMaintenanceId(pathname), [pathname]);
  const detailRoute = useMemo(() => isMaintenanceDetailRoute(pathname), [pathname]);
  const canFinalize = hasPermission('USUARIOS_GESTIONAR');
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [row, setRow] = useState(null);
  const [queueState, setQueueState] = useState({ operations: [] });
  const [allFinalizations, setAllFinalizations] = useState([]);
  const [working, setWorking] = useState(false);
  const [workingRetry, setWorkingRetry] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [message, setMessage] = useState('');
  const [footerTarget, setFooterTarget] = useState(null);
  const [choiceOpen, setChoiceOpen] = useState(false);

  const refreshQueue = useCallback(async () => {
    const operations = await listQueuedOperations().catch(() => []);
    setAllFinalizations(operations.filter((operation) => operation.kind === 'maintenanceFinalize'));
    if (!maintenanceId) {
      setQueueState({ operations: [] });
      return;
    }
    setQueueState(await getEntityQueueState(maintenanceId).catch(() => ({ operations: [] })));
  }, [maintenanceId]);

  const refreshFull = useCallback(async () => {
    await refreshQueue();
    if (!maintenanceId) {
      setRow(null);
      return;
    }
    const data = await requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken).catch(() => null);
    const maintenance = data?.mantenimiento || data || null;
    if (!maintenance) return;
    setRow({
      ...maintenance,
      DispositivosRegistrados: pick(
        maintenance,
        ['DispositivosRegistrados'],
        (data?.dispositivos || data?.devices || []).length,
      ),
    });
  }, [maintenanceId, refreshQueue, sessionToken]);

  const refreshStatus = useCallback(async () => {
    if (!maintenanceId) return;
    const data = await requestAvailable(
      MODULE_ROUTES.maintenance.get,
      { maintenanceId, finalizationStatusOnly: true },
      sessionToken,
    ).catch(() => null);
    if (data) setRow((current) => mergeStatus(current, data));
    await refreshQueue();
  }, [maintenanceId, refreshQueue, sessionToken]);

  useEffect(() => {
    refreshFull();
    const handleChange = () => refreshFull();
    const handleOnline = () => { setOnline(true); refreshFull(); };
    const handleOffline = () => { setOnline(false); refreshQueue(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', handleChange);
    window.addEventListener('dms-offline-sync-complete', handleChange);
    window.addEventListener('dms-offline-sync-error', handleChange);
    window.addEventListener('dms-maintenance-finalization-queued', handleChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', handleChange);
      window.removeEventListener('dms-offline-sync-complete', handleChange);
      window.removeEventListener('dms-offline-sync-error', handleChange);
      window.removeEventListener('dms-maintenance-finalization-queued', handleChange);
    };
  }, [refreshFull, refreshQueue]);

  useEffect(() => {
    setChoiceOpen(false);
  }, [maintenanceId, pathname]);

  useEffect(() => {
    if (!detailRoute) {
      setFooterTarget(null);
      return undefined;
    }
    const resolveTarget = () => setFooterTarget(document.querySelector('.maintenance-detail-footer-actions'));
    resolveTarget();
    const timer = window.setTimeout(resolveTarget, 100);
    return () => window.clearTimeout(timer);
  }, [detailRoute, pathname, row]);

  const operation = useMemo(() => (
    (queueState.operations || []).find((item) => item.kind === 'maintenanceFinalize') || null
  ), [queueState.operations]);
  const view = useMemo(() => maintenanceFinalizationView(row || {}, operation), [row, operation]);

  useEffect(() => {
    if (!maintenanceId || !online || !view.active || view.completed) return undefined;
    refreshStatus();
    if (view.scheduled) {
      const scheduledIntervalId = window.setInterval(refreshStatus, 30_000);
      return () => window.clearInterval(scheduledIntervalId);
    }
    const intervalId = window.setInterval(refreshStatus, 5_000);
    return () => window.clearInterval(intervalId);
  }, [maintenanceId, online, refreshStatus, view.active, view.completed, view.scheduled]);

  const status = clean(pick(row, ['Estado'], '')).toUpperCase();
  const devices = Number(pick(row, ['DispositivosRegistrados', 'FinalizacionTotalDispositivos'], 0) || 0);
  const hasUnsynchronizedChanges = (queueState.operations || []).some((item) => item.kind !== 'maintenanceFinalize');
  const deferredNeeded = !online || hasUnsynchronizedChanges || Boolean(pick(row, ['OfflinePendiente'], false));
  const canRequest = Boolean(
    maintenanceId
    && detailRoute
    && canFinalize
    && row
    && status === 'PENDIENTE'
    && devices > 0
    && (!view.active || view.canRetry)
    && !view.blocked,
  );
  const optionalSignatureNotice = 'Si no existe firma, las boletas y PDF se generarán sin firma.';

  async function finalize({ retry = false, mode = MAINTENANCE_FINALIZATION_MODES.AUTO } = {}) {
    if (!maintenanceId || working) return;
    const normalizedMode = retry ? MAINTENANCE_FINALIZATION_MODES.NOW : mode;
    const prompt = retry
      ? '¿Reanudar la finalización desde la unidad que falló? Todo lo ya completado se conservará.'
      : normalizedMode === MAINTENANCE_FINALIZATION_MODES.NOW
        ? deferredNeeded
          ? `¿Finalizar en cuanto termine la sincronización? El servidor iniciará el proceso sin esperar a las 5:00 p. m. ${optionalSignatureNotice}`
          : `¿Finalizar este mantenimiento ahora? El procesamiento escalonado comenzará inmediatamente y puede cerrar la aplicación. ${optionalSignatureNotice}`
        : deferredNeeded
          ? `¿Programar la finalización para las 5:00 p. m.? Primero se sincronizarán los cambios pendientes. Si la sincronización termina después de las 5:00 p. m., el procesamiento comenzará en cuanto sea posible. ${optionalSignatureNotice}`
          : `¿Programar la finalización para hoy a las 5:00 p. m. hora Costa Rica? Hasta esa hora el mantenimiento quedará bloqueado y podrá cancelar la programación. ${optionalSignatureNotice}`;
    if (!window.confirm(prompt)) return;
    setChoiceOpen(false);
    setWorkingRetry(retry);
    setWorking(true);
    setMessage('');
    try {
      const result = await requestMaintenanceFinalization({
        maintenanceId,
        sessionToken,
        retry,
        mode: normalizedMode,
      });
      setMessage(result?.message || (result?.offlineQueued
        ? 'La finalización quedó pendiente de sincronización.'
        : result?.scheduled
          ? 'La finalización quedó programada para las 5:00 p. m.'
          : 'La finalización escalonada fue iniciada.'));
      if (result?.mantenimiento) setRow((current) => mergeStatus(current, result));
      await refreshStatus();
    } catch (error) {
      setMessage(error?.message || 'No se pudo solicitar la finalización.');
      await refreshStatus();
    } finally {
      setWorking(false);
      setWorkingRetry(false);
    }
  }

  function requestFinalizationChoice() {
    if (!canRequest || working) return;
    if (!canScheduleForFiveToday()) {
      finalize({ mode: MAINTENANCE_FINALIZATION_MODES.NOW });
      return;
    }
    setMessage('');
    setChoiceOpen(true);
  }

  async function cancelSchedule() {
    if (!maintenanceId || canceling || !view.canCancelSchedule) return;
    if (!window.confirm('¿Cancelar la finalización programada? El mantenimiento volverá a quedar pendiente y no se procesará automáticamente a las 5:00 p. m.')) return;
    setCanceling(true);
    setMessage('');
    try {
      const result = await cancelScheduledMaintenanceFinalization({ maintenanceId, sessionToken });
      if (result?.mantenimiento) setRow((current) => mergeStatus(current, result));
      setMessage(result?.message || 'La finalización programada fue cancelada.');
      await refreshFull();
    } catch (error) {
      setMessage(error?.message || 'No se pudo cancelar la finalización programada.');
      await refreshStatus();
    } finally {
      setCanceling(false);
    }
  }

  const retryFromError = view.canRetry;
  const footerButton = canRequest && footerTarget
    ? createPortal(
      <button
        className="button button--primary maintenance-finalize-footer-button"
        type="button"
        onClick={() => (retryFromError
          ? finalize({ retry: true, mode: MAINTENANCE_FINALIZATION_MODES.NOW })
          : requestFinalizationChoice())}
        disabled={working}
      >
        <Icon name={retryFromError ? 'refresh' : deferredNeeded ? 'schedule_send' : 'task_alt'} />
        {working
          ? retryFromError ? 'Reanudando...' : 'Solicitando...'
          : retryFromError ? 'Reintentar finalización'
            : deferredNeeded ? 'Finalizar al sincronizar' : 'Finalizar mantenimiento'}
      </button>,
      footerTarget,
    )
    : null;

  const showStatus = Boolean(
    choiceOpen
    || (!maintenanceId && allFinalizations.length)
    || (maintenanceId && (working || view.active || message)),
  );
  if (!showStatus) return <>{footerButton}</>;

  const storedProgress = Number(pick(row, ['FinalizacionProgreso'], 0) || 0);
  const displayProgress = Math.max(0, Math.min(100, storedProgress || (view.active ? view.progress : working ? 2 : 0)));
  const ticketTotal = Number(pick(row, ['FinalizacionTotalBoletas'], 0) || 0);
  const ticketDone = Number(pick(row, ['FinalizacionBoletasCompletadas'], 0) || 0);
  const deviceTotal = Number(pick(row, ['FinalizacionTotalDispositivos'], 0) || 0);
  const deviceDone = Number(pick(row, ['FinalizacionDispositivosCompletados'], 0) || 0);
  const evidenceTotal = Number(pick(row, ['FinalizacionTotalEvidencias'], 0) || 0);
  const evidenceDone = Number(pick(row, ['FinalizacionEvidenciasProcesadas'], 0) || 0);
  const storedMessage = clean(pick(row, ['FinalizacionMensaje'], ''));
  const statusMessage = view.error || storedMessage || message || (view.scheduled
    ? `Se procesará automáticamente ${formattedSchedule(view.scheduledAt)}. Puede cerrar la aplicación.`
    : view.active
      ? 'La finalización continúa en segundo plano y guarda cada paso confirmado.'
      : '');

  return (
    <>
      {footerButton}
      <aside className={`maintenance-finalization-center${view.canRetry ? ' has-error' : ''}${view.scheduled ? ' is-scheduled' : ''}${choiceOpen ? ' is-choice' : ''}`} role="status" aria-live="polite">
        {choiceOpen ? (
          <>
            <div className="maintenance-finalization-center__heading">
              <span className="maintenance-finalization-center__icon"><Icon name="schedule" /></span>
              <div>
                <strong>¿Cuándo desea finalizar el mantenimiento?</strong>
                <small>Puede iniciar el procesamiento ahora o dejarlo programado para hoy a las 5:00 p. m. hora Costa Rica.</small>
                {deferredNeeded && (
                  <small>Hay cambios pendientes de sincronización; la opción elegida se conservará en la cola.</small>
                )}
              </div>
            </div>
            <div className="maintenance-finalization-center__actions">
              <button
                type="button"
                onClick={() => finalize({ mode: MAINTENANCE_FINALIZATION_MODES.NOW })}
                disabled={working}
              >
                <Icon name="play_arrow" />Finalizar ahora
              </button>
              <button
                type="button"
                onClick={() => finalize({ mode: MAINTENANCE_FINALIZATION_MODES.FIVE_PM })}
                disabled={working}
              >
                <Icon name="schedule" />Programar para las 5:00 p. m.
              </button>
              <button type="button" onClick={() => setChoiceOpen(false)} disabled={working}>
                <Icon name="close" />Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="maintenance-finalization-center__heading">
              <span className="maintenance-finalization-center__icon">
                <Icon name={view.canRetry ? 'error' : view.completed ? 'task_alt' : view.scheduled ? 'schedule' : 'pending_actions'} />
              </span>
              <div>
                <strong>{view.completed ? 'Mantenimiento finalizado' : working ? 'Procesando solicitud' : view.label}</strong>
                {statusMessage && <small>{statusMessage}</small>}
                {view.scheduled && view.scheduledAt && (
                  <small className="maintenance-finalization-center__scheduled-time">
                    Hora programada: {formattedSchedule(view.scheduledAt)} · Costa Rica
                  </small>
                )}
              </div>
            </div>

            {(working || (view.active && !view.scheduled)) && !view.completed && (
              <>
                <div className="maintenance-finalization-center__progress" aria-label={`${displayProgress}% completado`}>
                  <span style={{ width: `${displayProgress}%` }} />
                </div>
                <div className="maintenance-finalization-center__actions">
                  <span>{displayProgress}%</span>
                  {ticketTotal > 0 && <span>Boletas {ticketDone}/{ticketTotal}</span>}
                  {deviceTotal > 0 && <span>Dispositivos {deviceDone}/{deviceTotal}</span>}
                  {evidenceTotal > 0 && <span>Evidencias {evidenceDone}/{evidenceTotal}</span>}
                </div>
              </>
            )}

            <div className="maintenance-finalization-center__actions">
              {view.canCancelSchedule && (
                <button type="button" className="maintenance-finalization-center__cancel" onClick={cancelSchedule} disabled={canceling || !online}>
                  <Icon name="event_busy" />{canceling ? 'Cancelando...' : 'Cancelar finalización programada'}
                </button>
              )}
              {view.canRetry && (
                <button type="button" onClick={() => finalize({ retry: true, mode: MAINTENANCE_FINALIZATION_MODES.NOW })} disabled={working || view.blocked}>
                  <Icon name="refresh" />{workingRetry ? 'Reanudando...' : 'Reintentar desde el último paso'}
                </button>
              )}
              {view.scheduled && (
                <span>Puede cerrar el navegador o apagar este equipo. El servidor continuará mediante el worker programado.</span>
              )}
              {view.active && !view.scheduled && !view.canRetry && !view.completed && (
                <span>Puede continuar utilizando la aplicación. Si Render se reinicia, el avance persistido se reutilizará.</span>
              )}
              {!maintenanceId && allFinalizations.length > 0 && (
                <span>{allFinalizations.length} finalización{allFinalizations.length === 1 ? '' : 'es'} pendiente{allFinalizations.length === 1 ? '' : 's'}.</span>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
