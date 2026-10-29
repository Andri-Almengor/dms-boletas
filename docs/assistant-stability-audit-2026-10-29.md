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
