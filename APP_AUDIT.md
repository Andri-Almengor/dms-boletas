# Auditoría funcional de DMS Boletas

Fecha: 2026-07-14

## Módulos revisados

- Autenticación, sesiones, contraseñas y permisos.
- Inicio, navegación y rutas protegidas.
- Boletas: listas, filtros, formulario, asignaciones, firma, evidencias, PDF, correo y Chat.
- Mantenimientos: formularios, dispositivos, autoguardado, evidencias y reportes.
- Clientes y catálogos.
- Usuarios y roles.
- Base de conocimientos, borradores, editor y adjuntos.
- Integración con Google Sheets, Drive, Docs y Apps Script.

## Correcciones principales

- La plantilla acepta `<<[Recomendaciones]>>` y la variante antigua con espacio.
- Los filtros de boletas se aplican realmente en el backend.
- Los técnicos siguen limitados a boletas con asignación activa.
- Las actualizaciones parciales de clientes y catálogos ya no borran campos no enviados.
- Se separaron permisos de crear y editar clientes.
- Los catálogos inactivos pueden mostrarse y reactivarse por usuarios autorizados.
- Los borradores de conocimiento solo son visibles para su autor o administradores.
- Solo el autor o un administrador puede editar tutoriales y adjuntos.
- Las imágenes dejan de quedar indefinidamente en estado de carga.
- El visor de imágenes admite Escape, zoom y bloqueo de desplazamiento.
- Los errores operativos seguros del backend se muestran en la interfaz.
- La validación de contraseñas coincide con la regla indicada al usuario.

## Matriz manual recomendada

### Administrador

1. Abrir todos los módulos del menú.
2. Crear, editar, desactivar y reactivar clientes y catálogos.
3. Crear una boleta con firma y evidencias.
4. Ejecutar la prueba de reporte y confirmar correo, Chat, plantilla y PDF.
5. Finalizar una boleta y confirmar los destinatarios reales.
6. Crear, editar, publicar y eliminar un tutorial con adjuntos.
7. Crear un mantenimiento, autoguardar dispositivos y generar reportes.

### Técnico

1. Confirmar que solo vea boletas asignadas.
2. Intentar abrir una boleta ajena mediante URL directa y verificar rechazo.
3. Crear o editar una boleta y agregar datos operativos permitidos.
4. Confirmar que el selector de técnicos muestre usuarios activos.
5. Confirmar que solo pueda editar tutoriales propios.
6. Confirmar que no aparezcan acciones administrativas sin permiso.

### Navegadores

- Chrome y Edge de escritorio.
- Chrome Android.
- Safari iPhone/iPad.
- Aplicación instalada como PWA.
- Conexión lenta y recarga durante autoguardado.

## Comandos

```powershell
npm run build
npm run check:backend
```

La revisión de código reduce fallos reproducibles, pero la validación final debe ejecutarse con las cuentas reales de Google y en los dispositivos usados por el equipo.
