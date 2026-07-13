# Backend Node.js de DMS Boletas

Backend Express preparado para Render. Mantiene Google Sheets como base de datos y utiliza Google Drive para archivos.

## Estructura

- `src/config`: variables y metadatos de tablas.
- `src/core`: errores, utilidades y enrutador de acciones.
- `src/infra`: clientes de Google Sheets/Drive.
- `src/services`: autenticación, permisos, auditoría y correo.
- `src/modules`: usuarios, clientes, catálogos, boletas, mantenimientos y conocimiento.

## Google Cloud

1. Cree un proyecto en Google Cloud.
2. Active Google Sheets API, Google Drive API, Google Docs API y Google Slides API.
3. Cree una cuenta de servicio.
4. Comparta el Sheet `11u44CTxL2KWqwezF_p3Kkc4OoB71BKsQwIh-NLRFgm4` con el correo de la cuenta de servicio como editor.
5. Comparta también las carpetas de Drive configuradas en la pestaña `Configuracion`.
6. Configure las variables de `.env.example` en Render. Nunca suba el JSON de la cuenta de servicio al repositorio.

## Desarrollo local

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

El frontend debe usar `VITE_API_URL=http://localhost:10000/api/action`.

## Compatibilidad

El endpoint `POST /api/action` conserva el contrato del Apps Script:

```json
{"route":"auth.login","payload":{},"sessionToken":""}
```

Esto permite migrar el frontend sin reescribir sus formularios.
