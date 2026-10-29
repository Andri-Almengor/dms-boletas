# Auditoría integral de ciberseguridad — DMS Boletas

**Fecha de corte:** 2026-10-28 (America/Costa_Rica)  
**Repositorio:** https://github.com/Andri-Almengor/dms-boletas  
**Base:** `31f585c6bd71a2e23b6df011dc47596de58471e1` (`main`)  
**Modalidad:** revisión estática de código y metadatos de GitHub, confirmación de CI existente y cotejo documental de avisos públicos. **No se ejecutaron exploits, escaneos activos ni pruebas de producción.**  
**Naturaleza:** informe de auditoría inicial técnicamente trazable; no certificación completa de seguridad ni comprobación de las 16 fases en ejecución dinámica.

## 1. Resumen verificable
Se observaron **10 hallazgos/áreas de riesgo priorizadas**: **0 críticos, 2 altos, 7 medios y 1 bajo**. Son riesgos contextualizados a partir de evidencia estática; **no hay una explotación confirmada** en producción. Ocho requieren confirmación de alcance/explotabilidad o política operacional; los otros dos representan una desviación concreta de configuración/defensa en profundidad. La valoración no debe confundirse con un conteo de vulnerabilidades explotables confirmadas.

Los mayores asuntos son el acceso a contraseñas de clientes bajo permisos de lectura generales y la versión Node.js fijada antes de los avisos del 21/10/2026. Los procedimientos de autorización y cambio funcional no se modificaron.

## 2. Inventario del commit
| Elemento | Evidencia | Estado |
|---|---|---|
| Archivos versionados | árbol Git completo: 927 archivos | Observado |
| Frontend | React 18.3.1, React DOM 18.3.1, React Router 6.30.4, Vite 6.4.3 según `package-lock.json` | Observado |
| Backend | Node.js + Express 4.22.2, Helmet 8.3.0, CORS 2.8.6, pg 8.23.0, nodemailer 10.0.13, googleapis 144.0.0 según `backend/package-lock.json` | Observado |
| Runtime declarado | `.node-version`, `package.json`, `backend/package.json`, `render.yaml`: Node 24.21.0 | Observado; runtime realmente desplegado no verificado |
| Datos | PostgreSQL; migraciones 001–021, repositorios parametrizados | Inspección selectiva |
| Archivos | Google Drive, firmas, medios protegidos, adjuntos y Apps Script | Inspección selectiva |
| IA | Gemini con herramientas y validación backend; enrutamiento y fallback | Inspección selectiva |
| Persistencia cliente | IndexedDB/offline, sincronización incremental; aplicación móvil independiente fuera de este repositorio | Limitación de alcance |
| Calidad | 148 pruebas de caracterización, workflows CI y pruebas de integración PostgreSQL | Inventario, no ejecución local |

Versiones de **declaración**, **lockfile** y **runtime** no son la misma fuente; no se pudo leer la versión real de Render ni infraestructura no versionada.

## 3. Diagrama de flujos y límites de confianza
```text
[Usuario / navegador React SPA]
  | token de sesión en cuerpo JSON (actualmente desde localStorage)
  v
[Render reverse proxy / TLS] ------> [HTTP Node/Express + Helmet/CORS]
                                       | /api/action: middleware -> dispatchAction -> authenticate -> permisos
                                       | /api/media/stream: grant temporal firmado
                                       | /api/maintenance-*: secreto de worker
                                       v
                             [Servicios / módulos de dominio]
                                |       |          |
                                v       v          v
                          [PostgreSQL] [Google Drive/Apps Script] [Gemini API]
                                ^
                                | SyncChanges / deltas / cursores
                             [IndexedDB]
```
**Límites:** datos del navegador, parámetros HTTP, documentos recuperados, firmas públicas, webhooks de workers y respuestas de servicios externos son entradas no confiables. PostgreSQL y Drive son fuentes operacionales distintas; Gemini no debe ejecutar SQL ni operar Drive directamente.

## 4. Rutas y componentes clave inspeccionados
- `backend/src/server.js`: servidor HTTP, cola de concurrencia, diagnóstico, salud.
- `backend/src/app.js:68-260`: CSP/Helmet, CORS, parser, endpoints y tratamiento de excepciones.
- `backend/src/core/request-security.js:4-151`, `backend/src/middleware/security.middleware.js:11-90`: envoltura de acciones, límites de payload y rate limits.
- `backend/src/core/action-router.js:34-236`: registro central de acciones y permisos; público solamente donde está declarado.
- `backend/src/services/auth.service.js:1-49`, `backend/src/infra/auth-postgres.repository.js:11-69`, `backend/src/services/permissions.service.js`: identidad, hash de tokens, sesiones y permisos.
- `backend/src/modules/password-vault.module.js:18-78,211-259,419-475`: ámbito de lectura y revelación de credenciales.
- `backend/src/services/protected-media-stream.service.js:9-134,162-215`: grants firmados con caducidad de 10 minutos y streaming desde Drive.
- `backend/src/services/ticket-access.service.js:4-49`: validación de boletas asignadas reutilizable.
- `backend/src/ai/agent.permissions.js`, `backend/src/ai/agent.tools.js`: control de herramientas IA.
- `src/context/AuthContext.jsx:7-51` y `src/api.js:216-230`: almacenamiento y envío del token del navegador.
- `render.yaml`, `.github/workflows/*.yml`: despliegue y CI/CD.

