# Etapa 0 — Caracterización y observabilidad

## Alcance

Esta etapa parte de `main` en `f07cd3044583e2201be74e80ebc8c7438a538921` (merge de PR #301) y no contiene optimizaciones funcionales.

Se verificaron como invariantes de protección:

- PR #300: las funcionalidades de reportes de actividad permanecen retiradas y no se reintroducen.
- PR #300: las lecturas de headers/schema continúan evitando lecturas completas de tablas.
- PR #301: se conservan las optimizaciones de Home, cachés y trabajo redundante ya integradas.
- No se modifican roles, permisos, niveles de acceso, reglas de autorización, filtros, estados, finalización, offline, firmas, PDFs, correo, Google Chat ni calidad/originales de Drive.

## Baseline de referencia previo a esta etapa

El último `main` validado por CI antes de esta etapa reportó:

- Characterization: 389/389 pruebas verdes.
- Build de producción: correcto.
- Escenario sintético de 10.000 filas: RSS pico aproximado 286 MiB.
- Heap usado pico aproximado: 127 MiB.
- `external` pico aproximado: 5,2 MiB.
- Event-loop lag máximo aproximado: 39 ms.

Estas cifras son referencia del entorno de CI y no equivalen a métricas de producción en Render. No se usan para prometer porcentajes de mejora.

## Observabilidad agregada por acción

La instrumentación es opt-in. Se activa con:

```text
PERF_METRICS_ENABLED=1
```

Opcionalmente se puede ajustar el intervalo de salida agregada:

```text
PERF_METRICS_LOG_INTERVAL_MS=300000
```

El intervalo se limita entre 60 segundos y 1 hora. El valor por defecto es 5 minutos.

Por cada `routeName` se agregan, con memoria acotada:

- `requestCount`
- `errorCount`
- `queueWaitMs` p50/p95/max
- `handlerDurationMs` p50/p95/max
- `totalDurationMs` p50/p95/max
- `sheetsReadCount`
- `sheetsWriteCount`
- `driveCallCount`
- `cacheHit`
- `cacheMiss`
- `cacheEvictions`
- `responseSize` p50/p95/max cuando Express conserva `Content-Length`
- `eventLoopLagMs` p50/p95/max como muestra del monitor global al terminar la solicitud
- RSS, heapUsed, external y arrayBuffers (último y pico observado por ruta)

La espera del limitador de acciones se mide desde antes de `runWithActionConcurrency()` hasta que el handler recibe el slot. El tiempo del handler se mide por separado.

## Privacidad y límites

La instrumentación no conserva:

- payloads;
- tokens;
- contraseñas;
- correos;
- firmas;
- imágenes;
- contenido de archivos;
- IDs de usuario o registro.

El nombre de ruta se valida y limita. Como máximo se mantienen 200 claves de ruta; el exceso se agrega como `__other__`. Cada serie de percentiles conserva como máximo 128 muestras numéricas. No se crean cachés de datos nuevas.

## Conteo de Google

Sheets se cuenta en el wrapper central existente. Los reads contabilizan intentos físicos, incluidos reintentos transitorios; los writes se cuentan antes de la llamada física.

Drive se observa en el cliente central exportado por `google.js`, sin registrar `fileId`, nombres, metadata ni contenido.

Los hits/misses/evictions corresponden a las capas de caché de Sheets que ya existían y que participan dentro del request observado. No se cambia TTL, presupuesto, invalidación ni política de admisión.

## Validación

Comando de aceptación de la etapa:

```bash
npm run verify:stage0
```

Este comando conserva la suite de caracterización, chequeo backend, build frontend y baseline sintético. La workflow Stage 0 también se habilita para ramas `perf/**`.

## Rollback

La etapa puede revertirse como un solo commit. Al hacerlo se eliminan únicamente la instrumentación, su prueba de caracterización, su documentación y la inclusión de `perf/**` en la workflow; no depende de ninguna etapa futura.

## FOLLOW-UP

- Etapa 1: idempotencia, resultados ambiguos y orden de autosave.
- Etapa 2+: usar estas mediciones para decidir optimizaciones; no cambiar políticas de caché por intuición.
- Métricas de producción requieren habilitar explícitamente `PERF_METRICS_ENABLED` en el entorno y observar tráfico real; CI no sustituye el perfil de Render.
