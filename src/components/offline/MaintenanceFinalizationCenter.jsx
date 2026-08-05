import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

export default function MaintenanceFinalizationCenter() {
  const { pathname } = useLocation();
  const { sessionToken } = useAuth();
  const maintenanceId = useMemo(() => currentMaintenanceId(pathname), [pathname]);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [row, setRow] = useState(null);
  const [queueState, setQueueState] = useState({ operations: [] });
  const [allFinalizations, setAllFinalizations] = useState([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

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

  const operation = useMemo(() => (
    (queueState.operations || []).find((item) => item.kind === 'maintenanceFinalize') || null
  ), [queueState.operations]);
  const view = useMemo(() => maintenanceFinalizationView(row || {}, operation), [row, operation]);

  useEffect(() => {
    if (!maintenanceId || !online || !view.active || view.completed) return undefined;
    const intervalId = window.setInterval(() => refresh(), 2500);
    return () => window.clearInterval(intervalId);
  }, [maintenanceId, online, refresh, view.active, view.completed]);

  async function retryFinalization() {
    if (!maintenanceId || working) return;
    if (!window.confirm('¿Reintentar la finalización desde el último paso confirmado?')) return;
    setWorking(true);
    setMessage('');
    try {
      const result = await requestMaintenanceFinalization({ maintenanceId, sessionToken, retry: true });
      setMessage(result?.message || (result?.offlineQueued
        ? 'La finalización quedó pendiente de sincronización.'
        : 'El mantenimiento fue finalizado.'));
      await refresh();
    } catch (error) {
      setMessage(error?.message || 'No se pudo reintentar la finalización.');
    } finally {
      setWorking(false);
    }
  }

  if (!maintenanceId && !allFinalizations.length) return null;
  if (maintenanceId && !view.active && !message) return null;

  const statusMessage = message || view.error || (view.blocked
    ? 'Resuelva primero el conflicto de sincronización.'
    : view.active
      ? 'El proceso continuará desde el último paso confirmado.'
      : '');

  return (
    <aside className={`maintenance-finalization-center${view.canRetry ? ' has-error' : ''}`} role="status" aria-live="polite">
      <div className="maintenance-finalization-center__heading">
        <span className="maintenance-finalization-center__icon"><Icon name={view.canRetry ? 'error' : view.completed ? 'task_alt' : 'pending_actions'} /></span>
        <div>
          <strong>{view.active ? view.label : 'Estado de finalización'}</strong>
          {statusMessage && <small>{statusMessage}</small>}
        </div>
      </div>

      {view.active && !view.completed && (
        <div className="maintenance-finalization-center__progress" aria-label={`${view.progress}% completado`}><span style={{ width: `${view.progress}%` }} /></div>
      )}

      <div className="maintenance-finalization-center__actions">
        {view.canRetry && (
          <button type="button" onClick={retryFinalization} disabled={working || view.blocked}>
            <Icon name="refresh" />{working ? 'Reintentando...' : 'Reintentar finalización'}
          </button>
        )}
        {!maintenanceId && allFinalizations.length > 0 && (
          <span>{allFinalizations.length} finalización{allFinalizations.length === 1 ? '' : 'es'} pendiente{allFinalizations.length === 1 ? '' : 's'}.</span>
        )}
      </div>
    </aside>
  );
}
