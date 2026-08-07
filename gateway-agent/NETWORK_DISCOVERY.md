# Descubrimiento de cámaras por red local

Esta modalidad permite que **DMS Integration Gateway** detecte posibles cámaras IP directamente desde la red privada donde está instalado el agente, sin requerir Milestone ni OnGuard.

## Alcance de esta etapa

El agente usa únicamente descubrimiento e información técnica disponible sin credenciales:

- ONVIF WS-Discovery por UDP 3702.
- Comprobación TCP limitada a los puertos configurados, por defecto `80,443,554`.
- Lectura de la página web raíz para identificar título y encabezado `Server`.
- `RTSP OPTIONS` sin autenticación para identificar servicios de video.
- Tabla ARP/vecinos del sistema operativo para obtener MAC cuando está disponible.

El agente **no**:

- intenta contraseñas predeterminadas;
- realiza fuerza bruta;
- inicia sesión en cámaras;
- abre RTSP autenticado;
- cambia configuración de dispositivos;
- explora direcciones públicas;
- abre puertos entrantes en la institución.

## Información que puede obtener

Dependiendo del dispositivo y su configuración puede obtener:

- dirección IP;
- dirección MAC;
- UUID ONVIF;
- nombre publicado por ONVIF;
- fabricante inferido;
- modelo o hardware publicado por ONVIF;
- ubicación ONVIF;
- puertos detectados;
- servidor HTTP;
- servidor RTSP;
- métodos de detección;
- nivel de confianza de la clasificación.

No todas las cámaras publican todos esos datos sin autenticación. El nombre detectado se conserva como dato técnico y en DMS-Boletas se puede definir un **Nombre operativo** independiente.

## Identidad y deduplicación

El agente prioriza identificadores estables en este orden:

1. UUID ONVIF.
2. Dirección MAC.
3. Dirección IP como último recurso.

La identidad final sigue usando:

```text
GatewayID + SourceSystem + ExternalID
```

Por eso renombrar una cámara en DMS-Boletas no crea otro dispositivo.

## Seguridad del rango explorado

Por defecto el agente detecta las interfaces IPv4 privadas del equipo. Solo se admiten redes RFC1918:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

Cada rango explorado está limitado a prefijos `/24` a `/30`. Si la interfaz local pertenece a una red más grande, el modo automático limita la exploración al `/24` donde está el agente.

Para explorar varios segmentos autorizados, enumere varios `/24` explícitos:

```env
DMS_NETWORK_CIDRS=192.168.10.0/24,192.168.11.0/24
```

No configure redes sobre las que no tenga autorización administrativa.

## Configuración recomendada

```env
DMS_GATEWAY_ADAPTER=network
DMS_NETWORK_CIDRS=
DMS_NETWORK_SCAN_PORTS=80,443,554
DMS_NETWORK_PROBE_TIMEOUT_MS=600
DMS_NETWORK_ONVIF_TIMEOUT_MS=1500
DMS_NETWORK_SCAN_CONCURRENCY=48
DMS_NETWORK_MAX_HOSTS=1024
DMS_GATEWAY_INVENTORY_SYNC_MS=600000
```

Si `DMS_NETWORK_CIDRS` queda vacío, se detectan automáticamente las redes privadas del equipo.

## Primera prueba sin enviar datos a Render

Detenga temporalmente el servicio:

```bat
npm run service:stop
```

Cambie en `.env`:

```env
DMS_GATEWAY_ADAPTER=network
```

Luego ejecute:

```bat
npm run config:check
npm run source:check
```

`source:check` explora la red local y muestra cuántos posibles dispositivos de video detectó, pero no sincroniza el inventario con Render.

## Activar en producción

Cuando la prueba local sea correcta:

```bat
npm run service:start
npm run service:status
npm run service:logs
```

El servicio realiza una exploración al iniciar. En modo `NETWORK_DISCOVERY` repite la sincronización cada 10 minutos por defecto. El intervalo puede cambiarse con `DMS_GATEWAY_INVENTORY_SYNC_MS` y nunca puede ser menor a 60 segundos.

También se puede solicitar una exploración inmediata desde DMS-Boletas con **Sincronizar inventario**.

## Estados

- `ONLINE`: el dispositivo respondió durante la última exploración.
- `NO DETECTADO`: existía en el inventario, pero no apareció en la última sincronización.

`ONLINE` representa la última exploración, no una transmisión de video permanente.

## Nombre editable

En **Más → Gateways de integración → Dispositivos detectados**, el administrador puede pulsar el botón de edición y establecer un **Nombre operativo**.

Ejemplo:

```text
Nombre detectado: AXIS P3265-LV
Nombre operativo: Cámara Entrada Principal
```

Las siguientes sincronizaciones actualizan IP, MAC, modelo y estado detectado, pero conservan el nombre operativo.

Guardar el campo vacío vuelve a utilizar el nombre detectado automáticamente.

## Limitaciones conocidas

- Una cámara con ONVIF deshabilitado, RTSP en un puerto no incluido y una interfaz web sin identificadores puede no ser clasificada como cámara.
- La MAC puede no estar disponible si el dispositivo está en otra VLAN o si el sistema operativo no la expone en su tabla vecina.
- Si no existe UUID ONVIF ni MAC y la IP cambia, la identidad basada en IP puede crear una nueva entrada.
- El escaneo no atraviesa routers o VLANs a menos que el equipo del gateway tenga ruta hacia ellas y se configuren explícitamente los CIDR autorizados.
- Esta etapa no obtiene snapshots, video en vivo ni información que requiera credenciales.

Las integraciones Milestone, OnGuard y ONVIF autenticado pueden agregarse posteriormente sin cambiar el contrato de inventario del gateway.
