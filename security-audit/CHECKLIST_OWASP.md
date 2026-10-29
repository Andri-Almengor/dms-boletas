# Matriz de cobertura de seguridad (OWASP ASVS 5.0, WSTG, API Top 10)

**Estado = evidencia disponible, no nivel de certificación**. Las 12 filas con **No verificado** o **Bloqueado** son brechas de cobertura que deben probarse antes de cerrar la auditoría. Base `31f585c6bd71a2e23b6df011dc47596de58471e1`.

| Control / referencia | Componente | Estado | Evidencia y acción |
|---|---|---|---|
| ASVS autenticación/credenciales; WSTG-ATHN | Login y contraseña | Riesgo potencial | PBKDF2 210000 + legado SHA; falta inventario de hashes existentes |
| ASVS sesión y cierre; WSTG-SESS | `auth.service.js` | Riesgo potencial | Sesión hash almacenada; cambio password no revoca todas (SEC-04) |
| API1:2023 BOLA; WSTG-ATHZ | Password Vault | Riesgo potencial | Puede revelar secreto por ID con permiso de lectura general (SEC-01) |
| API5:2023 BFLA | `action-router.js` | Verificado parcialmente | Backend autentica, compara permisos; cobertura de handlers no exhaustiva |
| API3:2023 propiedad de objeto | Usuarios/CRUD | **No verificado** | Necesita tests mass assignment y campos protegidos |
| ASVS validación y API8 | `request-security.js` | Verificado parcialmente | Depth/keys/constructor bloqueados; validación específica por acción no auditada |
| WSTG-INPV SQLi | PostgreSQL repositorios | **No verificado** | Auth parametrizada; faltan todas las consultas dinámicas |
| WSTG-INPV XSS/DOM | React + Knowledge | **No verificado** | CSP presente; no se auditó cada render HTML/Markdown |
| WSTG-INPV SSRF | PDF/Drive/IA | **No verificado** | Faltan destinos controlados indirectamente y fetch URL |
| ASVS CSRF/CORS; WSTG-CLNT | HTTP | Riesgo potencial | JSON con bearer; CORS wildcard pero credentials:false (SEC-10) |
| ASVS HTTP headers/TLS | `app.js` | Verificado parcialmente | Helmet, CSP, frame-ancestors, no x-powered-by; TLS Render efectivo no evaluado |
| API4:2023 consumo ilimitado | `express.json` + workers | Riesgo potencial | 50 MB parser global antes de rate limit y auth (SEC-03) |
| WSTG-SESS / XSS token theft | React AuthContext | Riesgo potencial | Bearer en localStorage, condicionado a ejecución de JS no confiable (SEC-07) |
| ASVS gestión de archivos | Drive, imágenes, video | **No verificado** | Falta verificación MIME por magic bytes, traversal, autorización y tamaño |
| ASVS integridad concurrencia | Firmas públicas | Riesgo potencial | submissionLocks en Map por instancia (SEC-09) |
| API2:2023 autenticación rota | `auth.login` | **No verificado** | Falta test enumeración, rotación, tokens robados |
| API9:2023 inventario | Rutas `/api/action` | Verificado parcialmente | Router y aliases inspeccionados, matriz no exhaustiva |
| API10:2023 consumo inseguro de APIs | Google/IA/Apps Script | **No verificado** | Falta validación integral de origen/datos externos, fallos de timeout |
| ASVS logging/auditoría | `audit.service.js` | **No verificado** | Comprobar secretos excluidos en todo recorrido; una ruta revisada audita revelación |
| ASVS secretos/infra | Render/GitHub | **Bloqueado** | Entorno productivo y credenciales/configuración actual no disponibles |
| ASVS DB privilegios y backup | PostgreSQL | **Bloqueado** | Usuario real, red, backups cifrados, RLS y restore no evaluados |
| ASVS PWA/local | IndexedDB/SyncChanges | **No verificado** | Revocación permisos offline, conflicto, limpieza al logout |
| ASVS IA: modelo/herramientas | Gemini tools | **No verificado** | Requiere red-team de prompt injection en staging, controles de herramientas |
| ASVS runtime / SCA | Node/npm | Riesgo potencial | Node 24.21.0 y advisories 24.22.1; CI audit prod alto pasó |
| WSTG-CONF GitHub / CI | main & workflows | Riesgo potencial | Sin rulesets y con deployment automático (SEC-05) |
| ASVS multi-instance availability | Rate limit | Riesgo potencial | Map no compartido (SEC-06) |
| WSTG-CRYP/TLS | Producción HTTPS | **Bloqueado** | Configuración real Render/CDN fuera de alcance |
| ASVS transacciones críticas | Finalización y correo | **No verificado** | Falta matriz de idempotencia por operación, worker, mail/Chat |
| WSTG-ERRH | Errores al cliente | Verificado parcialmente | `app.js:231-260` sanitiza 500; revisar handlers custom |
| API7:2023 SSRF | Integraciones | **No verificado** | URL allowlist/redirects/metadata no rastreados exhaustivamente |
| WSTG-BUSL | Abusos lógicos | **Bloqueado** | Requiere DB de staging y cuentas sintéticas |

**12 controles no verificados** (filas rotuladas **No verificado**) y **4 bloqueados** en esta matriz; los restantes son verificados parcialmente o riesgos potenciales, no certificados conformes. No inferir “seguro” de “no verificado”.

Para documentar resultados futuros: ID de prueba, actor ficticio, petición anonimizada, respuesta, resultado esperado, evidencia, revisión de permisos, cambio mínimo y PR, sin copiar datos reales.

## Actualización de esta rama — endurecimiento seguro (29/10/2026 UTC)

En el PR #373 se cambió únicamente el **runtime declarado**, la reproducibilidad de CI y las pruebas de caracterización: los pines Node de `.node-version`, manifests, lockfiles y `render.yaml` se alinearon a **24.22.1 LTS**, se usó `npm ci` en `Validate application`, y se incorporaron informes JSON de `npm audit` incluyendo dependencias de desarrollo, manteniendo la puerta obligatoria de dependencias de producción. Se añadieron pruebas `security-runtime-baseline.test.mjs` y se actualizó la prueba existente `low-memory-headers.test.mjs` porque el contrato intencional de runtime cambió de 24.21.0 a 24.22.1. **Nada se ha desplegado ni fusionado a `main` por esta tarea**.

El hallazgo SEC-02 cambia de **pin vulnerable sin corregir** a **corregido en la rama/pendiente de integración y validación del runtime real**. Otros hallazgos quedan como riesgos pendientes, explícitamente sin explotar ni modificar las reglas de negocio. Los controles de concurrencia de `backend/src/middleware/concurrency.middleware.js` ya reservan carril para cargas grandes, limitan simultaneidad y evalúan memoria antes del parser HTTP; por tanto SEC-03 representa riesgo **residual**, no ausencia total de protección. Las rutas SQL dinámicas revisadas validan tabla/columna mediante `tableDefinition` y `_column` y parametrizan valores; ello reduce superficie SQLi de los repositorios inspeccionados sin acreditar que toda consulta haya sido probada.

**Validación pendiente:** CI del commit final, inspección de reportes npm (incluyendo dev), configuración de Render/GitHub y pruebas con cuentas sintéticas en staging. La auditoría no puede certificarse totalmente mientras estos límites no se resuelvan; no deben afirmarse pruebas dinámicas que no se ejecutaron.
