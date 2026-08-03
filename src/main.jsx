import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import './services/indexedDbVersionGuard';
import './services/maintenanceRoutes';
import './services/operationalRoutes';
import './services/operationalCreateRoutes';
import './services/clientAdminRoutes';
import { initializePerformanceMode } from './services/performanceMode';
import { initializeTheme } from './services/theme';
import App from './App';
import './styles/index.css';

const SERVICE_WORKER_RELOAD_KEY = 'dms_sw_controller_reload_at';
const SERVICE_WORKER_RELOAD_WINDOW_MS = 15_000;

initializePerformanceMode();
initializeTheme();

function reloadForServiceWorkerUpdate() {
  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY) || 0);
  } catch {
    // La recarga también funciona cuando sessionStorage está restringido.
  }
  if (Date.now() - lastReloadAt < SERVICE_WORKER_RELOAD_WINDOW_MS) return;
  try { sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, String(Date.now())); } catch { /* Sin efecto. */ }
  window.location.reload();
}

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
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
