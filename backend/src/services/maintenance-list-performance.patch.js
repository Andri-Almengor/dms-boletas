import { findRows, queryPage } from '../infra/sheets.repository.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import { addVisibleMaintenanceDeviceCounts } from './maintenance-list-domain.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceListPerformancePatch');

if (!maintenanceHandlers[INSTALL_FLAG]) {
  maintenanceHandlers.list = async ({ payload }) => {
    const request = { ...(payload || {}) };
    const page = await queryPage('Mantenimiento', request, {
      searchFields: ['TituloMantenimiento', 'Cliente', 'Responsables', 'DescripcionGeneral', 'Ubicacion'],
      statusNormalized: true,
      excludeInactive: true,
    });
    if (!page.items.length) return page;
    const ids = page.items.map((row) => String(row.MantenimientoID)).filter(Boolean);
    const devices = await findRows('Evidencia_Mantenimientos', { MantenimientoRef: ids }, { limit: 50_000 });
    return { ...page, items: addVisibleMaintenanceDeviceCounts(page.items, devices) };
  };
  maintenanceHandlers[INSTALL_FLAG] = true;
}
