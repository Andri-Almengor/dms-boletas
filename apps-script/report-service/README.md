# Apps Script completo: servicio real de reportes y Casos

`Code.gs` parte del archivo completo aportado por el usuario el 11 de septiembre de 2026, versión `2026-09-03-AGENDA-V7.9-TICKET-CREATION-FINALIZATION`. Conserva sus funciones y añade transporte por bloques para Casos. Versión actual: `2026-10-06-V7.13-MAINTENANCE-FAULT-EMAIL`.

## Aplicación del cambio

1. Abrir el proyecto Apps Script que corresponde a `APPS_SCRIPT_REPORT_URL`. Guardar una versión del código actual para reversión.
2. Reemplazar el contenido del archivo que contiene el servicio completo por este `Code.gs`. No añadirlo junto al anterior: duplicaría funciones y constantes. No sustituir el script distinto de `apps-script/boletas-report/Code.gs` del repositorio.
3. Mantener las propiedades existentes, incluidos `REPORT_WEBHOOK_SECRET`, carpetas y configuración del worker. Mantener la ejecución de la aplicación web como el propietario actual y su configuración de acceso. No copiar secretos al repositorio.
4. En Implementar → Gestionar implementaciones → editar la implementación existente → Nueva versión → Implementar. Conservar el mismo ID/URL. Autorizar con el propietario si Google solicita permisos. El código usa Drive y UrlFetchApp, ya presentes en el servicio anterior. Si el manifiesto fija scopes, debe permitir Drive y `script.external_request`; verificar también la disponibilidad de Drive API en el proyecto Google vinculado.
5. Probar primero un portal de prueba con una imagen original. Verificar tamaño y contenido descargado, propietario, carpeta PRUEBAS, creación de caso, recepción de notificación y reintento. Después validar un caso real controlado y las acciones históricas de reportes/finalización. No ejecutar instaladores de triggers para este cambio de transporte: no los modifica.
6. Solo después desplegar el frontend/backend de esta rama mediante el PR revisado. La nueva versión del Apps Script sigue aceptando las llamadas antiguas, permitiendo ese orden sin interrumpirlas.

No se ha aplicado esta implementación a Google desde este trabajo.

## Transporte y límites

- Mismos límites: 8 imágenes, 6 MiB por imagen y 16 MiB por solicitud; mismos formatos permitidos. Sin conversión ni compresión.
- `customer.case.evidence.init` reserva una sesión reanudable bajo el propietario del Apps Script y reutiliza su mecanismo de idempotencia. `customer.case.evidence.chunk` transfiere hasta 256 KiB originales por petición. El backend valida portal y contexto firmado antes de invocarlas.
- La entrega final utiliza `customer.case.evidence.upload`, que valida metadatos y mueve el archivo existente a la carpeta habitual del caso. Las rutas antiguas siguen funcionando.
- Las imágenes cargadas cuyo formulario se abandona permanecen en la carpeta privada `Cargas pendientes`, bajo la raíz real o PRUEBAS correspondiente. No se comparten ni se envían hasta crear el caso. Revisar manualmente esa carpeta si se desea limpiar cargas abandonadas; no se añadió borrado automático.
- Las referencias del backend expiran a las 4 horas. Para una sesión expirada, retirar y volver a seleccionar la imagen en el formulario genera una carga nueva. La recepción ya completada se recupera por el ID preasignado durante un reintento.
- Un resultado de tests local no certifica permisos, cuotas o configuración del deployment Google. La prueba real anterior es necesaria antes de producción.

## Reversión

Si se revierte el frontend/backend, este Apps Script ampliado puede permanecer: conserva las acciones anteriores. Si se decide volver también al Apps Script anterior, hacerlo después de retirar el frontend nuevo y de permitir finalizar las solicitudes en curso.


## Avisos de avería de dispositivos

La acción `maintenance.device.fault.send` envía los avisos de avería de dispositivos de Mantenimiento y Proyecto mediante este mismo Web App de Apps Script.

- El backend continúa validando sesión, permisos, dispositivo, mantenimiento, respuesta `reportaAveria`, destinatarios e idempotencia.
- Apps Script únicamente formatea y entrega el correo usando `sendDmsEmail_`, por lo que conserva el alias preferido `reportes@solutionsdms.com` y el fallback con la cuenta efectiva del Web App.
- La acción exige `idempotencyKey` para que un reintento HTTP no duplique el correo.
- No envía Google Chat ni reenvía correos de boletas.
- El botón administrativo **Probar correo de avería** usa exactamente esta misma acción.

### Despliegue requerido para esta versión

Después de fusionar el cambio, sí es necesario actualizar el Apps Script principal:

1. Reemplazar el contenido del Apps Script principal por `apps-script/report-service/Code.gs`.
2. En **Implementar → Gestionar implementaciones**, editar la implementación existente.
3. Seleccionar **Nueva versión** y publicar conservando la misma URL `/exec`.
4. Confirmar en `doGet` que `version` sea `2026-10-06-V7.13-MAINTENANCE-FAULT-EMAIL`.
5. Desde DMS Boletas, ir a **Más → Notificaciones** y ejecutar **Probar correo de avería**.

No requiere una nueva URL, nuevos secretos ni cambios en PostgreSQL.
