# Etapa 6B — Borrador compartido de dispositivos de mantenimiento

## Objetivo

Adaptar el borrador temporal del editor de dispositivos de Mantenimiento al ciclo común creado en la Etapa 6A, sin cambiar la clave histórica, el retraso de autoguardado, la restauración observable ni el tratamiento de imágenes.

## Compatibilidad preservada

- Clave heredada: `dms-maintenance-device-draft:<maintenanceId|new>`.
- Demora histórica: 650 ms.
- Las fotografías nuevas no se serializan dentro del estado JSON.
- Las imágenes existentes eliminan referencias temporales `dataUrl` y `previewUrl` antes de persistirse.
- Un borrador restaurado conserva el contenido del dispositivo, pero recibe un `localId` nuevo y nunca reutiliza un identificador del servidor.
- La restauración automática continúa aplicándose únicamente al flujo de creación de un mantenimiento; editar un mantenimiento existente no cambia de comportamiento.
- Guardar o cancelar limpia tanto la clave canónica como la histórica.

## Infraestructura

`useFormDraft` ahora distingue:

- `enabled`: permite restaurar y migrar un borrador.
- `persistEnabled`: habilita las escrituras y el respaldo al cerrar la página.

Esto permite restaurar el borrador antes de que exista un dispositivo activo sin guardar valores nulos encima del registro recuperado.

`useMaintenanceDeviceDraft` define el contrato específico:

- Clave canónica: `maintenance-device-state:<maintenanceId|new>`.
- Ruta interna: `maintenance-device-hook:<maintenanceId|new>`.
- Migración de la clave histórica.
- Sanitización del dispositivo.
- Consumo único de la restauración.
- Limpieza coordinada.

## Integración progresiva

`useOptimizedMaintenanceForm` envuelve el formulario escalable existente para integrar el nuevo contrato sin modificar todavía el hook histórico de casi quinientas líneas. Durante esta transición:

- El mecanismo histórico continúa escribiendo su respaldo compatible.
- El adaptador migra y mantiene el borrador canónico.
- El estado visual de autoguardado sigue usando el indicador existente.
- La siguiente etapa de refactor del formulario podrá eliminar la escritura histórica sin riesgo de perder borradores creados por versiones anteriores.

## Validación

La caracterización comprueba las claves, el retraso, la sanitización, el consumo único, la limpieza y la integración del indicador de autoguardado.
