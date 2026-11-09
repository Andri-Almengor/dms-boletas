# Apps Script completo: servicio real de reportes y Casos

## Agenda personal: mostrar quién acompaña a cada técnico (V7.16)

Las notificaciones personales **Nueva agenda** y **Agenda modificada** mantienen la misma plantilla HTML, asunto, destinatarios, horarios, enlaces y política de correo. Al crear o modificar una visita con dos o más asignados, cada destinatario recibe un saludo con los nombres de pila de los participantes, por ejemplo **«Hola Andrick, Dixon.»**, y la tarjeta identifica el **Personal asignado** con nombres completos. Cuando una persona va sola se conserva el saludo original.

El backend envía los nombres desde las asignaciones reales de la agenda (no desde la petición del navegador). Si un lote incluye varias visitas con equipos diferentes, el saludo queda individual y cada tarjeta muestra los nombres de su propia visita; si alguien fue retirado, su correo de actualización sigue avisando que ya no está asignado y no lo saluda como integrante. Se incluye el reenvío manual, reutilizando `buildDeliveries` existente. Los payloads históricos que no envían nombres de equipo siguen funcionando.

**Despliegue manual necesario:**
1. Fusionar el PR y desplegar el backend de Render, que ahora incluye `assignedNames` en la acción existente `agenda.notification.send`.
2. Copiar la versión fusionada de `apps-script/report-service/Code.gs` al **mismo** proyecto Apps Script configurado en el backend; actualizar `APPS_SCRIPT_VERSION` a `2026-11-09-V7.16-AGENDA-TEAM-EMAIL` (ya viene actualizado en el archivo).
3. En **Implementar → Gestionar implementaciones**, editar la implementación Web App **actual**, seleccionar **Nueva versión** y publicar, manteniendo la misma URL `/exec`; no crear una implementación paralela.
4. Crear una agenda de prueba con dos técnicos, verificar que ambos reciben un correo individual con saludo compartido y equipo completo, probar una visita individual y otra con varias visitas de equipos distintos, y confirmar que Google Chat no recibe mensajes adicionales por reenviar solo el correo.

No requiere migraciones PostgreSQL, permisos nuevos, triggers, variables de entorno ni cambios en sincronización/offline, finalización o recordatorios.


`Code.gs` parte del archivo completo aportado por el usuario el 11 de septiembre de 2026, versión `2026-09-03-AGENDA-V7.9-TICKET-CREATION-FINALIZATION`. Conserva sus funciones y añade transporte por bloques para Casos. Nueva versión: `2026-09-11-V7.9-BOUNDED-CASE-UPLOADS`.

## Corrección de videos en el envío de boletas (V7.15)

Cuando una boleta tiene un video (por ejemplo `20261001_121230.mp4`), **no se intenta adjuntarlo ni comprimirlo en el correo**. Se conserva en su archivo actual de Google Drive y el correo incluye un enlace al video. El PDF y las demás evidencias compatibles mantienen sus adjuntos. El límite de adjuntos `MAX_EMAIL_BYTES` no cambia.

La decisión se basa en el MIME de Drive, el MIME guardado, el tipo de medio o la extensión del nombre; no depende de `getSize()`, que puede informar 0 o estar desactualizado. Para los destinatarios existentes del correo (Para/CC), se intenta conceder acceso de lectura `addViewer` al archivo, sin publicarlo mediante `ANYONE_WITH_LINK`. Si la política de Drive impide conceder el acceso, el correo aún se envía y explica que puede ser necesario solicitarlo.

**Publicación manual obligatoria** (el deploy del backend Render no actualiza Apps Script):
1. Copiar el `apps-script/report-service/Code.gs` de la rama fusionada al **proyecto existente** definido en `APPS_SCRIPT_REPORT_URL`.
2. En *Implementar → Gestionar implementaciones*, editar la **implementación Web App actual**, elegir **Nueva versión** con `APPS_SCRIPT_VERSION = 2026-10-09-V7.15-VIDEO-DRIVE-LINK` e implementar. **No crear otra implementación ni cambiar la URL `/exec`**.
3. Confirmar que el Web App siga ejecutándose bajo el mismo propietario autorizado, con permisos para Drive y correo. No cambiar secretos, variables ni destinatarios.
4. Usar una boleta de prueba con video de 18 segundos ya almacenado en Drive: comprobar PDF adjunto, enlace al video dentro del cuerpo HTML/texto, acceso desde uno de los correos destinatarios y ninguna copia del video como adjunto. Después validar finalización real y revisar logs de Apps Script/Render.
5. Para el caso que ya falló, verificar primero si existe un correo o PDF previo y el estado de la boleta antes de reintentar, a fin de no duplicar envíos.

Sin cambios de PostgreSQL, permisos de la aplicación, cron/worker, `SyncChanges`, offline, reglas de negocio, destinatario principal ni envío independiente de Google Chat.

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
