# Instalación del módulo de mantenimientos

Copie al proyecto de Google Apps Script estos archivos:

- `apps-script/MaintenanceCore.gs`
- `apps-script/MaintenanceDevices.gs`
- `apps-script/MaintenanceHelpers.gs`
- `apps-script/MaintenanceReports.gs`

Agregue dentro del objeto `ROUTES` de `Code.gs`:

```javascript
'maintenance.list': { handler: apiMaintenanceList_, permission: 'BOLETAS_VER' },
'maintenance.get': { handler: apiMaintenanceGet_, permission: 'BOLETAS_VER' },
'maintenance.create': { handler: apiMaintenanceCreate_, permission: 'BOLETAS_CREAR' },
'maintenance.update': { handler: apiMaintenanceUpdate_, permission: 'BOLETAS_EDITAR' },
'maintenance.delete': { handler: apiMaintenanceDelete_, permission: 'USUARIOS_GESTIONAR' },
'maintenance.finalize': { handler: apiMaintenanceFinalize_, permission: 'BOLETAS_EDITAR' },
'maintenance.reopen': { handler: apiMaintenanceReopen_, permission: 'USUARIOS_GESTIONAR' },
'maintenance.devices.create': { handler: apiMaintenanceDeviceCreate_, permission: 'BOLETAS_EDITAR' },
'maintenance.devices.update': { handler: apiMaintenanceDeviceUpdate_, permission: 'BOLETAS_EDITAR' },
'maintenance.devices.delete': { handler: apiMaintenanceDeviceDelete_, permission: 'USUARIOS_GESTIONAR' },
'maintenance.images.upload': { handler: apiMaintenanceImageUpload_, permission: 'BOLETAS_EDITAR' },
'maintenance.images.update': { handler: apiMaintenanceImageUpdate_, permission: 'BOLETAS_EDITAR' },
'maintenance.images.delete': { handler: apiMaintenanceImageDelete_, permission: 'USUARIOS_GESTIONAR' },
'maintenance.media.get': { handler: apiMaintenanceMediaGet_, permission: 'BOLETAS_VER' },
'maintenance.report.spreadsheet': { handler: apiMaintenanceSpreadsheetReport_, permission: 'BOLETAS_VER' },
'maintenance.report.slides': { handler: apiMaintenanceSlidesReport_, permission: 'BOLETAS_VER' },
'maintenance.config': { handler: apiMaintenanceConfig_, permission: 'BOLETAS_VER' },
```

Después:

1. Ejecute `setupMaintenanceModule()` una sola vez.
2. Verifique que existan las tablas `Mantenimiento`, `Evidencia_Mantenimientos` y `Mantenimiento imagenes`.
3. Edite la implementación vigente del Web App y seleccione **Nueva versión**.
4. Implemente sin cambiar la URL utilizada por React.

El módulo reutiliza las rutas existentes de clientes, `ClienteUbicaciones` y `ClienteUbicacionesEquipo`.

## Permisos

- Técnicos: consultar, crear y editar mantenimientos pendientes; crear y editar dispositivos y evidencias.
- Administradores: todo lo anterior, además de eliminar, reabrir mantenimientos y eliminar dispositivos o evidencias.
- Los mantenimientos finalizados quedan en modo consulta para técnicos.

## Reportes

- `maintenance.report.spreadsheet` crea un Google Sheet con resumen y una hoja por categoría. También devuelve un enlace de exportación `.xlsx`.
- `maintenance.report.slides` crea una presentación de Google con portada, checklist y hasta cuatro fotografías por dispositivo.
