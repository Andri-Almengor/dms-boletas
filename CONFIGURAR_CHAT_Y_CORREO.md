# Configurar Google Chat y correo en Apps Script

Los errores:

- `CHAT_WEBHOOK_PRUEBAS no está configurado`
- `No cuentas con el permiso para llamar a MailApp.sendEmail`

se corrigen en el mismo proyecto de Apps Script publicado como Web App.

## 1. Copiar el parche

Copie `BACKEND_AUTORIZAR_CHAT_Y_CORREO.gs` dentro del proyecto de Apps Script.

## 2. Configurar los webhooks

Ejecute desde el editor:

```javascript
configurarNotificacionesDMS(
  'WEBHOOK_REAL_DE_BOLETAS',
  'WEBHOOK_DE_PRUEBAS'
);
```

Si todavía no existe un Chat separado para pruebas, puede usar temporalmente el mismo webhook en ambos parámetros o ejecutar:

```javascript
copiarWebhookBoletasComoPruebasDMS();
```

## 3. Autorizar el envío de correo

Ejecute manualmente desde el editor:

```javascript
autorizarYProbarCorreoDMS();
```

Apps Script mostrará la ventana de autorización. Debe aceptar el permiso para enviar correo. La función enviará un correo real al correo de pruebas configurado.

## 4. Verificar

Ejecute:

```javascript
verificarNotificacionesDMS();
```

Debe devolver:

```json
{
  "ok": true,
  "chatBoletas": true,
  "chatPruebas": true,
  "chatPruebaRespondio": true
}
```

## 5. Actualizar el Web App

Después de autorizar:

1. Implementar.
2. Administrar implementaciones.
3. Editar la implementación actual.
4. Seleccionar Nueva versión.
5. Implementar.

Conserve la misma URL `/exec`.

## appsscript.json

Si el proyecto utiliza permisos explícitos, confirme que incluya:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.send_mail"
]
```

No agregue `oauthScopes` manualmente si el proyecto no los usa; ejecutar `autorizarYProbarCorreoDMS()` normalmente es suficiente.
