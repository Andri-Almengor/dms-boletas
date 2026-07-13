import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export default function InstallAppCard() {
  const [installPrompt, setInstallPrompt] = useState(() => window.__dmsInstallPrompt || null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [message, setMessage] = useState('');
  const isIos = useMemo(() => /iphone|ipad|ipod/i.test(window.navigator.userAgent), []);

  useEffect(() => {
    function promptAvailable() { setInstallPrompt(window.__dmsInstallPrompt || null); }
    function appInstalled() {
      window.__dmsInstallPrompt = null;
      setInstallPrompt(null);
      setInstalled(true);
      setMessage('DMS Boletas se instaló correctamente.');
    }
    window.addEventListener('dms-install-available', promptAvailable);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('dms-install-available', promptAvailable);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      if (isIos) setShowIosHelp(true);
      else setMessage('Abra esta página desde Chrome o Edge y use “Instalar aplicación” en el menú del navegador.');
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') setMessage('Instalación iniciada.');
    window.__dmsInstallPrompt = null;
    setInstallPrompt(null);
  }

  return (
    <section className="install-app-card">
      <span className="install-app-card__icon"><Icon name={installed ? 'check_circle' : 'install_mobile'} /></span>
      <div className="install-app-card__content">
        <h2>{installed ? 'Aplicación instalada' : 'Instalar DMS Boletas'}</h2>
        <p>{installed
          ? 'La aplicación se está ejecutando desde la pantalla de inicio.'
          : 'Agregue DMS Boletas al teléfono o computadora para abrirla como una aplicación independiente.'}</p>
        {message && <div className="install-app-card__message">{message}</div>}
        {showIosHelp && !installed && (
          <div className="install-app-card__ios-help">
            <strong>En iPhone o iPad:</strong>
            <span>1. Abra DMS Boletas en Safari.</span>
            <span>2. Pulse Compartir.</span>
            <span>3. Elija “Añadir a pantalla de inicio”.</span>
            <span>4. Confirme con “Añadir”.</span>
          </div>
        )}
      </div>
      {!installed && <button className="button button--primary" type="button" onClick={install}><Icon name="download" />Instalar</button>}
    </section>
  );
}
