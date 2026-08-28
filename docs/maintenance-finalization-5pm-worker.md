# Finalización automática de mantenimientos a las 17:00

## Comportamiento

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

El trigger usa `America/Costa_Rica`. Google puede ejecutar un trigger diario unos minutos antes o después del minuto solicitado. Si se ejecuta antes de las 17:00, el backend responde con `nextDueAt` y el script crea automáticamente un trigger de una sola ejecución después de la hora exacta.

## 4. Probar sin finalizar nada

Ejecutar:

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

## Endpoint

```text
POST /api/maintenance-finalization/wake
```

Header obligatorio:

```text
x-dms-worker-secret: <secreto>
```

El endpoint no acepta sesiones de usuario como sustituto del secreto. El worker reconstruye un contexto interno `SISTEMA_1700` y reutiliza los jobs persistentes de finalización.

## Recuperación

- Si quedan mantenimientos `EN_PROCESO`, cada wake-up intenta reanudar los jobs persistentes existentes.
- El Apps Script mantiene una ventana de ejecución acotada y, si `pending > 0`, crea otro trigger aproximadamente cinco minutos después.
- Los errores definitivos quedan en `ERROR` y no se reintentan infinitamente; se conserva el botón manual **Reintentar finalización** de la aplicación.
