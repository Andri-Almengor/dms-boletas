import { useEffect } from 'react';
import MaintenanceDetailPage from '../../pages/maintenance/MaintenanceDetailPage';
import MaintenanceFormPage from '../../pages/maintenance/MaintenanceFormPage';
import MaintenanceListPage from '../../pages/maintenance/MaintenanceListPage';
import '../../styles/routes/maintenance.js';

const OFFLINE_MAINTENANCE_COMPONENTS = Object.freeze([
  MaintenanceListPage,
  MaintenanceDetailPage,
  MaintenanceFormPage,
]);

/**
 * Mantiene las rutas principales de mantenimiento dentro del paquete que se
 * descarga al activar el runtime offline. De esta forma React.lazy puede
 * resolverlas aunque el usuario no haya visitado Mantenimientos antes de
 * perder la conexión.
 */
export default function OfflineMaintenanceRouteBundle() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('dms-offline-maintenance-routes-ready', {
      detail: {
        routes: ['/mantenimientos', '/mantenimientos/nuevo', '/mantenimientos/:maintenanceId'],
        modules: OFFLINE_MAINTENANCE_COMPONENTS.length,
      },
    }));
  }, []);

  return null;
}
