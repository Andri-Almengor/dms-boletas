# Descubrimiento de cámaras por red local

Esta modalidad permite que **DMS Integration Gateway** detecte posibles cámaras IP directamente desde las redes a las que el equipo del gateway tenga acceso, sin requerir Milestone ni OnGuard.

## Alcance de esta etapa

El agente usa únicamente descubrimiento e información técnica disponible sin credenciales:

- ONVIF WS-Discovery por UDP 3702 en la red local donde el multicast sea visible.
- Comprobación TCP limitada a los puertos configurados, por defecto `80,443,554`.
- Lectura de la página web raíz para identificar título y encabezado `Server`.
- `RTSP OPTIONS` sin autenticación para identificar servicios de video.
- Tabla ARP/vecinos del sistema operativo para obtener MAC cuando está disponible.

El agente no intenta contraseñas predeterminadas, no realiza fuerza bruta, no inicia sesión, no modifica dispositivos y no abre puertos entrantes.

## Objetivos configurables

`DMS_NETWORK_TARGETS` permite controlar exactamente qué direcciones se revisan. Puede combinar varios objetivos separados por coma, punto y coma o salto de línea.

Formatos admitidos:

```text
192.168.4.0/24
192.168.4.100-192.168.4.200
192.168.4.100-200
192.168.4.100/200
192.168.96.12
```

Significado:

- `192.168.4.0/24`: revisa los hosts utilizables de la subred.
- `192.168.4.100-192.168.4.200`: revisa únicamente ese rango exacto.
- `192.168.4.100-200`: atajo para el mismo rango dentro del mismo bloque IPv4.
- `192.168.4.100/200`: atajo adicional equivalente, pensado para facilitar la configuración operativa.
- `192.168.96.12`: revisa una sola IP.

Ejemplo con varias VLAN/redes enrutadas:

```env
DMS_NETWORK_TARGETS=192.168.4.100/200,192.168.96.1-80,10.20.120.0/24
```

El número de VLAN se puede documentar en DMS-Boletas, pero la VLAN por sí sola no da conectividad. El equipo donde corre el gateway debe tener una ruta válida hacia cada red objetivo.

## Redes públicas o direccionamiento no RFC1918

Por defecto el agente solo permite objetivos privados RFC1918:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

Una dirección como `201.1.2.10` o una red como `192.68.4.0/24` no pertenece a RFC1918. Si realmente forma parte de infraestructura administrada por el cliente y existe autorización para consultarla, debe habilitarse localmente:

```env
DMS_NETWORK_ALLOW_PUBLIC_TARGETS=true
```

Después puede configurarse de forma explícita:

```env
DMS_NETWORK_TARGETS=201.1.2.10
```

Los objetivos públicos nunca se detectan automáticamente, cada objetivo público está limitado a 256 direcciones y el total sigue sujeto a `DMS_NETWORK_MAX_HOSTS`.

## Modo automático

Si `DMS_NETWORK_TARGETS` y `DMS_NETWORK_CIDRS` están vacíos, el agente detecta las interfaces IPv4 privadas del equipo y utiliza un `/24` por interfaz. Esto es útil para una instalación inicial, pero para clientes con varias VLAN o rangos estáticos se recomienda configurar `DMS_NETWORK_TARGETS` explícitamente.

`DMS_NETWORK_CIDRS` se conserva únicamente por compatibilidad con la primera versión del agente.

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
- método y nivel de confianza del descubrimiento;
- objetivo/rango mediante el cual fue encontrado.

No todas las cámaras publican todos esos datos sin autenticación. El nombre detectado se conserva como dato técnico y en DMS-Boletas se puede definir un **Nombre operativo** independiente.

## Identidad y deduplicación

El agente prioriza identificadores estables en este orden:

1. UUID ONVIF.
2. Dirección MAC.
3. Dirección IP como último recurso.

La identidad final continúa usando:

```text
GatewayID + SourceSystem + ExternalID
```

Por eso renombrar una cámara en DMS-Boletas no crea otro dispositivo.

## Configuración recomendada

```env
DMS_GATEWAY_ADAPTER=network
DMS_NETWORK_TARGETS=192.168.4.100/200,192.168.96.0/24
DMS_NETWORK_CIDRS=
DMS_NETWORK_SCAN_PORTS=80,443,554
DMS_NETWORK_PROBE_TIMEOUT_MS=600
DMS_NETWORK_ONVIF_TIMEOUT_MS=1500
DMS_NETWORK_SCAN_CONCURRENCY=48
DMS_NETWORK_MAX_HOSTS=1024
DMS_NETWORK_ALLOW_PUBLIC_TARGETS=false
DMS_GATEWAY_INVENTORY_SYNC_MS=600000
```

`DMS_NETWORK_MAX_HOSTS` limita la cantidad total de direcciones que se revisan aunque se configuren varios rangos.

## Primera prueba sin enviar datos a Render

Detenga temporalmente el servicio:

```bat
npm run service:stop
```

Cambie en `.env`:

```env
DMS_GATEWAY_ADAPTER=network
DMS_NETWORK_TARGETS=192.168.4.100/200,192.168.96.0/24
```

Luego ejecute:

```bat
npm run config:check
npm run source:check
```

`source:check` explora únicamente los objetivos configurados y muestra cuántos posibles dispositivos de video detectó, pero no sincroniza el inventario con Render.

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

## VLAN y rutas

Ejemplo:

```text
VLAN 4   -> 192.168.4.0/24
VLAN 96  -> 192.168.96.0/24
VLAN 120 -> 10.20.120.0/24
```

El gateway puede revisar todas si Windows tiene conectividad/enrutamiento hacia ellas. ONVIF WS-Discovery usa multicast y normalmente no cruza routers o VLAN, por lo que en una VLAN remota puede haber menos metadatos ONVIF aunque la cámara siga siendo detectable por IP, HTTP, HTTPS o RTSP.

## Limitaciones conocidas

- Una cámara con ONVIF deshabilitado, RTSP en un puerto no incluido y una interfaz web sin identificadores puede no ser clasificada como cámara.
- La MAC puede no estar disponible si el dispositivo está en otra VLAN o si el sistema operativo no la expone en su tabla vecina.
- Si no existe UUID ONVIF ni MAC y la IP cambia, la identidad basada en IP puede crear una nueva entrada.
- El escaneo no atraviesa routers o VLAN a menos que el equipo del gateway tenga ruta hacia ellas.
- Esta etapa no obtiene snapshots, video en vivo ni información que requiera credenciales.

Las integraciones Milestone, OnGuard y ONVIF autenticado pueden agregarse posteriormente sin cambiar el contrato de inventario del gateway.
