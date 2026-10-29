# Dependencias, versiones y avisos de seguridad

> **Estado final de la rama de auditoría (29/10/2026 UTC, previo al merge):** Node.js 24.22.1, Vite 6.4.5, React Router DOM 6.30.6 y Nodemailer 10.2.1 se encuentran declarados y alineados en manifests y lockfiles. La auditoría npm completa en el runner aislado con estas versiones muestra **0 críticas y 0 altas** en frontend y backend; **2 moderadas frontend y 7 moderadas backend**. Los parches de paquetes y el runtime no se han desplegado a Render. La revisión dinámica de roles/permisos entre clientes, firmas multi-instancia, plataforma Render y GitHub Rulesets sigue fuera de alcance y requiere infraestructura autorizada. Ningún aviso residual se resolvió con actualizaciones mayores automáticas.


Fecha 28/10/2026 · Commit `31f585c6bd71a2e23b6df011dc47596de58471e1`.

## Inventario de lockfiles en el commit original (línea base histórica)
- `package-lock.json`: lockfile v3, **120 registros de paquetes**; React 18.3.1, React DOM 18.3.1, react-router-dom 6.30.4, Vite 6.4.3, @vitejs/plugin-react 4.7.0. `package.json` usa varios rangos `^`; no confundir versión declarada con fijada en lock.
- `backend/package-lock.json`: lockfile v3, **213 registros**; Express 4.22.2, body-parser 1.20.9, cors 2.8.6, Helmet 8.3.0, pg 8.23.0, nodemailer 10.0.13, googleapis 144.0.0, proxy-addr 2.0.8, qs 6.15.3, path-to-regexp 0.1.13.
- **No** aparecen `react-server-dom-webpack`, `react-server-dom-parcel` ni `react-server-dom-turbopack` en ninguno de los lockfiles.
- `node 24.21.0` está fijado en cuatro ubicaciones; no existe evidencia aquí sobre la versión efectivamente ejecutada por Render.

## Alertas cotejadas
| Identificador / aviso | Alcance oficial | Evidencia del proyecto | Clasificación en alcance |
|---|---|---|---|
| GHSA-xqc2-xf4c-x3h3 (14/10/26) | RCE en React Server Components, paquetes `react-server-dom-*` 19.x | React 18 SPA Vite, ninguno de los tres paquetes instalado | **No aplicable** al proyecto inspeccionado |
| GHSA-h3gv-c5rc-p453 (14/10/26) | DoS Server Functions React | Sin RSC ni Server Functions | **No aplicable** |
| Avisos React RSC de 2025–2026 | RCE/DoS/source exposure en `react-server-dom-*` | No existen en lockfiles | **No aplicable** mientras se mantenga arquitectura |
| CVE-2026-106069 y 106072 | Node TLS canonicalización de IP, HIGH, corregidos en 24.22.1 | Node 24.21.0 fijado | **Potencialmente aplicable**; ruta afectada no demostrada |
| CVE-2026-105482 | Node DNS entradas NUL, HIGH, corregido en 24.22.1 | Pin 24.21.0 | **Potencialmente aplicable**; requiere traza de entrada |
| CVE-2026-105483 | Node TLS normalización IP, HIGH | Pin 24.21.0 | **Potencialmente aplicable** |
| CVE-2026-111497 | Dependencia nativa Brotli de Node, HIGH | Pin 24.21.0 | **Potencialmente aplicable**; uso específico no determinado |
| CVE-2026-105481 | Node HTTP Agent, MEDIUM | Pin 24.21.0 | **Potencialmente aplicable** |
| CVE-2026-106074 | Node crypto snapshot, MEDIUM | Pin 24.21.0 | **Potencialmente aplicable** si snapshots se usan |
| CVE-2026-106073 | Node permission realpathSync, LOW | Pin 24.21.0 | **Potencialmente aplicable** si Permission Model se usa |
| CVE-2026-109618, CVE-2026-109619 | PHP/Oracle productos específicos | Ningún runtime PHP, contenedor PHP o dependencia PHP figura en los archivos inventariados | **No aplicable al código/repositorio examinado**; infraestructura extra no revisada |

