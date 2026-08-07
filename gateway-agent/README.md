# DMS Integration Gateway Agent

Agente local para conectar redes privadas con DMS-Boletas en Render mediante solicitudes HTTPS salientes. En esta primera fase no se conecta todavía con Milestone, OnGuard ni cámaras reales. Utiliza un adaptador simulado para validar autenticación, heartbeat, inventario, comandos e idempotencia.

## Arquitectura inicial

```text
DMS-Boletas en Render
        ▲
        │ HTTPS saliente
        │
Agente local DMS
        │
        └── Adaptador simulado
```

El agente nunca abre un puerto entrante en la institución. Todas las solicitudes se originan desde el equipo local hacia Render.

## Preparación local en Windows

1. Desde DMS-Boletas, un administrador crea un gateway.
2. La aplicación muestra un `GatewayID` y un token una sola vez.
3. Abra CMD dentro de `gateway-agent`.
4. Cree el archivo local de configuración:

```bat
copy .env.example .env
notepad .env
```

5. Reemplace los tres valores obligatorios:

```env
DMS_GATEWAY_URL=https://su-servicio.onrender.com
DMS_GATEWAY_ID=gateway-entregado-por-la-aplicacion
DMS_GATEWAY_TOKEN=token-mostrado-una-sola-vez
```

6. Valide la configuración sin conectarse:

```bat
npm run config:check
```

7. Para una prueba manual, ejecute:

```bat
npm start
```

El agente carga automáticamente `gateway-agent/.env` mediante la función nativa de Node.js. Las variables definidas directamente por Windows o por un servicio tienen prioridad sobre el archivo local.

El archivo `.env` está excluido de Git y no debe compartirse ni subirse al repositorio.

## Instalar como servicio de Windows

La instalación como servicio permite que el agente:

- inicie automáticamente con Windows;
- funcione sin una ventana de CMD abierta;
- se reinicie después de un fallo;
- guarde logs rotativos;
- mantenga el gateway conectado después de cerrar sesión.

### Requisitos

- Windows 10, Windows 11 o Windows Server compatible.
- Node.js 20.12 o superior instalado.
- Archivo `.env` completo y validado.
- Acceso HTTPS saliente hacia Render y GitHub durante la instalación inicial.

Antes de instalar el servicio, cierre cualquier ejecución manual del agente con `Ctrl + C` para no dejar dos procesos usando el mismo gateway.

Desde CMD, dentro de `gateway-agent`, ejecute:

```bat
npm run service:install
```

El instalador solicita permisos de administrador mediante la ventana de Control de cuentas de usuario de Windows. Después:

1. valida `.env`;
2. localiza la ruta absoluta de `node.exe`;
3. valida el agente sin conectarse;
4. descarga WinSW 2.12.0 desde el repositorio oficial;
5. verifica el SHA-256 fijado para el ejecutable x64;
6. restringe los permisos de `.env`;
7. instala `DMS Integration Gateway` como servicio;
8. configura inicio automático retrasado;
9. inicia el servicio.

El servicio usa la cuenta local `SYSTEM`, pero solamente realiza conexiones HTTPS salientes. No publica puertos ni comparte carpetas.

### Verificar estado

```bat
npm run service:status
```

Debe mostrar:

```text
Servicio: DMS Integration Gateway
Estado: Running
```

Luego confirme en DMS-Boletas que el gateway aparece **EN LÍNEA**.

### Consultar logs

```bat
npm run service:logs
```

Los archivos se guardan en:

```text
gateway-agent\logs
```

Se conservan hasta 10 archivos de aproximadamente 10 MB cada uno.

### Administrar el servicio

```bat
npm run service:start
npm run service:stop
npm run service:restart
npm run service:status
npm run service:logs
```

Las acciones que modifican el servicio solicitan elevación de administrador automáticamente.

### Desinstalar

```bat
npm run service:uninstall
```

La desinstalación conserva por seguridad:

- `.env`;
- los logs existentes.

Para borrar también los logs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/uninstall-service.ps1 -RemoveLogs
```

### Actualizar el agente

Después de actualizar el repositorio:

```bat
git pull
npm run config:check
npm run service:restart
```

Si cambió la ubicación de la carpeta o la instalación de Node.js, vuelva a ejecutar:

```bat
npm run service:install
```

El instalador detecta una instalación anterior y la reemplaza sin borrar `.env` ni el inventario guardado en DMS-Boletas.

## Variables

- `DMS_GATEWAY_URL`: URL pública de Render, sin `/api/action` ni `/api/integration-gateway`.
- `DMS_GATEWAY_ID`: identificador entregado por DMS-Boletas.
- `DMS_GATEWAY_TOKEN`: token mostrado una sola vez al provisionar.
- `DMS_GATEWAY_NAME`: nombre descriptivo de la sede.
- `DMS_GATEWAY_ADAPTER`: por ahora solamente `simulated`.
- `DMS_GATEWAY_HEARTBEAT_MS`: intervalo de heartbeat, mínimo 10 segundos.
- `DMS_GATEWAY_POLL_MS`: intervalo para consultar comandos, mínimo 5 segundos.
- `DMS_SIMULATED_DEVICE_COUNT`: entre 1 y 25 cámaras virtuales.

## Errores de configuración

Si falta una variable, el agente muestra cuál valor debe completarse y la ubicación exacta esperada del archivo `.env`. Una URL de Render válida debe comenzar con `https://`.

Si el servicio no inicia:

1. ejecute `npm run config:check`;
2. ejecute `npm run service:logs`;
3. confirme que Node.js continúa instalado en la misma ruta;
4. confirme que el equipo tiene acceso a la URL de Render;
5. vuelva a ejecutar `npm run service:install`.

## Contrato para adaptadores futuros

Los adaptadores de Milestone y OnGuard deberán implementar el mismo contrato utilizado por `SimulatedAdapter`:

```js
class PhysicalSecurityAdapter {
  capabilities() {}
  async listDevices() {}
  async execute(command) {}
}
```

El inventario normalizado utiliza identificadores externos estables. La clave de deduplicación se construye con:

```text
GatewayID + SourceSystem + ExternalID
```

Renombrar un dispositivo no crea otro registro.

## Seguridad

- El token no se guarda en el repositorio ni en Google Sheets en texto plano.
- El backend almacena un hash `scrypt` con sal aleatoria.
- El archivo `.env` queda limitado al usuario instalador, `SYSTEM` y administradores.
- El instalador descarga WinSW desde su repositorio oficial y valida su SHA-256.
- Los metadatos eliminan campos con nombres como `password`, `token`, `secret` o `credential`.
- El agente solo puede operar sobre su propio `GatewayID`.
- Los comandos permitidos actualmente son `PING` e `INVENTORY_SYNC`.
- Cada comando usa una clave de idempotencia y puede reentregarse sin crear otro comando pendiente.
- No se transmiten video, contraseñas, RTSP ni credenciales de cámaras.

## Próximas fases

- `MilestoneInventoryAdapter`.
- `OnGuardInventoryAdapter`.
- Estado de dispositivos en tiempo real.
- Capturas protegidas bajo demanda.
- Relación entre dispositivos importados y dispositivos de mantenimientos.
