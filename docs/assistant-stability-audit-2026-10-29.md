# DMS Assistant — auditoría de estabilidad (29-10-2026)

**Rama única:** `fix/assistant-stability-integral-20261029`  
**Base inspeccionada:** `main@579588f` (PR #373 fusionado). No había PR abiertos al iniciar.  
**Alcance:** aislamiento de carril AI, clasificación conservadora del sobre del asistente, compatibilidad de presupuestos, recuperación de interfaz y pruebas de regresión. No modifica permisos ni reglas de negocio.

## Línea base y causas verificadas por inspección estática

| Hallazgo | Evidencia anterior | Intervención |
| --- | --- | --- |
| H1: bloqueo mutuo | `assistant.chat` se consideraba pesado y consumía `action-heavy`, compartido con finalizaciones | Se enruta `assistant.chat` al carril `action-ai` ya existente; límite de cola AI acotado |
| H5: replay inseguro | `src/api.js:isReadRoute` incluía `assistant.chat`; contenía `operation.decide` (COMMIT), `operation.revise`, `attachment.chunk` y preguntas | Se elimina el reintento automático, sin introducir invalidaciones de caché de lecturas por cada chat |
| H3: discrepancia de configuración | `render.yaml` declara `GEMINI_TIMEOUT_MS=65000` y `GEMINI_TOTAL_TIMEOUT_MS=210000`; el agente solo consumía `AI_GEMINI_TIMEOUT_MS` y `AI_AGENT_TOTAL_TIMEOUT_MS` | Compatibilidad con ambas familias (prioridad `AI_*`); máximo del agente conservado en 180 s; margen de navegador 240 s |
| H6: progreso ficticio | Cambiaba automáticamente entre «Buscando evidencias», «Consultando Knowledge» y otras fases que el backend no confirmaba | Estados neutrales, tiempo transcurrido y clasificación de fallos |
| H8: almacenamiento | `localStorage.setItem` sin manejo de excepciones y doble envío posible antes del render | Acceso tolerante a almacenamiento no disponible y bloqueo síncrono del envío |
| H6/H5: confirmación incierta | Al perder la respuesta de `operation.decide`, el usuario podía intentar repetir la confirmación | Consulta `operation.status` para leer estado de PostgreSQL; nunca se repite `decide` a ciegas |

## Arquitectura reutilizada

- Semáforo `action-ai` y `runWithActionConcurrency`; no nuevo router ni servicio.
- El sobre de `assistant.chat` mantiene `PREPARE → confirmación → COMMIT`, permisos backend y `AiPendingOperations` existentes.
- `requestPolicy.js`, `api.js` y `AssistantPageSecure.jsx` originales; no se crea asistente alternativo.
- `performance-observability.service.js`, métricas y logs del agente permanecen intactos. No se registran preguntas ni claves.
- PostgreSQL y Drive mantienen su función. No cambian SyncChanges, IndexedDB, correos, Google Chat, firmas o mantenimientos.

## Caracterización y pruebas

`tests/characterization/assistant-stability.test.mjs` verifica:
1. Asistente AI y finalización pesada ejecutándose al mismo tiempo sin ocupar carril de escritura.
2. Variables legacy activas y prioridad de `AI_*`.
3. Ausencia de replay automático del sobre mixto.
4. Estados de UI neutrales, reloj, almacenamiento seguro y consulta de estado ante resultado incierto.

Se actualiza la caracterización que protegía textos de progreso no verificables, ya que su expectativa anterior era precisamente el síntoma. Deben ejecutarse `npm run test:characterization`, `npm run check:backend`, `npm run build`, los trabajos PostgreSQL Stage 6 y Validate Application según CI.

## Verificación pendiente y límites

La inspección del repositorio no equivale a reproducción en Render. **No se dispone en esta sesión de logs privados de Render, un entorno PostgreSQL de pruebas ni de trazas de producción; no se inventan p50, p95, tiempos de arranque o porcentajes de mejora.** Los doce escenarios de la solicitud (cinco usuarios, recuperación de modelos, voz, dos boletas, corte de red tras COMMIT, etc.) requieren validación end-to-end antes de fusionar. El PR debe permanecer en borrador hasta completarlos.

**Riesgos no resueltos:**
- H2: la capacidad `http-all` continúa ocupada mientras se espera `action-ai`. Se debe medir saturación real antes de cambiar la adquisición de HTTP y garantías de desconexión.
- H4: `withTimeout` sobre herramientas limita la espera, no cancela una consulta ya iniciada. Requiere identificar herramientas solo lectura y sus capacidades de cancelación; no aplicar `AbortSignal` indiscriminadamente a COMMIT.
- H3: la rotación del router global Gemini y la rotación del agente pueden solaparse para fallos terminales; medir intentos efectivos antes de simplificar.
- H7: no hay mediciones para añadir índices PostgreSQL, cambiar Knowledge o tareas programadas.
- H2/H7: no se demostró mejora de cold-start en Render; plan Free puede imponer latencias que el software no elimina.

## Revisión de seguridad / compatibilidad

No se crean permisos. No se permite SQL de Gemini, no se altera el protocolo de confirmación, ni se reenvía correo/Chat. Un timeout de confirmación lleva a `operation.status`; un error de red no demuestra que el COMMIT no se ejecutara. El caché de lecturas operativas no se invalida por una pregunta AI. Los cambios se limitan al asistente, al carril AI compartido y a caracterizaciones.

## Despliegue y reversión

No requiere migración PostgreSQL, cambio de URL Apps Script, ni secreto nuevo. Verificar en Render la prioridad de variables `AI_GEMINI_TIMEOUT_MS`, `AI_AGENT_TOTAL_TIMEOUT_MS` frente a las legacy; el máximo permitido del agente sigue en 180 s. Publicar una nueva versión del servicio backend y frontend desde el commit aprobado; conservar la versión anterior de Render para rollback si la cola AI rechaza más de lo previsto. Revertir el PR completo si se observa regresión; no ajustar `HEAVY_ACTION_MAX_CONCURRENT` o `HTTP_MAX_CONCURRENT_REQUESTS` arbitrariamente.

## Objetivos de métricas al terminar (no medidos aún)

Recolectar por `X-Request-ID` y `bootId`: primera respuesta, latencia p50/p95, cola AI, cola HTTP, éxito por modelo, fallbacks, errores categorizados, RAM, impacto en autosaves y cero duplicaciones en ensayos concurrentes. Contrastar antes y después usando el mismo tipo de cargas y período.

## Continuación de implementación — etapas 1, 4, 6 y 7

### Rotación de Gemini ante modelos sin respuesta

La rotación existente `gemini-model-router.bootstrap.js` usaba una sola señal de timeout por solicitud. Si el primer modelo agotaba su plazo, la señal quedaba abortada y ningún fallback podía recuperarse. Ahora el router divide un **único presupuesto total** entre los modelos disponibles, usa un AbortController independiente por candidato y propaga la cancelación del solicitante para no repetir una consulta cancelada. La petición original de Gemini permanece sin efectos operativos: COMMIT se sigue ejecutando solamente por el flujo del backend y confirmación humana.

Se añade `__dmsGeminiTimeoutMs` como opción privada al `fetch` interno del agente, eliminada antes del transporte, y se preserva `GEMINI_PRIMARY_MODEL` como preferencia sobre `GEMINI_MODEL`. El timeout del navegador conserva margen. No se hacen reintentos sobre 400/401/403 determinísticos.

La transcripción de audio ahora calcula el tiempo restante antes de cada modelo, para que el fallback no inicie una nueva solicitud de 60 s cuando el presupuesto global de voz esté casi agotado.

### Trazabilidad y coste de Knowledge

El observador de rendimiento existente admite `cfRay` sanitizado de la cabecera `CF-Ray` (si está disponible) sin registrar preguntas, sesiones, secretos ni evidencias. El tiempo de admisión HTTP también se suma al tiempo de cola observado de `/api/action`.

`searchKnowledgeDocuments` conserva sus permisos y la consulta paginada. Solo evita la consulta batch adicional de estado de indexación cuando todos los documentos recuperados ya constan como `READY`. Los documentos en procesamiento mantienen la actualización del estado. No se crea caché compartida entre usuarios ni se cambian índices sin `EXPLAIN ANALYZE`.

### Pruebas y evidencia de CI

- `backend/test/gemini-model-router-failover.test.js`: un primer modelo atascado debe rotar al siguiente dentro del presupuesto; una cancelación del solicitante debe detener toda rotación.
- `tests/characterization/assistant-stability.test.mjs`: quinto chat recibe `SERVER_BUSY` cuando AI está saturada y un autosave puede atravesar su carril de acción de escritura; regresiones de Knowledge y correlación Cloudflare.
- Se detectó una **falla real de una prueba nueva** con solo 90 ms de presupuesto total en CI: 504 en vez de fallback 200. No correspondía al presupuesto real de producción ni a una regresión de negocio: el presupuesto de la prueba se cambió a 1.200 ms para verificar un plazo con tiempo disponible para ambos intentos. La aplicación **conserva** su presupuesto configurado; no se amplió un timeout de producción para pasar CI.
- PostgreSQL Stage 6 había pasado en varios commits intermedios. Validar el **último commit del PR** antes de fusionar, no usar checks verdes de una versión anterior.

### Límites que no se pueden declarar resueltos sin observabilidad real

1. **Cold start y Render Free:** no se cuenta con el tiempo real de despliegue, conexiones o arranque. El health check existente distingue backend activo de fallos propios de Gemini, pero una instancia dormida sigue dependiendo de la infraestructura.
2. **Capacidad `http-all`:** el límite global sigue vigente y puede saturarse con mezcla de AI, medios y cargas; la cola AI acotada reduce exposición pero no crea prioridad garantizada HTTP para autosaves. La prueba de carriles no equivale a una prueba del proxy o de cinco usuarios reales.
3. **Herramientas después del timeout:** `withTimeout` mantiene una carrera de promesas; cancelar operaciones PostgreSQL/Drive sin demostrar soporte de cancelación y distinguir consultas de PREPARE/COMMIT podría afectar escrituras. Sin ese soporte verificado, no se afirma que el trabajo subyacente se cancele.
4. **Rendimiento SQL:** no se dispone de `EXPLAIN ANALYZE` de producción, índices efectivos ni p50/p95 de las consultas. Por compatibilidad no se añaden migraciones hipotéticas.
5. **Pruebas E2E:** requieren sesión autorizada, cuenta Gemini, datos de pruebas, Render logs y cortes de conexión controlados. No ejecutarlas con datos de clientes reales ni finalizar/enviar reportes como prueba sintética.

**Puerta de salida:** mantener el PR en borrador hasta terminar CI del head y los escenarios operativos representativos. Si no es posible acceder a la infraestructura para reproducir los incidentes, registrar el bloqueo, el indicador por medir y no afirmar que desaparecieron.

## Continuación — admisión HTTP y clientes desconectados (29-10-2026)

### Hallazgo reproducible: espera AI ocupaba `http-all`

`server.js` pasa los requests API por `concurrencyMiddleware` antes de Express. Antes, una solicitud `assistant.chat` consumía inmediatamente uno de los slots de `http-all` y luego quedaba en espera de `action-ai` dentro de `/api/action`. Con dos IA activas y otras dos esperando, estas últimas no ejecutaban nada útil pero retenían hasta dos cupos HTTP de Render durante hasta `HTTP_QUEUE_TIMEOUT_MS`, retrasando autosaves y otras gestiones.

Se reutiliza `AsyncSemaphore` y `concurrencyMiddleware` existentes con un gate de **admisión HTTP AI**, `http-assistant`, adquirido **antes de `http-all`**. Máximo de gate: `max(1,min(2,AI_ACTION_MAX_CONCURRENT,HTTP_MAX_CONCURRENT_REQUESTS-2))`. El cliente Node añade la cabecera opcional `X-DMS-Workload: assistant` solamente para rutas Gemini/asistente. Es **pista de planificación, no fuente de verdad**; no interviene en permisos, autenticación, validaciones ni despacho. Las solicitudes antiguas o externas sin cabecera conservan el control autoritativo de `action-ai`. La cabecera nunca se envía al fallback de Apps Script.

Las solicitudes AI que esperan en `http-assistant` no ocupan `http-all`; el gate tiene una cola acotada y duración máxima configurada. `/api/health` sigue fuera de la cola HTTP por el flujo existente de `server.js`. No cambia el número general de cupos ni la lógica de negocio.

### Cliente desconectado durante la espera

`concurrencyMiddleware` ahora entrega al dispatcher una `AbortSignal` derivada del cierre de la conexión. `runWithActionConcurrency` la pasa únicamente a `AsyncSemaphore.acquire()` y comprueba si el request se abortó **antes de llamar al handler**. Una acción en cola cuyo cliente cerró la pestaña se retira de la cola en lugar de seguir esperando y ejecutarse minutos después. **Una vez iniciada la ejecución**, esa señal no interrumpe SQL, Drive, finalizaciones, correo, Chat ni COMMIT; el backend continúa como fuente de verdad.

Pruebas: `backend/test/assistant-http-admission.test.js` (tres requests de IA frente a tráfico foreground) y `backend/test/assistant-action-queue-abort.test.js` (cancelar uno en cola sin ejecutarlo; preservar una operación ya comenzada). Se ajustó el test de caracterización de aislamiento heavy/write porque su regex anterior exigía `acquire()` sin opciones; conserva las aserciones de aislamiento con `acquire({signal})`.

### Limitaciones y despliegue

La reserva AI es una optimización de cliente cooperativo: peticiones sin cabecera no pasan por el gate y siguen sujetas a `http-all`, `action-ai` y todas las validaciones backend. No constituye protección completa contra tráfico arbitrario; para eso serían necesarios límites por ruta identificada tras validación y/o reverse proxy. No se modifican esquemas, permisos ni variables obligatorias. Desplegar frontend y backend del mismo commit para obtener la reserva efectiva. Comprobar `concurrency.assistantRequests` en diagnósticos autorizados si procede.

El problema de ejecución subyacente de herramientas que terminan tarde tras el `Promise.race` permanece identificado; cancelar de modo indiscriminado una herramienta de preparación o una escritura sería peligroso. Requiere distinguir lecturas seguras y comandos de PREPARE y validar un camino real de cancelación por herramienta.

### Diagnóstico seguro de saturación desde una sesión administradora

Se extendió exclusivamente la respuesta existente de `GET /api/ai/health`, que ya exige autenticación y `USUARIOS_GESTIONAR` en `app.js`. Su objeto `queues` contiene dos snapshots del sistema de semáforos existente: `httpAssistant` (`http-assistant`) y `aiActions` (`action-ai`), con cupos activos, en espera y máximo. No contiene mensajes, permisos individuales, correos, sessionTokens ni datos de clientes. Se agregó una prueba de regresión del contrato. Esto permite diferenciar un cuello de botella en admisión HTTP de uno en el procesamiento de Gemini sin exponer las métricas de producción a usuarios no autorizados.

**Guía rápida de diagnóstico:** autenticar una sesión con `USUARIOS_GESTIONAR`, revisar `/api/ai/health` con su token en un entorno autorizado; observar `queues.httpAssistant.waiting`, `queues.aiActions.waiting`, el modelo activo y las métricas existentes durante una solicitud lenta. Correlacionar con `X-Request-ID`/`CF-Ray` y los logs de Render. Nunca compartir tokens o mensajes en los reportes.

## Continuación: trabajo realmente activo de herramientas y PREPARE concurrente

### Causa: `Promise.race` terminaba antes del trabajo subyacente

El agente ejecutaba hasta `AI_MAX_PARALLEL_TOOLS` herramientas simultáneas y aplicaba un timeout con `Promise.race`. Cuando éste vencía, la consulta real a PostgreSQL/Drive no se cancelaba y podía permanecer activa, pero el asistente quedaba libre para ejecutar otras herramientas o peticiones. Sucesivos errores podían acumular trabajo y presión en el pool PostgreSQL.

Se **amplió el helper existente `withTimeout`** en `agent.service.js` reutilizando `AsyncSemaphore`, con el nombre `ai-tool-work`. El número máximo de trabajos reales simultáneos está acotado por `PG_POOL_MAX`; cada espera también observa el presupuesto de timeout de su llamada. La acción se inicia solo después de obtener el cupo. El helper devuelve `AI_TOOL_TIMEOUT` cuando vence el presupuesto, pero conserva el cupo hasta que la promesa **original** termine (por éxito o fallo). Una herramienta que venció esperando cupo nunca se ejecuta tardíamente. No se descarta ningún resultado de escritura como si hubiera sido revertido.

Este mecanismo **no es cancelación real de SQL/Drive** ni pretende serlo. Se evita introducir `pg_cancel_backend`, abortos indiscriminados de clientes, o cortes de PREPARE/COMMIT sin evidencia de seguridad. El endpoint de diagnóstico `GET /api/ai/health`, ya autorizado con `USUARIOS_GESTIONAR`, añade el snapshot agregado `queues.aiTools` para mostrar los trabajos reales retenidos y en espera. No expone preguntas, correos, sesión ni secretos.

### Causa: carrera de idempotencia de PREPARE

`createOperation` consultaba primero `AiPendingOperations` buscando una misma `IdempotencyKey`, y luego insertaba una nueva propuesta. Dos solicitudes idénticas concurrentes podían ver «ninguna operación» y ambas intentar insertar, aunque el índice UNIQUE de la migración `012_ai_integral_agent.sql` ya impide dos filas con la misma clave. La perdedora recibía error PostgreSQL 23505, no una confirmación reutilizable.

La escritura ahora usa `INSERT ... ON CONFLICT ("IdempotencyKey") WHERE "__valid"=TRUE DO NOTHING RETURNING *` y, si se produce conflicto, consulta la propuesta ganadora que ya quedó persistida y devuelve su mismo `OperationID` cuando sigue vigente. No genera nuevas propuestas para el mismo PREPARE ni cambia confirmaciones, permisos, estados o negocio; el aislamiento de múltiples instancias de Render sigue basado en el índice UNIQUE de PostgreSQL, no en locks en memoria. Si la operación competidora fue cancelada o está fallida, se devuelve un error de conflicto explícito que no inventa éxito.

### Pruebas de regresión

- `backend/test/postgres-integration.mjs`: dos `prepareTicketBatchCreate` simultáneos para el mismo lote/sesión deben devolver el mismo `OperationID` real, bajo PostgreSQL migrado, y la posterior confirmación de dos boletas debe conservar su idempotencia.
- `backend/test/ai-tool-timeout-isolation.test.js`: una herramienta simulada que tarda más que el timeout sigue ocupando un slot; su terminación real libera el slot. Si toda la capacidad ya está ocupada, una solicitud que expiró esperando no debe arrancar luego.
- `backend/test/assistant-backend-health-isolation.test.js`: los contadores del endpoint de salud siguen siendo agregados y sin contenidos sensibles.

Estas pruebas no requieren datos de clientes ni ejecutan envíos reales de correo o Google Chat. El ensayo de caída de red durante COMMIT y las mediciones de latencia/PG en Render deben realizarse en un entorno controlado antes de fusionar.

## Continuación: precarga de adjuntos e imágenes antes de Gemini (29-10-2026)

### Causa identificada

El flujo `runDmsAgent` obtenía los metadatos autorizados desde `AiChatUploads` y después descargaba hasta tres imágenes de Drive **antes del primer modelo**. La descarga `driveApi.files.get({alt:'media'})` estaba dentro de un bucle secuencial sin límite de tiempo propio. Si Drive no devolvía una respuesta, se detenía el chat en precarga, sin oportunidad para que Gemini, sus fallbacks o las herramientas internas procesaran la consulta. El presupuesto total del agente se inicializaba, pero no se comprobaba activamente mientras esperaba estos recursos.

### Cambio mínimo, reutilizando el helper existente

- `loadDiagnosticImageInputs` usa `withTimeout` y `ai-tool-work` ya existentes para cada lectura de imagen (máximo configurado `AI_TOOL_TIMEOUT_MS`, limitado además por el tiempo total que resta al asistente). La función no introduce solicitudes duplicadas a Drive ni reintentos determinísticos. Un archivo que responde tarde sigue ocupando su cupo real hasta que se resuelva, pero no bloquea el avance del agente.
- Si no se logra recuperar ninguna imagen elegible, se devuelve `AI_IMAGE_UNAVAILABLE` sin intentar describir contenido que Gemini no recibió. Los adjuntos se mantienen en la UI para reintentar. Se conservan las restricciones existentes de MIME, número y tamaño de imágenes.
- `loadChatAttachments` ejecuta el **mismo SELECT autorizado** (`UserID`, `SessionHash`, IDs y estado) dentro de `withTimeout`, con límite de tiempo compartido. Si esa lectura se demora o agota la cola controlada, informa `AI_ATTACHMENTS_UNAVAILABLE`. Nunca omite el filtro de propiedad de archivos ni devuelve metadatos ajenos.
- El frontend clasifica `AI_IMAGE_UNAVAILABLE` y `AI_ATTACHMENTS_UNAVAILABLE` como **fallos conocidos de precarga**, no como confirmaciones COMMIT inciertas. Mantiene la entrada y los archivos; no repite automáticamente operaciones.
- Las operaciones de Drive aquí son lecturas; las reglas de negocio, el PREPARE/COMMIT, PostgreSQL operativo y el almacenamiento Drive no cambian.

### Pruebas automatizadas

`backend/test/ai-tool-timeout-isolation.test.js` contiene pruebas con Drive simulado que no responde, descarga posterior que sí llega, liberación del cupo al completarse realmente y diagnóstico cuando no hay imagen usable. También incluye un SELECT de adjuntos simulado que nunca responde y una prueba de que la consulta sigue obligando a verificar `UserID` y `SessionHash`. `tests/characterization/assistant-stability.test.mjs` protege los códigos frontend/servidor. CI usa PostgreSQL de pruebas sin datos ni credenciales productivas.

### Limitaciones de aceptación

- El tiempo y la memoria de descargas de imagen deben medirse con documentos de prueba y latencia real de Drive. Una descarga subyacente sin soporte nativo de cancelación puede seguir consumiendo un slot después del timeout, ahora contabilizado y acotado.
- No se han medido arranques en frío de Render, cuota real Gemini ni recuperación E2E después de desconectar una sesión durante COMMIT. No fusionar en producción solo por CI verde.
