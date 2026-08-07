# DMS Integration Gateway Agent

Agente local para conectar redes privadas con DMS-Boletas en Render mediante solicitudes HTTPS salientes. El agente mantiene la autenticación con Render, heartbeat, inventario, comandos e idempotencia sin publicar cámaras, NVR ni sistemas internos.

Actualmente admite dos fuentes:

- `simulated`: cámaras virtuales para pruebas.
- `milestone`: inventario de cámaras desde Milestone XProtect mediante el API Gateway REST.

La integración de Milestone de esta etapa es **solo de inventario/configuración**. Todavía no consulta video en vivo, snapshots ni estado de transmisión en tiempo real.

## Arquitectura

```text
DMS-Boletas en Render
        ▲
        │ HTTPS saliente autenticado
        │
DMS Integration Gateway Agent
        │
        ├── SimulatedAdapter
        └── MilestoneAdapter
                │
                └── XProtect API Gateway / REST Configuration API
```

El agente nunca abre un puerto entrante en la institución. Todas las solicitudes hacia Render se originan desde el equipo local.

## Preparación local en Windows

1. Desde DMS-Boletas, un administrador crea un gateway.
2. La aplicación muestra un `GatewayID` y un token una sola vez.
3. Abra CMD dentro de `gateway-agent`.
4. Cree el archivo local de configuración:

```bat
copy .env.example .env
notepad .env
```

5. Reemplace los datos del gateway:

```env
DMS_GATEWAY_URL=https://su-servicio.onrender.com
DMS_GATEWAY_ID=gateway-entregado-por-la-aplicacion
DMS_GATEWAY_TOKEN=token-mostrado-una-sola-vez
```

6. Valide la configuración sin conectarse:

```bat
npm run config:check
```

7. Para una prueba manual:

```bat
npm start
```

El agente carga automáticamente `gateway-agent/.env`. Las variables definidas directamente por Windows o por un servicio tienen prioridad sobre el archivo local.

El archivo `.env` está excluido de Git y no debe compartirse ni subirse al repositorio.

## Adaptador Milestone XProtect

### Qué hace esta etapa

El adaptador utiliza el API Gateway de XProtect y la REST Configuration API para:

- validar que el API Gateway esté disponible;
- autenticarse con un usuario Basic de XProtect;
- obtener cámaras configuradas, incluidas las deshabilitadas;
- obtener hardware relacionado;
- obtener recording servers;
- conservar el GUID de la cámara como identificador externo estable;
- importar nombre, IP detectada desde el hardware, modelo y relaciones técnicas disponibles;
- sincronizar el inventario hacia DMS-Boletas sin duplicar cámaras por cambio de nombre.

Una cámara importada y habilitada se registra inicialmente como `CONFIGURED`, no como `ONLINE`. `CONFIGURED` significa que la cámara existe en la configuración de XProtect; **no confirma que esté transmitiendo video en ese momento**. El estado real se incorporará posteriormente mediante las APIs de estado/eventos de Milestone.

### Requisitos de Milestone

- XProtect con API Gateway disponible.
- Acceso desde la computadora del agente hacia el servidor/API Gateway de XProtect.
- Un usuario Basic de XProtect dedicado a la integración.
- Permisos de lectura únicamente sobre los objetos necesarios siempre que la instalación lo permita.
- HTTPS recomendado para producción.

Puede verificar manualmente que el API Gateway exista abriendo desde la computadora del agente:

```text
https://SERVIDOR-MILESTONE/api/.well-known/uris
```

### Configuración

Cambie el adaptador en `.env`:

```env
DMS_GATEWAY_ADAPTER=milestone
DMS_MILESTONE_URL=https://SERVIDOR-MILESTONE
DMS_MILESTONE_USERNAME=dms-inventory
DMS_MILESTONE_PASSWORD=contraseña-del-usuario-basic
DMS_MILESTONE_TIMEOUT_MS=15000
DMS_MILESTONE_PAGE_SIZE=100
DMS_MILESTONE_MAX_DEVICES=2500
```

El usuario y contraseña permanecen únicamente en el equipo local. No se envían a Render, Google Sheets ni al navegador.

### Certificados HTTPS

La opción preferida es que XProtect utilice un certificado confiable. Si la institución utiliza una CA privada, puede indicar el certificado CA en formato PEM:

```env
DMS_MILESTONE_CA_FILE=C:\certificados\ca-institucion.pem
```

Para laboratorio solamente, cuando se utilice un certificado autofirmado:

```env
DMS_MILESTONE_ALLOW_INSECURE_TLS=true
```

Para laboratorio también se puede habilitar HTTP explícitamente:

```env
DMS_MILESTONE_ALLOW_HTTP=true
DMS_MILESTONE_URL=http://SERVIDOR-MILESTONE
```

