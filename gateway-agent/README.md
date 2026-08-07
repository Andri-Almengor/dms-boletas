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

## Preparación

1. Desde DMS-Boletas, un administrador crea un gateway.
2. La aplicación muestra un `GatewayID` y un token una sola vez.
3. En el equipo local, defina las variables de `.env.example` en el entorno del sistema o servicio.
4. Ejecute:

```bash
npm start
```

Node.js no carga archivos `.env` automáticamente. En producción configure las variables desde el servicio de Windows, systemd, Docker o el administrador de procesos elegido.

## Variables

- `DMS_GATEWAY_URL`: URL pública de Render, sin `/api/action`.
- `DMS_GATEWAY_ID`: identificador entregado por DMS-Boletas.
- `DMS_GATEWAY_TOKEN`: token mostrado una sola vez al provisionar.
- `DMS_GATEWAY_NAME`: nombre descriptivo de la sede.
- `DMS_GATEWAY_ADAPTER`: por ahora solamente `simulated`.
- `DMS_GATEWAY_HEARTBEAT_MS`: intervalo de heartbeat, mínimo 10 segundos.
- `DMS_GATEWAY_POLL_MS`: intervalo para consultar comandos, mínimo 5 segundos.
- `DMS_SIMULATED_DEVICE_COUNT`: entre 1 y 25 cámaras virtuales.

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
