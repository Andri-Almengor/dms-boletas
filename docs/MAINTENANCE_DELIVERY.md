# Finalización y envío de mantenimientos

Al finalizar un mantenimiento, el backend crea o reutiliza esta estructura en Drive:

`Cliente / Fecha - Título - MantenimientoID / Zona / Categoría / Dispositivo / Evidencia del antes|despues|otras`

Las imágenes originales permanecen en su ubicación actual y se copian a la carpeta organizada. Las copias son idempotentes: una prueba o reintento no duplica archivos con el mismo nombre.

## Google Chat

- Si el cliente tiene `ChatWebhook`, el resultado final se envía a ese espacio.
- Si el cliente no tiene Chat, se utiliza `CHAT_TEST_WEBHOOK` o `CHAT_WEBHOOK_PRUEBAS` de la hoja `Configuracion`.
- El mensaje incluye la carpeta principal y las carpetas de cada dispositivo.
- Los mensajes extensos se dividen automáticamente.

## Prueba administrativa

El botón **Probar envío** crea/reutiliza las carpetas, copia las evidencias y envía toda la información al Chat de pruebas sin cambiar el estado del mantenimiento.

## Carpeta raíz

Se usa la primera clave disponible:

1. `MANTENIMIENTOS_EVIDENCE_ROOT_FOLDER_ID`
2. `EVIDENCE_ROOT_FOLDER_ID`
3. `MANTENIMIENTOS_FOLDER_ID`
4. `MANTENIMIENTOS_REPORTS_FOLDER_ID`
5. `EVIDENCIAS_FOLDER_ID`
6. `ROOT_FOLDER_ID`

La cuenta de servicio del backend debe tener acceso de edición a la carpeta configurada y a los archivos originales de evidencia.
