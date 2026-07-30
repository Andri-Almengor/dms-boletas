# Etapa 10 — Memoria y reintentos de evidencias

## Objetivo

Reducir el consumo transitorio de memoria durante cargas grandes de fotografías y archivos, evitar conversiones Base64 repetidas y reforzar los reintentos sin modificar la interfaz, los límites, las rutas, los payloads compatibles, el modo offline ni las integraciones existentes.

## Hallazgos

### Mantenimientos

`maintenanceImageBatch` dividía correctamente las fotografías en lotes de hasta 10 archivos y 10 MB sin codificar. Sin embargo, cada lote se convertía mediante `Promise.all`, por lo que podían existir hasta diez `FileReader` y sus cadenas Base64 al mismo tiempo.

Cuando el endpoint por lote no estaba disponible, el sistema ya había convertido el lote completo y posteriormente el fallback individual volvía a leer cada archivo. Esto duplicaba trabajo, memoria transitoria y tiempo de CPU.

Las caídas de red en la ruta por lote tampoco llegaban al fallback basado en `requestAvailable`, que es el encargado de la cola offline.

### Boletas

Las evidencias se enviaban secuencialmente, pero el payload no incluía el `localId` como `EvidenciaID`, aunque el backend ya admite identificadores generados por el cliente. Una repetición posterior a un guardado parcial podía crear archivos duplicados.

### Vistas previas

La eliminación de archivos y fotografías repetía directamente `URL.revokeObjectURL` y el evento `dms-draft-file-removed` en distintos componentes y servicios.

## Cambios realizados

### Codificación secuencial y cancelable

`fileToBase64` conserva su API histórica y ahora acepta opcionalmente `AbortSignal`. Al terminar, fallar o cancelarse:

- Retira los listeners del `FileReader`.
- Propaga un `AbortError` reconocible.
- Evita resoluciones o rechazos dobles.

`mapFilesSequentially` garantiza una única conversión activa por vez.

### Carga de mantenimientos

- Se mantienen exactamente 10 archivos por solicitud.
- Se mantiene exactamente el límite de 10 MB sin codificar por solicitud.
- Se mantienen 80 actualizaciones de metadatos por lote.
- Cada lote se codifica de forma secuencial.
- El fallback reutiliza las cadenas Base64 ya preparadas.
- Después de cada solicitud se vacían las referencias Base64 del payload temporal.
- La disponibilidad de las rutas por lote se recuerda durante la sesión para evitar aliases fallidos repetidos.
- Una caída de red activa el fallback individual para el resto de la ejecución.
- El fallback individual continúa utilizando `requestAvailable`, por lo que conserva la cola offline.
- Los fallos parciales continúan dejando únicamente los elementos pendientes para reintento.

### Evidencias de boletas

Cada evidencia envía su identificador local como:

- `evidenciaId`.
- `EvidenciaID`.

El backend ya devuelve la evidencia existente cuando recibe nuevamente el mismo ID para la misma boleta. De esta forma, repetir una acción después de un fallo parcial no vuelve a crear la evidencia que ya llegó al servidor.

La lectura continúa siendo secuencial y la variable Base64 temporal se vacía después de cada solicitud. Los archivos y vistas previas permanecen disponibles mientras exista un error y solo se liberan después de que la acción completa termine correctamente.

### Ciclo de archivos locales

`localFileLifecycle` centraliza:

- Creación opcional de vistas previas `blob:`.
- Liberación idempotente de `blob:`.
- Notificación idempotente al almacén de borradores.
- Liberación individual o por colección.

Se utiliza en la eliminación explícita de evidencias, la persistencia de fotografías de mantenimiento, el descarte de cambios y la finalización exitosa de boletas.

## Compatibilidad preservada

- Misma interfaz, textos y estilos.
- Mismos ocho pasos de boletas y cuatro pasos de mantenimientos.
- Mismos límites de archivos y peso.
- Mismos tipos Antes/Después y notas.
- Mismos endpoints por lote y aliases.
- Mismo fallback individual.
- Mismos payloads existentes, agregando únicamente los aliases de ID que el backend ya reconoce.
- Mismos mensajes de guardado parcial.
- Mismo modo offline y cola de sincronización.
- Sin cambios en Sheets, Drive, correo, Google Chat o generación de reportes.

## Validación requerida

```bash
npm run verify:stage0
npm run build
npm --prefix backend run check
```

## Pruebas manuales recomendadas

1. Agregar más de diez fotografías a un dispositivo.
2. Guardar un lote cercano a 10 MB.
3. Interrumpir la red durante una carga y reintentar.
4. Forzar un fallo parcial y confirmar que solo permanezcan las evidencias fallidas.
5. Agregar varias evidencias a una boleta y repetir el guardado después de un fallo.
6. Eliminar una evidencia pendiente y comprobar que desaparezca del borrador.
7. Guardar o finalizar correctamente y revisar que no queden vistas previas locales activas.
