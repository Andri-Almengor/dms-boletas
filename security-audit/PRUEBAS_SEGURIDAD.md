# Evidencia, comandos y pruebas de ciberseguridad

Fecha de corte 28/10/2026; fuente `main` commit `31f585c6bd71a2e23b6df011dc47596de58471e1`. Toda prueba que no fue efectivamente ejecutada figura expresamente como pendiente.

## Ejecutado: inspección estática y lectura de GitHub
1. **Tree Git:** `GET /repos/Andri-Almengor/dms-boletas/git/trees/main?recursive=1`; status completo no truncado, 927 archivos. Se examinó el inventario de código, lockfiles, rutas, CI y configuraciones.
2. **Commit:** `GET /repos/.../branches/main` confirma SHA `31f585c6bd71a2e23b6df011dc47596de58471e1` y `protected:false`; `GET /repos/.../rulesets` devuelve `[]`.
3. **Pull Requests:** PR #372 y #371 fusionados, lista PR abiertas vacía al momento de consulta.
4. **Fuentes:** lectura selectiva de `backend/src/app.js`, `core/action-router.js`, `request-security.js`, middleware, auth/permissions, Password Vault, protected media, firmas, IA, frontend AuthContext, workflows y Render.
5. **Dependencias:** lectura de `package.json` y dos lockfiles; React RSC no instalado.
6. **Advisories:** contrastados avisos Node 21/10/2026, React RSC 14/10/2026 y Oracle PHP.
7. **CI externo preexistente:** PR #372 `Validate application` run `40713271732` **success**, paso `Audit production dependencies` **success**. CI del commit `main`: `Stage 0 Characterization` run `40713683365` **success**.
8. **Producción:** no se realizaron peticiones de explotación, fuzzing, carga, credenciales ni acceso a registros de usuarios.

## No ejecutado: lista de verificación
| Prueba | Estado | Bloqueo |
|---|---|---|
| `npm audit --json` completo (frontend/backend) | Pendiente | Dependencias no instaladas en entorno de ejecución de esta auditoría |
| `npm ls --all`, SBOM, OSV/CodeQL/Semgrep | Pendiente | Requiere herramienta y sandbox autorizados |
| BOLA/IDOR con técnico A/B | Bloqueado | Faltan cuentas ficticias y PostgreSQL aislado |
| XSS/Markdown/DOM real | Pendiente | Revisión exhaustiva de sinks + DAST local |
| Validación SSRF/URL redirect | Pendiente | Trazado de integraciones y simulaciones |
| Abuso de body 50 MB | Bloqueado | Staging autorizado y presupuesto de recursos |
| Revocación al cambio de contraseña | Pendiente | Test unitario/integración con sesiones ficticias |
| Multi instancia ratelimit y firma | Bloqueado | Staging multi-instancia aislado |
| Permisos de Drive y Apps Script publicado | Bloqueado | Sin acceso a configuración de cuentas |
| TLS y runtime real de Render | Bloqueado | Sin acceso a panel y evidencia de ejecución |
| Migraciones, backups y Restore | Bloqueado | No ejecutar sobre producción |
| Datos offline / sesión revocada | Pendiente | Requiere PWA de prueba y fixtures |

## Comandos sugeridos para entorno aislado, **no ejecutados**
```bash
git fetch origin main
git switch -c audit/security-validation origin/main
node --version
npm ci --ignore-scripts
npm ci --prefix backend --ignore-scripts
npm audit --json
npm --prefix backend audit --json
npm ls --all
npm --prefix backend ls --all
# Tras verificar scripts de terceros y levantar PostgreSQL solo de test:
npm run test:characterization
npm --prefix backend run check
npm run build
npm --prefix backend run test:db:safety
# Solo con TEST_DATABASE_URL de base aislada:
npm --prefix backend run test:db
```
**No usar `DATABASE_URL` de producción.** Nunca ejecutar scripts de importación/restauración o stress sobre Render con datos reales. Sanitizar resultados de `npm audit` y logs antes de compartir.

## Formato recomendado de evidencia DAST
ID, entorno, request sintético (sin token real), identidad/rol ficticio, controles de acceso previstos, response status/body sanitizado, comportamiento observado, reproducción segura, impacto, false-positive analysis, patch/PR y fecha de cierre.

## Observación de CI
`.github/workflows/validate.yml` usa `npm install`, mientras otros workflows usan `npm ci`; recomendar reproducibilidad uniforme tras validar compatibilidad. El script audit actual filtra paquetes de producción con `--omit=dev` y `--audit-level=high`: éxito no demuestra riesgo cero ni cubre paquetes dev o alertas MEDIUM.

## Fuentes y evidencia directa
- Código: https://github.com/Andri-Almengor/dms-boletas/tree/31f585c6bd71a2e23b6df011dc47596de58471e1
- CI PR #372: https://github.com/Andri-Almengor/dms-boletas/actions/runs/40713271732
- CI main: https://github.com/Andri-Almengor/dms-boletas/actions/runs/40713683365
- Node Security: https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
- React GHSA: https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3
