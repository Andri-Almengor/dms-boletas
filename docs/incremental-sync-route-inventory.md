# Inventario de lecturas y sincronización incremental

Este inventario clasifica las lecturas activas registradas en `backend/src/core/action-router.js`. Las mutaciones se auditan por separado mediante `classifyMutationRoute()` y sus pruebas de cobertura.

## A. DELTA_SYNCED

Persisten snapshot/cursor en IndexedDB y consumen `sync.delta` en revisitas compatibles:

- `boletas.list/get`, `tickets.list/get`.
- `maintenance.list/get`, `mantenimientos.list/get`.
- `agenda.list/get`, `agendas.list/get`.
- clientes y relaciones normalizadas: `clients`, `clientLocations`, `equipmentLocations`, `contacts` y sus aliases, en `list/get`.
- catálogos operativos: categorías, tipos de dispositivo, fabricantes, modelos, tipos de falla y relaciones dispositivo/fabricante, incluidos aliases operativos, en `list/get`.
- `customerCases.list/get`, `casos.cliente.list/get`.
- artículos y categorías de conocimiento (`knowledge`, `baseConocimientos`, `conocimiento`, `tutorials`) en `list/get`.

## B. VERSIONED_CACHE

Actualmente vacío a propósito. No se marca una ruta como versionada hasta que exista un contrato real de versión servidor/cliente. Los catálogos principales ya usan `DELTA_SYNCED`.

## C. ALWAYS_ONLINE

Lecturas pequeñas, operativas o derivadas que se mantienen online y no se presentan como colecciones sincronizadas:

- configuración runtime (`config.get`, `app.config.get`);
- asistente;
- métricas;
- preview de importación legacy;
- administración de encuestas;
- agregado `clients.relations.get`;
- estado del enlace de customer cases;
- preguntas/configuración de mantenimiento.

## D. MEDIA_STREAM

Media sigue fuera del delta. `sync.delta` transporta solo metadata:

- `boletas.media.get` / `tickets.media.get`;
- `maintenance.media.get` / `mantenimientos.media.get`;
- `customerCases.media.get`;
- `knowledge.media.get` y aliases.

## E. GENERATED_ARTIFACT

Se generan bajo demanda y no se almacenan como snapshots sincronizados:

- PDF de boleta;
- reporte spreadsheet de mantenimiento;
- presentación de mantenimiento.

## F. SECURITY_SENSITIVE

Siempre se valida contra el backend y no se trata como catálogo común:

- `auth.me` y demás rutas de autenticación;
- usuarios, usuarios asignables y roles;
- payloads públicos de firma y enlaces de firma;
- lecturas públicas tokenizadas de customer cases y encuestas.

## Reconciliación

El refresco incremental en background usa un intervalo conservador (60 s por defecto), únicamente con sesión vigente, red disponible y pestaña visible. Cada `sync.delta` valida `generation`, `schemaVersion`, cursor, gaps/eventos incompatibles y el estado `sync_unsafe`. Ante incompatibilidad se solicita snapshot completo; el cliente conserva el cache anterior hasta tener el reemplazo autoritativo. Una entrada IndexedDB inexistente deja de considerarse un snapshot válido y cae al camino de lectura completa existente.

No se hace un full scan periódico solo para comprobar integridad: eso anularía el beneficio del delta. El ChangeLog, `generation`, cursor estable y la degradación `fullSnapshotRequired` son la revisión ligera; los snapshots completos quedan reservados para incompatibilidades o recuperación.
