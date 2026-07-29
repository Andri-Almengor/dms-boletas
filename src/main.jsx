import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const register = () => navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('No se pudo registrar el modo instalable:', error);
    });
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
