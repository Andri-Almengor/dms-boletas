import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const tables = read('backend/src/config/tables.js');
const schema = read('backend/src/services/activity-schema.service.js');
const logger = read('backend/src/services/activity-log.service.js');
const reportModule = read('backend/src/modules/activity-reports.module.js');
const reportRoutes = read('backend/src/routes/activity-report.routes.js');
const app = read('backend/src/app.js');
const shell = read('src/components/layout/AppShell.jsx');
const telemetry = read('src/components/system/ActivityTelemetryBridge.jsx');
const metrics = read('src/pages/admin/MetricsPage.jsx');
const dashboard = read('src/components/metrics/ActivityReportsDashboard.jsx');
const exporter = read('src/services/activityReportExport.js');
const backendPackage = read('backend/package.json');
const frontendPackage = read('package.json');

assert.match(tables, /ActividadApp:\s*\{\s*id:\s*'ActividadID'/);
assert.match(schema, /'RutaUI'/);
assert.match(schema, /'RutaAccion'/);
assert.match(schema, /'DuracionSegundos'/);
assert.match(schema, /ensureActivitySchema/);

assert.match(logger, /recordApiActivityFromToken/);
assert.match(logger, /recordUiActivity/);
assert.match(logger, /SENSITIVE_KEY/);
assert.match(logger, /contenido binario omitido/);
assert.match(logger, /BOLETAS/);
assert.match(logger, /MANTENIMIENTOS/);
assert.match(logger, /DISPOSITIVOS/);
assert.match(logger, /priorityForRoute/);
assert.match(logger, /flushActivityQueue/);

assert.match(app, /activityReportRouter/);
assert.match(app, /app\.use\('\/api\/activity'/);
assert.match(app, /recordApiActivityFromToken/);
assert.match(app, /endedAt:\s*Date\.now\(\)/);

assert.match(reportRoutes, /post\('\/track'/);
assert.match(reportRoutes, /post\('\/report'/);
assert.match(reportRoutes, /USUARIOS_GESTIONAR/);
assert.match(reportRoutes, /buildActivityReport/);

assert.match(reportModule, /ActividadApp/);
assert.match(reportModule, /Auditoria/);
assert.match(reportModule, /Agendas/);
assert.match(reportModule, /AgendaAsignados/);
assert.match(reportModule, /dateFrom/);
assert.match(reportModule, /dateTo/);
assert.match(reportModule, /timeFrom/);
assert.match(reportModule, /timeTo/);
assert.match(reportModule, /pageSummary/);
assert.match(reportModule, /entitySummary/);
assert.match(reportModule, /telemetryStartedAt/);
assert.match(reportModule, /no puede reconstruir tiempo de permanencia retroactivamente/);

assert.match(shell, /ActivityTelemetryBridge/);
assert.match(telemetry, /PAGE_VIEW/);
assert.match(telemetry, /PAGE_TIME/);
assert.match(telemetry, /UI_TAB/);
assert.match(telemetry, /5 \* 60 \* 1000/);
assert.match(telemetry, /document\.visibilityState/);
assert.match(telemetry, /keepalive/);

assert.match(metrics, /ActivityReportsDashboard/);
assert.match(metrics, /Reportes de actividad/);
assert.match(dashboard, /Fecha desde/);
assert.match(dashboard, /Hora desde/);
assert.match(dashboard, /Personas/);
assert.match(dashboard, /Secciones del app/);
assert.match(dashboard, /Toda la app/);
assert.match(dashboard, /Actividad del app/);
assert.match(dashboard, /Agenda/);
assert.match(dashboard, /PDF/);
assert.match(dashboard, /EXCEL/);
assert.match(dashboard, /WORD/);
assert.match(dashboard, /slice\(0, 250\)/);

assert.match(exporter, /application\/pdf/);
assert.match(exporter, /\.xls/);
assert.match(exporter, /\.doc/);
assert.match(exporter, /Actividad/);
assert.match(exporter, /Tiempo por pestaña/);
assert.match(exporter, /Agenda/);

assert.doesNotMatch(backendPackage, /pdfkit|exceljs|xlsx|docx/i, 'El reporte no debe agregar dependencias pesadas al backend.');
assert.doesNotMatch(frontendPackage, /jspdf|exceljs|xlsx|docx/i, 'El reporte no debe agregar dependencias pesadas al frontend.');

console.log('✓ reportes de actividad: captura global, tiempo por pestaña, filtros, agenda y exportación PDF/Excel/Word');
