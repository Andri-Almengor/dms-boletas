# Resumen ejecutivo — Auditoría de seguridad DMS Boletas

> **Estado final de la rama de auditoría (29/10/2026 UTC, previo al merge):** Node.js 24.22.1, Vite 6.4.5, React Router DOM 6.30.6 y Nodemailer 10.2.1 se encuentran declarados y alineados en manifests y lockfiles. La auditoría npm completa en el runner aislado con estas versiones muestra **0 críticas y 0 altas** en frontend y backend; **2 moderadas frontend y 7 moderadas backend**. Los parches de paquetes y el runtime no se han desplegado a Render. La revisión dinámica de roles/permisos entre clientes, firmas multi-instancia, plataforma Render y GitHub Rulesets sigue fuera de alcance y requiere infraestructura autorizada. Ningún aviso residual se resolvió con actualizaciones mayores automáticas.


**Corte:** 28 de octubre de 2026 · **Commit examinado:** `31f585c6bd71a2e23b6df011dc47596de58471e1`.

## Dictamen
**Requiere correcciones prioritarias y pruebas adicionales antes de una conclusión definitiva.** Se examinaron arquitectura React/Express, manifest de dependencias, sesiones/permisos, Password Vault, archivos Drive, IA, integraciones, CI y configuración versionada de Render. **No se modificó producción**. Esta rama incorpora actualización declarativa del runtime Node y controles CI; los demás riesgos requieren validación.

| Resultado | Cantidad | Interpretación |
|---|---:|---|
| Críticos priorizados | 0 | No se confirmó explotación crítica |
| Altos priorizados | 2 | Bóveda por ID y Node LTS antes de parche |
| Medios priorizados | 7 | Defensa en profundidad, disponibilidad, CI, concurrencia |
| Bajos priorizados | 1 | Orígenes CORS declarados demasiado amplios |
| Hipótesis/riesgos pendientes de confirmar | 8 | No se probó exploit ni se accedió a datos reales |
| Controles OWASP no verificados | 12 | Requieren pruebas específicas |
| Controles OWASP bloqueados | 4 | Requieren staging/configuración autorizada |

No se debe interpretar “0 críticos” como garantía de seguridad. Las puntuaciones son **prioridad de remediación, no CVSS calculado**.

## Diez riesgos en orden operativo
1. Verificación de límites de acceso por cliente a contraseñas almacenadas.
2. Desfase de Node.js 24.21.0 en main: corregido a 24.22.1 en esta rama; pendiente de merge y verificación en Render.
3. Interpretación de cuerpos HTTP de hasta 50 MB antes del rate limit por acción.
4. Cambio de contraseña sin revocación de otras sesiones activas.
5. Rama `main` sin protección ni rulesets pese a auto-despliegue.
6. Rate limiting local a cada instancia y dependiente de IP.
7. Token Bearer persistido en localStorage y accesible a JavaScript del origen.
8. Pipelines históricos con credenciales de PostgreSQL Render y ejecución manual.
9. Locks de firma en memoria que requieren verificación multi-instancia.
10. Política CORS configurada como `*` (sin cookies/credentials, no bypass demostrado).

## Vulnerabilidades recientes que NO aplican al árbol inspeccionado
Los avisos React Server Components de 2025 y 2026, incluido el **GHSA-xqc2-xf4c-x3h3**, requieren paquetes `react-server-dom-*` ausentes; DMS tiene SPA React 18.3.1 con Vite. Los CVE de PHP **CVE-2026-109618 y CVE-2026-109619** no se vinculan a tecnología presente en el repositorio. No se ha revisado infraestructura oculta.

## Qué está bien implementado
Hay autenticación en backend, modelo de permisos, hashes de sesiones, SQL parametrizado en auth, CSP, controles de tamaño/complejidad, grants de Drive temporales, separación de herramientas IA y suites de caracterización. El CI del último PR revisado fue exitoso, incluida auditoría de dependencias de producción de severidad alta.

## Decisiones recomendadas
- **Propietario funcional:** definir si técnicos con permisos de boletas/mantenimientos deben ver todas las credenciales de clientes. Sin esta decisión no modificar permisos.
- **Ingeniería:** preparar PR separado de actualización Node LTS, ejecutar CI y staging.
- **Operaciones/GitHub:** proteger `main` con required checks y revisión.
- **Seguridad/QA:** habilitar staging ficticio y ejecutar casos BOLA/IDOR, sesiones, carga de archivos, XSS, SSRF, concurrencia y auditoría npm completa.

**Integridad del aplicativo:** conservar estados, roles, firmas, correos, Chat, PDFs, Drive, sincronización PostgreSQL/IndexedDB y reglas existentes. La auditoría solo documenta; ninguna corrección fue aplicada.

Consulte los informes técnicos de la carpeta `security-audit/` para alcance, evidencia y plan de cierre.

## Actualización de esta rama — endurecimiento seguro (29/10/2026 UTC)

En el PR #373 se cambió únicamente el **runtime declarado**, la reproducibilidad de CI y las pruebas de caracterización: los pines Node de `.node-version`, manifests, lockfiles y `render.yaml` se alinearon a **24.22.1 LTS**, se usó `npm ci` en `Validate application`, y se incorporaron informes JSON de `npm audit` incluyendo dependencias de desarrollo, manteniendo la puerta obligatoria de dependencias de producción. Se añadieron pruebas `security-runtime-baseline.test.mjs` y se actualizó la prueba existente `low-memory-headers.test.mjs` porque el contrato intencional de runtime cambió de 24.21.0 a 24.22.1. **Nada se ha desplegado ni fusionado a `main` por esta tarea**.

El hallazgo SEC-02 cambia de **pin vulnerable sin corregir** a **corregido en la rama/pendiente de integración y validación del runtime real**. Otros hallazgos quedan como riesgos pendientes, explícitamente sin explotar ni modificar las reglas de negocio. Los controles de concurrencia de `backend/src/middleware/concurrency.middleware.js` ya reservan carril para cargas grandes, limitan simultaneidad y evalúan memoria antes del parser HTTP; por tanto SEC-03 representa riesgo **residual**, no ausencia total de protección. Las rutas SQL dinámicas revisadas validan tabla/columna mediante `tableDefinition` y `_column` y parametrizan valores; ello reduce superficie SQLi de los repositorios inspeccionados sin acreditar que toda consulta haya sido probada.

**Validación pendiente:** CI del commit final, inspección de reportes npm (incluyendo dev), configuración de Render/GitHub y pruebas con cuentas sintéticas en staging. La auditoría no puede certificarse totalmente mientras estos límites no se resuelvan; no deben afirmarse pruebas dinámicas que no se ejecutaron.
