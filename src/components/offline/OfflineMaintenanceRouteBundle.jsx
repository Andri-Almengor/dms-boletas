import { useEffect } from 'react';
import MorePage from '../../pages/MorePage';
import MaintenanceDetailPage from '../../pages/maintenance/MaintenanceDetailPage';
import MaintenanceFormPage from '../../pages/maintenance/MaintenanceFormPage';
import MaintenanceListPage from '../../pages/maintenance/MaintenanceListPage';
import '../../styles/routes/maintenance.js';
import '../../styles/routes/more.js';
import '../../styles/routes/offline.js';

const OFFLINE_OPERATION_COMPONENTS = Object.freeze([
  MorePage,
  MaintenanceListPage,
  MaintenanceDetailPage,
  MaintenanceFormPage,
]);

/**
 * Mantiene Más y las rutas principales de mantenimiento dentro del paquete que
 * se descarga al activar el runtime offline. Así React.lazy puede resolver el
 * camino completo /mas -> /mantenimientos aunque el usuario no haya visitado
 * previamente ninguna de esas pantallas antes de perder la conexión.
 */
export default function OfflineMaintenanceRouteBundle() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('dms-offline-maintenance-routes-ready', {
      detail: {
        routes: [
          '/mas',
          '/mantenimientos',
          '/mantenimientos/nuevo',
          '/mantenimientos/:maintenanceId',
        ],
        modules: OFFLINE_OPERATION_COMPONENTS.length,
      },
    }));
  }, []);

  return null;
}
