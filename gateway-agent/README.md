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

6. Inicie el agente:

```bat
npm start
```

Desde la versión 0.1.0 el agente carga automáticamente `gateway-agent/.env` mediante la función nativa de Node.js. Las variables definidas directamente por Windows o por un servicio siguen teniendo prioridad sobre el archivo local.

El archivo `.env` está excluido de Git y no debe compartirse ni subirse al repositorio.

## Ejecución como servicio

En producción las mismas variables pueden configurarse desde un servicio de Windows, systemd, Docker o el administrador de procesos elegido. El archivo `.env` es opcional cuando todas las variables ya existen en el entorno del proceso.

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

Si falta una variable, el agente ahora muestra cuál valor debe completarse y la ubicación exacta esperada del archivo `.env`. Una URL de Render válida debe comenzar con `https://`.

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
- Instalador y ejecución como servicio de Windows.
