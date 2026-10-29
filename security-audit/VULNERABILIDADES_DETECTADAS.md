# Hallazgos y condiciones de seguridad — 28/10/2026

**Base:** `31f585c6bd71a2e23b6df011dc47596de58471e1`. Los identificadores **SEC-01...SEC-10** describen hechos de código y riesgos. **No se confirmó explotación activa**. “Vulnerable” se reserva para una brecha de política demostrada; aquí no se adjudica sin pruebas o una definición de acceso del propietario. Severidad = prioridad contextual, no CVSS medido. No hay cambios de permisos realizados.

## SEC-01 — ALTO · Posible acceso transversal a contraseñas de clientes
- **Estado:** Riesgo potencial de autorización horizontal (confirmada ausencia de alcance por cliente en ruta revisada).
- **Componente:** `backend/src/modules/password-vault.module.js:18-25,69-78,211-259,419-437,439-479`.
- **Ruta:** `POST /api/action`, `passwordVault.dashboard.get`, `passwordVault.credentials.reveal`, acceso desde asistente.
- **Evidencia:** `READ_PERMISSIONS` incluye `BOLETAS_VER` y `MANTENIMIENTOS_VER`; `revealCredential` recibe un `credentialId`, valida `assertCanRead(ctx)`, lee `CredencialesClientes` y retorna la contraseña desencriptada. No valida asignación del usuario al cliente o credencial. `dashboard` devuelve credenciales de todos los clientes si no filtran.
- **Condición:** persona autenticada con cualquiera de los permisos de lectura existentes, ID válido; impacto: revelación de credenciales ajenas al ámbito de trabajo si la política organizacional exige aislamiento.
- **Causa:** autorización por capacidad funcional sin alcance de entidad; es importante confirmar si todos esos roles *están autorizados por negocio* a ver todas las credenciales.
- **Corrección mínima propuesta:** definir con dueño funcional visibilidad prevista; si debe ser acotada, reutilizar políticas existentes y aplicar una única verificación en backend en dashboard, reveal y herramientas del asistente; denegar el acceso sin asignación, sin alterar roles existentes ni añadir permisos. Registrar auditoría sin secretos.
- **Regresión:** dos técnicos, clientes A/B, credenciales ficticias; lectura cruzada denegada según política aprobada, administrador permitido, uso Gemini no expone secreto al modelo. El control de revelación debe bloquearse aun invocando API directamente.
- **Cierre:** política firmada, cobertura de endpoints y prueba de no acceso entre clientes.
## SEC-02 — ALTO · Runtime Node.js fijado antes del parche de octubre
- **Estado:** Riesgo potencial de vulnerabilidad conocida por desfase de versión; alcance de CVE en ejecución no confirmado.
- **Archivos:** `.node-version:1`, `package.json:6`, `backend/package.json:7`, `render.yaml:10-13`.
- **Evidencia:** 24.21.0 configurado en main; en esta rama pasa a 24.22.1. El equipo Node publicó **24.22.1 LTS el 21/10/2026** con correcciones HIGH para TLS/DNS/Brotli, entre otras.
- **Condición:** si Render usa el pin y funciones afectadas son alcanzables. No hay evidencia de exploit dentro de DMS.
- **Corrección:** en PR autorizado, actualizar todos los pines **coherentemente** a una versión LTS parcheada, validar API Google, pg, build, workers y CI; comprobar runtime real por canales internos sin divulgar valores sensibles.
- **Regresión/cierre:** matriz de compatibilidad y CI de Node actualizado, smoke en staging, confirmación de versión efectiva en Render.
- **Fuente:** https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
## SEC-03 — MEDIO · Parsing de hasta 50 MB antes de autorización y limitación por ruta
- **Estado:** Riesgo potencial de agotamiento de recursos; no se hizo DoS.
- **Archivo:** `backend/src/app.js:97-105,145-160`; `render.yaml` presupuesto 512 MB.
- **Evidencia:** `express.json({limit:'50mb'})` y `express.text(...limit:'50mb')` son globales, antes del middleware de rate limit aplicado al `/api/action`.
- **Condición:** cliente remoto sin autenticar que envía repetidamente cuerpos grandes; hay límites externos/concurrencia ya existentes pero no comprobados con tráfico real.
- **Corrección:** aplicar límites por clase de acción y protección temprana reutilizando middleware existente, preservando el tamaño de video/evidencias y operaciones grandes autorizadas. No reducir límites de negocio indiscriminadamente.
- **Regresión:** staging con peticiones sintéticas pequeñas/sobre límite, métricas de memoria estables, subida de evidencia real compatible.
## SEC-04 — MEDIO · Cambiar contraseña no revoca las sesiones previas
- **Estado:** Limitación de seguridad confirmada en código (no sesión comprometida).
- **Archivo:** `backend/src/services/auth.service.js:42-49`, referencia reutilizable `backend/src/modules/users.module.js:23-36,94-95`.
- **Evidencia:** `changePassword` actualiza hash y no revoca `Sesiones`, a diferencia de reset administrativo.
- **Condición:** el token anterior continúa vigente mientras no caduque o se revoca explícitamente; riesgo si había una sesión robada.
- **Corrección:** reutilizar rutina de revocación central con transacción, preservar sesión actual solo si se acuerda, definir compatibilidad/offline.
- **Regresión:** dos sesiones ficticias, cambio de contraseña, token antiguo debe rechazar `auth.me`; comprobar procedimiento de recuperación.
## SEC-05 — MEDIO · `main` sin protección/requisitos obligatorios de revisión
- **Estado:** Configuración observada.
- **Evidencia:** GitHub `GET /branches/main` devuelve `protected:false`, `GET /rulesets` devuelve `[]`; `render.yaml` indica `autoDeployTrigger: commit`.
- **Condición:** cuenta con capacidad de push/compromiso de token puede alterar `main` y activar despliegue sin PR.
- **Corrección:** regla de protección/Ruleset con revisión y required checks, prohibición force-push, configuración acorde con CI y mantenedores; paso manual de administración GitHub.
- **Regresión:** intento de push directo desde cuenta de prueba debe bloquearse; PR con checks verificables.
## SEC-06 — MEDIO · Rate limit en memoria por proceso y por IP
- **Estado:** Riesgo potencial en despliegues con múltiples instancias o proxy atípico.
- **Archivo:** `backend/src/middleware/security.middleware.js:11,67-90`; `backend/src/core/request-security.js:88-151`; `backend/src/app.js:69`.
- **Evidencia:** `Map` local por instancia; en login se consume bucket según IP y familia, sin almacenamiento distribuido.
- **Condición:** escalado horizontal o tráfico detrás de proxies; los límites no constituyen una cuota global garantizada.
- **Corrección:** solo si la arquitectura efectiva lo necesita, reutilizar la política de rate limit y persistir contadores atómicos en medio compartido; validar `trust proxy` de Render.
- **Regresión:** pruebas de dos instancias y recuperación de 429, sin falsos bloqueos.
## SEC-07 — MEDIO · Sesión Bearer accesible a JavaScript persistida en localStorage
- **Estado:** Riesgo condicionado a XSS/malware/extensión; no hay XSS demostrado.
- **Archivo:** `src/context/AuthContext.jsx:7-28,46-51`; `src/api.js:216-230`.
- **Evidencia:** `dms_session` incluye `sessionToken` y se guarda en `localStorage`.
- **Condición:** script ejecutado con privilegios del origen puede leer el token.
- **Corrección:** endurecer y probar CSP/XSS primero; evaluar diseño de sesión/revocación con compatibilidad offline antes de cambiar a cookies HttpOnly (CSRF y flujos de firma incluidos).
- **Regresión:** DOM/XSS, logout, expiración, offline/IndexedDB y multi-pestaña.
## SEC-08 — MEDIO · Workflows heredados con acceso a credencial PostgreSQL de Render
- **Estado:** Riesgo potencial de abuso de pipeline, sin exposición de secret observada.
- **Archivos:** `.github/workflows/render-postgres-stage3.yml:1-35`, `render-postgres-cutover-key.yml`, `render-postgres-cutover-dry-run.yml`.
- **Evidencia:** `workflow_dispatch` y `secrets.RENDER_DATABASE_URL` en jobs que consultan o migran DB Render; scripts de importación siguen versionados.
- **Condición:** permisos GitHub mal configurados o disparos no aprobados; impacto sobre DB operacional si el job tiene credenciales.
- **Corrección:** revisar necesidad operativa y permisos por entorno, aprobaciones de deployment, separar secretos y permisos mínimos; no borrar flujos históricos sin aprobación.
- **Regresión:** revisión de accesibilidad y simulación sin credenciales reales.
## SEC-09 — MEDIO · Locks de firmas exclusivamente en memoria en rutas inspeccionadas
- **Estado:** Riesgo potencial; no está demostrado que se produzcan duplicados porque existen otros controles de estado/transacciones no auditados exhaustivamente.
- **Archivos:** `backend/src/services/ticket-signature-request.service.js:30`, `backend/src/services/maintenance-signature-request.service.js:34`.
- **Evidencia:** `submissionLocks = new Map()`.
- **Condición:** dos instancias o reinicios simultáneos procesando la misma firma pública.
- **Corrección:** verificar antes locks existentes PostgreSQL, unicidad y estado; cuando sea necesario usar `withTransaction`, `SELECT FOR UPDATE`, restricciones UNIQUE e idempotencia, sin alterar la política de firmas/PDF/correos.
- **Regresión:** duplicado concurrente desde dos conexiones ficticias, una sola firma/correo.
## SEC-10 — BAJO · CORS amplio declarado en Render
- **Estado:** Hardening pendiente, **no** bypass de autenticación por sí mismo.
- **Archivos:** `render.yaml` clave `FRONTEND_ORIGIN: "*"`, `backend/src/app.js:97-102`.
- **Evidencia:** refleja orígenes al admitir `*` en configuración; `credentials:false` y autenticación por token mitigan la exposición convencional de cookies.
- **Condición:** futuros cambios de autenticación o endpoints que permitan credenciales pueden hacer más peligrosa la amplitud.
- **Corrección:** documentar orígenes autorizados y acotar desde configuración, con verificación de app web, público y móviles; no cambiar sin validación.
- **Regresión:** solicitudes cross-origin autorizadas funcionan; orígenes ajenos no leen respuestas si no hay requisito.

