import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
  getEntityQueueState,
  listQueuedOperations,
} from '../../services/offlineStore';
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

  const refresh = useCallback(async () => {
    const operations = await listQueuedOperations().catch(() => []);
    setAllFinalizations(operations.filter((operation) => operation.kind === 'maintenanceFinalize'));
    if (!maintenanceId) {
      setRow(null);
      setQueueState({ operations: [] });
      return;
    }

    const [state, data] = await Promise.all([
      getEntityQueueState(maintenanceId).catch(() => ({ operations: [] })),
      requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken).catch(() => null),
    ]);
    setQueueState(state || { operations: [] });
    const maintenance = data?.mantenimiento || data || null;
    setRow(maintenance ? {
      ...maintenance,
      DispositivosRegistrados: pick(maintenance, ['DispositivosRegistrados'], (data?.dispositivos || data?.devices || []).length),
    } : null);
  }, [maintenanceId, sessionToken]);

  useEffect(() => {
    refresh();
    const handleChange = () => refresh();
    const handleOnline = () => { setOnline(true); refresh(); };
    const handleOffline = () => { setOnline(false); refresh(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', handleChange);
    window.addEventListener('dms-offline-sync-start', handleChange);
    window.addEventListener('dms-offline-sync-complete', handleChange);
    window.addEventListener('dms-offline-sync-error', handleChange);
    window.addEventListener('dms-maintenance-finalization-queued', handleChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', handleChange);
      window.removeEventListener('dms-offline-sync-start', handleChange);
      window.removeEventListener('dms-offline-sync-complete', handleChange);
      window.removeEventListener('dms-offline-sync-error', handleChange);
      window.removeEventListener('dms-maintenance-finalization-queued', handleChange);
    };
  }, [refresh]);

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
    const intervalId = window.setInterval(() => refresh(), 2500);
    return () => window.clearInterval(intervalId);
  }, [maintenanceId, online, refresh, view.active, view.completed]);

  const status = clean(pick(row, ['Estado'], '')).toUpperCase();
  const devices = Number(pick(row, ['DispositivosRegistrados'], 0) || 0);
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
      ? '¿Reintentar la finalización? La firma del cliente no es obligatoria y las boletas pueden generarse sin firma.'
      : deferredNeeded
        ? '¿Guardar la finalización para ejecutarla después de sincronizar todos los cambios? La firma es opcional.'
        : '¿Finalizar este mantenimiento? Si no existe firma, las boletas y PDF se generarán sin firma.';
    if (!window.confirm(prompt)) return;
    setWorkingRetry(retry);
    setWorking(true);
    setMessage('');
    try {
      const result = await requestMaintenanceFinalization({ maintenanceId, sessionToken, retry });
      setMessage(result?.message || (result?.offlineQueued
        ? 'La finalización quedó pendiente de sincronización.'
        : 'El mantenimiento fue finalizado.'));
      await refresh();
    } catch (error) {
      setMessage(error?.message || 'No se pudo procesar la finalización.');
      await refresh();
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
          ? retryFromError ? 'Reintentando...' : 'Procesando...'
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

  const statusMessage = working && !view.active
    ? 'Preparando las boletas automáticas. La firma no es obligatoria.'
    : message || view.error || (view.blocked
      ? 'Resuelva primero el conflicto de sincronización.'
      : view.active
        ? 'El proceso continuará desde el último paso confirmado.'
        : '');
  const displayProgress = view.active ? view.progress : working ? 5 : 0;
  const displayLabel = working && !view.active
    ? workingRetry ? 'Reintentando finalización' : 'Iniciando finalización'
    : view.active ? view.label : 'Estado de finalización';

  const blockingOverlay = working && typeof document !== 'undefined'
    ? createPortal(
      <div className="maintenance-finalization-blocking" role="alert" aria-live="assertive" aria-busy="true">
        <div className="maintenance-finalization-blocking__card">
          <span className="maintenance-finalization-blocking__spinner"><Icon name="progress_activity" /></span>
          <span className="maintenance-finalization-blocking__eyebrow">Finalización de mantenimiento</span>
          <h2>{workingRetry ? 'Reintentando finalización' : 'Finalizando mantenimiento'}</h2>
          <p>{view.active ? view.label : 'Validando el mantenimiento y preparando las boletas automáticas...'}</p>
          <div className="maintenance-finalization-blocking__progress" aria-label={`${Math.max(displayProgress, 5)}% completado`}>
            <span style={{ width: `${Math.max(displayProgress, 5)}%` }} />
          </div>
          <small>No cierre la aplicación mientras se generan y envían las boletas. La firma del cliente es opcional.</small>
        </div>
      </div>,
      document.body,
    )
    : null;

  if (!showStatus) return <>{footerButton}{blockingOverlay}</>;

  return (
    <>
      {footerButton}
      {blockingOverlay}
      <aside className={`maintenance-finalization-center${view.canRetry ? ' has-error' : ''}`} role="status" aria-live="polite">
        <div className="maintenance-finalization-center__heading">
          <span className="maintenance-finalization-center__icon"><Icon name={view.canRetry ? 'error' : view.completed ? 'task_alt' : 'pending_actions'} /></span>
          <div>
            <strong>{displayLabel}</strong>
            {statusMessage && <small>{statusMessage}</small>}
          </div>
        </div>

        {(working || view.active) && !view.completed && (
          <div className="maintenance-finalization-center__progress" aria-label={`${displayProgress}% completado`}><span style={{ width: `${displayProgress}%` }} /></div>
        )}

        <div className="maintenance-finalization-center__actions">
          {view.canRetry && (
            <button type="button" onClick={() => finalize({ retry: true })} disabled={working || view.blocked}>
              <Icon name="refresh" />{working ? 'Reintentando...' : 'Reintentar finalización'}
            </button>
          )}
          {!maintenanceId && allFinalizations.length > 0 && (
            <span>{allFinalizations.length} finalización{allFinalizations.length === 1 ? '' : 'es'} pendiente{allFinalizations.length === 1 ? '' : 's'}.</span>
          )}
        </div>
      </aside>
    </>
  );
}
