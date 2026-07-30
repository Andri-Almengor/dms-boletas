# Etapa 1 — Utilidades compartidas neutrales

## Objetivo

Eliminar duplicaciones pequeñas y de bajo riesgo antes de extraer hooks o componentes. Esta etapa no cambia la interfaz, las rutas, los permisos, los payloads ni las consultas realizadas por cada pantalla.

## Utilidades extraídas

### `src/utils/paginatedCollection.js`

Centraliza dos comportamientos repetidos:

- Unión de páginas por una clave definida por cada módulo.
- Cálculo de `total` y `hasMore`, incluyendo el fallback histórico cuando el backend no devuelve `total`.

Se utiliza en:

- Boletas.
- Mantenimientos.
- Clientes.
- Usuarios.
- Base de conocimiento.
- Encuestas.

Cada módulo conserva su propia función de identidad para respetar IDs, aliases y claves de respaldo existentes.

### `src/utils/localId.js`

Centraliza la generación de IDs locales idempotentes. Se reutiliza en:

- Mantenimientos nuevos.
- Dispositivos de mantenimiento.
- Cola y operaciones offline mediante el export histórico `createOfflineId`.

### `src/utils/fileEncoding.js`

Centraliza la conversión `File` → Base64. `maintenanceFormData.js` conserva el export histórico `fileToBase64` para no romper imports existentes, mientras los servicios nuevos pueden depender directamente de la utilidad neutral.

## Compatibilidad preservada

- Mismos tamaños de página.
- Mismo orden de registros.
- El registro más reciente continúa sustituyendo al anterior cuando comparten ID.
- Se mantienen claves de respaldo para registros históricos sin ID.
- El modo offline conserva `createOfflineId` con el mismo prefijo por defecto.
- Los formularios y el pipeline de imágenes conservan el mismo formato Base64.
- No se modifican rutas, aliases, permisos, filtros, consultas ni estilos.

## Pruebas añadidas

- Unión estable y sustitución por ID.
- Claves de respaldo por origen.
- Paginación con total del servidor.
- Paginación sin total del servidor.
- Totales inválidos.
- IDs con y sin prefijo.
- Conversión Base64 y propagación de errores.

## Duplicaciones pendientes para etapas posteriores

Esta etapa no intenta resolver todavía:

- Implementación repetida de estado de listados (`loading`, `page`, `requestSequence`, etc.).
- Campos de formulario locales repetidos.
- Recuperación/autoguardado superpuestos.
- Reintentos de red duplicados.
- Conversión Base64 local restante en formularios antiguos.
- Filtros locales aplicados después del filtrado del backend.

Esas extracciones requieren pruebas y cambios estructurales separados para mantener los PR pequeños y reversibles.
