import { MODULE_ROUTES } from './moduleApi';

const spreadsheetReportRoutes = [
  'maintenance.report.spreadsheet',
  'mantenimientos.reporte.excel',
];

const slidesReportRoutes = [
  'maintenance.report.slides',
  'mantenimientos.reporte.presentacion',
];

MODULE_ROUTES.maintenance = {
  list: ['maintenance.list', 'mantenimientos.list'],
  get: ['maintenance.get', 'mantenimientos.get'],
  create: ['maintenance.create', 'mantenimientos.create'],
  update: ['maintenance.update', 'mantenimientos.update'],
  delete: ['maintenance.delete', 'mantenimientos.delete'],
  finalize: ['maintenance.finalize', 'mantenimientos.finalize'],
  reopen: ['maintenance.reopen', 'mantenimientos.reopen'],
  deviceCreate: ['maintenance.devices.create', 'mantenimientos.dispositivos.create'],
  deviceUpdate: ['maintenance.devices.update', 'mantenimientos.dispositivos.update'],
  deviceAutosave: ['maintenance.devices.autosave', 'mantenimientos.dispositivos.autosave'],
  deviceDelete: ['maintenance.devices.delete', 'mantenimientos.dispositivos.delete'],
  imageUpload: ['maintenance.images.upload', 'mantenimientos.imagenes.upload'],
  imageUpdate: ['maintenance.images.update', 'mantenimientos.imagenes.update'],
  imageDelete: ['maintenance.images.delete', 'mantenimientos.imagenes.delete'],
  mediaGet: ['maintenance.media.get', 'mantenimientos.media.get'],
  spreadsheetReport: spreadsheetReportRoutes,
  slidesReport: slidesReportRoutes,
  // Alias conservados para pantallas o instalaciones que todavía usan los
  // nombres anteriores. Ambos apuntan a las mismas rutas del backend.
  reportSpreadsheet: spreadsheetReportRoutes,
  reportSlides: slidesReportRoutes,
  config: ['maintenance.config', 'mantenimientos.config'],
};