## Priorización y criterio
| Conteo | Hallazgos |
|---|---|
| Crítico: 0 | — |
| Alto: 2 | SEC-01, SEC-02 |
| Medio: 7 | SEC-03 a SEC-09 |
| Bajo: 1 | SEC-10 |

Los hallazgos tienen **severidad contextual**, **no puntuación CVSS asignada arbitrariamente**; ocho son hipótesis de riesgo/explotabilidad que requieren autorización y pruebas, y SEC-04/05 son limitaciones directas constatadas en código/configuración. **La cantidad de vulnerabilidades efectivamente explotadas o demostradas mediante ataque controlado es cero**; esto no significa que no existan.

## Actualización de esta rama — endurecimiento seguro (29/10/2026 UTC)

En el PR #373 se cambió únicamente el **runtime declarado**, la reproducibilidad de CI y las pruebas de caracterización: los pines Node de `.node-version`, manifests, lockfiles y `render.yaml` se alinearon a **24.22.1 LTS**, se usó `npm ci` en `Validate application`, y se incorporaron informes JSON de `npm audit` incluyendo dependencias de desarrollo, manteniendo la puerta obligatoria de dependencias de producción. Se añadieron pruebas `security-runtime-baseline.test.mjs` y se actualizó la prueba existente `low-memory-headers.test.mjs` porque el contrato intencional de runtime cambió de 24.21.0 a 24.22.1. **Nada se ha desplegado ni fusionado a `main` por esta tarea**.

El hallazgo SEC-02 cambia de **pin vulnerable sin corregir** a **corregido en la rama/pendiente de integración y validación del runtime real**. Otros hallazgos quedan como riesgos pendientes, explícitamente sin explotar ni modificar las reglas de negocio. Los controles de concurrencia de `backend/src/middleware/concurrency.middleware.js` ya reservan carril para cargas grandes, limitan simultaneidad y evalúan memoria antes del parser HTTP; por tanto SEC-03 representa riesgo **residual**, no ausencia total de protección. Las rutas SQL dinámicas revisadas validan tabla/columna mediante `tableDefinition` y `_column` y parametrizan valores; ello reduce superficie SQLi de los repositorios inspeccionados sin acreditar que toda consulta haya sido probada.

**Validación pendiente:** CI del commit final, inspección de reportes npm (incluyendo dev), configuración de Render/GitHub y pruebas con cuentas sintéticas en staging. La auditoría no puede certificarse totalmente mientras estos límites no se resuelvan; no deben afirmarse pruebas dinámicas que no se ejecutaron.
