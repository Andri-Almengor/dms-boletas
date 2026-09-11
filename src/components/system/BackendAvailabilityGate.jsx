import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import Icon from '../common/Icon';
import { isOfflineModeEnabled } from '../../services/offlineMode';
import {
  backendAvailabilitySnapshot,
  probeBackend,
  startBackendAvailabilityMonitor,
  subscribeBackendAvailability,
} from '../../services/backendAvailability';
import './BackendAvailabilityGate.css';

function StatusCard({ status, unavailableSince }) {
  const offline = status === 'offline';
  const elapsedSeconds = unavailableSince ? Math.max(0, Math.floor((Date.now() - unavailableSince) / 1000)) : 0;

  return <section className="backend-availability-card" role="status" aria-live="polite">
    <div className={`backend-availability-card__icon${offline ? ' is-offline' : ''}`}>
      <Icon name={offline ? 'cloud_off' : 'progress_activity'} className={offline ? '' : 'spin'} />
    </div>
    <p className="eyebrow">DMS Boletas</p>
    <h1>{offline ? 'Sin conexión a internet' : 'Conectando con el servidor'}</h1>
    <p>{offline
      ? 'Compruebe la conexión del dispositivo. La aplicación continuará automáticamente cuando vuelva internet.'
      : 'La interfaz está disponible, pero el backend todavía está iniciando o recuperando la conexión. Espere un momento antes de realizar gestiones.'}</p>
    {!offline && <div className="backend-availability-card__progress"><span /></div>}
    <small>{offline
      ? 'No se cerrará su sesión por este problema.'
      : `Reintentando automáticamente${elapsedSeconds >= 5 ? ` · ${elapsedSeconds} s` : '…'}`}</small>
    <button type="button" className="button button--secondary" onClick={() => probeBackend({ force: true })}>
      <Icon name="refresh" /> Comprobar ahora
    </button>
  </section>;
}

export default function BackendAvailabilityGate({ children }) {
  const availability = useSyncExternalStore(
    subscribeBackendAvailability,
    backendAvailabilitySnapshot,
    backendAvailabilitySnapshot,
  );
  const wasReady = useRef(availability.status === 'ready');

  useEffect(() => startBackendAvailabilityMonitor(), []);
  if (availability.status === 'ready') wasReady.current = true;

  const offlineAllowed = availability.status === 'offline' && isOfflineModeEnabled();
  const initialBlocked = !wasReady.current && availability.status !== 'ready' && !offlineAllowed;

  if (initialBlocked) {
    return <main className="backend-availability-screen"><StatusCard {...availability} /></main>;
  }

  return <>
    {children}
    {availability.status !== 'ready' && !offlineAllowed && (
      <div className="backend-availability-overlay" aria-modal="true" role="dialog">
        <StatusCard {...availability} />
      </div>
    )}
  </>;
}
