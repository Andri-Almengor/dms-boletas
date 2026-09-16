import './metrics-ticket-query-optimization.patch.js';
import { readTables } from '../infra/sheets.repository.js';
import { metricsHandlers } from '../modules/metrics.module.js';
import { buildTicketMetrics } from './ticket-metrics-query.service.js';

const INSTALL_FLAG = Symbol.for('dms.metricsFullAssignedHoursPolicy');

if (!metricsHandlers[INSTALL_FLAG]) {
  metricsHandlers.tickets = async (ctx = {}) => {
    const tables = await readTables(['Boletas', 'BoletaAsignados', 'Usuarios']);
    return buildTicketMetrics({
      tickets: tables.Boletas || [],
      assignments: tables.BoletaAsignados || [],
      users: tables.Usuarios || [],
      payload: ctx.payload || {},
      fullAssignedHours: true,
    });
  };
  metricsHandlers[INSTALL_FLAG] = true;
}
