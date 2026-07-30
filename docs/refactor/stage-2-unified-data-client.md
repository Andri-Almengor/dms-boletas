# Etapa 2 — Cliente de datos unificado

## Objetivo

Centralizar la política de red antes de extraer hooks de consulta reutilizables. Esta etapa no modifica rutas, payloads, permisos, pantallas, estilos, recuperación de formularios ni reglas offline.

## Problema corregido

Antes, una solicitud realizada mediante `requestAvailable` podía ejecutar:

- Hasta cuatro intentos dentro de `api.js`.
- Dos intentos adicionales dentro de `moduleApi.js`.
- El mismo patrón otra vez por cada alias compatible.

En una caída de red, una sola operación podía provocar hasta ocho intentos para un alias, además de pausas duplicadas.

## Arquitectura resultante

```text
Pantalla o servicio
  → requestAvailable(routes, payload, token, options)
    → requestFirstAvailable(aliases)
      → apiRequest(route, payload, token, options)
        → una sola política de reintentos
        → caché y deduplicación de lecturas
        → AbortController cuando la consulta es cancelable
```

## Alias resolver

`src/services/aliasResolver.js`:

- Solo prueba el siguiente alias cuando el backend confirma que la ruta o acción no existe.
- No cambia de alias ante errores de red, permisos, validación o servidor temporal.
- Recuerda en memoria el alias que funcionó.
- En solicitudes posteriores prueba primero el alias válido.
- Limita la memoria a 160 conjuntos de aliases.
- Respeta `AbortSignal` antes de cada intento.

La preferencia vive únicamente en memoria. No se almacena en `localStorage` ni modifica datos históricos.

## Política de reintentos

`src/api.js` conserva una sola política:

- Solicitud inicial.
- Reintentos después de 700 ms, 1500 ms y 2800 ms.
- Solo para errores transitorios de red o estados 502, 503 y 504.
- Las pausas se cancelan mediante `AbortController`.
- Los errores de permisos, validación y rutas inexistentes no se reintentan.

`moduleApi.js` ya no contiene `requestRouteWithRetry`, otro bucle ni una pausa adicional de 450 ms.

## Cancelación

`apiRequest` y `requestAvailable` aceptan un cuarto parámetro opcional:

```js
const controller = new AbortController();

requestAvailable(routes, payload, sessionToken, {
  signal: controller.signal,
});

controller.abort();
```

Las lecturas existentes que no pasan señal conservan la deduplicación compartida. Las futuras búsquedas que pasen una señal pueden detener su `fetch` real al cambiar de consulta o desmontar la pantalla.

## Caché y deduplicación

Se conserva:

- Caché fresca de 15 segundos.
- Datos stale por hasta 5 minutos para degradación controlada de Sheets.
- Máximo de 120 lecturas recientes.
- Invalidación por familias después de escrituras.
- Una sola petición simultánea para lecturas idénticas sin señal.

Las claves de lectura ahora ordenan las propiedades del payload antes de serializarlo. Dos objetos equivalentes con distinto orden de propiedades comparten la misma caché.

## Compatibilidad offline

Se conserva sin cambios funcionales:

- Modo offline desactivado por defecto.
- Recuperación de formularios independiente del modo offline.
- Cola existente y sus claves.
- IDs idempotentes.
- Bloqueo de finalización con cambios pendientes.
- Lecturas desde IndexedDB.
- Actualizaciones optimistas de boletas y mantenimientos.

`ONLINE_REQUIRED` no se convierte en una operación offline cuando el usuario tiene el modo sin conexión desactivado.

## Pruebas

Las pruebas cubren:

- Fallback únicamente por ruta inexistente.
- Preferencia del alias válido.
- No cambiar de alias por error de red.
- Cancelación antes de iniciar una solicitud.
- Compatibilidad con códigos y mensajes históricos.
- Protección del modo offline desactivado.
- Ausencia del segundo ciclo de reintentos en `moduleApi.js`.

## Siguiente etapa

Construir `usePaginatedResource` y migrar progresivamente usuarios, conocimiento, encuestas, clientes, boletas y mantenimientos. Ese hook utilizará el `AbortSignal` agregado en esta etapa para cancelar búsquedas anteriores sin duplicar controladores en cada página.
