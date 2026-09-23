# Automatización externa de mantenimientos: recordatorios 07:00/17:00 y finalización 17:00

## Comportamiento

- Los recordatorios de progreso de mantenimientos pendientes se despiertan externamente a las **07:00** y **17:00 America/Costa_Rica**, por lo que no dependen de que el Web Service gratuito de Render permanezca despierto.
- El scheduler interno del backend se conserva como respaldo; la idempotencia PostgreSQL garantiza un solo mensaje por mantenimiento, fecha y franja aunque ambos caminos coincidan.
- Si un administrador pulsa **Finalizar mantenimiento antes de las 17:00** en Costa Rica, el mantenimiento queda en `PROGRAMADO` / `ESPERANDO_1700`.
- No se generan boletas, PDF, carpetas ni notificaciones antes de la hora programada.
- A partir de las **17:00 America/Costa_Rica**, el worker puede iniciar la finalización escalonada existente.
- Si se pulsa Finalizar después de las 17:00, el proceso comienza inmediatamente.
- Mientras todavía está `PROGRAMADO`, el administrador puede cancelar la solicitud desde la interfaz.
- El navegador no necesita permanecer abierto.

## 1. Configurar Render

Crear una variable de entorno secreta:

```text
MAINTENANCE_FINALIZATION_WAKE_SECRET=<valor-largo-y-aleatorio>
```

`render.yaml` ya declara la variable como `sync: false`; el valor real nunca debe subirse a GitHub.

## 2. Configurar Apps Script

Copiar al proyecto de Apps Script que usa DMS Boletas el archivo:

```text
scripts/google-apps-script/maintenance-finalization-5pm-worker.gs
```

En **Project Settings → Script Properties** crear:

```text
DMS_APP_URL=https://<dominio-publico-de-la-app>
DMS_FINALIZATION_WAKE_SECRET=<mismo-valor-configurado-en-render>
```

La URL debe apuntar a la aplicación desplegada, sin `/` final.

## 3. Instalar el trigger

Ejecutar manualmente una vez desde Apps Script:

```javascript
installDmsMaintenanceFinalizationTrigger();
```

Autorizar `UrlFetchApp` y la creación de triggers cuando Google lo solicite.

La instalación crea tres salvaguardas:

- un trigger diario que despierta el recordatorio de progreso alrededor de las **07:00** Costa Rica;
- un trigger diario de las **17:00** que despierta primero el recordatorio de progreso y luego el worker de finalización;
- una limpieza horaria de las propiedades de idempotencia del Apps Script de reportes.

Después de actualizar este archivo en un proyecto de Apps Script que ya existía, debe ejecutarse nuevamente `installDmsMaintenanceFinalizationTrigger()` una sola vez para reemplazar los triggers antiguos por esta configuración.

La limpieza conserva como máximo 80 entradas recientes y únicamente administra claves con los prefijos `DELIVERY_`, `INVITATION_`, `MAINTENANCE_PRESENTATION_` y `CUSTOMER_CASE_*`. No elimina `REPORT_WEBHOOK_SECRET`, IDs de carpetas, plantillas ni los secretos del worker.

Los triggers usan `America/Costa_Rica`. Google puede ejecutar un trigger diario unos minutos antes o después del minuto solicitado. Los recordatorios nunca se envían antes de la hora nominal: si el wake de las 07:00 o 17:00 llega anticipadamente, el backend responde `TOO_EARLY` y Apps Script programa un retry corto. La finalización mantiene además su mecanismo `nextDueAt` existente.

## 4. Probar los wake-ups

Para probar los recordatorios sin esperar al trigger puede ejecutar:

```javascript
testDmsMaintenanceProgressMorning();
testDmsMaintenanceProgressAfternoon();
```

La respuesta puede indicar `TOO_EARLY` si la prueba se ejecuta antes de la franja solicitada; en ese caso no se envía ningún mensaje antes de hora.

Para probar el worker de finalización:

```javascript
testDmsMaintenanceFinalizationWorker();
```

Un resultado correcto puede ser similar a:

```json
{
  "ok": true,
  "invoked": 0,
  "scheduled": 0,
  "processing": 0,
  "pending": 0
}
```

La prueba únicamente despierta y consulta el worker. No fuerza mantenimientos que todavía no hayan llegado a su hora programada.

## Recuperar el error de cuota de Script Properties

Si la aplicación muestra:

```text
You have exceeded the property storage quota. Please remove some properties and try again.
```

la instalación ya acumuló demasiadas respuestas idempotentes de versiones anteriores. No es necesario borrar secretos ni configuración manualmente.

Después de actualizar `maintenance-finalization-5pm-worker.gs`, ejecutar una vez:

```javascript
dmsCleanupPropertyQuotaNow();
```

La función elimina únicamente las propiedades idempotentes administradas por DMS y devuelve un resumen con `deleted`, `legacyDeleted`, `expiredDeleted` y `retained`.

Una vez completada la limpieza, en DMS Boletas usar **Reintentar desde el último paso**. El backend conserva el job y el progreso persistido, por lo que no hay que devolver el mantenimiento a Pendiente ni recrearlo.

## Endpoints

Recordatorios de progreso:

```text
POST /api/maintenance-progress/wake
```

Body:

```json
{ "slot": "07:00" }
```

o:

```json
{ "slot": "17:00" }
```

Finalización:

```text
POST /api/maintenance-finalization/wake
```

Header obligatorio:

```text
x-dms-worker-secret: <secreto>
```

El endpoint no acepta sesiones de usuario como sustituto del secreto. El worker reconstruye un contexto interno `SISTEMA_1700` y reutiliza los jobs persistentes de finalización.

## Recuperación

- Antes de cada wake-up, Apps Script libera propiedades idempotentes heredadas o expiradas para evitar que la generación de boletas falle por cuota.
- Si quedan mantenimientos `EN_PROCESO`, cada wake-up intenta reanudar los jobs persistentes existentes.
- El Apps Script mantiene una ventana de ejecución acotada y, si `pending > 0`, crea otro trigger aproximadamente cinco minutos después.
- Los errores definitivos quedan en `ERROR` y no se reintentan infinitamente; se conserva el botón manual **Reintentar finalización** de la aplicación.
