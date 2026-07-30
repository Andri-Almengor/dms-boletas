# Etapa 7B — Servicios del formulario de boletas

## Objetivo

Reducir las responsabilidades operativas de `TicketFormPage.jsx` sin modificar la interfaz, los ocho pasos, permisos, payloads, recuperación, modo offline ni integraciones existentes.

## Responsabilidades extraídas

### `useTicketFormResources`

Centraliza:

- Carga inicial de los ocho catálogos históricos.
- Lectura de la boleta durante edición.
- Cantidad de evidencias existentes.
- Configuración de correos CC predeterminados.
- Relaciones de clientes, sedes, ubicaciones del equipo y contactos.
- Cancelación de solicitudes al cambiar de cliente, abandonar la pantalla o sustituir una carga.

Las relaciones reutilizan `fetchClientRelations`, creado en la Etapa 4. El formulario recibe todas las relaciones activas del cliente en una sola acción y filtra en memoria las ubicaciones del equipo correspondientes a la sede seleccionada.

### `useTicketQuickCreate`

Centraliza el estado y ciclo del modal de creación rápida:

- Sede.
- Ubicación del equipo.
- Supervisor.
- Categoría.
- Tipo de falla.
- Tipo de dispositivo.
- Fabricante y su relación con el tipo de dispositivo.
- Modelo.

`ticketQuickCreateService` conserva los payloads y rutas existentes. Después de crear un registro, el hook actualiza la relación local o recarga los catálogos y selecciona automáticamente el nuevo valor.

### `useTicketPersistence`

Centraliza:

- Autoguardado del servidor durante edición con demora de 1.800 ms.
- Validación completa antes de persistir.
- Requisito de firma para prueba y finalización de boletas nuevas.
- Creación y actualización de la boleta base.
- Carga secuencial de firma y evidencias.
- Guardar pendiente, generar PDF, ejecutar prueba y finalizar.
- Limpieza del borrador y navegación al detalle.

`ticketPersistenceService` mantiene la codificación compartida `fileToBase64` y las rutas históricas.

## Compatibilidad preservada

- Ocho pasos, textos, botones y estilos.
- Selección de técnicos.
- Cálculo de horas y cruce de medianoche.
- Claves y formato de borradores.
- Indicador de autoguardado.
- Creación rápida y selección automática.
- Firma y evidencias.
- Guardar pendiente, PDF, prueba y finalización.
- Rutas, aliases, permisos y payloads.
- Modo offline y caché existentes.
- Backend, Sheets, Drive, correo y Google Chat sin cambios.

## Mejoras internas

- Las respuestas antiguas no pueden sobrescribir relaciones de otro cliente.
- Las cargas iniciales y relacionadas son cancelables mediante `AbortController`.
- Se reutiliza la consulta agregada de relaciones, evitando solicitudes separadas por sede.
- `TicketFormPage` queda enfocado en estado visual, navegación de pasos y renderizado.

## Validación requerida

```bash
npm run verify:stage0
npm run build
npm --prefix backend run check
```

Pruebas manuales recomendadas:

1. Crear una boleta y recorrer los ocho pasos.
2. Cambiar rápidamente entre clientes y sedes.
3. Crear una sede, ubicación de equipo, supervisor y cada catálogo rápido.
4. Recuperar un borrador local.
5. Editar una boleta y confirmar el autoguardado del servidor.
6. Guardar pendiente, generar PDF, ejecutar prueba y finalizar.
