import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { getEntityQueueState, listQueuedOperations } from '../../services/offlineStore';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { requestMaintenanceFinalization } from '../../services/maintenanceFinalization';
import { maintenanceFinalizationView } from '../../services/maintenanceFinalizationDomain';
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
  const [message, setMessage] = useState('');
  const [footerTarget, setFooterTarget] = useState(null);

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
    const intervalId = window.setInterval(refreshStatus, 5_000);
    return () => window.clearInterval(intervalId);
  }, [maintenanceId, online, refreshStatus, view.active, view.completed]);

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

  async function finalize({ retry = false } = {}) {
    if (!maintenanceId || working) return;
    const prompt = retry
      ? '¿Reanudar la finalización desde la unidad que falló? Todo lo ya completado se conservará.'
      : deferredNeeded
        ? '¿Guardar la finalización para ejecutarla después de sincronizar todos los cambios?'
        : '¿Iniciar la finalización escalonada? El proceso guardará el avance automáticamente y puede tardar según el tamaño del mantenimiento.';
    if (!window.confirm(prompt)) return;
    setWorkingRetry(retry);
    setWorking(true);
    setMessage('');
    try {
      const result = await requestMaintenanceFinalization({ maintenanceId, sessionToken, retry });
      setMessage(result?.message || (result?.offlineQueued
        ? 'La finalización quedó pendiente de sincronización.'
        : 'La finalización escalonada fue iniciada.'));
      if (result?.mantenimiento) setRow((current) => mergeStatus(current, result));
      await refreshStatus();
    } catch (error) {
      setMessage(error?.message || 'No se pudo iniciar la finalización.');
      await refreshStatus();
    } finally {
      setWorking(false);
      setWorkingRetry(false);
    }
  }

  const retryFromError = view.canRetry;
  const footerButton = canRequest && footerTarget
    ? createPortal(
      <button
        className="button button--primary maintenance-finalize-footer-button"
        type="button"
        onClick={() => finalize({ retry: retryFromError })}
        disabled={working}
      >
        <Icon name={retryFromError ? 'refresh' : deferredNeeded ? 'schedule_send' : 'task_alt'} />
        {working
          ? retryFromError ? 'Reanudando...' : 'Iniciando...'
          : retryFromError ? 'Reintentar finalización'
            : deferredNeeded ? 'Finalizar al sincronizar' : 'Finalizar mantenimiento'}
      </button>,
      footerTarget,
    )
    : null;

  const showStatus = Boolean(
    (!maintenanceId && allFinalizations.length)
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
  const statusMessage = message || view.error || storedMessage || (view.active
    ? 'La finalización continúa en segundo plano y guarda cada paso confirmado.'
    : '');

  return (
    <>
      {footerButton}
      <aside className={`maintenance-finalization-center${view.canRetry ? ' has-error' : ''}`} role="status" aria-live="polite">
        <div className="maintenance-finalization-center__heading">
          <span className="maintenance-finalization-center__icon">
            <Icon name={view.canRetry ? 'error' : view.completed ? 'task_alt' : 'pending_actions'} />
          </span>
          <div>
            <strong>{view.completed ? 'Mantenimiento finalizado' : working ? 'Iniciando finalización' : view.label}</strong>
            {statusMessage && <small>{statusMessage}</small>}
          </div>
        </div>

        {(working || view.active) && !view.completed && (
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
          {view.canRetry && (
            <button type="button" onClick={() => finalize({ retry: true })} disabled={working || view.blocked}>
              <Icon name="refresh" />{workingRetry ? 'Reanudando...' : 'Reintentar desde el último paso'}
            </button>
          )}
          {view.active && !view.canRetry && !view.completed && (
            <span>Puede continuar utilizando la aplicación. Si Render se reinicia, el avance persistido se reutilizará.</span>
          )}
          {!maintenanceId && allFinalizations.length > 0 && (
            <span>{allFinalizations.length} finalización{allFinalizations.length === 1 ? '' : 'es'} pendiente{allFinalizations.length === 1 ? '' : 's'}.</span>
          )}
        </div>
      </aside>
    </>
  );
}
