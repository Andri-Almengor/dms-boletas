# Configuración de reportes y notificaciones

La finalización de una boleta requiere configuración privada en el backend. Los valores reales no deben agregarse al repositorio ni utilizar variables `VITE_*`.

## Variables del backend

Agregue estas variables en `backend/.env` para desarrollo y en **Environment** del servicio de Render para producción:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cuenta-remitente@dominio.com
SMTP_PASS=CONTRASENA_DE_APLICACION
SMTP_FROM="DMS Boletas <cuenta-remitente@dominio.com>"

GOOGLE_CHAT_BOLETAS_WEBHOOK=WEBHOOK_PRIVADO_DEL_CHAT_OPERATIVO
GOOGLE_CHAT_TEST_WEBHOOK=WEBHOOK_PRIVADO_DEL_CHAT_DE_PRUEBAS
TEST_NOTIFICATION_EMAIL=andrick.almengor@solutionsdms.com

# Opcional: prevalece sobre el valor TEMPLATE_BOLETA_ID de la hoja Configuracion.
TEMPLATE_BOLETA_ID=
MAX_EMAIL_ATTACHMENT_MB=20
NOTIFICATION_TIMEOUT_MS=15000
```

Reinicie el backend después de modificar las variables.

## Acceso de Google Drive

La cuenta de servicio configurada en el backend debe tener acceso de editor a:

- La plantilla de Google Docs.
- La carpeta principal de documentos de boletas.
- Las carpetas de evidencias y firmas.

## Chat de un cliente

Desde **Clientes**, un administrador puede guardar el webhook opcional de Google Chat. Al finalizar una boleta se envía un resumen a ese Chat únicamente cuando el cliente de la boleta tiene un webhook configurado.

## Flujo real

Al finalizar:

1. Se crea una copia de la plantilla.
2. Se reemplazan los marcadores.
3. Se agregan firma y evidencias al anexo.
4. Se genera y guarda el PDF.
5. Se envía correo al supervisor con PDF y evidencias.
6. Se envía el resumen al Chat operativo.
7. Se envía un resumen al Chat del cliente cuando exista.
8. Se registra cada intento en `Notificaciones`.
9. Se marca la boleta como finalizada y se guardan los enlaces.

## Modo de prueba

El botón de prueba requiere `NOTIFICACIONES_PRUEBA` y:

- Crea documento y PDF de prueba.
- Envía solamente a `TEST_NOTIFICATION_EMAIL`.
- Envía solamente a `GOOGLE_CHAT_TEST_WEBHOOK`.
- No cambia el estado de la boleta.
- No notifica al cliente ni al Chat operativo.

## Seguridad

Un webhook de Google Chat funciona como una credencial. Si se publica en un chat, captura, repositorio o documento compartido, debe regenerarse y reemplazarse en las variables privadas del backend.
