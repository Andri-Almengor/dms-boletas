# Eliminación operativa y respaldos semanales

## Eliminación por técnicos

- Las boletas se eliminan de forma lógica: cambian a `ANULADA` y dejan de aparecer en las listas operativas. No se borran físicamente del Google Sheets.
- Los técnicos con `BOLETAS_EDITAR` pueden ejecutar esta acción desde el detalle de la boleta.
- Los dispositivos de mantenimiento también usan eliminación lógica (`Activo=false`).
- Los técnicos con `MANTENIMIENTOS_EDITAR` o `BOLETAS_EDITAR` pueden eliminar dispositivos únicamente mientras el mantenimiento esté `PENDIENTE`.
- Administradores y usuarios con permisos de gestión conservan su alcance administrativo.
- Cada eliminación queda registrada en Auditoría.

## Copia de respaldo semanal

La opción se encuentra en **Más → Administración → Copias de respaldo** y solo es visible/operable para administradores.

El respaldo copia el archivo maestro completo de Google Sheets (`GOOGLE_SHEET_ID`) a una carpeta `Respaldos DMS Boletas` en Drive. La copia conserva todas las pestañas del libro: boletas, mantenimientos, clientes, usuarios, permisos, configuraciones, auditoría, catálogos e integraciones almacenadas en el archivo principal.

La programación permite activar/desactivar el proceso, escoger día de la semana y hora. La hora se interpreta siempre en `America/Costa_Rica`. El backend revisa periódicamente el último ciclo esperado y usa `BACKUP_LAST_SLOT` para evitar duplicar la misma semana incluso después de un reinicio.

También existe **Crear respaldo ahora** para generar una copia manual usando el mismo mecanismo.

Las imágenes, PDFs, videos y demás archivos externos de Drive no se duplican semanalmente. Permanecen en sus carpetas originales; las eliminaciones operativas son lógicas precisamente para no destruir esos archivos ni su trazabilidad.