**Importante:** ausencia de paquete RSC/PHP aplica al árbol de Git bajo este commit; **no** demuestra ausencia de otros sistemas, CDNs, servicios de administración o servidores no incluidos.

Fuentes oficiales:
- https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
- https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3
- https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453
- https://github.com/react/react/security/advisories
- https://www.oracle.com/security-alerts/alert-cve-2026-109618.html

## Auditoría de dependencias de CI: evidencia histórica y estado ampliado
**Evidencia indirecta confirmada:** `.github/workflows/validate.yml` ejecuta `npm run audit:security`. En el PR #372, run 40713271732 el paso “Audit production dependencies” terminó success. El script revisa frontend y backend con `--omit=dev --audit-level=high`. Por tanto **en ese run** no hubo un fallo por alerta de alta gravedad en paquetes de producción según el auditor npm de ese momento.

**Ejecutado en el PR:** `npm audit --json` completo en ambos árboles dentro de `Validate application`, con artefactos y conteos. **Pendiente:** `npm ls --all`, SBOM, CodeQL, OSV, Dependabot, pruebas de explotabilidad y verificación real en Render. No declarar cero vulnerabilidades totales.

## Procedimiento reproducible en entorno autorizado
```bash
node --version
npm ci --ignore-scripts
npm ci --prefix backend --ignore-scripts
npm audit --json > /tmp/audit-frontend.json
npm audit --omit=dev --json > /tmp/audit-frontend-prod.json
npm --prefix backend audit --json > /tmp/audit-backend.json
npm --prefix backend audit --omit=dev --json > /tmp/audit-backend-prod.json
npm ls --all > /tmp/npm-tree-frontend.txt
npm --prefix backend ls --all > /tmp/npm-tree-backend.txt
```
Revisar scripts de instalación **antes** de permitirlos; luego ejecutar `npm ci` en un sandbox confiable para pruebas funcionales. Los comandos no fueron ejecutados en esta sesión y **no** deben apuntar a producción. Los archivos JSON de salida pueden contener paths internos: sanitizar antes de adjuntar.

## Actualización de esta rama — endurecimiento seguro (29/10/2026 UTC)

En el PR #373 se cambió únicamente el **runtime declarado**, la reproducibilidad de CI y las pruebas de caracterización: los pines Node de `.node-version`, manifests, lockfiles y `render.yaml` se alinearon a **24.22.1 LTS**, se usó `npm ci` en `Validate application`, y se incorporaron informes JSON de `npm audit` incluyendo dependencias de desarrollo, manteniendo la puerta obligatoria de dependencias de producción. Se añadieron pruebas `security-runtime-baseline.test.mjs` y se actualizó la prueba existente `low-memory-headers.test.mjs` porque el contrato intencional de runtime cambió de 24.21.0 a 24.22.1. **Nada se ha desplegado ni fusionado a `main` por esta tarea**.

El hallazgo SEC-02 cambia de **pin vulnerable sin corregir** a **corregido en la rama/pendiente de integración y validación del runtime real**. Otros hallazgos quedan como riesgos pendientes, explícitamente sin explotar ni modificar las reglas de negocio. Los controles de concurrencia de `backend/src/middleware/concurrency.middleware.js` ya reservan carril para cargas grandes, limitan simultaneidad y evalúan memoria antes del parser HTTP; por tanto SEC-03 representa riesgo **residual**, no ausencia total de protección. Las rutas SQL dinámicas revisadas validan tabla/columna mediante `tableDefinition` y `_column` y parametrizan valores; ello reduce superficie SQLi de los repositorios inspeccionados sin acreditar que toda consulta haya sido probada.

**Validación pendiente:** CI del commit final, inspección de reportes npm (incluyendo dev), configuración de Render/GitHub y pruebas con cuentas sintéticas en staging. La auditoría no puede certificarse totalmente mientras estos límites no se resuelvan; no deben afirmarse pruebas dinámicas que no se ejecutaron.
