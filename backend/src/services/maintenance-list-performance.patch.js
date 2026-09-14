import { readTable } from '../infra/sheets.repository.js';
import { maintenanceHandlers } from '../modules/maintenance.module.js';
import {
  addVisibleMaintenanceDeviceCounts,
  selectMaintenancePage,
} from './maintenance-list-domain.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceListPerformancePatch');

if (!maintenanceHandlers[INSTALL_FLAG]) {
  maintenanceHandlers.list = async ({ payload }) => {
    const maintenanceRows = await readTable('Mantenimiento');
    const page = selectMaintenancePage(maintenanceRows, payload || {});
    if (!page.items.length) return page;

    const devices = await readTable('Evidencia_Mantenimientos');
    return {
      ...page,
      items: addVisibleMaintenanceDeviceCounts(page.items, devices),
    };
  };

  maintenanceHandlers[INSTALL_FLAG] = true;
}
