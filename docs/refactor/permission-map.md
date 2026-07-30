# Mapa actual de permisos

Este documento registra el comportamiento vigente antes del refactor. No sustituye las validaciones del backend y no representa una propuesta de permisos nuevos.

## Principios actuales

- El frontend oculta o bloquea rutas según permisos para mejorar la experiencia.
- El backend vuelve a autenticar la sesión y valida el permiso de cada acción.
- `USUARIOS_GESTIONAR` funciona como permiso administrativo global en el router backend.
- Los permisos operativos permiten crear ciertos catálogos desde boletas y mantenimientos sin conceder acceso administrativo completo.

## Rutas principales del frontend

| Área | Ruta | Permiso o grupo actual |
|---|---|---|
| Inicio | `/` | Sesión autenticada |
| Boletas pendientes | `/boletas/pendientes` | `BOLETAS_VER` |
| Boletas finalizadas | `/boletas/finalizadas` | `BOLETAS_VER` |
| Crear boleta | `/boletas/nueva` | `BOLETAS_CREAR` |
| Ver boleta | `/boletas/:boletaUid` | `BOLETAS_VER` |
| Nueva visita | `/boletas/:boletaUid/nueva-visita` | `BOLETAS_CREAR` |
| Editar boleta | `/boletas/:boletaUid/editar` | `BOLETAS_EDITAR` |
| Edición rápida | `/boletas/:boletaUid/editar-rapido/:section` | `BOLETAS_EDITAR` |
| Ver mantenimientos | `/mantenimientos` | Cualquiera de `MANTENIMIENTOS_VER`, `MANTENIMIENTOS_CREAR`, `MANTENIMIENTOS_EDITAR`, `MANTENIMIENTOS_GESTIONAR`, `BOLETAS_VER`, `USUARIOS_GESTIONAR` |
| Crear mantenimiento | `/mantenimientos/nuevo` | Cualquiera de `MANTENIMIENTOS_CREAR`, `MANTENIMIENTOS_GESTIONAR`, `BOLETAS_CREAR`, `USUARIOS_GESTIONAR` |
| Editar mantenimiento | `/mantenimientos/:maintenanceId/editar` | Cualquiera de `MANTENIMIENTOS_EDITAR`, `MANTENIMIENTOS_GESTIONAR`, `BOLETAS_EDITAR`, `USUARIOS_GESTIONAR` |
| Clientes | `/clientes` | `CLIENTES_VER` |
| Catálogos | `/catalogos` | `CATALOGOS_VER`, `CATALOGOS_GESTIONAR` o `USUARIOS_GESTIONAR` |
| Usuarios | `/usuarios` | `USUARIOS_VER` |
| Crear/editar usuarios | `/usuarios/nuevo`, `/usuarios/:id/editar` | `USUARIOS_GESTIONAR` |
| Métricas | `/metricas` | `USUARIOS_GESTIONAR` |
| Encuestas administrativas | `/encuestas` | `USUARIOS_GESTIONAR` |
| Firma pública | `/firmar/:token` | Pública mediante token |
| Encuesta pública | `/encuesta/:token` | Pública mediante token |

## Acciones de boletas en el backend

| Acción | Permiso actual |
|---|---|
| Listar, obtener y leer medios | `BOLETAS_VER` |
| Crear | `BOLETAS_CREAR` |
| Actualizar, autoguardar, regresar a pendiente, anular, firma autenticada | `BOLETAS_EDITAR` |
| Finalizar | `BOLETAS_FINALIZAR` |
| Reenviar chats | `BOLETAS_FINALIZAR` o `BOLETAS_EDITAR` |
| Probar finalización | `NOTIFICACIONES_PRUEBA` |
| Crear, editar o eliminar evidencias | `BOLETAS_EVIDENCIAS` o `BOLETAS_EDITAR` |
| Obtener/guardar firma pública | Pública mediante token |

## Acciones de mantenimientos en el backend

| Acción | Permiso actual |
|---|---|
| Listar, obtener, medios, configuración y enlace de firma | Cualquiera de `MANTENIMIENTOS_VER`, `MANTENIMIENTOS_CREAR`, `MANTENIMIENTOS_EDITAR`, `MANTENIMIENTOS_GESTIONAR`, `BOLETAS_VER` |
| Crear | `MANTENIMIENTOS_CREAR`, `MANTENIMIENTOS_GESTIONAR` o `BOLETAS_CREAR` |
| Actualizar, dispositivos, imágenes, reabrir, eliminar y reportes | `MANTENIMIENTOS_EDITAR`, `MANTENIMIENTOS_GESTIONAR` o `BOLETAS_EDITAR` |
| Finalizar | `USUARIOS_GESTIONAR` |
| Probar generación de boletas o firma | `USUARIOS_GESTIONAR`, `MANTENIMIENTOS_GESTIONAR` o `MANTENIMIENTOS_ELIMINAR` |
| Obtener/guardar firma pública | Pública mediante token |

La finalización administrativa de mantenimientos se registra como contrato actual. Cualquier ampliación futura debe revisarse con el propietario funcional y acompañarse de pruebas de autorización.

## Altas operativas desde formularios

Los técnicos con permisos de creación o edición de boletas/mantenimientos pueden crear desde esos flujos:

- Ubicaciones del cliente.
- Ubicaciones del equipo.
- Supervisores/contactos.
- Tipos de dispositivo.
- Fabricantes.
- Modelos.
- Relaciones tipo de dispositivo–fabricante.

Categorías y tipos de falla continúan sujetos a la configuración efectiva del router y deben conservarse según las pruebas de cada flujo antes de extraer componentes.

## Riesgos a vigilar durante el refactor

1. No usar la visibilidad del frontend como autorización real.
2. No convertir un permiso `anyOf` en una exigencia de todos los permisos.
3. No eliminar el bypass administrativo de `USUARIOS_GESTIONAR` sin una decisión funcional.
4. No reutilizar una ruta administrativa para altas operativas si expone edición o eliminación.
5. Mantener separadas las rutas públicas basadas en token de las rutas autenticadas.
6. Probar respuestas `401`, `403` y tokens vencidos en cada módulo migrado.
