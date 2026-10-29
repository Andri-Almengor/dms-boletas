# Inventario de endpoints y autorizaciones — alcance revisado

Fuente primaria `backend/src/app.js`, `backend/src/core/action-router.js`, `backend/src/modules/password-vault.module.js`, `backend/src/ai/agent.permissions.js`. Fecha 28/10/2026. El backend centraliza la mayoría de operaciones en **un único HTTP POST /api/action** con campo `route`; por ello la ruta lógica es una parte crítica de la superficie de ataque. Alias de rutas mostrados por familia. No constituye catálogo exhaustivo de todas las variantes y aliases.

## Endpoints HTTP
| Método / URL | Autenticación | Permiso/control | Sensibilidad |
|---|---|---|---|
| GET `/api/health` | Pública | Mínimo estado, sin detalle salvo opción controlada | Baja |
| GET `/api/ai/health` | Bearer | `USUARIOS_GESTIONAR` | Alta |
| POST `/api/action` | Según `route` | Middleware valida envoltura, rate limit, despacho backend | Variable, crítica |
| GET `/api/media/stream?token=...` | Grant HMAC temporal | Caduca a 10 min, scope definido al crearlo, Map efímero | Alta |
| POST `/api/maintenance-finalization/*` | Secreto worker | `x-dms-worker-secret` validado server-side | Crítica |
| POST `/api/maintenance-progress/*` | Secreto worker | Reutiliza secreto maintenance worker | Crítica |
| GET `/*` frontend | HTML SPA | Protección real depende de la API, no de React | Media |

## Acciones `POST /api/action`
| Acción o familia (ejemplos) | Auth | Permiso en router / handler | Comprobación pendiente |
|---|---|---|---|
| `auth.login` | Pública | IP rate limit, usuario activo y bloqueo | Enumeración/fuerza bruta en staging |
| `auth.me`, `auth.logout` | Sesión | Sesión válida; consulta/revocación | Vigencia y revocación |
| `auth.changePassword` | Sesión | Contraseña actual + nueva política | Sesiones previas, SEC-04 |
| `users.list/get` | Sesión | `USUARIOS_VER` | Campos devueltos sanitizados |
| `users.create/update/resetPassword` | Sesión | `USUARIOS_GESTIONAR` | Mutación de roles y tokens |
| `boletas.list/get/media.get` | Sesión | `BOLETAS_VER` y reglas en servicios | Restricción por asignación |
| `boletas.create` | Sesión | `BOLETAS_CREAR` | Pertenencia de cliente, mass assignment |
| `boletas.update/autosave/annul/returnPending` | Sesión | `BOLETAS_EDITAR` | Estado y propiedad |
| `boletas.finalize` | Sesión | `BOLETAS_FINALIZAR` | Estado, idempotencia, concurrencia |
| `boletas.resendEmail/resendChats` | Sesión | `BOLETAS_FINALIZAR` o `BOLETAS_EDITAR` | Canales independientes, auditoría |
| `boletas.evidence.*` | Sesión | `BOLETAS_EVIDENCIAS` o `BOLETAS_EDITAR` | IDOR, MIME, tamaño, Drive |
| `maintenance.list/get/media.get` | Sesión | Permisos lectura de mantenimiento o boleta | Visibilidad por asignación |
| `maintenance.create` | Sesión | `MANTENIMIENTOS_CREAR`, `MANTENIMIENTOS_GESTIONAR` o `BOLETAS_CREAR` | Cliente/ubicación |
| `maintenance.update/devices.*/images.*` | Sesión | Permisos de edición mantenimiento o `BOLETAS_EDITAR` | Estado, relaciones, evidencias |
| `maintenance.finalize` | Sesión | `USUARIOS_GESTIONAR` | Exclusividad, transacción |
| `maintenance.signature.link` | Sesión | Familia lectura mantenimiento | Usuario debe tener alcance |
| `agenda.list/get` | Sesión | Router sin permiso adicional; handler aplica visibilidad | Asignaciones y filtros |
| `agenda.create/update` | Sesión | `USUARIOS_GESTIONAR` | Pertenencia y asignaciones |
| `assistant.chat` | Sesión | Herramientas y autorizaciones internas IA | Prompt injection/control de tools |
| `passwordVault.dashboard.get` | Sesión | Lectura amplia por READ_PERMISSIONS | **SEC-01** alcance por cliente |
| `passwordVault.credentials.reveal` | Sesión | `assertCanRead`, credencial por ID | **SEC-01** alcance por credencial |
| `passwordVault.credentials.create/update/delete` | Sesión | `USUARIOS_GESTIONAR` | Entrada, auditoría |
| `knowledge.list/get` | Sesión | Lectura publicada o autor/gestor según handler | Knowledge privado |
| `knowledge.create/update/delete` | Sesión | Permisos particulares de conocimiento/autor | IDOR de borradores |
| `survey.public.get/submit` | Pública | Token público + validación de handler | Repetición/tokens |
| `ticket.signature.public.get/submit` | Pública | Token no adivinable, expiración, handler | Concurrente/public signature |
| `maintenance.signature.public.get/submit` | Pública | Token no adivinable, expiración, handler | Concurrente/public signature |

**Notas:**
1. Array de permisos en `action-router.js` significa **OR**, no AND; `USUARIOS_GESTIONAR` activa bypass administrativo. Respetar negocio actual en remediación.
2. `backend/src/services/ticket-access.service.js` filtra asignaciones de boletas, `backend/src/ai/agent.permissions.js` construye `EXISTS` sobre `BoletaAsignados`, pero no se ha verificado que *todas* las rutas lo invoquen.
3. Los endpoints de firma y encuesta son públicos **mediante token**, no públicos sin protección semántica. El secreto de worker no es el mismo que un token de usuario.
4. No cambiar roles/permisos antes de confirmar políticas con dueño funcional. Toda prueba de `401`, `403`, IDOR, asignaciones y estados requiere base y usuarios ficticios; **no ejecutada**.
5. Para matriz exhaustiva, instrumentar extracción determinista del mapa `add()`, alias, rutas de módulos y verificación de permisos por handler, sin ejecutar handlers ni producción.
