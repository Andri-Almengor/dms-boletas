# Resumen ejecutivo — Auditoría de seguridad DMS Boletas

**Corte:** 28 de octubre de 2026 · **Commit examinado:** `31f585c6bd71a2e23b6df011dc47596de58471e1`.

## Dictamen
**Requiere correcciones prioritarias y pruebas adicionales antes de una conclusión definitiva.** Se examinaron arquitectura React/Express, manifest de dependencias, sesiones/permisos, Password Vault, archivos Drive, IA, integraciones, CI y configuración versionada de Render. **No se modificó producción**.

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
2. Desfase de versión Node.js 24.21.0 frente a parche de seguridad 24.22.1 (21/10/2026).
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
