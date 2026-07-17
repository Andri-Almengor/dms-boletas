# Adjuntos directos en correos de boletas

Los clientes externos no deben depender de permisos de Google Drive para consultar el reporte final.

## Comportamiento

- El PDF de cada boleta se adjunta directamente al correo.
- Todas las evidencias disponibles se adjuntan como archivos reales.
- Las visitas relacionadas incluyen un PDF por visita y las evidencias de todo el seguimiento.
- El correo no presenta enlaces privados de Drive como mecanismo principal para consultar los archivos.
- Los enlaces públicos de firma y encuesta se mantienen porque forman parte del flujo del cliente y no son archivos privados de Drive.

## Tamaño de los correos

Los adjuntos se agrupan con un límite conservador de 17 MB por mensaje antes de la codificación MIME. Cuando el seguimiento supera ese tamaño, Apps Script envía varios correos numerados, por ejemplo `Archivos 1/3`, `Archivos 2/3` y `Archivos 3/3`.

Si un único archivo supera el límite, se intenta comprimirlo en ZIP. Si aun así es demasiado grande, el envío se detiene con un error claro para evitar informar falsamente que el cliente recibió todos los archivos.

## Apps Script

El proyecto de Apps Script debe actualizarse con la versión compatible con adjuntos directos y publicarse como una nueva versión conservando la URL `/exec`.

La versión actualizada:

- Adjunta el PDF y las evidencias sin requerir acceso a Drive.
- Divide automáticamente los adjuntos en varios correos cuando sea necesario.
- Se aplica a boletas individuales, visitas relacionadas, envíos de prueba y reenvíos después de la firma.
- Mantiene los enlaces públicos de firma y encuesta.
- No cambia el envío a Google Chat.