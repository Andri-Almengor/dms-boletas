# Etapa 8A — Orquestación del formulario de mantenimientos

## Objetivo

Reducir responsabilidades de `MaintenanceFormPage.jsx` sin modificar la interfaz, los cuatro pasos, los permisos, el guardado de dispositivos, las imágenes, los borradores ni el modo offline.

## Alcance

Esta etapa extrae únicamente dos responsabilidades de bajo riesgo:

1. Navegación directa hacia creación o edición de dispositivos mediante parámetros de URL.
2. Creación rápida de ubicaciones del cliente y ubicaciones de equipo.

El hook histórico de persistencia, imágenes, autoguardado y recuperación permanece intacto para dividirlo después en PR pequeños.

## Componentes nuevos

### `maintenanceFormOrchestration.js`

Centraliza funciones puras para:

- Identificar dispositivos históricos o locales.
- Interpretar `directDevice`, `newDevice`, `device` y `step=devices`.
- Calcular el progreso de los cuatro pasos.
- Crear y validar el modal rápido.
- Normalizar las respuestas de ubicaciones creadas.

### `useMaintenanceDirectDevice.js`

Administra:

- Apertura automática de un dispositivo nuevo.
- Apertura automática de un dispositivo existente.
- Mensajes cuando no hay categorías esperadas o el dispositivo no existe.
- Guardar, cancelar y eliminar en modo directo.
- Retorno al detalle con navegación `replace`.

### `useMaintenanceQuickCreate.js`

Administra:

- Estado del modal.
- Validación del nombre.
- Creación de ubicaciones del cliente.
- Creación de ubicaciones de equipo.
- Selección automática de la ubicación recién creada.

## Compatibilidad preservada

- Cuatro pasos y mismo porcentaje visual.
- Modo directo y parámetros históricos.
- Mismos mensajes de validación.
- Mismos permisos.
- Mismos payloads y rutas.
- Mismo editor de dispositivos.
- Mismo flujo de guardado, borradores, imágenes y finalización.
- Sin cambios en backend, Sheets, Drive, correo o Google Chat.

## Siguiente etapa

La Etapa 8B separará del hook grande:

- Carga inicial de clientes, técnicos y mantenimiento.
- Relaciones de ubicaciones y equipos con cancelación.
- Cálculos derivados y validaciones puras.

La persistencia e imágenes se mantendrán todavía aisladas hasta contar con caracterización suficiente.
