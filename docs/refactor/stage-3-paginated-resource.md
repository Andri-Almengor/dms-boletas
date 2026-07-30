# Etapa 3 — Recurso paginado reutilizable

## Objetivo

Eliminar la implementación repetida de carga inicial, carga incremental, cancelación, errores, total y `hasMore` en los listados del frontend.

Esta primera migración cubre:

- Usuarios.
- Base de conocimiento.
- Respuestas de encuestas.

Boletas, mantenimientos y clientes se migrarán después de validar este patrón en módulos de menor riesgo.

## Hook compartido

`src/hooks/usePaginatedResource.js` administra:

- Colección cargada.
- Página actual.
- Total del servidor.
- Disponibilidad de más resultados.
- Carga inicial.
- Carga incremental.
- Mensaje de error.
- Cancelación mediante `AbortController`.
- Sustitución de solicitudes anteriores.
- Unión estable por identificador.
- Limpieza al desmontar o cambiar filtros.

## Contrato

El módulo consumidor proporciona:

```js
usePaginatedResource({
  pageSize,
  fetchPage: ({ page, pageSize, signal }) => Promise,
  getItemKey,
  normalizeResponse,
  enabled,
  resetKey,
});
```

El hook no conoce reglas de negocio ni rutas. Cada página conserva la construcción exacta de su payload.

## Compatibilidad

Se mantienen:

- Tamaños de página: usuarios 50, conocimiento 30 y encuestas 40.
- Ordenamiento enviado al backend.
- Búsquedas manuales mediante el botón existente.
- Filtros existentes.
- Unión por los mismos identificadores.
- Textos, tarjetas, botones y estados vacíos.
- Operaciones de edición, desactivación y restablecimiento.
- Rutas, aliases, permisos y payloads.
- Caché y modo offline de la capa de datos.

## Cancelación

Cuando cambia una pestaña, filtro o componente:

1. Se invalida la secuencia anterior.
2. Se aborta el `fetch` activo.
3. La respuesta anterior no puede modificar el estado.
4. Las pausas de reintento también se cancelan en la capa HTTP.

## Encuestas

Preguntas y respuestas ya no comparten el mismo contador de solicitudes.

- Las respuestas usan `usePaginatedResource`.
- Las preguntas conservan su carga independiente.
- Cada flujo tiene su propio `AbortController`, estado de carga y error.

Esto evita que cambiar de pestaña invalide accidentalmente una petición del otro flujo.

## Exclusiones

Esta etapa no modifica:

- Backend.
- Google Sheets.
- Drive.
- Reportes.
- Formularios.
- Recuperación de borradores.
- Cola offline.
- Interfaz o estilos.

## Validación

```bash
npm run verify:stage0
npm run build
```

También deben comprobarse manualmente:

- Búsqueda y “Cargar más” en Usuarios.
- Categorías, “Mis tutoriales”, búsqueda y “Cargar más” en Conocimiento.
- Cambio entre Preguntas y Respuestas.
- Filtro de estado, búsqueda y “Cargar más” en Encuestas.
- Edición y estado de preguntas.