## 5. Matriz de 16 fases
| Fase | Estado | Alcance y evidencia |
|---|---|---|
| 1. Arquitectura | Parcial verificado | Árbol, manifests, rutas principales, integraciones; falta matriz exhaustiva de 927 archivos |
| 2. RCE, deserialización, PHP | Parcial verificado | Inventario y advisories: RSC/PHP no aplican al código rastreado; trazado taint de todos los sinks pendiente |
| 3. Dependencias | Parcial verificado | Dos lockfiles y CI audit de producción HIGH exitoso; falta SCA completo dev/transitivas actualizado |
| 4. Auth/autorización | Riesgo potencial | Bóveda y sesiones inspeccionadas; requiere pruebas entre cuentas ficticias |
| 5. Express/HTTP | Riesgo potencial | Helmet/CSP y 50 MB antes de rate limit; falta DAST aislado |
| 6. Inyecciones/DB | No verificado exhaustivamente | Consultas SQL de auth parametrizadas; no se auditaron todas las consultas dinámicas |
| 7. React | Parcial verificado | localStorage y sourcemap deshabilitado; DOM/XSS sin cobertura total |
| 8. Archivos | Parcial verificado | Drive y medio firmado inspeccionados; MIME real, consumo y autorización cruzada pendientes |
| 9. Render/CI | Parcial verificado | IaC y workflows; variables y controles efectivos de producción no accesibles |
| 10. Integraciones/IA | Parcial verificado | separación backend/IA y gestión de secretos inspeccionadas; prompt injection sin pruebas controladas |
| 11. Negocio/concurrencia/offline | Riesgo potencial | locks de firma en memoria; transacciones y SyncChanges necesitan pruebas por flujo |
| 12. Abusos/DoS | Riesgo potencial | parser global 50 MB; no se efectuaron cargas |
| 13. Pruebas controladas | Bloqueado | No hay staging autorizado con cuentas ficticias ni DB aislada ejecutada en esta sesión |
| 14. OWASP/trazabilidad | Parcial | Checklist elaborado; no representa cumplimiento ASVS certificado |
| 15. Priorización | Realizado | 10 riesgos con severidad contextual, hipótesis y límites |
| 16. Remediación | Diseñada, sin ejecutar | Propuestas mínimas y pruebas de regresión pendientes de autorización |

## 6. Evidencia CI previamente ejecutada
- PR #372 fusionado; en el commit de su PR `b52c36f24ed6fe4efa55f3843825e0a5ede0b09f` el workflow **Validate application** (run `40713271732`) finalizó **success**; el paso **Audit production dependencies** también **success**. El script aplica `npm audit --omit=dev --audit-level=high` para frontend y backend.
- En `main` commit `31f585c6bd71a2e23b6df011dc47596de58471e1`, **Stage 0 Characterization** (run `40713683365`) finalizó **success**.
- No se ejecutó `npm audit --json` de dependencias de desarrollo en esta auditoría. Tampoco se realizó análisis dinámico.

## 7. Seguridad observada (evidencia positiva)
- `dispatchAction` autentica las acciones privadas y coteja permisos en backend; ciertas operaciones requieren alcance adicional dentro del handler.
- `auth.service.js` almacena el hash del token de sesión, no el token en claro; verifica estado de usuario vigente.
- Se usan consultas parametrizadas en `auth-postgres.repository.js`.
- Se aplica CSP y se limita el anidamiento y número de claves en la envoltura de acciones.
- Los workers consultados cotejan un secreto, los medios protegidos usan HMAC y caducidad; `vite.config.js` especifica `sourcemap: false`.
- La lógica de IA incluye herramientas backend y controles de acceso; la revisión no encontró evidencia de que los secretos de Password Vault se envíen a Gemini.

## 8. Limitaciones materiales
Sin acceso a: versión efectiva Node/imagen de Render, logs sensibles sanitizados, configuración TLS/CDN real, copia de datos ficticios, usuarios de prueba para autorización, tablero Render, secretos, instalaciones auxiliares, móviles repos separados, auditoría de red, plataforma Apps Script publicada, ni ejecución local de pruebas con dependencias instaladas. No se consultaron datos de clientes. Esta lista impide pronunciarse sobre inexistencia de SQLi, XSS, IDOR, SSRF, exposición de Drive o RCE.

## 9. Conclusión
**Requiere correcciones prioritarias y validación de límites de acceso antes de certificarse.** No hay RCE, fuga real o intrusión confirmada a partir de esta revisión. Clasificar un aviso RSC/PHP como no aplicable al código no acredita que toda la infraestructura esté libre de tecnología no inventariada.

Referencias: [Node.js 24.22.1](https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md), [React GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3), [Oracle PHP alert](https://www.oracle.com/security-alerts/alert-cve-2026-109618.html), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).
