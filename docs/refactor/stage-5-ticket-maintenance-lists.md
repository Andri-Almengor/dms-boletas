# Etapa 5 — Listados de boletas y mantenimientos

## Objetivo

Migrar los dos listados operativos principales a `usePaginatedResource` sin cambiar su interfaz, filtros, tamaños de página, permisos ni contratos del backend.

## Boletas

- Mantiene páginas de 50 registros.
- Mantiene estados pendiente/finalizado, asignación por técnico y filtros históricos.
- La búsqueda y los filtros solo se aplican al enviar o confirmar.
- La anulación recarga mediante el hook compartido.
- La carga diferida de catálogos ahora usa `AbortController`.

## Mantenimientos

- Mantiene páginas de 40 registros.
- Mantiene pestañas pendiente/finalizado y filtros por cliente y fechas.
- Conserva el filtrado local de compatibilidad para respuestas offline o backends anteriores.
- La actualización y “Cargar más” usan el hook compartido.

## Eliminado

- Estados locales de página, total, `hasMore`, carga inicial y carga incremental.
- Contadores `requestSequence`.
- Unión manual con `mergePaginatedItems`.
- Cálculo manual con `paginationMeta`.

## Compatibilidad

No se modifican rutas, aliases, payloads, permisos, tarjetas, estilos, navegación, modo offline, formularios, Drive, Sheets, correo, Chat ni reportes.

## Validación

La suite de caracterización comprueba el uso del hook, cancelación, tamaños de página y preservación de filtros y estados.
