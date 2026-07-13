# Despliegue de DMS Boletas en Render

El repositorio funciona como un monorepo:

- React/Vite se compila en `dist`.
- Express vive en `backend`.
- El backend sirve el frontend y expone `POST /api/action`.
- Google Sheets sigue siendo la base de datos.
- Google Drive conserva evidencias, firmas y documentos.

## 1. Preparar Google Cloud

1. Cree o seleccione un proyecto de Google Cloud.
2. Active Google Sheets API, Google Drive API, Google Docs API y Google Slides API.
3. Cree una cuenta de servicio y genere una clave privada.
4. Comparta como **Editor** con el correo de la cuenta de servicio:
   - El Sheet `11u44CTxL2KWqwezF_p3Kkc4OoB71BKsQwIh-NLRFgm4`.
   - La carpeta principal y las carpetas configuradas en la hoja `Configuracion`.
5. No suba el JSON de la cuenta de servicio al repositorio.

## 2. Crear el Blueprint

En Render seleccione **New → Blueprint** y conecte este repositorio. Render detectará `render.yaml` y creará el servicio `dms-boletas`.

Durante la creación, complete:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, incluyendo `-----BEGIN PRIVATE KEY-----` y los saltos de línea como `\n`.
- `APP_PUBLIC_URL` puede dejarse vacío inicialmente y actualizarse con la URL final.
- Las variables SMTP para enviar correos de credenciales.
- `GOOGLE_CHAT_WEBHOOK` cuando se requieran notificaciones de Google Chat.

## 3. Verificar

- Salud: `https://SU-SERVICIO.onrender.com/api/health`
- Aplicación: `https://SU-SERVICIO.onrender.com`

El frontend usa `/api/action` en producción, por lo que no necesita una URL separada ni CORS entre dos servicios.

## 4. Desarrollo local

Terminal 1:

```bash
npm install
npm run dev
```

Terminal 2:

```bash
npm --prefix backend install
cp backend/.env.example backend/.env
npm run dev:backend
```

En Windows PowerShell puede usar:

```powershell
Copy-Item backend/.env.example backend/.env
```

Vite redirige `/api` a `http://localhost:10000`.

## 5. Seguridad

- Mantenga la cuenta de servicio y SMTP únicamente en variables secretas de Render.
- Comparta el Sheet solo con la cuenta de servicio necesaria.
- El backend devuelve usuarios saneados y no expone hashes ni salts.
- Las sesiones se registran en la pestaña `Sesiones` mediante hashes del token.

## 6. Compatibilidad durante la migración

El frontend conserva compatibilidad con Google Apps Script cuando `VITE_API_URL` contiene una URL de `script.google.com`. En producción, Render usa el backend Node por la ruta relativa `/api/action`.

Las operaciones principales ya están estructuradas en Node: autenticación, permisos, usuarios, clientes, catálogos, boletas, mantenimientos, evidencias, archivos y base de conocimientos. Los reportes avanzados que dependan de plantillas específicas deben compararse con las plantillas actuales antes de retirar definitivamente Apps Script.