No se recomienda `ALLOW_INSECURE_TLS=true` ni HTTP en producción.

### Validar Milestone sin reiniciar el servicio

Primero revise la sintaxis/configuración local:

```bat
npm run config:check
```

Después pruebe la conexión real al API Gateway y la autenticación:

```bat
npm run source:check
```

Un resultado correcto se parece a:

```text
Fuente MILESTONE accesible · Nombre de la instalación.
```

Después reinicie el agente:

```bat
npm run service:restart
npm run service:status
npm run service:logs
```

Al iniciar debe sincronizar las cámaras encontradas. En DMS-Boletas aparecerán con `SourceSystem=MILESTONE`.

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

```bat
npm run service:install
```

El instalador solicita permisos de administrador y después:

1. valida `.env`;
2. localiza la ruta absoluta de `node.exe`;
3. valida el agente sin conectarse;
4. descarga WinSW 2.12.0 desde el repositorio oficial;
5. verifica el SHA-256 fijado para el ejecutable x64;
6. restringe los permisos de `.env`;
7. instala `DMS Integration Gateway` como servicio;
8. configura inicio automático retrasado;
9. inicia el servicio.

El servicio usa la cuenta local `SYSTEM`, pero solamente realiza conexiones salientes. No publica puertos ni comparte carpetas.

### Administrar el servicio

```bat
npm run service:start
npm run service:stop
npm run service:restart
npm run service:status
npm run service:logs
```

Los logs quedan en:

```text
gateway-agent\logs
```

### Desinstalar

```bat
npm run service:uninstall
```

La desinstalación conserva `.env` y los logs existentes.

### Actualizar el agente

```bat
git pull
npm run config:check
npm run service:restart
```

Si cambió la ubicación de la carpeta o la instalación de Node.js, vuelva a ejecutar `npm run service:install`.

## Variables comunes

- `DMS_GATEWAY_URL`: URL pública de Render, sin `/api/action` ni `/api/integration-gateway`.
- `DMS_GATEWAY_ID`: identificador entregado por DMS-Boletas.
- `DMS_GATEWAY_TOKEN`: token mostrado una sola vez al provisionar.
- `DMS_GATEWAY_NAME`: nombre descriptivo de la sede.
- `DMS_GATEWAY_ADAPTER`: `simulated` o `milestone`.
- `DMS_GATEWAY_HEARTBEAT_MS`: intervalo de heartbeat, mínimo 10 segundos.
- `DMS_GATEWAY_POLL_MS`: intervalo para consultar comandos, mínimo 5 segundos.
- `DMS_SIMULATED_DEVICE_COUNT`: entre 1 y 25 cámaras virtuales.

## Variables Milestone

- `DMS_MILESTONE_URL`: URL base del API Gateway/Management Server.
- `DMS_MILESTONE_USERNAME`: usuario Basic dedicado.
- `DMS_MILESTONE_PASSWORD`: contraseña local del usuario Basic.
- `DMS_MILESTONE_TIMEOUT_MS`: timeout de solicitudes, por defecto 15 s.
- `DMS_MILESTONE_PAGE_SIZE`: tamaño de página, por defecto 100.
- `DMS_MILESTONE_MAX_DEVICES`: máximo de cámaras por sincronización, hasta 2500.
- `DMS_MILESTONE_CA_FILE`: CA privada PEM opcional.
- `DMS_MILESTONE_ALLOW_INSECURE_TLS`: desactiva validación TLS; solo laboratorio.
- `DMS_MILESTONE_ALLOW_HTTP`: permite HTTP; solo laboratorio.

## Deduplicación

El inventario normalizado utiliza identificadores externos estables:

```text
GatewayID + SourceSystem + ExternalID
```

En Milestone, `ExternalID` es el GUID real de la cámara. Renombrar una cámara en XProtect no crea un dispositivo nuevo en DMS-Boletas.

## Seguridad

- El token del gateway no se guarda en Google Sheets en texto plano.
- El backend almacena un hash `scrypt` con sal aleatoria.
- `.env` queda limitado al usuario instalador, `SYSTEM` y administradores.
- Las credenciales de Milestone permanecen en la red local.
- Los resultados enviados a Render no incluyen usuario, contraseña ni bearer token de XProtect.
- El adaptador no envía la respuesta completa del hardware; solo campos explícitamente permitidos.
- Direcciones de hardware se reducen al origen para no propagar credenciales embebidas en URLs.
- No se transmiten video, RTSP ni contraseñas de cámaras.
- Los comandos permitidos siguen siendo `PING` e `INVENTORY_SYNC`.

## Próximas fases

- Estado real de cámaras mediante Event and State API.
- Capturas protegidas bajo demanda.
- Relación entre cámaras importadas y dispositivos de mantenimientos.
- `OnGuardInventoryAdapter` para paneles, lectores y puertas.
