# Configuración de reportes y notificaciones

La generación del documento, el PDF y el correo de una boleta se ejecuta mediante Google Apps Script. Google Chat continúa enviándose desde el backend Node.

Consulte `APPS_SCRIPT_REPORT_SETUP.md` para crear y desplegar el Web App.

## Variables del backend

Agregue estas variables en `backend/.env` para desarrollo y en **Environment** del servicio de Render para producción:

```env
APPS_SCRIPT_REPORT_URL=https://script.google.com/macros/s/ID_IMPLEMENTACION/exec
APPS_SCRIPT_REPORT_SECRET=SECRETO_PRIVADO_COMPARTIDO_CON_APPS_SCRIPT
APPS_SCRIPT_TIMEOUT_MS=330000

GOOGLE_CHAT_BOLETAS_WEBHOOK=WEBHOOK_PRIVADO_DEL_CHAT_OPERATIVO
GOOGLE_CHAT_TEST_WEBHOOK=WEBHOOK_PRIVADO_DEL_CHAT_DE_PRUEBAS
TEST_NOTIFICATION_EMAIL=andrick.almengor@solutionsdms.com

TEMPLATE_BOLETA_ID=1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE
NOTIFICATION_TIMEOUT_MS=15000
```

Las variables `SMTP_*` ya no se utilizan para enviar reportes de boletas. Solo deben conservarse cuando otro flujo del sistema todavía las requiera.

Reinicie el backend después de modificar las variables.

## Acceso de Google Drive

La cuenta que despliega el Web App de Apps Script debe tener acceso a:

- La plantilla de Google Docs `1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE`.
- La carpeta principal de documentos de boletas.
- Las carpetas y archivos de evidencias y firmas.

Apps Script ejecuta la generación y el correo con la identidad de la cuenta que hizo la implementación.

## Chat de un cliente

Desde **Clientes**, un administrador puede guardar el webhook opcional de Google Chat. Al finalizar una boleta se envía un resumen a ese Chat únicamente cuando el cliente de la boleta tiene un webhook configurado.

## Flujo real

Al finalizar:

1. Node recopila la boleta, los técnicos, el cliente y las evidencias.
2. Apps Script crea una copia de la plantilla oficial.
3. Reemplaza los marcadores e inserta firma y evidencias.
4. Apps Script genera el PDF y envía el correo al supervisor y a los técnicos asignados.
5. Node envía el resumen al Chat operativo.
6. Node envía un resumen al Chat del cliente cuando exista.
7. Se registra cada intento en `Notificaciones`.
8. Se marca la boleta como finalizada y se guardan los enlaces.

## Visibilidad de técnicos

Los usuarios técnicos solamente reciben en los listados y pueden abrir las boletas donde exista una asignación activa en `BoletaAsignados`. Los administradores conservan la vista completa.

## Modo de prueba

El botón de prueba requiere `NOTIFICACIONES_PRUEBA` y:

- Crea documento y PDF de prueba utilizando Apps Script.
- Envía solamente a `TEST_NOTIFICATION_EMAIL`.
- Envía solamente a `GOOGLE_CHAT_TEST_WEBHOOK`.
- No cambia el estado de la boleta.
- No notifica al cliente, supervisor, técnicos ni al Chat operativo.

## Seguridad

Los webhooks, `APPS_SCRIPT_REPORT_SECRET` y otras credenciales no deben guardarse en GitHub ni compartirse por chat. Cuando una credencial se publica, debe regenerarse inmediatamente.
