# Etapa 9 — Catálogos bajo demanda y búsqueda remota

## Objetivo

Reducir la carga inicial de los formularios de boletas y mantenimientos sin cambiar la interfaz, las opciones disponibles, los permisos, la creación rápida, la recuperación de borradores ni el funcionamiento sin conexión.

## Situación anterior

El formulario de boletas solicitaba simultáneamente ocho catálogos con hasta 1.000 registros cada uno:

- Clientes.
- Categorías.
- Tipos de falla.
- Tipos de dispositivo.
- Fabricantes.
- Modelos.
- Relaciones entre tipos y fabricantes.
- Usuarios asignables.

El formulario de mantenimientos también solicitaba hasta 1.000 clientes aunque normalmente solo se utiliza uno.

## Nuevo comportamiento

### Carga inicial de boletas

Se conservan completos los catálogos pequeños y necesarios desde los primeros pasos:

- Categorías.
- Tipos de falla.
- Tipos de dispositivo.
- Usuarios asignables.

Clientes carga inicialmente una página de 80 registros. Fabricantes, relaciones y modelos dejan de formar parte de la carga inicial.

### Clientes

Los selectores de Cliente en boletas y mantenimientos mantienen el mismo diseño buscable, pero ahora la búsqueda consulta el backend con una demora de 300 ms.

- Cada búsqueda anterior se cancela cuando cambia el texto.
- Los resultados se unen por identificador sin perder selecciones anteriores.
- El nombre de un cliente histórico se mantiene visible aunque no pertenezca a la primera página.
- La página inicial y cada búsqueda contienen como máximo 80 clientes.

### Fabricantes

Fabricantes y relaciones se solicitan únicamente después de seleccionar el tipo de dispositivo.

La lista visible continúa respetando `TipoDispositivoFabricantes`. Cuando un tipo no tiene relaciones históricas, se conserva el fallback anterior que permite mostrar fabricantes activos.

### Modelos

Los modelos se solicitan únicamente cuando existen tipo de dispositivo y fabricante. El backend recibe ambos identificadores y devuelve únicamente los modelos correspondientes.

### Creación rápida

Después de crear una categoría, falla, tipo, fabricante o modelo, el registro se agrega directamente al catálogo local en lugar de volver a descargar todos los catálogos.

Al crear un fabricante también se agrega inmediatamente la relación local con el tipo seleccionado, evitando que el filtro dependiente oculte el registro recién creado.

## Caché compartida

`catalogResource.js` mantiene una caché en memoria de cinco minutos, separada por:

- Sesión.
- Ruta o aliases.
- Payload y filtros.

Las claves son estables aunque cambie el orden de las propiedades del payload. La creación rápida invalida la caché para que futuras consultas puedan leer los datos actualizados.

## Compatibilidad sin conexión

La precarga operativa existente continúa descargando los catálogos maestros con hasta 1.000 registros.

Cuando una búsqueda específica no tiene una entrada exacta y el dispositivo está sin conexión:

1. Se lee el catálogo maestro precargado.
2. Se aplican localmente búsqueda, estado, cliente, sede, tipo y fabricante.
3. Se aplica la misma página solicitada.

Esto permite buscar clientes y resolver modelos o fabricantes sin conexión después de haber realizado al menos una precarga operativa conectada.

## Compatibilidad preservada

- Mismos ocho pasos de boletas y cuatro pasos de mantenimientos.
- Mismos componentes, textos y estilos.
- Mismos valores seleccionados y etiquetas históricas.
- Mismos permisos.
- Mismas rutas, aliases y payloads.
- Misma creación rápida y selección automática.
- Mismas relaciones de clientes, sedes, equipos y contactos.
- Mismos técnicos asignables.
- Mismo modo offline, autoguardado y recuperación.
- Sin cambios en backend, Google Sheets, Drive, correo o Google Chat.

## Validación requerida

```bash
npm run verify:stage0
npm run build
npm --prefix backend run check
```

## Pruebas manuales recomendadas

1. Crear una boleta y buscar clientes que no aparezcan inicialmente.
2. Editar una boleta histórica y confirmar que Cliente, Fabricante y Modelo mantengan sus nombres.
3. Cambiar rápidamente la búsqueda de cliente y comprobar que no aparezcan resultados de búsquedas anteriores.
4. Seleccionar un tipo de dispositivo y verificar los fabricantes correspondientes.
5. Seleccionar fabricante y verificar que solo aparezcan sus modelos.
6. Crear rápidamente un fabricante y confirmar que quede seleccionado y visible.
7. Crear rápidamente un modelo y confirmar que quede seleccionado.
8. Crear y editar un mantenimiento buscando clientes.
9. Repetir una búsqueda después de activar el modo sin conexión con la base operativa previamente descargada.
