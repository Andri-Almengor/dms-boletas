# Etapa 11 — Backend y consultas agrupadas

## Objetivo

Reducir lecturas y escrituras repetidas contra Google Sheets y eliminar recorridos cuadráticos en respuestas con muchas boletas, visitas, mantenimientos, dispositivos y evidencias, sin modificar rutas, permisos, payloads ni formas de respuesta.

## Hallazgos

### Escrituras de filas

`updateRow` ya utilizaba `spreadsheets.values.batchUpdate`, pero solo para las columnas de una fila. Los flujos que modificaban varias filas llamaban `updateRow` dentro de ciclos, generando una solicitud de Google Sheets por cada asignación o visita.

Los puntos de mayor impacto eran:

- Reemplazo de técnicos asignados a una boleta.
- Propagación de firma a todas las visitas relacionadas.
- Retorno de un grupo completo de visitas a pendiente.
- Sincronización de una firma histórica entre visitas.
- Creación de una visita relacionada, que actualiza la visita nueva y la raíz.

### Lecturas de mantenimientos

El listado de mantenimientos esperaba primero la hoja principal y después la hoja de dispositivos. El detalle esperaba primero dispositivos y después imágenes. Al estar separadas por `await`, esas lecturas no podían entrar en el mismo `batchGet` del repositorio.

Además, el listado contaba dispositivos filtrando el arreglo completo para cada mantenimiento, y el detalle filtraba todas las imágenes para cada dispositivo.

### Visitas relacionadas

La respuesta de grupos de visitas recorría todas las asignaciones y todas las evidencias por cada visita. El costo crecía como visitas × relaciones.

## Cambios realizados

### `updateRows`

El repositorio de Sheets incorpora `updateRows(sheetName, updates, idColumn)`:

- Lee encabezados y filas una sola vez.
- Resuelve todas las filas por ID en memoria.
- Construye una única operación `spreadsheets.values.batchUpdate`.
- Conserva el control de concurrencia, intervalo mínimo y reintentos por cuota.
- Mantiene el error histórico `SHEET_PROTECTED_RANGE`.
- Actualiza la caché de todas las filas confirmadas.
- `updateRow` conserva su API y delega en `updateRows` con un solo elemento.

### Asignaciones de boletas

El reemplazo de asignados ahora:

1. Lee asignaciones y usuarios mediante `readTables`.
2. Desactiva todas las asignaciones anteriores con una sola actualización múltiple.
3. Agrega todas las asignaciones nuevas con un solo `appendRows`.

Los IDs, snapshots de nombre, actor, estado y fechas se conservan.

### Grupos de visitas

- La firma compartida se aplica a todas las visitas con una sola escritura agrupada.
- El retorno a pendiente utiliza una sola escritura agrupada.
- La sincronización de firma actualiza únicamente visitas que realmente la necesitan.
- Crear una visita relacionada actualiza la visita nueva y la raíz en una sola operación.
- `prepareRelatedVisit` reutiliza la visita ya cargada por el grupo en lugar de consultar nuevamente la hoja.

### Mantenimientos

- El listado solicita `Mantenimiento` y `Evidencia_Mantenimientos` en un solo snapshot.
- El detalle solicita mantenimiento, dispositivos e imágenes en un solo snapshot.
- La edición solicita mantenimiento, usuarios, dispositivos e imágenes conjuntamente y reutiliza ese snapshot en la respuesta.
- La finalización reutiliza el snapshot validado de dispositivos e imágenes.
- Los conteos se construyen una sola vez con un mapa.
- Las imágenes se agrupan una sola vez por dispositivo.
- Los responsables se resuelven mediante un índice de usuarios.

### Índices reutilizables

`row-index` centraliza:

- Índice de una fila por clave.
- Agrupación de filas por clave.
- Conteo de filas por clave.
- Filtrado opcional de registros activos.

## Compatibilidad preservada

- Mismas rutas y aliases.
- Mismos permisos.
- Mismos payloads y respuestas.
- Mismos IDs idempotentes.
- Mismos estados y mensajes de error.
- Mismos controles de cuota y caché.
- Mismos datos en Sheets, Drive, correo, Google Chat y reportes.
- Sin cambios visuales en el frontend.

## Impacto esperado

Para una boleta con seis técnicos, reemplazar asignados pasa de hasta doce escrituras individuales a dos operaciones agrupadas: una actualización y un append.

Para un grupo de diez visitas, propagar una firma pasa de diez actualizaciones de red a una sola operación de Sheets.

Un detalle de mantenimiento frío pasa de tres lecturas lógicas secuenciales a un `batchGet` de tres rangos. Los recorridos de dispositivos e imágenes pasan de cuadráticos a lineales.

## Validación requerida

```bash
npm run verify:stage0
npm run build
npm --prefix backend run check
```

## Pruebas manuales recomendadas

1. Crear y editar una boleta con varios técnicos.
2. Quitar todos los técnicos y volver a asignarlos.
3. Crear una visita relacionada.
4. Firmar una boleta que tenga varias visitas.
5. Regresar un grupo completo a pendiente.
6. Abrir un mantenimiento con muchos dispositivos e imágenes.
7. Editar responsables y finalizar el mantenimiento.
