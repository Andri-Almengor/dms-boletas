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

## Etapa 3 — evidencias de Proyecto

Proyecto reutiliza la tabla y los componentes actuales de evidencias, sin crear almacenamiento paralelo.

- No utiliza Antes/Después. El campo histórico `Tipo` se guarda como `Proyecto` únicamente por compatibilidad de la tabla.
- `FechaCaptura` se asigna automáticamente; si una carga queda offline conserva la hora original capturada por el cliente y el backend la valida.
- El detalle y la galería ordenan de más nueva a más vieja.
- Cada evidencia puede corresponder al dispositivo principal o a un componente relacionado.
- El backend resuelve el componente desde `RespuestasJSON`; no confía en nombre, marca o tipo enviados por frontend.
- Se conserva un snapshot del componente para mostrar la evidencia incluso después de recargar.
- La nota sigue siendo editable con el editor existente.
- Fotos y videos reutilizan la misma validación multimedia, Drive, cargas por lote y carga reanudable actual.
- Sync/offline conserva fecha, destino, relación y componente.
- Si un componente tiene evidencias, no puede eliminarse de la relación hasta reasignar o eliminar esas evidencias.
- Las acciones de Mantenimiento normal conservan Antes/Después sin cambios.

La migración `017_maintenance_project_evidence.sql` extiende `Mantenimiento imagenes` con metadatos de Proyecto e índices por dispositivo/fecha y componente/fecha.

## Etapa 4 — detalle y navegación del inventario de Proyecto

El inventario mantiene las mismas ubicaciones y dispositivos, pero Proyecto reutiliza `AdminEntityModal` como ventana de detalle en lugar de crear una pantalla o ruta paralela.

- al abrir un dispositivo de Proyecto se muestra una ventana responsive propia;
- la ventana incluye tipo, ubicación, fabricante, modelo, serie, MAC, fecha de trabajo, técnicos, estado y cantidad de evidencias;
- las preguntas configurables y los componentes relacionados se muestran con la misma estructura guardada en `RespuestasJSON`;
- la galería reutiliza `MaintenanceEvidenceImage`, incluyendo lightbox, navegación y zoom existentes;
- desde la ventana se puede agregar evidencia o editar una existente mediante los flujos ya implementados;
- las evidencias pueden filtrarse por dispositivo principal o por cualquiera de sus componentes relacionados;
- existen controles Anterior / Siguiente para recorrer todos los dispositivos en el orden natural del inventario sin cerrar el detalle;
- el botón Editar sigue reutilizando el editor de dispositivo actual y sus permisos;
- el buscador del inventario también inspecciona notas, nombres y componente relacionado de las evidencias, por lo que una nota como “mal funcionamiento” puede localizar el dispositivo correspondiente;
- Mantenimiento normal conserva la expansión histórica dentro de la tabla/tarjeta; la ventana nueva se activa únicamente para Proyecto.

No se agregaron rutas backend, tablas, permisos, servicios de datos ni almacenamiento nuevo en esta etapa.

## Etapa 5 — consultas del Agente Gemini sobre Proyecto

El Agente reutiliza las tools controladas existentes de Mantenimientos. Gemini sigue sin acceso directo a PostgreSQL, Drive o SQL arbitrario.

- `get_maintenance_devices` devuelve en Proyecto las respuestas configurables del dispositivo principal y sus componentes relacionados.
- Puede filtrar componentes por tipo, marca, modelo, serie, MAC y contenido de preguntas configurables.
- `search_devices` permite las mismas búsquedas entre Proyectos cuando todavía no se conoce el Proyecto exacto.
- Las notas de evidencias participan en las búsquedas de dispositivos sin ejecutar una consulta por dispositivo.
- `search_maintenance_evidence` puede devolver solo las evidencias de un lector, magneto u otro componente relacionado.
- Los archivos continúan saliendo como attachments protegidos; el modelo nunca recibe `DriveFileID`.
- Para Proyecto se usa `FechaCaptura`; la tool rechaza reinterpretar sus evidencias como ANTES/DESPUÉS.
- El clasificador reconoce referencias naturales como puertas, lectores o magnetos aunque el usuario no escriba la palabra “dispositivo”.
- Las respuestas de listas/filtros pueden usar tablas Markdown.
- Si existen varias referencias válidas o el resultado estructurado supera el límite seguro, Gemini debe pedir/refinar información y no seleccionar o declarar exhaustividad por intuición.
- El contexto conversacional conserva de forma sanitizada los últimos filtros de tipo/componente/marca/modelo/serie/MAC/nota para seguimientos como “esas puertas” o “las fotos de esos magnetos”.
- La migración `018_ai_project_inventory_search.sql` agrega índices de búsqueda; no crea almacenamiento paralelo.

Ejemplos soportados:

- “Dame las puertas que tengan magnetos modelo X.”
- “Muéstrame los lectores HID del Proyecto Zeus.”
- “¿Qué dispositivos tienen notas de mal funcionamiento?”
- “Dame las imágenes de los magnetos de esas puertas.”
- “Lista las puertas de emergencia de este Proyecto.”

## Etapas posteriores

1. extender acciones operativas de Gemini a la semántica específica de Proyecto solo cuando exista una solicitud explícita y contrato PREPARE/COMMIT seguro;
2. añadir nuevas consultas agregadas únicamente si aparecen necesidades que no puedan resolverse eficientemente con las tools reutilizadas.
