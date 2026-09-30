# Agente Gemini de DMS Boletas

## Arquitectura

```
Chat UI
  -> POST /api/action (assistant.chat)
  -> sesión/autenticación DMS
  -> backend/src/ai/agent.service.js
  -> Gemini Interactions API
  -> function calling controlado
  -> permisos del backend
  -> consultas PostgreSQL parametrizadas / Drive protegido
  -> resultado sanitizado
  -> Gemini sintetiza
  -> UI renderiza texto, entidades y attachments
```

PostgreSQL sigue siendo la única fuente operacional. Gemini no recibe `DATABASE_URL`, credenciales SQL ni permiso para generar/ejecutar SQL arbitrario.

Google Drive continúa privado. Los archivos se presentan con el mecanismo existente de URLs temporales protegidas; el modelo recibe metadata textual, no `fileId`, binarios ni URLs firmadas.

## Prioridad de fuentes

1. PostgreSQL DMS.
2. Knowledge Base DMS.
3. Casos y metadata interna permitida.
4. Evidencias/Drive autorizado.
5. Conocimiento general de Gemini.
6. Google Search, únicamente cuando `AI_WEB_SEARCH_ENABLED=true` y la consulta requiere información externa/actual.

El prompt obliga a buscar internamente antes de responder preguntas que dependan de datos DMS.

## Seguridad

- La identidad proviene de la sesión autenticada; `userId`, rol o permisos enviados por frontend no son autoridad.
- Las boletas de técnicos se filtran en SQL usando `BoletaAsignados` antes de que el resultado llegue a Gemini.
- Cases permanece limitado a administradores.
- Drafts de Knowledge respetan autor/gestor.
- No existe tool de contraseñas, password vault, tokens o secretos.
- `sanitizeAiToolResult()` elimina campos sensibles antes de enviar tool output al modelo.
- Datos recuperados se tratan como datos no confiables; instrucciones incrustadas en observaciones, artículos, evidencias o web no cambian las reglas del agente.
- La etapa actual es read-only.
- Los attachments firmados no se persisten en `localStorage`.

## Tools

- `search_internal`
- `search_clients`
- `get_client`
- `search_users`
- `get_technician_activity`
- `search_tickets`
- `get_ticket`
- `get_ticket_evidence`
- `get_ticket_history`
- `search_evidence_activity`
- `search_maintenances`
- `get_maintenance`
- `get_maintenance_devices` — en Proyecto también devuelve respuestas configurables y componentes relacionados y acepta filtros por tipo/marca/modelo/serie/MAC del componente o nota de evidencia.
- `get_maintenance_evidence`
- `search_maintenance_evidence` — en Proyecto permite filtrar evidencias por dispositivo principal o componente relacionado y devuelve únicamente attachments protegidos coincidentes.
- `search_devices` — busca tanto dispositivos principales como sus componentes configurables de Proyecto y notas de evidencias.
- `search_knowledge_base`
- `get_knowledge_article`
- `search_agenda`
- `search_network_devices` (solo administradores; campos técnicos no secretos)
- `search_cases`
- `get_case`
- `get_statistics`

Las operaciones agregadas se ejecutan en PostgreSQL mediante `COUNT`, `GROUP BY`, filtros, límites y paginación. No se descargan colecciones completas para que Gemini las cuente.

## Conversación

La UI conserva historial corto y contexto activo por usuario. El backend aplica allowlist a ese contexto y solo acepta referencias como mantenimiento, cliente, boleta, dispositivo, usuario, artículo o caso. El contexto nunca concede permisos.

El loop Gemini usa Interactions API en modo `store:false`. Los `steps` y `function_result` se mantienen únicamente durante la petición actual. La siguiente consulta recibe solo el historial corto enviado por DMS.

## Variables de entorno

