# Eliminación de reportes de actividad y lecturas livianas de encabezados

Base revisada: `main` en `65c86e21a1eb135d38a85cd6788f3eecbfb3e008` (PR #299). Se revisaron los commits recientes de memoria, serialización de Sheets, liberación de buffers, finalización y disponibilidad antes de editar. La caracterización previa dio **381/381**, además de las aserciones de nivel de módulo. Solo se retira la prueba exclusiva de reportes de actividad; las 381 pruebas existentes con nombre permanecen.

## Causa raíz y Antes vs después

**ANTES:** primera actividad → cola → schema → getHeaders → readTable → `ActividadApp!A:ZZ`. Un chequeo de columnas descargaba un histórico creciente. La instrumentación transversal también procesaba resultados de acciones y volvía a autenticar para registrar actividad.

**DESPUÉS:** funcionalidad de actividad eliminada. No hay bridge, tracking de páginas/pestañas/permanencia, reportes, exportaciones, rutas, módulo, servicio, cola, métricas exclusivas ni registro de esa tabla. La hoja histórica no se borra ni modifica. `activity_summary` del asistente es un resumen operativo de clientes, no telemetría de usuarios; se conserva. `progress_activity` es el nombre del icono de carga, también se conserva.

**ANTES:** getHeaders → readTable → tabla completa.

**DESPUÉS:** getHeaders → `Sheet!1:1` → headerCache durante cinco minutos. Force vuelve a consultar únicamente fila 1, sin que otra caché devuelva encabezados viejos. La invalidación de encabezados no elimina filas cacheadas y la de tabla no elimina encabezados.

**Auditoría:** cold start → una lectura `Auditoria!1:1` → append. Los siguientes appends reutilizan encabezados. Se conserva audit(), su cola, orden, reintentos y manejo de errores. No se descarga su histórico para escribir.

**Schema:** metadata mínima → encabezados → comparación → solo si faltan columnas, ampliar grilla cuando corresponde y escribir las celdas nuevas de fila 1. El resultado actualiza headerCache sin releer registros. Un schema sin cambios ya no expulsa la tabla de caché. Se conservan posiciones de columnas vacías para no desplazar datos.

## Optimización interna

- Lecturas completas: `A:<última columna real>`. Primero se resuelven encabezados pequeños; cada tabla se recibe y normaliza antes de solicitar la siguiente. Las llamadas de datos usan los gates y la serialización existentes.
- Parsing con un solo recorrido: elimina slice/map/filter/map y objetos envoltorio por cada fila. Se extraen únicamente arrays de valores, no se conserva el response HTTP del SDK entre tablas ni se mutan respuestas compartidas.
- tableCache y staleTableCache ya compartían el mismo objeto de datos en main; se conserva. Ambas siguen limitadas a 16 MiB estimados con presupuesto de 512 MiB. Si una escritura no puede actualizar una entrada vigente, invalida también su stale para no devolver una versión anterior a esa escritura.
- Las cachés global y por ruta no retienen tablas crudas del repositorio ni encabezados con caché propia. Para otras lecturas conservan solo data, no requests, sockets ni headers del SDK. Siguen acotadas.
- El TTL de encabezados no se renueva al leer una tabla: así una columna agregada externamente puede detectarse al expirar los cinco minutos. Hay regresión para este caso.
- Se mantienen límites HTTP, uploads, lectura de Sheets, memory guard, recuperación acotada ya existente, health real y distinción ocupado/caído. No se incrementan RAM, heap, concurrencia, batches, reintentos ni trabajo de finalización por paso.
- Warmup de server.js permanece limitado a Sesiones, Usuarios, Roles, Permisos, RolPermisos y UsuarioPermisos. Sin precargas de catálogos, evidencia, imágenes o agenda.

## Llamadas Sheets: ahorro y costo explícitos

| Operación | Antes | Después |
|---|---|---|
| Primer flush de actividad, schema ya existente y cache frío | Metadata + fila 1 + tabla completa + append, al menos 4 llamadas en el flujo normal sin retries | 0: las cuatro desaparecen |
| Flush posterior de actividad | Al menos 1 append; podía volver a leer el histórico al caducar headers | 0 |
| Reporte de actividad | Lectura de actividad y varias tablas relacionadas | 0; cantidad anterior dependía de caches y filtros |
| Primera auditoría | 1 lectura completa + 1 append | 1 lectura de fila 1 + 1 append: mismo número, volumen radicalmente menor |
| Schema existente y sin cambios, cache frío | Metadata + fila 1 + lectura completa | Metadata + fila 1: una lectura completa eliminada |
| Listado real, headers fríos | Lectura de datos con rango A:ZZ | Lectura pequeña adicional de fila 1 y rango de datos acotado |

No se afirma un porcentaje global de ahorro sin tráfico real. Serializar la recepción/parsing por tabla puede aumentar el número de batchGet de varias tablas pequeñas frente al batching anterior. Es una decisión explícita de menor pico de memoria. No hay lecturas anticipadas para disimular esta latencia. Los encabezados se reutilizan cinco minutos y las filas mantienen sus caches existentes.

## Clasificación de tablas y paginación restante

Google Sheets no aporta filtros SQL para estas listas. pageSize limita la salida, **no** garantiza que Google solo entregue esa cantidad de filas. Se conserva la semántica existente de permisos, filtros, orden, conteos y asociaciones; no se introduce un motor de consultas nuevo.

| Tabla | Necesidad real / riesgo restante | Cambio de bajo riesgo aplicado |
|---|---|---|
| Boletas | Listados, conteos del inicio, búsqueda por ID y visibilidad por asignación aún dependen de filas completas | Rango según headers, parsing único y caché existente |
| EvidenciasBoleta | Detalle, asociaciones e idempotencia; puede crecer mucho | Schema y append sin datos; lectura acotada cuando la lógica la necesita |
| Mantenimiento | Listados y detalle; sort/filter/slice en memoria | Rango acotado y no invalidar su caché por schema sin cambios |
| Evidencia_Mantenimientos | Conteos por mantenimiento y datos de dispositivos | Mismas optimizaciones; no modificar conteos ni paginación funcional |
| Mantenimiento imagenes | Relaciones de fotos/dispositivos; no se descargan archivos por obtener headers | Schema/append livianos, rango acotado en consultas reales |
| Auditoria | Append-only en Node tras retirar los reportes | Cero full scans en el flujo de audit; histórico no participa |
| MaintenanceFinalizationJobs | Selección, estado y reanudación de jobs | Schema liviano y caché no expulsada innecesariamente |
| MaintenanceFinalizationItems | Pasos persistidos y reanudación; lecturas completas siguen siendo posibles | Igual; no cambiar worker, cantidades por paso ni persistencia |
| CasoEvidencias | Detalle/recuperación e idempotencia | Headers/append sin full scan; consultas reales acotadas |
| EncuestaRespuestas | Asociaciones y métricas globales | Sin lectura de datos para validar columnas; rangos reales |
| KnowledgeArticles | Listas, búsquedas y metadatos | Lecturas reales acotadas, sin cambiar resultados |
| KnowledgeArticleContent | Ensamblaje de partes de contenido | Schema/append baratos; consulta completa sigue siendo un riesgo con mucho texto |

findById conserva la búsqueda en tabla cacheada; no se introduce un índice parcial que pudiera alterar selección o consistencia. La finalización conserva su implementación, force/coalescence, PDF, Drive, Apps Script, control administrativo, evidencias y reanudación. La mejora es transversal: sus schema checks ya no descargan datasets ni invalidan cachés de filas si nada cambió.

### Usos de A:ZZ

No queda un rango fijo `A:ZZ` de descarga en código activo. La única mención literal de backend es un comentario histórico en el bootstrap de finalización; otra permanece en la documentación histórica de estabilidad. Tests/documentación lo mencionan para describir y rechazar el defecto. Los guards aceptan `A:<columna>` para mantener las protecciones. Si una hoja realmente tiene 702 encabezados, el rango calculado puede legítimamente terminar en ZZ: no es un fallback arbitrario.

## Runtime reproducible

Node **24.21.0 LTS**, versión exacta en engines de frontend/backend, lockfiles, `.node-version` y NODE_VERSION de render.yaml. Ambos workflows usan `.node-version`. Render instala con npm ci. No se cambian dependencias ni sus versiones.

Fuentes oficiales: [Node LTS](https://nodejs.org/en/download/current), [selección de runtime en Render](https://render.com/docs/node-version). Render prioriza NODE_VERSION del servicio: cualquier override manual debe coincidir con la versión del repo al desplegar. No se ha modificado ni desplegado el servicio real de Render.

## Validación y límites de la evidencia

- npm ci; npm ci --prefix backend.
- Caracterización completa anterior: 381/381. Después: 387/387, con seis regresiones adicionales; las aserciones de reportes retiradas eran exclusivamente de esa función.
- Frontend build; node --check de todos los JS de backend fuera de node_modules.
- verify:stage0 (incluye baseline); audit:security; report:final; stress existente.
- La auditoría existente de producción pasa con umbral high. Persisten avisos moderate de dependencias y avisos de desarrollo; no se ocultan ni se cambian umbrales.
- Regresión ejecutable de endpoints retirados, actividad ausente de source, auditoría real, schema sin datos, nueva hoja, columnas intermedias vacías, invalidaciones independientes y TTL ante columnas externas.
- Pruebas SHA-256 contra main para rutas de autorización, roles/permisos, restricciones de técnicos, handlers de negocio, firmas, streaming y reanudación, y todos los archivos de Apps Script. **No se cambiaron roles, permisos, niveles de acceso ni reglas de asignación de técnicos.**
- Pruebas existentes conservadas sobre archivos originales, videos/streaming, firmas, finalización y permisos. No se ejecutó una entrega real por SMTP/Google Chat, un PDF real ni subida de archivos a Drive; esos servicios no están configurados en esta prueba.

La prueba `node scripts/low-memory-smoke.mjs` ejecuta Express, autenticación y handlers reales, con Google reemplazado por datos sintéticos. Simula dos históricos virtuales de cinco millones de filas: cualquier acceso a ActividadApp o lectura completa de Auditoria falla antes de asignar memoria. No infla la RAM construyendo un histórico que justamente no debería descargarse. Utiliza 10.000 boletas y 10.000 mantenimientos, 17 acciones HTTP (login, me, tres consultas del inicio, tres ciclos de listas de boletas/mantenimientos/agenda/clientes), más auditoría y schema. Los endpoints retirados se comprueban por HTTP.

La regresión rápida usa 1.000 filas por tabla. Validate application ejecuta además el escenario de 10.000 y conserva el JSON en sus artifacts.

### Medición local registrada (MiB)

| Métrica | Inicio del proceso | Backend preparado con fixture | Máximo observado |
|---|---:|---:|---:|
| rss | 56.61 | 188.82 | 267.67 |
| heapUsed | 7.56 | 84.00 | 120.40 |
| external | 3.74 | 5.67 | 5.67 |
| arrayBuffers | 0.14 | 1.78 | 1.78 |

Event loop máximo observado: 205.39 ms. Lecturas mock: 56; escrituras mock: 18 (incluyen las regresiones de schema). Accesos a actividad: **0**. Primera auditoría: **2 llamadas**, exactamente headers + append.

RSS máximo incluye el high-water mark del sistema; heap/external/arrayBuffers son muestras cada 5 ms y en puntos explícitos, no una garantía de capturar todos los picos entre muestras. No se midió el mismo escenario en main, por lo que estas cifras no se presentan como un benchmark comparativo antes/después.

**Riesgos restantes:** los mocks no reproducen Gaxios, TLS, gzip, buffers de respuestas Google, latencias/cuotas, tamaño real de celdas, el cgroup de Render ni PDF/Drive/video. El proceso de prueba incluye el dataset fixture en memoria. Las listas grandes pueden superar la caché y volver a descargarse. Una tabla legítimamente enorme sigue siendo un riesgo; esta corrección elimina las descargas injustificadas de actividad/headers, no promete RAM constante para cualquier volumen. La estabilidad por debajo de 512 MiB en producción requiere observar el despliegue bajo carga real; no se afirma como garantizada con estos mocks.
