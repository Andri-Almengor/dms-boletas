# Etapa 8D — Persistencia remota de dispositivos y evidencias

## Objetivo

Unificar el guardado remoto de dispositivos de mantenimiento y sus evidencias sin modificar interfaz, permisos, rutas, payloads, modo offline, finalización ni contratos con Google Sheets y Drive.

## Problema anterior

La persistencia estaba implementada en dos lugares:

- `useMaintenanceForm` guardaba el dispositivo, actualizaba evidencias y subía fotografías mediante ciclos individuales.
- `useScalableMaintenanceForm` repetía la creación o actualización del dispositivo, utilizaba operaciones por lote, reconstruía el estado, liberaba vistas previas y generaba mensajes de guardado parcial.

Esto permitía que ambos caminos evolucionaran de manera diferente y obligaba a mantener dos implementaciones de las mismas reglas.

## Infraestructura nueva

### `maintenanceDevicePersistenceState.js`

Contiene funciones puras para:

- Mantener IDs idempotentes en creación y reintentos.
- Normalizar imágenes devueltas por el backend.
- Reconstruir el dispositivo después de una respuesta completa o parcial.
- Marcar como limpias únicamente las evidencias actualizadas.
- Retirar únicamente las fotografías cargadas correctamente.
- Conservar en `newImages` las fotografías que deben reintentarse.
- Generar el mismo mensaje histórico de guardado parcial.

### `maintenanceDevicePersistence.js`

Centraliza:

1. Selección de la ruta de creación o actualización.
2. Construcción del payload del dispositivo.
3. Resolución del identificador devuelto por el backend.
4. Actualización por lotes de metadatos de evidencias.
5. Carga por lotes de fotografías.
6. Fallback individual ya proporcionado por `maintenanceImageBatch`.
7. Liberación de vistas previas y archivos procesados.
8. Persistencia secuencial de colecciones de dispositivos.
9. Interrupción segura cuando existe un guardado parcial.

## Integración

`useMaintenanceForm` ahora utiliza el servicio común para:

- Guardar el dispositivo activo.
- Mantener evidencias fallidas dentro del editor.
- Guardar todos los dispositivos durante una persistencia completa.

`useScalableMaintenanceForm` ahora:

- Delega el guardado individual a `base.commitActiveDevice`.
- Utiliza `persistMaintenanceDeviceCollection` al crear el mantenimiento completo.
- Conserva la generación idempotente de `MantenimientoID`.
- Conserva el mensaje que permite reintentar sin duplicar elementos procesados.

## Compatibilidad preservada

- Mismos cuatro pasos y editor visual.
- Mismos permisos.
- Mismas rutas y aliases.
- Mismos payloads.
- Mismos límites y lotes de imágenes.
- Mismo fallback individual cuando el endpoint por lote no existe.
- Mismo mensaje de guardado parcial.
- Mismos IDs idempotentes para reintentos.
- Mismos eventos `dms-draft-file-removed`.
- Mismo autoguardado y recuperación de borradores.
- Sin cambios en backend, Sheets, Drive, correo o Google Chat.

## Fuera de alcance

Esta etapa no cambia todavía:

- Conversión simultánea de archivos a Base64.
- Límites de memoria durante la preparación de lotes.
- Compresión o redimensionamiento de fotografías.
- Estructura de controladores y servicios del backend.

Esas optimizaciones pertenecen a las etapas posteriores de imágenes, evidencias y backend.
