# Actualización: finalización de boletas

## Frontend

La rama `feature/boletas` ahora incluye:

- Tipo de falla como desplegable.
- Creación de nuevos tipos de falla.
- Correo del supervisor automático al seleccionarlo.
- Creación de supervisor con correo obligatorio.
- Eliminación del enlace para crear técnicos desde la boleta.
- Finalización con documento, PDF, correo y Google Chat.
- Prueba de PDF, Chat y correo sin cambiar la boleta a finalizada.

## Backend

Copie el archivo `BACKEND_PDF_CORREO_CHAT_TIPOS_FALLA.gs` al proyecto de Apps Script.

Luego:

1. Agregue en `ROUTES` las rutas comentadas al inicio del archivo.
2. Ejecute `instalarParcheTiposFallaDMS()` una sola vez.
3. Ejecute `verificarConfiguracionFinalizacionDMS()`.
4. Corrija cualquier propiedad faltante.
5. Publique una nueva versión de la implementación conservando la misma URL `/exec`.

La ruta de producción es `boletas.finalize` y la ruta de prueba es `boletas.testFinalize`.
