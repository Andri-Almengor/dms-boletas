import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import MobileTimePickerBridge from './components/forms/MobileTimePickerBridge';
import TicketEvidenceMultiSelectBridge from './components/forms/TicketEvidenceMultiSelectBridge';
import TicketHoursCeilingBridge from './components/forms/TicketHoursCeilingBridge';
import './services/maintenanceRoutes';
import './services/operationalRoutes';
import './services/operationalCreateRoutes';
import './services/ticketVisitOfflineSync';
import { initializeTheme } from './services/theme';
import App from './App';
import './styles/index.css';

initializeTheme();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('No se pudo registrar el modo instalable:', error);
    });
  });
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
        <MobileTimePickerBridge />
        <TicketHoursCeilingBridge />
        <TicketEvidenceMultiSelectBridge />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
