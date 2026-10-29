# Resultado de validación y riesgos residuales — PR #373

**Fecha:** 28/10/2026, cierre técnico de la rama de auditoría 29/10/2026 UTC.  
**Base de producción no alterada:** `main` en `31f585c6bd71a2e23b6df011dc47596de58471e1`.  
**PR:** https://github.com/Andri-Almengor/dms-boletas/pull/373. **No fusionar ni desplegar sin revisión.**

## 1. Cambios técnicos entregados

| Elemento | Antes (main) | Propuesto en rama |
|---|---|---|
| Node.js | 24.21.0 | **24.22.1** (parches de seguridad 21/10/2026) |
| Vite | 6.4.3 | **6.4.5** |
| React Router DOM | 6.30.4 | **6.30.6**; avisos moderados residuales requieren evaluación de upgrade mayor |
| Nodemailer | 10.0.13 | **10.2.1** |
| PostCSS | 8.5.16 | **8.5.32** vía lockfile |
| Browserslist | 4.28.5 | **4.29.5** vía lockfile |
| nanoid | 3.3.15 | **3.3.20** vía lockfile |
| Auditoría CI | Omite dev, umbral HIGH | **npm audit completo** (JSON adjunto) con puerta HIGH/CRITICAL incluyendo dev + gate productivo HIGH existente |
| Reproducibilidad CI | npm install en Validate | **npm ci** en frontend/backend, sin pasos temporales |

El frontend sigue siendo SPA React 18; la base de datos continúa siendo PostgreSQL y Drive permanece para archivos.

## 2. Dependencias: evidencia sin suposiciones

Lectura de `npm-audit-frontend-all.json` y `npm-audit-backend-all.json` generados por el runner de GitHub que preparó los lockfiles candidatos, sin cambiar paquetes mayores ni usar `--force`.

| Registro | Críticas | Altas | Moderadas | Bajas |
|---|---:|---:|---:|---:|
| **Antes — frontend (incluye desarrollo)** | 0 | **5** | 3 | 0 |
| **Después — frontend (incluye desarrollo)** | 0 | **0** | **2** | 0 |
| **Antes — backend (incluye desarrollo)** | 0 | 0 | 7 | 0 |
| **Después — backend (incluye desarrollo)** | 0 | 0 | **7** | 0 |

Estas cifras son **paquetes señalados por npm**, no vulnerabilidades explotadas ni CVE independientes. La reducción de 5 avisos altos del frontend se logró sin actualizaciones mayores. El resultado de la auditoría npm puede evolucionar conforme se publiquen nuevos avisos; se guarda evidencia por run de CI. A partir de esta actualización, el job falla ante **cualquier HIGH/CRITICAL** en frontend o backend, incluyendo devDependencies, y conserva el gate de producción existente.

### Riesgos moderados restantes

- **Frontend:** `react-router` y `react-router-dom` 6.30.6, asociados a avisos de la familia 6.x. El auditor aconseja actualizar a 7.x, una migración mayor que debe tener pruebas de rutas, acceso, navegación, IndexedDB y enlaces públicos antes de considerarse.
- **Backend:** `body-parser`, `express`, `qs`, `googleapis`, `googleapis-common`, `uuid`, `exceljs`. Algunos requieren versión mayor de Google APIs/ExcelJS; los otros tienen restricciones de dependencias transitivas. Se requiere análisis de reachability por módulo y pruebas. No instalar overrides no verificados.

## 3. Validaciones de seguridad automatizadas

**Suites exigidas por PR:** `Stage 0 Characterization`, `Validate application`, `PostgreSQL Stage 6 CI`. Incluyen pruebas de caracterización, compilación frontend, verificación sintáctica y unitarias backend, integración/migraciones PostgreSQL, auditoría npm productiva, benchmark y pruebas de estabilidad. La referencia autoritativa de éxito es **el último commit y los tres checks del PR #373**: https://github.com/Andri-Almengor/dms-boletas/pull/373/checks.

El código de la rama incorpora regresiones sobre coherencia de Node/manifests/lockfiles/Render, ausencia de paquetes RSC y permanencia de controles backend; también preserva tests de permisos, firma, sincronización y entrega existentes. Se corrigió la expectativa de versión en una prueba de caracterización que referenciaba el pin anterior; no se retiró ningún test funcional para aprobar CI.

**La auditoría npm verifica alertas conocidas en dependencias; no es DAST ni demostración de ausencia de fallos.**

## 4. Riesgos que requieren decisión del propietario funcional o acceso a staging

- **Password Vault:** los tests existentes establecen que técnicos con `BOLETAS_VER` / `MANTENIMIENTOS_VER` pueden consultar credenciales. Si el alcance esperado es por cliente asignado, hay que definirlo y ensayar IDOR con usuarios/datos **ficticios** antes de cambiar cualquier permiso.
- **Sesiones:** el cambio propio de contraseña no revoca todas las sesiones; requiere política explícita sobre logout, tokens e IndexedDB/offline.
- **Firmas:** existen locks por proceso para firma pública; falta simulación multiinstancia de idempotencia, correo y PDFs en staging sin datos reales.
- **DoS y media:** el parser general de 50 MB tiene mitigación previa por concurrencia y memoria, pero hace falta ejercicio de consumo en entorno aislado.
- **GitHub:** `main` no protegido y sin Rulesets observados; habilitar revisión obligatoria y controles requeridos desde administración GitHub, operación no incluida en cambios de código.
- **Render:** verificar la versión Node efectiva, variables de entorno sin revelar, TLS, CORS y permisos de acceso después del despliegue autorizado.
- **Integraciones:** Google Drive, Apps Script, Gemini, email y Google Chat requieren prueba sintética end-to-end; no se han invocado con secretos de producción.

## 5. Pruebas negativas no realizadas

Ningún exploit, escaneo de red, fuerza bruta, fuzzing sobre Render, inyección de SQL, estrés sobre producción, intento de leer contraseñas reales o firma ajena fue realizado. Sin staging/roles de prueba, no se puede afirmar una **auditoría dinámica integral superada**. La revisión de código es un control útil pero no sustituye ensayos de seguridad por rol, entidad y estado.

## 6. Procedimiento de despliegue y cierre

1. Revisar y aprobar PR #373 con las tres suites verdes en el último SHA; **no** hacer push directo a main ni `force push`.
2. Fusionar tras revisión y verificar que Render usa **Node 24.22.1** y que `/api/health` responde correctamente; no imprimir secretos ni DB URL.
3. Probar login por rol, pendientes/finalizadas, boletas, mantenimientos, fotos y video, firmas públicas, generación PDF, correo con CC, Google Chat (canales independientes), Gemini, sync/offline e IndexedDB sobre entorno autorizado, sin acciones que creen duplicados o alteren datos reales.
4. Revisar logs de Render por fallas de etapa (PDF/Drive/correo/Chat/firma), sin copiar payloads ni credenciales.
5. Activar protección de rama y requerir checks en GitHub por el administrador del repositorio; gestionar riesgos residuales en PR específicos.
6. Documentar resultados adicionales y aceptar el riesgo residual explícitamente antes de declarar cierre de auditoría dinámica.

**No se requieren migraciones PostgreSQL, cambios Apps Script, nuevas variables de entorno ni modificación de permisos para este PR.** La publicación de Node y nuevas dependencias exige deploy normal de Render **solo después de merge aprobado**.
