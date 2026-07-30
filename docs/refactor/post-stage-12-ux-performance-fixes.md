# Correcciones posteriores a la Etapa 12 — imágenes, catálogos y procesamiento

## Problemas observados

1. Las fotografías de los dispositivos de mantenimiento permanecían mostrando `Cargando...`.
2. La ubicación seleccionada tardaba en aparecer al abrir el formulario de un dispositivo.
3. El fabricante tardaba en estar disponible en el formulario de boletas.
4. Las operaciones largas no bloqueaban visualmente la pantalla, por lo que el usuario podía interpretar que el botón no había funcionado.

## Evidencias de mantenimiento

`MaintenanceEvidenceImage` ahora utiliza primero el `PreviewURL` o thumbnail que ya viene en el detalle del mantenimiento.

El endpoint `maintenance.media.get`, que descarga la fotografía y la convierte a data URL, queda como respaldo únicamente cuando:

- no existe una URL inicial; o
- el navegador no puede abrir el thumbnail recibido.

Los respaldos se guardan en memoria y las solicitudes simultáneas de la misma fotografía se deduplican. De esta manera, una fotografía no se descarga varias veces al expandir dispositivos o volver a renderizar el formulario.

## Ubicaciones de dispositivos

Al editar un mantenimiento, el formulario crea inmediatamente opciones provisionales con:

- la ubicación principal guardada en el mantenimiento; y
- las ubicaciones del equipo que ya están presentes en sus dispositivos.

La relación completa del cliente continúa cargándose en segundo plano y luego reemplaza esas opciones provisionales. Esto permite que la ubicación seleccionada se muestre desde el primer render útil.

Cuando se agrega un dispositivo directamente desde una ubicación del inventario, el formulario ya no espera a descargar todas las demás ubicaciones. Abre con la ubicación seleccionada y actualiza las opciones restantes en segundo plano.

## Fabricantes en boletas

Los fabricantes y las relaciones entre tipo de dispositivo y fabricante empiezan a precargarse desde que se abre el formulario, sin formar parte del bloqueo inicial de la pantalla.

Al seleccionar el tipo de dispositivo, el filtro se realiza localmente sobre la precarga. Si la precarga falla, se conserva la consulta histórica como respaldo.

Los fabricantes creados desde el propio formulario también se incorporan al catálogo precargado para que no desaparezcan al cambiar de tipo.

## Pantalla de procesamiento

Se agregó `ProcessingOverlay`, una pantalla reutilizable y bloqueante que informa la operación activa.

Se utiliza para:

- guardar un dispositivo y subir sus evidencias;
- agregar una ubicación al mantenimiento;
- crear ubicaciones, ubicaciones del equipo y registros relacionados desde modales;
- guardar una boleta pendiente;
- finalizar una boleta;
- generar o probar documentos de una boleta;
- guardar o finalizar un mantenimiento.

La pantalla evita clics repetidos y muestra que la aplicación continúa trabajando. Incluye texto contextual, indicador animado y la recomendación de no cerrar ni recargar.

## Compatibilidad preservada

- No cambian rutas ni aliases.
- No cambian permisos.
- No cambian payloads ni respuestas del backend.
- No cambia el almacenamiento en Sheets o Drive.
- No cambia el modo offline.
- Se conserva el fallback autenticado para imágenes privadas.
- Se conservan las validaciones y la lógica de guardado/finalización existentes.

## Validación manual recomendada

1. Abrir un mantenimiento con varias evidencias y confirmar que los thumbnails aparecen sin permanecer indefinidamente en `Cargando...`.
2. Probar una imagen privada o sin thumbnail y confirmar que el fallback la carga.
3. Abrir `Agregar dispositivo` desde una ubicación del inventario y confirmar que el formulario aparece inmediatamente con esa ubicación seleccionada.
4. Abrir una boleta, avanzar al paso del dispositivo y confirmar que el fabricante aparece rápidamente después de seleccionar el tipo.
5. Guardar un dispositivo con varias fotografías y confirmar que aparece la pantalla bloqueante.
6. Agregar una ubicación y confirmar que aparece la pantalla `Agregando ubicación`.
7. Guardar una boleta pendiente y finalizar otra, comprobando los mensajes distintos.
8. Probar en móvil y escritorio, tanto en tema claro como oscuro.
