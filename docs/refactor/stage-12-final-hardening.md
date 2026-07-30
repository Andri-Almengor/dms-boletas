# Etapa 12 — Seguridad, CSS y validación final

## Objetivo

Cerrar el refactor con controles de seguridad HTTP, auditoría automática de dependencias, análisis medible de CSS y una comparación cuantitativa contra la Etapa 0, sin modificar la interfaz, permisos, rutas, payloads, formas de respuesta, modo offline ni integraciones.

## Seguridad HTTP

### Validación del sobre de acciones

Antes de llegar al router, cada llamada a `/api/action` valida:

- Que el cuerpo sea un objeto JSON.
- Que `route` o `action` utilice únicamente el formato histórico permitido.
- Que `payload` sea un objeto.
- Que el token no supere el límite configurado.
- Que el payload no exceda la profundidad o cantidad de claves permitidas.
- Que no contenga claves de contaminación de prototipos como `__proto__`, `prototype` o `constructor`.

Las solicitudes `text/plain` continúan siendo compatibles y se convierten a JSON antes de aplicar el mismo contrato.

### Límites por ruta e IP

Se aplican ventanas independientes para:

- Inicio de sesión.
- Escrituras públicas de encuestas y firmas.
- Lecturas públicas.
- Acciones autenticadas generales.

Los buckets se comparten por familia de política e IP. Variar un alias o inventar nombres de ruta no crea límites independientes.

Los valores predeterminados son deliberadamente amplios para no afectar el trabajo normal de varios técnicos detrás de una misma dirección pública. Todos pueden ajustarse mediante variables de entorno.

Las respuestas incluyen `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` y, cuando corresponde, `Retry-After`.

### Trazabilidad

Cada solicitud recibe un `X-Request-ID`. Un identificador válido proporcionado por el cliente se conserva; valores manipulados se reemplazan por un UUID. El identificador se utiliza en registros internos, pero no cambia los cuerpos JSON históricos.

### Cabeceras

Helmet ahora aplica una política CSP activa que:

- Solo permite scripts del mismo origen.
- Permite estilos propios y Google Fonts.
- Permite imágenes, medios y conexiones HTTPS necesarias para Drive, Apps Script y recursos existentes.
- Bloquea objetos incrustados.
- Impide que la aplicación se muestre dentro de marcos externos.
- Restringe `base-uri` y `form-action` al mismo origen.

También se mantienen `X-Content-Type-Options`, política de referencia y restricciones de capacidades no utilizadas.

### Errores

JSON inválido y solicitudes superiores a 25 MB reciben códigos controlados sin exponer mensajes internos del parser. Los errores inesperados conservan el mensaje genérico histórico.

### Health check

En producción, la ruta exacta `/api/health` muestra únicamente estado, servicio y hora. Las métricas internas de memoria, concurrencia, Sheets y auditoría quedan ocultas por defecto. Se pueden habilitar explícitamente con `HEALTH_DETAILS_PUBLIC=true`.

## Variables nuevas

- `SECURITY_LOGIN_RATE_LIMIT_MAX`
- `SECURITY_LOGIN_RATE_LIMIT_WINDOW_MS`
- `SECURITY_PUBLIC_WRITE_RATE_LIMIT_MAX`
- `SECURITY_PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS`
- `SECURITY_PUBLIC_READ_RATE_LIMIT_MAX`
- `SECURITY_PUBLIC_READ_RATE_LIMIT_WINDOW_MS`
- `SECURITY_ACTION_RATE_LIMIT_MAX`
- `SECURITY_ACTION_RATE_LIMIT_WINDOW_MS`
- `SECURITY_RATE_LIMIT_MAX_BUCKETS`
- `SECURITY_MAX_SESSION_TOKEN_LENGTH`
- `SECURITY_PAYLOAD_MAX_DEPTH`
- `SECURITY_PAYLOAD_MAX_KEYS`
- `HEALTH_DETAILS_PUBLIC`

No es obligatorio definirlas; todas tienen valores conservadores.

## Auditoría de dependencias

