# Etapa 8B — Recursos y dominio del formulario de mantenimientos

## Objetivo

Separar del hook histórico del formulario de mantenimientos la carga inicial, las relaciones del cliente y los cálculos derivados, sin modificar la interfaz, los permisos, los payloads, la persistencia, las imágenes ni la recuperación de borradores.

## Cambios

### `maintenanceFormDomain.js`

Centraliza funciones puras para:

- Normalizar clientes, ubicaciones y ubicaciones de equipo.
- Filtrar usuarios activos.
- Preparar las opciones de técnicos.
- Contar dispositivos registrados por categoría.
- Calcular el total esperado.
- Actualizar cantidades sin aceptar valores negativos.
- Validar título, cliente y responsables.
- Determinar el modo de solo lectura.
- Filtrar equipos por la ubicación seleccionada.

### `useMaintenanceResources.js`

Administra:

- Carga inicial de clientes y técnicos.
- Carga del mantenimiento y sus dispositivos al editar.
- Cancelación de solicitudes al salir o cambiar de mantenimiento.
- Carga agrupada de sedes y equipos mediante `fetchClientRelations`.
- Cancelación de relaciones al cambiar de cliente.
- Filtrado local de equipos por sede.
- Actualización inmutable tras crear sedes o equipos desde el modal rápido.

### `useMaintenanceForm.js`

El hook principal mantiene intactas las responsabilidades sensibles:

- Estado y edición del dispositivo activo.
- Autoguardado local del dispositivo.
- Confirmación al descartar cambios.
- Persistencia de dispositivos.
- Actualización y carga de imágenes.
- Guardado y finalización del mantenimiento.
- Recuperación del dispositivo pendiente.

Ahora delega recursos, validaciones y cálculos a las piezas nuevas.

## Mejora de consultas

Antes, cambiar de cliente cargaba las sedes y después cada cambio de sede generaba otra consulta de ubicaciones de equipo.

Ahora:

1. Se carga una sola relación agrupada por cliente.
2. Se conservan todas las ubicaciones de equipo del cliente en memoria.
3. La sede seleccionada filtra localmente los equipos correspondientes.
4. Cambiar rápidamente de cliente cancela la solicitud anterior.

El fallback offline y de compatibilidad de `fetchClientRelations` se conserva.

## Compatibilidad preservada

- Cuatro pasos y misma interfaz.
- Mismos permisos.
- Mismos mensajes de validación.
- Mismos payloads y rutas.
- Mismo modo de solo lectura.
- Mismo editor y autoguardado de dispositivos.
- Mismos borradores recuperables.
- Mismo guardado, finalización e imágenes.
- Sin cambios en backend, Sheets, Drive, correo o Google Chat.

## Pruebas

Se agregaron contratos para:

- Normalización de registros históricos.
- Técnicos y usuarios activos.
- Cantidades, registrados y validaciones.
- Filtrado local por sede.
- Cancelación con `AbortController`.
- Uso de la relación agrupada.
- Ausencia de consultas directas por sede en el hook principal.
- Actualización inmutable de creación rápida.

## Siguiente etapa

La Etapa 8C separará el ciclo de edición del dispositivo, firmas de cambios, confirmación de descarte y autoguardado local. La persistencia de imágenes seguirá aislada hasta contar con un servicio caracterizado para reintentos parciales.
