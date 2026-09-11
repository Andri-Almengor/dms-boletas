# Incidente de disponibilidad global — diagnóstico y avance

Base: `main` en `145a137cf2b7247dfe7485439ed2dfa770bdb26c`.
Rama: `fix/global-backend-stability-20260911`. La rama `fix/global-backend-stability` ya existía y se conservó intacta. No fusionar ni presentar como incidente resuelto sin completar los pendientes siguientes.

## Estado y límites de la evidencia

El defecto de idempotencia semanal se reproduce localmente: veinte módulos nuevos, con persistencia compartida que modela USER_ENTERED y SERIAL_NUMBER, generan veinte copias antes del cambio y una después. La prueba no escribe a la hoja real ni certifica su locale/valor actual. Verificar BACKUP_LAST_SLOT en producción.

Los 22 arranques en 47 minutos fueron descritos en el brief; no se adjuntó un export completo de logs, eventos, memoria, exit codes o despliegues de Render. OOM, SIGKILL o health failures siguen siendo hipótesis, no causas confirmadas. No es posible garantizar desde una prueba local que Render dejó de reiniciar.

**Pendientes bloqueantes para cerrar el alcance:**

- Casos públicos utiliza `customer.case.evidence.upload` en un Apps Script externo, incluyendo propiedad del archivo y modo de prueba. Su implementación no está en `apps-script/boletas-report/Code.gs` de este repositorio. Falta el código del deployment real de `APPS_SCRIPT_REPORT_URL` para extender el transporte conservando ese contrato. Esa ruta y la sincronización legacy aún pueden transportar JSON/base64 grande; quedan serializadas y sujetas a admisión por memoria, pero no cumplen todavía la meta de transporte por bloques en todos los caminos.
- Las respuestas de medios antiguos y reportes todavía pueden construir buffers grandes. La admisión reduce la concurrencia de entrada; no constituye un límite duro sobre toda la memoria de V8, Drive o reportes. Medir RSS con carga representativa real antes de aprobar producción.
- Validación visual real de navegación/deploy/offline en navegador y soak en Render pendientes. Las pruebas de recovery incluyen funciones, hooks y contratos de código, no un navegador real.
- La reserva de backup cubre cold starts secuenciales de una instancia. Sheets no ofrece compare-and-swap para estas celdas; no es un bloqueo distribuido ante dos procesos que reservan simultáneamente. No escalar réplicas ni solapar dos schedulers automáticos sin coordinar un lock transaccional externo.

## Cadena de fallo probable

Inicio → warmup de 16 tablas + schedulers a los 2/5 segundos → slot de fecha normalizado a número → otra copia semanal → usuarios reconectando + JSON de hasta 50 MB → presión de RSS/CPU y colas → posible muerte o health timeout → nuevo inicio.

La copia de Sheets usa Drive files.copy, no descarga el libro completo a Node; no se atribuye OOM a un buffer de ese respaldo sin evidencia.

Otros problemas verificables: cargas chunked/sin Content-Length escapaban al carril grande; login compartía el carril de escrituras; el registro de actividad retenía payloads mientras reautenticaba; auditoría y actividad reintentaban inmediatamente un lote fallido; caché global retenía valores crudos y objetos SDK además de filas normalizadas.

## Cambios implementados

