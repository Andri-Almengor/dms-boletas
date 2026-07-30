# Etapa 7A — Dominio del formulario de boletas

## Objetivo

Reducir responsabilidades de `TicketFormPage.jsx` sin cambiar la interfaz, los ocho pasos, las validaciones, los payloads, el autoguardado, la recuperación ni las integraciones existentes.

## Extracciones

### `src/features/tickets/ticketFormDomain.js`

Centraliza funciones puras y comprobables:

- Definición de los ocho pasos.
- Estado vacío histórico.
- Claves de identificadores de catálogos.
- Cálculo de horas, incluido cruce de medianoche.
- Normalización de boletas históricas.
- Construcción del payload dual para frontend y backend.
- Validaciones por paso y validación completa.
- Construcción de opciones dependientes.
- Filtrado de fabricantes y modelos.
- Normalización de técnicos.
- Resolución de registros por identificador.

### `src/components/forms/FormField.jsx`

Reemplaza el campo local del formulario y conserva:

- `field-group`.
- `field-label`.
- `form-control`.
- `ticket-textarea` para campos multilínea.
- Texto de ayuda.
- Todos los atributos nativos recibidos.

## Compatibilidad conservada

- Ocho pasos y mismo porcentaje de progreso.
- Mismos campos, textos, botones y estilos.
- Mismos permisos.
- Mismos nombres de payload en español y formato interno.
- Mismo estado `PENDIENTE` al guardar.
- Mismo cálculo automático de horas.
- Misma recuperación mediante `useTicketDraft`.
- Mismo autoguardado del servidor a 1.800 ms durante edición.
- Misma creación rápida de catálogos y relaciones.
- Misma firma, evidencias, PDF, prueba y finalización.
- Mismas rutas, aliases, Sheets, Drive, correo y Google Chat.

## Ajuste neutral adicional

La conversión de evidencias reutiliza `fileToBase64`, creada en la Etapa 1, en lugar de mantener un segundo `FileReader` local.

## Pruebas

Se caracterizan:

- Horas normales y cruces de medianoche.
- Columnas históricas y asignaciones.
- Payload dual y conversión numérica de horas.
- Mensajes de validación de los pasos.
- Fabricantes, modelos, supervisores y técnicos.
- Uso del dominio, `FormField` y `fileToBase64` desde la página.

## Siguiente bloque

La Etapa 7B podrá separar carga de catálogos, relaciones dependientes, creación rápida, persistencia y carga de archivos en hooks y servicios específicos. Esta etapa no cambia todavía esas operaciones para mantener el riesgo bajo y facilitar la reversión.
