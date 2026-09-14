import './metrics-ticket-query-optimization.patch.js';
import { readTables } from '../infra/sheets.repository.js';
import { metricsHandlers } from '../modules/metrics.module.js';
import { buildFullAssignedHours } from './ticket-metrics-query.service.js';

const INSTALL_FLAG = Symbol.for('dms.metricsFullAssignedHoursPolicy');

if (!metricsHandlers[INSTALL_FLAG]) {
  const ticketMetrics = metricsHandlers.tickets;
  metricsHandlers.tickets = async (ctx) => {
    const result = await ticketMetrics(ctx);
    const tables = await readTables(['Boletas', 'BoletaAsignados', 'Usuarios']);
    return {
      ...result,
      tableAsignadoHoras: buildFullAssignedHours({
        tickets: tables.Boletas || [],
        assignments: tables.BoletaAsignados || [],
        users: tables.Usuarios || [],
        payload: ctx.payload || {},
      }),
    };
  };
  metricsHandlers[INSTALL_FLAG] = true;
}
