# Etapa 7A — Modelo puro del formulario de Boletas

## Objetivo

Preparar la división estructural de `TicketFormPage` extrayendo primero sus reglas puras y contratos de datos a un módulo independiente, sin modificar todavía el renderizado, la navegación, el autoguardado ni las solicitudes HTTP.

## Alcance

Se añade `src/features/tickets/ticketFormModel.js` con:

- Definición estable de los ocho pasos.
- Creación del estado vacío.
- Cálculo de horas, incluido el cruce de medianoche.
- Normalización de respuestas `boleta` / `ticket`.
- Mapeo del registro del backend al formulario.
- Construcción del payload histórico con aliases en mayúscula y camelCase.
- Validación por paso.

## Compatibilidad preservada

El módulo replica exactamente los contratos que siguen activos en `TicketFormPage`:

- `Titulo` y `Título`.
- `CorreoCliente` y `Correo_Cliente`.
- `Descripcion`, `Descripción`, `DescripcionEquipo` y `NombreEquipo`.
- `AsignadoA`, `Estado`, `HorasTotales` y demás campos históricos.
- Mensajes de validación actuales.
- Cálculo de horas que suma 24 horas cuando el final corresponde al día siguiente.

No cambia:

- Interfaz ni estilos.
- Rutas ni permisos.
- Recuperación y autoguardado.
- Evidencias o firma.
- Backend, Sheets, Drive, correo, Chat o PDF.
- Modo offline.

## Estrategia progresiva

Esta primera parte es aditiva y de bajo riesgo. El siguiente PR sustituirá las funciones duplicadas dentro de `TicketFormPage` por imports del modelo caracterizado. Después se podrán extraer carga de datos, guardado y secciones visuales en cambios pequeños.

## Pruebas

La caracterización verifica:

- Presencia de campos y aliases históricos.
- Equivalencia con los contratos actuales de la página.
- Ausencia de dependencias de React, navegación y red dentro del modelo puro.
