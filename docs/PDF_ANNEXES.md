# Anexos de los PDF de boletas

## Problema corregido

Algunas versiones de la plantilla terminan con un salto de página después de la tabla de firmas. El generador agregaba además otro salto antes de `ANEXOS`, por lo que el PDF podía incluir una página completamente en blanco.

También se agregaba siempre la sección:

- ANEXOS
- Evidencias fotográficas
- Sin evidencias asociadas

incluso cuando la boleta no tenía fotografías ni documentos.

## Nuevo comportamiento

- Antes de agregar anexos se eliminan únicamente los saltos de página y párrafos vacíos que hayan quedado al final de la plantilla.
- Cuando existen evidencias, se agrega exactamente un salto de página y luego la sección de anexos.
- Cuando no existen evidencias, no se agrega el título `ANEXOS`, ni `Evidencias fotográficas`, ni el mensaje `Sin evidencias asociadas`.
- Una firma solo se agrega como anexo cuando existe y no pudo insertarse en el marcador de firma de la plantilla.
- El cambio se aplica a boletas individuales y a cada PDF de las visitas relacionadas.

## Despliegue

Reemplace el contenido de `Code.gs` por la versión completa actualizada y publique una nueva versión de la implementación de Apps Script conservando la misma URL `/exec`.

El parche técnico también está disponible en `apps-script/patches/pdf-annex-blank-page.patch`.
