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

1. Reemplace en Apps Script `MaintenanceCore.gs`, `MaintenanceDevices.gs` y `MaintenanceHelpers.gs` con las versiones del repositorio.
2. Ejecute `setupMaintenanceModule()` una vez. La función agregará las columnas faltantes sin borrar los datos históricos.
3. Verifique que `Evidencia_Mantenimientos` tenga `TipoDispositivoID`, `TipoDispositivo`, `FabricanteID`, `Fabricante` y `ModeloID`.
4. Edite la implementación vigente del Web App y seleccione **Nueva versión**.
5. Implemente sin cambiar la URL utilizada por React.

El módulo reutiliza los mismos catálogos que las boletas:

- Tipos de dispositivo.
- Fabricantes.
- Modelos.
- Relación tipo de dispositivo-fabricante.

El campo histórico `Categoria` se conserva por compatibilidad, pero en nuevos registros representa el nombre del tipo de dispositivo seleccionado.

## Permisos

- Técnicos: consultar, crear y editar mantenimientos pendientes; crear y editar dispositivos y evidencias.
- Administradores: todo lo anterior, además de eliminar, reabrir mantenimientos, eliminar dispositivos o evidencias y generar Excel o presentaciones.
- Solo usuarios con `CATALOGOS_GESTIONAR` pueden crear tipos de dispositivo, fabricantes o modelos desde el formulario.
- Los mantenimientos finalizados quedan en modo consulta para técnicos.
- Los handlers de reportes validan nuevamente que el usuario sea administrador.

## Aplicación instalable

El frontend incluye `manifest.webmanifest`, Service Worker e interfaz de instalación. El sitio debe publicarse mediante HTTPS para instalarse como aplicación. En iPhone y iPad la instalación se hace desde Safari con **Compartir → Añadir a pantalla de inicio**.

## Evidencias en el detalle

- La pantalla de detalle permite agregar fotografías directamente a cada dispositivo mientras el mantenimiento esté pendiente.
- Las imágenes intentan cargar primero desde la miniatura de Drive.
- Si Drive no permite mostrar la miniatura directamente, React usa `maintenance.media.get` de forma autenticada.

## Reportes

- `maintenance.report.spreadsheet` crea un Google Sheet con resumen y una hoja por categoría.
- `maintenance.report.slides` crea una presentación con portada, checklist y fotografías.
- Solo administradores pueden ejecutar ambas rutas.