- `GEMINI_API_KEY`: secreto exclusivo de backend.
- `GEMINI_MODEL`: modelo centralizado.
- `AI_CHAT_ENABLED`: habilita el agente; si es `false`, solo el chatbot queda temporalmente deshabilitado. El resto de DMS continúa funcionando.
- `AI_WEB_SEARCH_ENABLED`: habilita Google Search externo.
- `AI_GEMINI_TIMEOUT_MS`
- `AI_TOOL_TIMEOUT_MS`
- `AI_MAX_TOOL_ROUNDS`
- `AI_MAX_PARALLEL_TOOLS`
- `AI_MAX_TOOL_RESULT_ROWS`
- `AI_MAX_TOOL_RESULT_BYTES`
- `AI_MAX_HISTORY_MESSAGES`
- `AI_MAX_MESSAGE_CHARS`
- `AI_RATE_LIMIT_PER_MINUTE`

No guardar `GEMINI_API_KEY` en frontend, GitHub, IndexedDB o logs.

## Observabilidad

Cada petición registra métricas acumuladas de:

- duración total;
- duración de Gemini;
- cantidad y duración de tools;
- consultas y tiempo PostgreSQL;
- input/output tokens cuando Gemini los reporta;
- bytes de respuesta;
- errores.

`GET /api/ai/health` está disponible solo para `USUARIOS_GESTIONAR` y no forma parte del health general de DMS. Una caída de Gemini no marca `/api/health` como caído.

La auditoría `AI_CHAT` guarda modelo, tools, duración y si hubo búsqueda web. No guarda prompts completos, secretos ni URLs firmadas.

## Consultas de Proyectos

Las mismas tools de Mantenimientos se extienden para Proyecto; no existen rutas ni tools v2.

- `get_maintenance_devices` puede filtrar un Proyecto por `componentType`, `componentManufacturer`, `componentModel`, `componentSerial`, `componentMac` y texto de campos configurables.
- `search_devices` aplica esos filtros entre Proyectos cuando no se conoce aún el maintenanceId.
- `search_maintenance_evidence` usa `ProyectoComponenteLocalID` y vuelve a resolver el componente desde `RespuestasJSON` antes de entregar metadata al modelo.
- Las evidencias de Proyecto se filtran por `FechaCaptura`, dispositivo/componente y nota; no se reinterpretan como ANTES/DESPUÉS.
- Los filtros estructurados se aplican primero en PostgreSQL como reducción de candidatos y después se verifican contra la estructura JSON parseada por el mismo servicio que valida las evidencias.
- Si el número de candidatos supera el presupuesto seguro, la tool devuelve `truncated` y exige refinar la consulta en lugar de fingir exhaustividad.
- Las listas pueden sintetizarse como tablas Markdown y los archivos se entregan únicamente como attachments protegidos.
- Referencias ambiguas deben resolverse con las tools existentes o solicitar aclaración.

## Búsqueda

La migración `011_ai_search_indexes.sql` intenta habilitar `pg_trgm` y crea índices GIN para los campos de texto de mayor uso. Si la extensión no está disponible, la migración conserva la funcionalidad y omite esos índices.

La migración `018_ai_project_inventory_search.sql` agrega índices aditivos para `RespuestasJSON`, notas de evidencias, nombres de componentes, tipo de mantenimiento y componentes de evidencias de Proyecto. No agrega almacenamiento operacional paralelo.

## Añadir una tool

1. Implementar una función read-only en uno de los módulos `agent.repository.*.js`.
2. Aplicar autorización antes del query.
3. Seleccionar únicamente columnas necesarias.
4. Usar consultas parametrizadas, `LIMIT` y agregaciones.
5. Añadirla al mapa correspondiente.
6. Declarar el JSON Schema en `agent.tools.js`.
7. Añadir tests de permiso, sanitización y no-encontrado.
8. Nunca añadir credenciales o lógica destructiva sin una fase separada y controles explícitos.

## Troubleshooting

### GEMINI_NOT_CONFIGURED
Configure `GEMINI_API_KEY` en el Web Service de Render.

### AI_RATE_LIMIT
Aumentar el límite solo después de revisar costo/uso. El valor normal es 12 consultas por minuto por usuario.

### AI_TOOL_TIMEOUT
Revisar el query y sus índices antes de aumentar el timeout.

### Gemini 429/5xx
El chatbot devuelve error amigable; el resto de DMS sigue operativo.

### Búsqueda externa no funciona
Verifique `AI_WEB_SEARCH_ENABLED=true`. Las preguntas operativas DMS no usan internet como sustituto de PostgreSQL.
