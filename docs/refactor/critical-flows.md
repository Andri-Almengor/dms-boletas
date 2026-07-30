# Flujos críticos protegidos durante el refactor

Cada etapa debe conservar estos flujos. Cuando un módulo se modifique, el PR debe indicar cuáles fueron probados y con qué resultado.

## Autenticación y sesión

- Inicio de sesión con usuario o correo.
- Rechazo de credenciales incorrectas.
- Bloqueo temporal por intentos fallidos.
- Recuperación de la sesión después de recargar la PWA.
- Continuidad con datos locales durante una caída de red.
- Cierre de sesión y revocación del token.
- Cambio obligatorio y cambio voluntario de contraseña.

## Boletas

- Listar pendientes y finalizadas según permisos y asignación.
- Buscar y filtrar sin perder paginación.
- Crear una boleta completa.
- Recuperar un formulario interrumpido.
- Editar y autoguardar sin duplicar la boleta.
- Edición rápida de información general, cliente y dispositivo.
- Crear ubicaciones, ubicaciones de equipo, supervisores y catálogos desde el formulario operativo.
- Mantener relaciones tipo de dispositivo → fabricante → modelo.
- Subir, editar y eliminar evidencias.
- Firmar con dedo, mouse o lápiz.
- Guardar pendiente.
- Generar prueba, PDF y finalización.
- Enviar correo y Google Chat exactamente una vez por ciclo de finalización.
- Regresar una boleta a pendiente y permitir una nueva finalización intencional.
- Crear una visita relacionada.

## Mantenimientos

- Listar pendientes y finalizados con paginación y filtros.
- Crear mantenimiento y cantidades esperadas.
- Crear ubicaciones y ubicaciones de equipo desde el flujo.
- Agregar, editar y eliminar dispositivos.
- Mantener el estado manual `PENDIENTE` como bloqueo de checklist.
- Asignar pendiente automático a dispositivos con checklist incompleto.
- Cambiar a estado efectivo cuando la checklist está completa.
- Conservar preguntas históricas aunque cambie el catálogo.
- Subir fotografías en lotes sin duplicarlas al reintentar.
- Editar tipo y nota de evidencias existentes.
- Recuperar el dispositivo en edición después de una interrupción.
- Guardar parcialmente y reintentar elementos fallidos con los mismos IDs.
- Generar Excel, presentación y boletas automáticas.
- Registrar y validar la firma general.
- Finalizar solamente con los permisos actuales.

## Clientes y catálogos

- Listar, buscar, paginar y ver registros relacionados.
- Crear y editar clientes únicamente con permisos administrativos.
- Mantener oculto el webhook para usuarios sin autorización.
- Crear altas operativas desde boletas y mantenimientos sin abrir administración completa.
- Propagar cambios de nombre de ubicación del equipo.
- Evitar duplicados de modelos por tipo y fabricante.
- Crear automáticamente la relación tipo–fabricante cuando corresponda.
- Conservar bajas lógicas e históricos.

## Recuperación y modo offline

- La recuperación de formularios permanece activa aunque el modo offline esté desactivado.
- El modo offline viene desactivado por defecto.
- Una cola offline existente no se pierde durante la migración.
- No se permite finalizar mientras existan cambios pendientes de sincronización.
- Las operaciones reintentadas conservan IDs idempotentes.
- Los archivos eliminados del formulario no reaparecen al recuperar el borrador.
- Los borradores vencidos se limpian sin afectar formularios recientes.

## Rendimiento y dispositivos de bajos recursos

- La pantalla inicial muestra contenido prioritario sin esperar módulos secundarios.
- Los filtros no descargan catálogos hasta que se abren.
- Los listados no cargan todos los registros de una sola vez.
- Las imágenes se procesan con memoria limitada y se liberan después de cada lote.
- No se agregan listeners globales duplicados.
- No se crean intervalos o timers que permanezcan activos al cambiar de pantalla.
- El tamaño inicial JavaScript/CSS no aumenta sin justificación documentada.
- El número de solicitudes iniciales no aumenta sin justificación documentada.

## Evidencia mínima por Pull Request

- Pruebas automáticas ejecutadas.
- Build exitoso.
- Comparación del baseline.
- Prueba manual en escritorio y móvil.
- Prueba en modo claro y oscuro cuando cambia interfaz.
- Prueba de permisos con técnico y administrador cuando cambia una ruta.
- Prueba de recuperación cuando cambia un formulario.
- Prueba de reintento cuando cambia una escritura o subida de archivo.