| Capa / archivos | Cambio y efecto |
|---|---|
| `weekly-backup.service.js` | Normaliza slot anterior ISO o serial; escribe `WEEK_SLOT:YYYY-MM-DD`; persiste BACKUP_AUTO_SLOT antes de copiar; no duplica un slot reservado incluso tras resultado ambiguo; copia manual disponible. |
| `env.js`, `render.yaml` | Default HTTP = 2 × (reads Sheets + writes Sheets), 6 con 2+1; una carga grande; cola 12; presupuesto RSS declarado de 512 MiB. |
| `concurrency.middleware.js`, `semaphore.js` | Admisión antes del parser, incluyendo longitud desconocida/cuerpo comprimido; cola cancelable; reserva conservadora de memoria 4× tamaño; no libera un trabajo de acción por desconexión prematura del cliente. |
| `action-concurrency.service.js` | Carriles acotados de autenticación y evidencias separados de escrituras y acciones pesadas. Los permisos siguen en el dispatcher original. |
| `server.js`, `runtime-diagnostics.js` | bootId, release, memoria completa, colas y event-loop delay cada 30 s; señales y fallos fatales seguros; deadline duro de shutdown; warmup solo auth y arranque de schedulers al terminar. |
| `google.js`, `sheets.repository.js` | Evita duplicar caché de lecturas A:ZZ del repositorio; no retiene objetos request del SDK en caché; límite de entradas y cola; evita copiar todas las filas antes de normalizarlas. |
| `audit.service.js`, `activity-log.service.js` | El fallo espera al próximo flush; actividad sanitiza y suelta payload/respuesta antes de esperar autenticación. |
| `large-evidence-upload.service.js`, `largeEvidenceUpload.js` | Generaliza sesiones reanudables existentes a imágenes/documentos permitidos; bloques de 256 KiB; tipo de medio correcto; validación previa al decode; token ligado al usuario; timeout de Drive. |
| Formularios de boletas, mantenimiento y conocimiento | Archivos mayores de 256 KiB usan bloques sin cambiar bytes; conocimiento verifica autor/permisos en cada bloque usando su handler original; completa visitas relacionadas y alta rápida que no usaban esa capa. |
| `customerCases.js` | Elimina optimización automática de imagen preexistente: conserva bytes originales. No cambia el endpoint externo de Casos. |
| `api.js`, `requestPolicy.js`, `requestErrors.js`, `AuthContext.jsx` | Deadline total incluye fetch, body y retries: login 20 s, me 25 s, común 45 s, evidencias 120 s, reportes/finalización 240 s. auth.me llega al servidor; fallo temporal conserva caché; 401 limpia sesión. |
| `index.html`, `App.jsx`, `main.jsx`, `AppErrorBoundary.jsx`, `reloadRecovery.js`, `sw.js` | Login eager, HTML visible antes de React; misma única recarga automática por pestaña para SW/chunks; si sessionStorage falla, recuperación manual; navegación 5xx usa fallback; assets hash cache-first y no se cachea HTML como JS. |
| `app.js` | Assets ausentes devuelven 404, no index.html; errores SDK no se imprimen completos; seguimiento de final de acción al desconectar. |

No se modificaron PermissionRoute, ProtectedRoute, action-router, auth.service, permissions.service ni las reglas de roles. AuthContext conserva effectivePermission sin cambios. Las validaciones del tipo/duración/tamaño de evidencia siguen vigentes. La nueva capa no convierte, comprime ni reduce resolución.

## Memoria y event loop

Con el default de una carga grande se elimina la multiplicación de JSON grandes simultáneos. Los cuerpos esperan sin ser parseados; longitud desconocida o Content-Encoding reservan el peor caso de 50 MiB. Antes de admitir se exige RSS + 4× tamaño < 90% del presupuesto. Es una estimación conservadora, no una garantía contra OOM ni una razón para subir el plan. Los bloques normales de 256 KiB generan aproximadamente 350 KiB base64 y un Buffer de 256 KiB; no se materializa el archivo entero en Node por esos caminos.

Health continúa antes de Express y todos los semáforos. No importa resultados de Google. Sigue dependiendo del mismo event loop y proceso: una operación síncrona suficientemente grande puede retrasarlo. Casos/legacy/reportes pendientes impiden afirmar que ese riesgo desapareció.

Importar la aplicación completa sin warmup ni red en este entorno dio RSS 155,713,536 B, heapUsed 75,381,856 B, external 4,529,033 B. No extrapolar la prueba sintética más ligera a un proceso de producción cargado.

## Respaldo y recuperación de fallos ambiguos

BACKUP_LAST_SLOT público se normaliza a YYYY-MM-DD; el valor persistido es prefijado. BACKUP_AUTO_SLOT registra la reserva automática. Un error posterior a reservar no dispara automáticamente otra copia: revisar Drive/último estado y usar «Crear respaldo ahora» si hace falta. Esto evita duplicados sacrificando el reintento ciego tras una copia de resultado incierto; no borra respaldos. Cambiar a otra semana permite otra reserva.

No eliminar manualmente BACKUP_AUTO_SLOT para forzar retries sin revisar si la copia ya existe. La reserva no tiene lease ni garantía multi-instancia.

## Validación

Se ejecutaron npm install y npm --prefix backend install sin modificar lockfiles. La suite ampliada incluye cold starts, serial de Sheets, resultado ambiguo, cancelación de colas, backpressure sin Content-Length, health real con downstream simulado, timeout, clasificación 401/5xx, AuthProvider con hooks controlados y conservación byte a byte de PNG/PDF/MP4.

