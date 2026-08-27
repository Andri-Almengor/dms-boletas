# Ajuste móvil del editor de Agenda

Este cambio corrige el comportamiento del formulario de creación/edición de Agenda en iPhone y teléfonos angostos sin modificar la lógica de negocio.

## Cambios principales

- El modal usa una estructura de tres filas: encabezado, cuerpo desplazable y acciones.
- Sólo el cuerpo del formulario hace scroll, evitando problemas de Safari con `position: sticky` y el teclado.
- Se usa `100dvh`/`96dvh` y `safe-area-inset-top`/`safe-area-inset-bottom` para notch, Dynamic Island y barra inferior de iOS.
- Inputs de fecha/hora mantienen 16 px para evitar zoom automático de Safari.
- Fecha ocupa todo el ancho; horas se muestran en dos columnas cuando hay espacio y pasan a una columna en teléfonos muy estrechos.
- Selector de personas pasa de dos columnas a una en iPhone angosto.
- Búsqueda y `Seleccionar todos` se apilan cuando el ancho no es suficiente.
- Footer de acciones permanece visible como fila independiente y respeta el área segura inferior.
- En pantallas de hasta 374 px los botones se apilan y la acción principal aparece primero.
- Se mantiene la misma lógica de creación múltiple, edición, asignaciones, correo y Google Chat.

## Validación

`tests/characterization/agenda-editor-mobile-ui.test.mjs` protege los contratos de viewport dinámico, safe area, scroll, inputs iOS y acciones responsivas.
