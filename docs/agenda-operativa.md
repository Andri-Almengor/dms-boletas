# Agenda operativa DMS

## Objetivo

La Agenda DMS queda integrada a la aplicación existente. No utiliza la hoja independiente ni la lista fija de técnicos de la agenda anterior.

- `Usuarios` es la fuente de personas asignables.
- `Agendas` y `AgendaAsignados` se crean dentro del mismo spreadsheet definido por `GOOGLE_SHEET_ID`.
- Los administradores (`USUARIOS_GESTIONAR`) pueden crear y modificar agendas.
- Los demás usuarios únicamente reciben las agendas donde están asignados.
- El calendario relaciona cada visita con una boleta usando fecha + persona asignada y una asociación uno-a-uno.
- `Oficina`, `office` y `RN` como palabras completas no requieren boleta.

## Tablas creadas automáticamente

### Agendas

`AgendaID, Fecha, HoraInicio, HoraFin, Detalle, Estado, RequiereBoleta, BoletaUID, RecordatorioEnviado, RecordatorioEnviadoEn, CreadoPor, FechaCreacion, ActualizadoPor, FechaActualizacion`

### AgendaAsignados

`AgendaAsignadoID, AgendaID, UsuarioID, Activo, FechaAsignacion, FechaDesasignacion`

No es necesario crear estas pestañas manualmente. El backend y el Apps Script pueden inicializarlas si no existen.

## Contrato con Apps Script

El backend llama la acción:

`agenda.notification.send`

con el mismo endpoint configurado actualmente mediante `APPS_SCRIPT_REPORT_URL` y el mismo secreto de `APPS_SCRIPT_REPORT_SECRET` / `REPORT_WEBHOOK_SECRET`.

El payload incluye:

- `dataSpreadsheetId`: mismo `GOOGLE_SHEET_ID` del backend.
- `appUrl`: URL pública de DMS Boletas.
- `mode`: `CREATED` o `UPDATED`.
- `deliveries`: correos y agendas que corresponden a cada persona.

El Apps Script conserva el control de las 5:00 p. m. en `America/Costa_Rica`, revisa las agendas del día y utiliza los destinatarios configurados más las personas asignadas.

## Variables que deben existir en Render/backend

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `APPS_SCRIPT_REPORT_URL`
- `APPS_SCRIPT_REPORT_SECRET`
- `APP_PUBLIC_URL`

No se requiere una variable adicional para Agenda.

## Flujo de creación

1. El administrador abre `/agenda`.
2. La fecha inicial propuesta es mañana en Costa Rica.
3. Define horario, detalle y una o varias personas.
4. Agrega la visita a la lista temporal.
5. Puede preparar, editar o quitar varias visitas antes del envío.
6. `Crear y enviar (N)` guarda todas las agendas y asignaciones.
7. Apps Script notifica por correo a cada persona asignada.
8. La interfaz se recarga y muestra inmediatamente las visitas creadas.

## Flujo de actualización

Al modificar fecha, horario, detalle o personas:

- la agenda se actualiza en el spreadsheet;
- las asignaciones removidas quedan desactivadas con `FechaDesasignacion`;
- las nuevas asignaciones se agregan;
- si cambia fecha, detalle o asignación se limpia la relación automática anterior con la boleta;
- las personas afectadas reciben la notificación de actualización.

## Asociación con boletas

Una boleta sólo puede satisfacer una agenda.

Ejemplo:

- Agenda A: 28/08/2026, Andrick, Asamblea.
- Agenda B: 28/08/2026, Andrick, otra visita.
- Existe una sola boleta de Andrick el 28/08/2026.

Resultado: una agenda queda `COMPLETA` y la otra `PENDIENTE`.

El sistema prioriza una `BoletaUID` ya guardada. Si todavía no existe vínculo persistido, compara las boletas del mismo día y de las personas asignadas y utiliza coincidencias del detalle con `Titulo`, `RazonVisita`, `TrabajoRealizado` y `Pendientes` para escoger la relación más coherente.

## Estados visibles

- `COMPLETA`: boleta realizada; muestra enlace a la boleta.
- `PENDIENTE`: llegó la fecha y aún no hay boleta.
- `FUTURA`: visita programada para una fecha posterior.
- `NO_REQUIERE`: detalle Oficina/RN; no genera recordatorio.
- `CANCELADA`: agenda cancelada.

## Asistente DMS

Las consultas de agenda se resuelven antes de delegar al asistente existente; las demás preguntas siguen usando el flujo anterior.

Ejemplos admitidos:

- `¿Dónde fue Andrick el último mes?`
- `Dime dónde fue Andrick los últimos tres meses.`
- `¿Dónde fui los últimos dos meses?`
- `¿Qué agendas del último mes tenían la palabra mantenimiento?`
- `Dime las agendas de los últimos tres meses con la palabra "instalación".`
- `¿Qué agendas hubo el mes pasado?`

Un técnico no puede utilizar el Asistente para consultar la agenda de otros usuarios. Un administrador sí puede consultar por nombre, usuario o correo.

## Pruebas recomendadas antes de merge

1. Entrar como administrador y abrir `/agenda`.
2. Confirmar que aparecen todos los usuarios activos al crear una agenda.
3. Crear dos agendas para mañana en un único envío.
4. Confirmar los correos de creación.
5. Modificar una de las agendas y cambiar una persona asignada.
6. Confirmar el correo de actualización para personas actuales y removidas.
7. Crear `Oficina` y `RN`; confirmar `No requiere boleta`.
8. Crear dos visitas para la misma persona y fecha; crear sólo una boleta; confirmar `1 completa + 1 pendiente`.
9. Abrir la visita completa y comprobar el enlace `Ver boleta`.
10. Preguntar al Asistente por persona, período y palabra clave.
11. Después de las 17:00, validar en un entorno de prueba el correo de boleta faltante.

## Prueba automatizada

`tests/characterization/agenda-operativa.test.mjs` valida las exclusiones, la cuadrícula mensual, el vínculo uno-a-uno y los contratos principales de rutas/Asistente.

Se incluye desde `tests/characterization/all.test.mjs` para formar parte de `npm run test:characterization`.
