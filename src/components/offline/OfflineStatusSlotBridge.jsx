import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function isWorkflowRoute(pathname = '') {
  return pathname === '/boletas/nueva'
    || pathname === '/mantenimientos/nuevo'
    || /^\/boletas\/[^/]+\/editar$/.test(pathname)
    || /\/boletas\/[^/]+\/editar-rapido\//.test(pathname)
    || /\/boletas\/[^/]+\/nueva-visita$/.test(pathname)
    || /^\/mantenimientos\/[^/]+\/editar$/.test(pathname);
}

export default function OfflineStatusSlotBridge() {
  const { pathname } = useLocation();

  useEffect(() => {
    const updateConnectionClass = () => {
      document.body.classList.toggle('dms-offline-active', navigator.onLine === false);
    };

    updateConnectionClass();
    window.addEventListener('online', updateConnectionClass);
    window.addEventListener('offline', updateConnectionClass);

    return () => {
      window.removeEventListener('online', updateConnectionClass);
      window.removeEventListener('offline', updateConnectionClass);
      document.body.classList.remove('dms-offline-active');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dms-workflow-status-slot', isWorkflowRoute(pathname));
    return () => document.body.classList.remove('dms-workflow-status-slot');
  }, [pathname]);

  return null;
}
