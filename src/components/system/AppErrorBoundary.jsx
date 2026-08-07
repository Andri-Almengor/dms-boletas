import React from 'react';

const RECOVERY_KEY = 'dms_app_recovery_at';
const RECOVERY_WINDOW_MS = 60_000;
const CHUNK_ERROR = /chunkloaderror|loading chunk|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

function errorText(error) {
  return `${error?.name || ''} ${error?.message || error || ''}`.trim();
}

function mayRecoverAutomatically(error) {
  return CHUNK_ERROR.test(errorText(error));
}

async function clearStaleApplicationCache() {
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith('dms-boletas-shell-'))
        .map((key) => caches.delete(key)));
    }
  } catch {
    // La recarga sigue siendo útil aunque el navegador no permita limpiar Cache Storage.
  }
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map((registration) => registration.update().catch(() => {})));
  } catch {
    // Sin efecto: no se elimina el service worker ni el almacenamiento de formularios.
  }
}

async function recoverAndReload() {
  await clearStaleApplicationCache();
  window.location.reload();
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, recovering: false };
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Error de interfaz capturado por DMS-Boletas:', error, info);
    if (!mayRecoverAutomatically(error) || navigator.onLine === false) return;

    let lastRecovery = 0;
    try { lastRecovery = Number(sessionStorage.getItem(RECOVERY_KEY) || 0); } catch { /* Sin efecto. */ }
    if (Date.now() - lastRecovery < RECOVERY_WINDOW_MS) return;
    try { sessionStorage.setItem(RECOVERY_KEY, String(Date.now())); } catch { /* Sin efecto. */ }
    this.setState({ recovering: true });
    recoverAndReload().catch(() => window.location.reload());
  }

  reload() {
    this.setState({ recovering: true });
    recoverAndReload().catch(() => window.location.reload());
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-recovery-screen" role="alert">
        <section className="app-recovery-card">
          <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
          <div>
            <span className="eyebrow">RECUPERACIÓN DE LA APLICACIÓN</span>
            <h1>{this.state.recovering ? 'Recuperando DMS-Boletas…' : 'La pantalla no pudo cargarse'}</h1>
            <p>Sus borradores locales no se eliminan. Puede recargar la interfaz de forma segura para obtener la versión más reciente.</p>
          </div>
          <button className="button button--primary" type="button" onClick={this.reload} disabled={this.state.recovering}>
            {this.state.recovering ? 'Recargando…' : 'Recargar aplicación'}
          </button>
        </section>
      </main>
    );
  }
}
