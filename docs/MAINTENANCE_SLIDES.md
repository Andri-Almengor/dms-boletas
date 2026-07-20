# Presentaciones de mantenimiento

## Comportamiento

La acción **Crear presentación** utiliza el Apps Script de reportes mediante la acción `maintenance.presentation.create`.

La presentación contiene:

- Portada con cliente, fecha, título, estado, técnicos y totales.
- Una o más diapositivas por dispositivo.
- Zona, categoría, modelo, serie, funcionamiento, uso, estado y observación.
- Fotografías ordenadas como Antes, Después y Otra evidencia.
- Hasta seis fotografías por diapositiva, conservando su proporción.
- Nota individual debajo de cada fotografía.
- Enlace a la carpeta del dispositivo cuando ya existe la estructura de Drive del mantenimiento.

Si el mantenimiento contiene muchos dispositivos, Apps Script crea inmediatamente la presentación y continúa agregando diapositivas en segundo plano mediante un disparador temporal.

## Seguridad

El backend envía únicamente la información del mantenimiento y los identificadores privados de los archivos de Drive. Apps Script lee los blobs directamente con los permisos de la cuenta ejecutora. Las fotografías no se hacen públicas para insertarlas en Slides.

No se utiliza la API de AppSheet ni una llave de acceso de AppSheet para generar la presentación.

## Despliegue

1. Reemplazar el código del Web App de reportes por la versión V4 que incluye `maintenance.presentation.create`.
2. Guardar el proyecto de Apps Script.
3. Ir a **Implementar > Administrar implementaciones**.
4. Editar la implementación activa y seleccionar **Nueva versión**.
5. Mantener la misma URL `/exec` configurada como `APPS_SCRIPT_REPORT_URL` en Render.
6. Confirmar mediante `doGet()` que aparece la versión `2026-07-20-MAINTENANCE-SLIDES-V4`.
7. Después desplegar la rama principal del backend.

El Apps Script debe ejecutarse como el propietario y tener permisos de Google Drive y Google Slides.
