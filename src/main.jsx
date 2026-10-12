import { claimAutomaticReload, hasActiveMaintenanceEvidenceSurface } from './services/reloadRecovery';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import AppErrorBoundary from './components/system/AppErrorBoundary';
import BackendAvailabilityGate from './components/system/BackendAvailabilityGate';
import './services/indexedDbVersionGuard';
import './services/maintenanceRoutes';
import './services/operationalRoutes';
import './services/operationalCreateRoutes';
import './services/clientAdminRoutes';
import { initializePerformanceMode } from './services/performanceMode';
import { initializeTheme } from './services/theme';
import App from './App';
import './styles/index.css';

initializePerformanceMode();
initializeTheme();

let deferredAutomaticReload = false;
let reloadObserver = null;

function reloadForServiceWorkerUpdate() {
  if (hasActiveMaintenanceEvidenceSurface()) {
    deferredAutomaticReload = true;
    // Observamos solo hasta cerrar la pantalla; nunca forzamos una recarga
    // mientras el selector de cámara o un editor pueda contener cambios.
    if (!reloadObserver && typeof MutationObserver === 'function' && document.body) {
      reloadObserver = new MutationObserver(() => {
        if (deferredAutomaticReload && !hasActiveMaintenanceEvidenceSurface()) {
          reloadForServiceWorkerUpdate();
        }
      });
      reloadObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    return;
  }
  deferredAutomaticReload = false;
  reloadObserver?.disconnect();
  reloadObserver = null;
  if (claimAutomaticReload()) window.location.reload();
}

window.addEventListener('focus', () => {
  if (deferredAutomaticReload) reloadForServiceWorkerUpdate();
});
window.addEventListener('dms-offline-editing-complete', () => {
  if (deferredAutomaticReload) reloadForServiceWorkerUpdate();
});

window.addEventListener('vite:preloadError', (event) => {
  if (navigator.onLine === false) return;
  if (hasActiveMaintenanceEvidenceSurface()) {
    event.preventDefault();
    reloadForServiceWorkerUpdate();
    return;
  }
  if (claimAutomaticReload()) {
    event.preventDefault();
    window.location.reload();
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const controlledAtStartup = Boolean(navigator.serviceWorker.controller);
  let controllerChanged = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controllerChanged) return;
    controllerChanged = true;
    if (controlledAtStartup) reloadForServiceWorkerUpdate();
  });

  window.addEventListener('load', () => {
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        await registration.update().catch(() => {});
      } catch (error) {
        console.warn('No se pudo registrar el modo instalable:', error);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(register, { timeout: 2_500 });
    } else {
      window.setTimeout(register, 1_500);
    }
  }, { once: true });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__dmsInstallPrompt = event;
  window.dispatchEvent(new CustomEvent('dms-install-available'));
});

window.addEventListener('appinstalled', () => {
  window.__dmsInstallPrompt = null;
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <BackendAvailabilityGate>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BackendAvailabilityGate>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
);
