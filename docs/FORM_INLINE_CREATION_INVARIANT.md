# Regla permanente: altas rápidas dentro de formularios

Esta regla es un **invariante funcional del proyecto DMS Boletas**. No es una mejora opcional y no debe eliminarse durante refactorizaciones, rediseños, cambios de permisos, optimizaciones ni migraciones del backend.

## Boletas

Todo técnico autorizado para crear o editar una boleta debe poder crear, sin abandonar el formulario, los siguientes valores:

1. Categoría.
2. Tipo de falla.
3. Ubicación.
4. Ubicación del equipo.
5. Supervisor.
6. Tipo de dispositivo.
7. Fabricante.
8. Modelo.

La creación debe:

- abrirse desde el mismo selector mediante la acción de agregar;
- guardar el nuevo registro usando una ruta operativa autorizada para técnicos;
- actualizar inmediatamente el selector;
- seleccionar automáticamente el valor recién creado;
- conservar la relación con el cliente, ubicación, tipo de dispositivo o fabricante correspondiente;
- seguir funcionando para administradores;
- no conceder a los técnicos permisos para editar o eliminar catálogos fuera del flujo operativo.

## Mantenimientos

Todo técnico autorizado para crear o editar mantenimientos debe conservar las altas rápidas que forman parte del flujo:

1. Ubicación del cliente.
2. Ubicación del equipo.
3. Tipo de dispositivo.
4. Fabricante.
5. Modelo.

Esta regla también aplica al formulario completo, al editor de dispositivos y al alta rápida desde el detalle del mantenimiento.

## Permisos

Los permisos operativos que implican la capacidad de crear datos relacionados desde formularios son:

- `BOLETAS_CREAR`
- `BOLETAS_EDITAR`
- `MANTENIMIENTOS_CREAR`
- `MANTENIMIENTOS_EDITAR`
- `MANTENIMIENTOS_GESTIONAR`

`USUARIOS_GESTIONAR`, `CLIENTES_EDITAR`, `CLIENTES_DATOS_OPERATIVOS_CREAR` y `CATALOGOS_GESTIONAR` continúan autorizando según su alcance administrativo.

Los técnicos deben utilizar rutas `operational.*` para crear relaciones de clientes y catálogos. Las rutas administrativas pueden permanecer únicamente como respaldo para administradores o instalaciones antiguas.

## Protección contra regresiones

La prueba `tests/characterization/form-inline-creation-invariant.test.mjs` debe fallar cuando ocurra cualquiera de estas situaciones:

- se elimina uno de los botones de agregar;
- se elimina uno de los tipos admitidos;
- se quita un permiso operativo requerido;
- una creación de ubicación, ubicación del equipo o supervisor vuelve a depender solamente de rutas administrativas;
- mantenimiento pierde alguna de sus altas rápidas;
- el backend deja de exponer las rutas operativas.

No se debe modificar la prueba para permitir la eliminación de estas funciones. Un cambio deliberado de esta regla requiere una decisión explícita del propietario del proyecto y la actualización conjunta de este documento, la política central, frontend, backend y pruebas.
