# Etapa 6A — Ciclo compartido de borradores controlados

## Objetivo

Extraer de `useTicketDraft` la infraestructura neutral de recuperación y autoguardado para que los formularios controlados puedan reutilizar una sola implementación, sin modificar claves, datos restaurados, indicadores ni comportamiento observable.

## Problema anterior

`useTicketDraft` contenía de forma acoplada:

- Cálculo de la clave del borrador.
- Lectura desde IndexedDB y respaldo local.
- Migración desde `localStorage` histórico.
- Cola serial de guardado.
- Debounce.
- Respaldo en `pagehide` y `beforeunload`.
- Cancelación posterior a guardar o finalizar.
- Eliminación del borrador y sus claves heredadas.
- Estados `idle`, `saving`, `local`, `restored`, `server` y `error`.

La misma secuencia será necesaria para Mantenimientos y otros editores, pero copiarla aumentaría el riesgo de restauraciones dobles, borradores huérfanos y diferencias entre formularios.

## Solución

Se añade `src/hooks/useFormDraft.js` como ciclo neutral para valores controlados.

Parámetros principales:

- `namespace`: prefijo estable de la clave.
- `keySuffix`: identificador del formulario nuevo o existente.
- `routePrefix`: metadato histórico conservado en el registro.
- `legacyKeys`: claves antiguas que deben migrarse una sola vez.
- `value`: estado serializable actual.
- `onRestore`: restauración específica del formulario.
- `onEmpty`: inicialización específica cuando no existe borrador.
- `saveDelayMs`: demora del autoguardado.

El hook compartido conserva:

1. IndexedDB como fuente principal.
2. Respaldo escalar en `localStorage` mediante `draftStore`.
3. Migración automática de claves antiguas.
4. Guardados serializados para impedir escrituras fuera de orden.
5. Respaldo síncrono al ocultar o cerrar la página.
6. Cancelación para impedir que un guardado pendiente recree un borrador eliminado.
7. Los mismos estados consumidos por `AutosaveIndicator`.

## Adaptador de Boletas

`useTicketDraft` permanece como API pública para no modificar `TicketFormPage`.

El adaptador conserva exactamente:

- Clave canónica: `ticket-state:<id|new>`.
- Ruta interna: `ticket-hook:<id|new>`.
- Clave heredada: `dms_boleta_draft_<id|new>`.
- Debounce de 250 ms.
- Corrección de la fecha inicial usando Costa Rica.
- Forma del valor restaurado `{ form, step }`.
- Métodos `clearDraft`, `markServerSaved` y `storageKey`.

## Fuera de alcance

- No se cambia `FormRecoveryManager`, que continúa protegiendo formularios no controlados y archivos.
- No se cambia todavía el borrador temporal del editor de dispositivos de Mantenimiento; se migrará mediante un adaptador sobre este mismo contrato en el siguiente PR pequeño.
- No se modifican formularios, payloads, rutas, permisos, backend ni modo offline.

## Validación

La caracterización comprueba:

- Lectura, respaldo, persistencia y eliminación compartidas.
- Cola de guardado.
- Respaldo durante cierre de página.
- Migración y eliminación de claves heredadas.
- Conservación de claves y fecha de Costa Rica en Boletas.
- Ausencia de la infraestructura duplicada dentro de `useTicketDraft`.
