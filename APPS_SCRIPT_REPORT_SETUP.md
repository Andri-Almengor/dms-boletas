# Reportes de boletas mediante Google Apps Script

La generación del Google Doc, el PDF y el envío del correo se ejecutan desde un Web App de Google Apps Script. El backend Node continúa enviando los mensajes a Google Chat y registrando los resultados en la hoja `Notificaciones`.

## 1. Crear el proyecto de Apps Script

1. Ingrese a `https://script.google.com` con la cuenta que enviará los correos.
2. Cree un proyecto independiente, por ejemplo **DMS Boletas - Reportes**.
3. Copie el contenido de `apps-script/boletas-report/Code.gs` en el archivo `Code.gs`.
4. Use el manifiesto incluido en `apps-script/boletas-report/appsscript.json` si trabaja con `clasp`.

El correo saldrá desde la cuenta que despliegue el Web App. Para que el remitente sea `reportes@solutionsdms.com`, el proyecto debe crearse y desplegarse desde esa cuenta o desde una cuenta que tenga configurado ese alias en Google Workspace.

## 2. Configurar propiedades privadas

En **Configuración del proyecto → Propiedades del script**, agregue:

```text
REPORT_WEBHOOK_SECRET=UNA_CADENA_LARGA_ALEATORIA
TEMPLATE_BOLETA_ID=1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE
BOLETAS_FOLDER_ID=ID_DE_LA_CARPETA_PRINCIPAL_DE_BOLETAS
```

`REPORT_WEBHOOK_SECRET` debe ser diferente de las contraseñas y webhooks existentes. No debe guardarse en GitHub ni enviarse en capturas.

## 3. Permisos de Drive

La cuenta que despliega Apps Script debe poder abrir:

- La plantilla `1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE`.
- La carpeta principal de boletas.
- Las evidencias y firmas guardadas en Drive.

Comparta estas carpetas con esa cuenta cuando los archivos sean propiedad de la cuenta de servicio del backend.

## 4. Desplegar como aplicación web

1. Pulse **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Ejecutar como: **Yo**.
4. Quién tiene acceso: **Cualquiera**.
5. Autorice Drive, Documentos y envío de correo.
6. Copie la URL terminada en `/exec`.

La petición se protege adicionalmente con `REPORT_WEBHOOK_SECRET`.

## 5. Configurar el backend

En `backend/.env` y en **Render → Environment**, agregue:

```env
APPS_SCRIPT_REPORT_URL=https://script.google.com/macros/s/ID_IMPLEMENTACION/exec
APPS_SCRIPT_REPORT_SECRET=LA_MISMA_CADENA_DE_REPORT_WEBHOOK_SECRET
APPS_SCRIPT_TIMEOUT_MS=330000
TEMPLATE_BOLETA_ID=1QsEaLN8RL5Ry_EBZvBeKoWo6NHZHNmKHckAWT85fhBE
```

Las variables `SMTP_*` ya no se usan para los reportes de boletas. Pueden conservarse únicamente si se utilizan para otros correos del sistema, como credenciales temporales de usuarios.

Reinicie el backend después de cambiar variables.

## 6. Actualizaciones futuras

Cuando cambie `Code.gs`:

1. Guarde el proyecto.
2. Entre en **Implementar → Administrar implementaciones**.
3. Edite la implementación.
4. Seleccione **Nueva versión**.
5. Implemente nuevamente sin cambiar la URL del backend.

## 7. Flujo

Al finalizar una boleta:

1. Node obtiene la boleta, técnicos, cliente, firma y evidencias.
2. Apps Script copia la plantilla oficial.
3. Reemplaza los marcadores `<<[Campo]>>` y `{{Campo}}`.
4. Inserta la firma en el marcador y agrega las evidencias como anexos.
5. Exporta el documento a PDF.
6. Envía el correo al supervisor y copia a los técnicos asignados.
7. Node envía los mensajes a Google Chat y guarda las URL del reporte.

El botón **Probar** envía solamente al correo configurado en `TEST_NOTIFICATION_EMAIL` y al Chat de pruebas, sin finalizar la boleta.
