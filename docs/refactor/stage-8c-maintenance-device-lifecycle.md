# Etapa 8C — Ciclo de edición de dispositivos de mantenimiento

## Objetivo

Separar del hook principal la edición temporal de un dispositivo sin modificar la interfaz, los permisos, los payloads, el guardado al servidor, la recuperación existente ni el procesamiento de imágenes.

## Responsabilidades extraídas

### `maintenanceDeviceState.js`

Centraliza funciones puras para:

- Clonar dispositivos sin compartir respuestas o arreglos de imágenes.
- Crear una versión serializable del borrador.
- Calcular firmas de dispositivo y mantenimiento.
- Detectar cambios respecto a la copia original.
- Reemplazar o agregar dispositivos por `localId`.
- Identificar imágenes nuevas que deben liberar su vista previa.
- Restaurar el formato histórico del borrador.
- Mantener la clave `dms-maintenance-device-draft:*` y la demora de 650 ms.

### `useMaintenanceDeviceEditorLifecycle.js`

Administra:

- Dispositivo activo y referencia inmediata.
- Copia original para confirmar descartes.
- Estado de autoguardado: `idle`, `saving`, `local`, `server` y `error`.
- Apertura y cierre del editor.
- Confirmación antes de descartar cambios.
- Limpieza de URLs `blob:` y archivos asociados al borrador.
- Escritura temporal compatible en `localStorage`.
- Restauración histórica para mantenimientos nuevos.
- Sincronización de la firma después de un guardado exitoso.

## Integración

`useMaintenanceForm` conserva:

- Permisos.
- Recursos y relaciones.
- Persistencia del encabezado.
- Solicitudes al backend.
- Subida y actualización de evidencias.

El hook principal delega al ciclo de edición:

- `activeDevice` y `setActiveDevice`.
- `openDevice` y `cancelActiveDevice`.
- `saveActiveDevice`.
- `markDeviceSaved`.
- `createDevice`.
- Limpieza del borrador.

`useScalableMaintenanceForm` utiliza `markDeviceSaved` cuando el guardado por lotes termina completamente. Cuando existe un guardado parcial, conserva el dispositivo y sus elementos pendientes sin marcarlo como totalmente sincronizado.

## Compatibilidad preservada

- Mismos cuatro pasos y editor visual.
- Mismos mensajes de confirmación.
- Misma clave histórica de borrador.
- Misma demora de 650 ms.
- Misma recuperación mediante `useMaintenanceDeviceDraft` y `useFormDraft`.
- Mismos eventos `dms-draft-file-removed` y `dms-offline-editing-complete`.
- Mismos payloads, rutas y permisos.
- Mismo comportamiento para guardados parciales.
- Sin cambios en backend, Google Sheets, Drive, correo o Google Chat.

## Fuera de alcance

Esta etapa no separa todavía:

- Persistencia del dispositivo en el backend.
- Actualización de metadatos de imágenes.
- Conversión y carga de fotografías.
- Guardado completo y finalización del mantenimiento.

Esas responsabilidades se abordarán en la Etapa 8D y en la optimización posterior de imágenes y evidencias.
