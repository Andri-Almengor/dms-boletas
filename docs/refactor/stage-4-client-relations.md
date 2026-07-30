# Etapa 4 — Clientes y relaciones agrupadas

## Objetivo

Migrar la lista de clientes a `usePaginatedResource` y eliminar el patrón N+1 al abrir el detalle de un cliente, manteniendo la interfaz, permisos, payloads, modo offline y administración de relaciones.

## Problema anterior

La pantalla realizaba:

1. Una consulta de sedes.
2. Una consulta de contactos.
3. Una consulta adicional por cada sede para obtener ubicaciones del equipo.

Un cliente con 20 sedes podía generar 22 consultas lógicas. La pantalla también repetía estados, secuencias, paginación y unión por ID que ya estaban centralizados.

## Solución

### Listado

`ClientsPage` usa `usePaginatedResource` para:

- Página actual.
- Total.
- Carga inicial.
- Carga incremental.
- Cancelación.
- Error.
- Unión por ID.

La búsqueda conserva el comportamiento visual inmediato y se envía al servidor al confirmar el formulario.

### Relaciones

La acción privada:

- `clients.relations.get`
- `clientes.relaciones.get`

lee en una sola operación:

- `ClienteUbicaciones`
- `ClienteUbicacionesEquipo`
- `ClienteContactos`

`readTables` permite que las hojas no almacenadas en caché se agrupen en un único `batchGet` de Google Sheets.

El servicio devuelve únicamente las relaciones del cliente solicitado, ordenadas y filtradas por estado.

## Compatibilidad offline

Cuando la acción agrupada todavía no está disponible durante un despliegue o el dispositivo está sin conexión, `src/services/clientRelations.js` reconstruye la respuesta utilizando los tres catálogos históricos.

Esto conserva la compatibilidad con:

- Catálogos offline descargados anteriormente.
- Versiones de backend y frontend desplegadas con pocos segundos de diferencia.
- Aliases históricos.

El fallback realiza como máximo tres consultas lógicas y nunca vuelve al patrón por sede.

## Cancelación

Cada apertura de cliente cancela la carga relacionada anterior. Cerrar el modal también cancela la solicitud activa, evitando actualizaciones tardías y trabajo de red innecesario.

## Permisos

- La lectura continúa siendo una ruta privada para usuarios autenticados, igual que los listados relacionados existentes.
- Los registros inactivos solo pueden incluirse con `USUARIOS_GESTIONAR` o `CLIENTES_EDITAR`.
- Crear, editar, desactivar y eliminar clientes conserva `USUARIOS_GESTIONAR`.

## Interfaz preservada

No se modificaron:

- Tarjetas.
- Modal.
- Formularios.
- Textos.
- Botones.
- Contadores.
- Modo consulta.
- Gestión de sedes, ubicaciones del equipo y contactos.
- Modo claro u oscuro.

## Pruebas

- Agrupación por cliente.
- Exclusión de relaciones ajenas.
- Exclusión de registros inactivos.
- Inclusión autorizada de inactivos.
- Contrato de una sola carga relacionada.
- Ausencia de `mapWithConcurrency` y secuencias locales.
- Registro de aliases en el backend.