`npm run audit:security` revisa vulnerabilidades altas o críticas en dependencias de producción tanto del frontend como del backend.

Cambios aplicados:

- `nodemailer`: actualizado a `9.0.3`, eliminando la vulnerabilidad alta detectada por npm.
- `react-router-dom`: actualizado dentro de la línea compatible de React Router 6, de `6.28.x` a `6.30.4`.
- Los `package-lock.json` fueron regenerados por npm y validados mediante `npm ci`.

Permanecen avisos moderados que npm solo propone resolver con cambios mayores:

- React Router 7 para los avisos restantes del frontend.
- Google APIs 173 para la cadena `googleapis-common`/`uuid` del backend.

No se forzaron esas migraciones porque exceden el alcance de una corrección final segura y requieren una etapa funcional propia. La CI bloquea vulnerabilidades altas o críticas.

## Validación y CSS

`npm run report:final` utiliza el baseline generado después del build y:

- Compara archivos, líneas y bytes con la referencia de la Etapa 0.
- Compara tamaños normales y gzip de JavaScript y CSS.
- Verifica que todos los imports CSS existan.
- Detecta imports duplicados y ciclos.
- Identifica reglas CSS exactamente duplicadas respetando el contexto de `@media`, `@supports`, `@layer` y `@container`.
- Produce `.artifacts/final-validation.json`.

### Resultado cuantitativo previo a la validación definitiva

| Métrica | Etapa 0 | Etapa 12 | Cambio |
|---|---:|---:|---:|
| Archivos frontend | 208 | 236 | +28 |
| Líneas frontend | 36 867 | 38 375 | +1 508 |
| Archivos backend | 81 | 86 | +5 |
| Líneas backend | 18 456 | 19 020 | +564 |
| JavaScript gzip | 265 544 B | 273 933 B | +8 389 B |
| CSS gzip | 59 597 B | 59 597 B | 0 B |

El aumento de archivos y líneas corresponde principalmente a hooks, servicios, utilidades, pruebas y controles de seguridad separados. El CSS de producción no aumentó.

### Revisión CSS

El análisis registró:

- 70 archivos CSS inspeccionados.
- 3 028 reglas.
- 0 imports faltantes.
- 0 imports duplicados.
- 0 ciclos de importación.
- 17 grupos de reglas exactamente repetidas.

Los grupos repetidos se concentran en el botón flotante del asistente y en el estado de recuperación. Se conservaron porque están distribuidos entre estilos globales y estilos de módulos cargados posteriormente. En varios breakpoints, la repetición restaura deliberadamente valores como `bottom`, tamaño del icono o visibilidad después de una regla base posterior. Eliminarla sin pruebas visuales en todas las rutas podría introducir una regresión de cascada aun cuando el texto de la regla sea idéntico.

Por esta razón, la limpieza final no elimina CSS automáticamente. El reporte convierte esas repeticiones en deuda localizada y medible para una futura etapa visual con capturas comparativas.

## Compatibilidad preservada

- Mismos cuerpos de respuestas exitosas y de error.
- Mismas rutas y aliases.
- Mismos permisos.
- Mismos payloads.
- Mismos límites de carga de evidencias.
- Mismo soporte para JSON y `text/plain`.
- Mismo modo offline.
- Sin cambios en Sheets, Drive, correo, Google Chat o reportes.

## Validación automática

```bash
npm run verify:stage0
npm run audit:security
npm run report:final
```

## Pruebas manuales recomendadas

1. Iniciar sesión correctamente y con contraseña incorrecta.
2. Abrir la aplicación desde su URL normal y revisar fuentes, iconos e imágenes.
3. Crear o editar una boleta y un mantenimiento.
4. Cargar evidencias y generar enlaces de firma pública.
5. Enviar una encuesta pública.
6. Confirmar que `/api/health` responde en producción sin métricas internas.
7. Confirmar que una respuesta 429 incluye `Retry-After`.
8. Revisar el botón flotante del asistente en móvil, escritorio, formularios y con el indicador de recuperación visible.