Última validación local: 362/362 pruebas, check:backend, build y verify:final con salida 0 (incluyendo auditoría al umbral high). Sin cambio de lockfiles.

Comandos reproducibles:

```sh
npm install
npm --prefix backend install
npm run test:characterization
npm run check:backend
npm run build
npm run verify:final
npm run test:stress
```

Prueba sintética inicial: 28 solicitudes (20 lecturas, 3 auth.me, 3 login, 2 cargas de 2 MiB), 40 health checks, concurrencia máxima de carga 1. Health máximo 84 ms, media 4 ms, event-loop p99 26 ms, RSS máximo 105,693,184 B. Incluye parsing real y semáforos de producción; el app downstream es fixture sin Sheets/Drive/SMTP y no verifica contraseñas reales. Repeticiones varían con la máquina. La prueba valida disponibilidad del health bajo esa carga, no estabilidad productiva.

Auditoría de dependencias de producción: 2 moderadas frontend (react-router/react-router-dom 6.30.4, GHSA-wrjc-x8rr-h8h6 y GHSA-337j-9hxr-rhxg); 7 moderadas backend (qs/express/body-parser, GHSA-x5fp-wj9c-mxmx y GHSA-4mjr-xmp4-gh2g; uuid/gaxios/googleapis-common/googleapis, GHSA-w5hq-g745-h8pq). Son preexistentes en los lockfiles sin modificar. El gate actual usa --audit-level=high y puede pasar con estas moderadas. No se ejecutó audit fix --force ni salto de googleapis 144 a 178.1.1. No confundir «gate verde» con «sin vulnerabilidades».

## Render: configuración y despliegue propuesto

No se desplegó ni se cambió main. Mantener borrador hasta cerrar los pendientes.

1. Obtener logs completos/eventos Render del intervalo y el código del Apps Script de Casos. Registrar commit, restart/exit reason, RSS y health failures. No enviar claves privadas ni secretos.
2. Revisar rama/PR y ejecutar todos los comandos anteriores en CI sobre el commit exacto.
3. Validar por separado Casos y reportes con archivos originales, además de login bajo carga y permisos existentes. Confirmar un único scheduler activo.
4. Para staging, desplegar la rama en servicio separado con datos de prueba, no con el scheduler automático contra el libro productivo.
5. En el servicio final fijar MEMORY_BUDGET_MB=512, HTTP_MAX_CONCURRENT_REQUESTS=6, HTTP_MAX_CONCURRENT_LARGE_REQUESTS=1, HTTP_QUEUE_LIMIT=12. Si ya hay overrides 40/2 en el dashboard, actualizarlos; no asumir que un merge modifica overrides manuales. Revisar que lecturas/escrituras Sheets sigan 2/1. MEMORY_BUDGET_MB debe corresponder al límite real de la instancia.
6. Tras aprobación del cambio completo, merge mediante PR; autoDeployTrigger: commit queda activo. start/build/healthCheckPath permanecen iguales. APP_PUBLIC_URL, FRONTEND_ORIGIN, /api/action, firmas, encuestas y links no cambian.
7. Observar al menos una ventana mayor que la del incidente (60–90 minutos) y verificar cold starts/control de respaldo. Probar una interrupción temporal y recuperación sin pérdida de sesión/borradores. No asumir que un HTTP 200 de health valida Sheets.
8. Rollback: desplegar el commit anterior solo si es necesario; desactivar temporalmente la programación automática desde la configuración existente durante ese rollback, pues el código anterior no entiende el prefijo y vuelve a duplicar copias. No borrar las copias existentes.

Buscar en Render: `runtime_boot` (bootId/release/pid), `runtime_sample`, `runtime_memory_peak`, `warmup_auth_ready`, `warmup_auth_failed`, `runtime_shutdown`, `runtime_warning`, `runtime_uncaught_exception`, `runtime_unhandled_rejection`, `[weekly-backup] slot_reserved` y `slot_skipped`. Mismo release con muchos bootIds sigue indicando reinicios, no nuevos commits. Falta de shutdown no demuestra OOM: correlacionar con eventos Render. SIGKILL no puede capturarse desde Node.

## Separación frontend/API

No se hizo la migración. Propuesta posterior: frontend estático con proxy same-origin de /api al backend, conservando URLs públicas, APP_PUBLIC_URL, SW y enlaces. Validar proxy/CORS/cache/CSP antes de cambiar DNS. Mejora la entrega del login si muere Node, pero no corrige el incidente de API por sí sola.

## Fuentes del contrato Sheets

- https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption
