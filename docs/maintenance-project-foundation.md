# Mantenimientos tipo Proyecto

La implementación evoluciona el flujo existente de Mantenimientos sin crear una aplicación, tabla de inventario ni catálogo paralelo.

## Compatibilidad histórica

- Todo registro histórico o nuevo sin tipo explícito se interpreta como `MANTENIMIENTO`.
- `MANTENIMIENTO` conserva checklist, evidencias Antes/Después, firma general, finalización y boletas automáticas.
- `PROYECTO` reutiliza cliente, ubicación, responsables, cantidades esperadas, dispositivos, permisos, PostgreSQL, sync/offline y catálogos.
- No se crean permisos nuevos.
- Los tipos, fabricantes, modelos y relaciones tipo/fabricante siguen siendo los catálogos globales del app.
- Una vez que existen dispositivos, el backend bloquea cambiar entre Mantenimiento y Proyecto para evitar reinterpretar datos existentes.

## Etapa 1 — modelo configurable

`TipoDispositivoPreguntas` puede definir:

- `AplicaModo`: `MANTENIMIENTO`, `PROYECTO` o `AMBOS`.
- `TipoRespuesta`: `SI_NO`, `TEXTO`, `NUMERO`, `CANTIDAD`, `MAC`, `OPCIONES` o `RELACION_DISPOSITIVO`.
- `TipoDispositivoRelacionadoID`: tipo existente que se ligará al dispositivo principal.
- `ConfiguracionJSON`: campos, opciones y obligatoriedad.

Las relaciones de dispositivo se validan en backend contra los catálogos existentes.

## Etapa 2 — captura operativa de dispositivos de Proyecto

El formulario permite seleccionar `MANTENIMIENTO` o `PROYECTO`.

En Proyecto:

- las preguntas configuradas para Proyecto se renderizan dinámicamente;
- una relación como Puerta → Lector puede habilitarse con Sí/No;
- las relaciones son opcionales por defecto y pueden marcarse obligatorias desde Administración;
- se puede solicitar cantidad, nombre/identificador, fabricante, modelo, serie y MAC;
- fabricante y modelo reutilizan los dropdowns dependientes actuales;
- los botones de alta inline reutilizan los mismos catálogos globales del app;
- los componentes relacionados se almacenan estructurados dentro de `RespuestasJSON` del dispositivo principal y no incrementan artificialmente las cantidades de dispositivos principales;
- un tipo relacionado puede tener sus propias preguntas escalares de Proyecto, por ejemplo un Lector con una lista `Lector / Botón`;
- el backend valida obligatoriedad, opciones, números, MAC, tipo relacionado, fabricante, modelo y relaciones tipo/fabricante;
- los catálogos necesarios se leen por lote para evitar N+1;
- borradores y sync conservan las respuestas estructuradas;
- el detalle reutiliza el inventario actual y muestra los componentes relacionados al expandir un dispositivo.

Los Proyectos no ejecutan firma general, prueba/finalización de mantenimiento ni generación de boletas automáticas. Estas acciones están ocultas en frontend y rechazadas nuevamente en backend.

## Etapa 3 pendiente — evidencias de Proyecto

La carga de evidencias está intencionalmente deshabilitada en Proyecto hasta implementar el contrato específico solicitado:

- sin Antes/Después;
- fecha y hora automáticas;
- orden de más nueva a más vieja;
- galería;
- notas editables;
- clasificación por dispositivo principal o componente relacionado;
- edición con las mismas capacidades multimedia existentes.

Esto evita guardar fotografías de Proyecto bajo la semántica histórica de evidencias de Mantenimiento.

## Etapas posteriores

Después de evidencias:

1. mejorar la navegación de detalle entre dispositivos del Proyecto;
2. exponer dispositivos, relaciones, notas y evidencias al Agente Gemini mediante tools controladas;
3. soportar consultas naturales y tablas filtradas por tipo, fabricante, modelo, serie, componentes y notas;
4. permitir recuperar imágenes por dispositivo o componente relacionado;
5. pedir aclaración cuando la referencia natural no pueda resolverse con suficiente certeza.
