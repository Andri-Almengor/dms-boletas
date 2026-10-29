# Plan de remediación y aceptación

Fecha: 28/10/2026 · Base: `31f585c6bd71a2e23b6df011dc47596de58471e1`. **No se aplicaron cambios** al backend, frontend, BD, Drive, Apps Script, permisos ni a Render.

## Prioridad inmediata (sin cambios automáticos de negocio)
1. **SEC-01 (ALTO), control de acceso a credenciales.** Acordar formalmente quién puede leer/revelar credenciales de cada cliente. Identificar capacidades y helpers existentes (`canReadPasswordVault`, comprobaciones de entidad y asignación); reutilizar y extender las mismas verificaciones backend en dashboard, reveal y asistente. No agregar roles, permisos ni reglas nuevas sin acuerdo. Evidencia de cierre: test A/B administrador/técnico con entidades ficticias, no revelación cruzada según política.
2. **SEC-02 (ALTO), Node.js parcheado.** Validar changelog de Node v24.22.1+, fijar coherentemente `.node-version`, manifests y Render en rama propia, revisar Google APIs, PostgreSQL, auto deploy; confirmar versión runtime real tras publicación. Cierre: stage0, validate, Postgres CI y smoke en staging.

## Prioridad alta
3. **SEC-03:** endurecer parsing pre-auth y distribución por tipo de solicitud; preservar archivos grandes y compatibilidad de video. Pruebas request body bounded/memoria por rutas, sin pruebas de saturación en producción.
4. **SEC-04:** integrar revocación de otras sesiones al cambio de contraseña usando repositorio y transacción compartidos, no réplica del loop existente; proteger sync/offline/logout contra sorpresa. Cierre: token viejo inválido y actual conforme especificación.
5. **SEC-05:** configurar manualmente GitHub Ruleset `main` con PR obligatorio, revisión, checks y no force push; verificar Render gatillos y permisos de despliegue. No cambiar workflows sin evaluar sus usos operacionales.

## Mediano plazo
6. **SEC-06:** inventariar instancias reales y límites per-IP/per-identidad; si hay >1 instancia, reemplazar solo estado del limitador por almacenamiento compartido atómico, sin perder actionEnvelope ni política existente.
7. **SEC-07:** auditoría XSS/DOM/Markdown y exposición de token; estudiar cambio de gestión de sesión solo si es compatible con modo offline, CSRF, firma pública y sincronización; ninguna migración de auth automática.
8. **SEC-08:** revisión y autorización de workflows migratorios con secretos. Requerir aprobación de ambiente para operaciones con DB real; mantener flujos necesarios y evitar cambios en lógica de migración.
9. **SEC-09:** analizar camino completo `applyPublicSignature`, transacciones e índices existentes. Si Map es único lock, extender mecanismo compartido PostgreSQL/idempotencia sin duplicar correos, PDF ni firmas; proteger pruebas de dos instancias.
10. **SEC-10:** acordar orígenes reales, configurar CORS limitado y probar web/móvil/firmas en staging.

## Plan de pruebas de seguridad antes de cerrar riesgos
| Área | Test que debe fallar antes (si falla el control) | Resultado esperado luego |
|---|---|---|
| Bóveda | Técnico lectura cruzada A/B (según política aprobada) | Denegado y auditado |
| Sesiones | Sesión 2 usa token luego del cambio | `401` |
| Node | Version pin anterior presente | Runtime y CI muestran versión parcheada |
| Parsing | Body malicioso/oversize aceptado por parser global | Rechazo temprano, evidencia válida aún funciona |
| Multiinstancia | >límite distribuido entre dos workers | Límite consistente, no falsos bloqueos |
| Firma | Dos firmas idénticas simultáneas | Un único resultado/entrega |
| Workflow | Push directo main con permisos normales | Bloqueado |
| CORS | Lectura desde origen no autorizado | No autorizada según política |

## Compatibilidad DMS que debe firmarse en cada PR
- **Frontend:** controles responsive y permisos visuales conservados.
- **Backend:** autorización revalidada, sin caminos paralelos, helpers centrales.
- **PostgreSQL:** transacciones, `SELECT FOR UPDATE`, UNIQUE, idempotencia donde corresponda; sin usar Google Sheets como DB.
- **Sync/offline:** `SyncChanges`, cursor/generation, snapshots, IndexedDB, cache remoto, tokens revocados.
- **Integraciones:** firma, PDFs, Drive, correo de boletas, Chat independiente, Apps Script `APPS_SCRIPT_VERSION` solo si se modifica script.
- **Auditoría:** registro sanitizado de acciones, sin contraseña/token/log secreto.
- **Deployment:** pruebas de caracterización y regresión, GitHub CI, Render manual cuando se apruebe. Ningún cambio directo a `main`.

## Criterios de salida
- Política y alcance aprobados (especialmente Password Vault).
- Hallazgos de severidad alta con casos verificables cerrados o excepción de riesgo documentada por propietario.
- DAST acotado contra staging y SCA completo con reporte actual.
- Resultados de CI vinculados al commit exacto.
- Revisión de disponibilidad/permisos de Render y secretos; respaldos y restauración comprobados por personal autorizado.

No deben introducirse retries para ocultar fallos determinísticos ni alterarse tests solo para aprobar CI.

## Actualización de esta rama — endurecimiento seguro (29/10/2026 UTC)

En el PR #373 se cambió únicamente el **runtime declarado**, la reproducibilidad de CI y las pruebas de caracterización: los pines Node de `.node-version`, manifests, lockfiles y `render.yaml` se alinearon a **24.22.1 LTS**, se usó `npm ci` en `Validate application`, y se incorporaron informes JSON de `npm audit` incluyendo dependencias de desarrollo, manteniendo la puerta obligatoria de dependencias de producción. Se añadieron pruebas `security-runtime-baseline.test.mjs` y se actualizó la prueba existente `low-memory-headers.test.mjs` porque el contrato intencional de runtime cambió de 24.21.0 a 24.22.1. **Nada se ha desplegado ni fusionado a `main` por esta tarea**.

El hallazgo SEC-02 cambia de **pin vulnerable sin corregir** a **corregido en la rama/pendiente de integración y validación del runtime real**. Otros hallazgos quedan como riesgos pendientes, explícitamente sin explotar ni modificar las reglas de negocio. Los controles de concurrencia de `backend/src/middleware/concurrency.middleware.js` ya reservan carril para cargas grandes, limitan simultaneidad y evalúan memoria antes del parser HTTP; por tanto SEC-03 representa riesgo **residual**, no ausencia total de protección. Las rutas SQL dinámicas revisadas validan tabla/columna mediante `tableDefinition` y `_column` y parametrizan valores; ello reduce superficie SQLi de los repositorios inspeccionados sin acreditar que toda consulta haya sido probada.

**Validación pendiente:** CI del commit final, inspección de reportes npm (incluyendo dev), configuración de Render/GitHub y pruebas con cuentas sintéticas en staging. La auditoría no puede certificarse totalmente mientras estos límites no se resuelvan; no deben afirmarse pruebas dinámicas que no se ejecutaron.
