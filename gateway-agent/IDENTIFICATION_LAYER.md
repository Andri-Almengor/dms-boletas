# Segunda capa de identificación de cámaras

Después del descubrimiento básico por IP/puertos, el adaptador `NETWORK_DISCOVERY` ejecuta una segunda capa opcional de identificación sin credenciales.

## Objetivo

Convertir entradas genéricas como:

```text
Cámara detectada 192.168.100.204
Puertos 80, 443, 554
Confianza MEDIUM
```

en información técnica más útil cuando el propio dispositivo la expone:

```text
AXIS P3265-LV
192.168.100.204
AC:CC:8E:12:34:56
Firmware 12.1.3
ONVIF confirmado
Confianza HIGH
```

## Métodos utilizados

1. Se conserva la primera capa: puertos TCP, HTTP/HTTPS, RTSP, ARP y WS-Discovery multicast.
2. Para cada candidato ya clasificado como posible cámara se intenta además un `Probe` ONVIF unicast a UDP 3702. Esto puede funcionar en algunas redes enrutadas donde el multicast no cruza la VLAN.
3. Si existe un endpoint ONVIF conocido o los puertos 80/443 están disponibles, se prueba el servicio estándar `/onvif/device_service` con operaciones exclusivamente de lectura:
   - `GetDeviceInformation`
   - `GetNetworkInterfaces`
4. Si ONVIF no entrega fabricante/modelo sin autenticación, se analiza únicamente la información pública de HTTP/HTTPS y RTSP para buscar huellas de fabricantes conocidos.

## Datos que puede recuperar

Dependiendo de la cámara y de su política de autenticación:

- fabricante;
- modelo;
- versión de firmware;
- número de serie;
- Hardware ID;
- MAC mediante ONVIF, incluso cuando ARP no puede verla a través de una VLAN;
- UUID/nombre/hardware/ubicación publicados por ONVIF Discovery;
- evidencia usada para elevar la confianza de identificación.

## Seguridad

La segunda capa no prueba usuarios ni contraseñas, no usa credenciales por defecto, no realiza fuerza bruta, no cambia la configuración del dispositivo, no reinicia equipos y no solicita video. Las únicas operaciones SOAP implementadas son consultas de lectura.

Las URLs anunciadas por una cámara mediante ONVIF se aceptan solo cuando apuntan a la misma IP que ya estaba dentro de `DMS_NETWORK_TARGETS`; de esta forma una respuesta manipulada no puede convertir al agente en un proxy hacia otra dirección.

Los certificados HTTPS autofirmados se aceptan únicamente para estas conexiones locales de descubrimiento. La conexión del Gateway hacia Render continúa usando HTTPS normal y no se modifica.

## Limitaciones

Muchas cámaras requieren autenticación incluso para `GetDeviceInformation` y `GetNetworkInterfaces`. En ese caso el agente puede registrar que existe un endpoint protegido, pero no inventa fabricante, modelo, MAC, firmware o serie.

ONVIF unicast es un mecanismo oportunista y no sustituye WS-Discovery multicast. Algunos fabricantes responden y otros solo responden al multicast de su propia VLAN.

## Configuración

```env
DMS_NETWORK_IDENTIFICATION_ENABLED=true
DMS_NETWORK_ONVIF_UNICAST_ENABLED=true
DMS_NETWORK_IDENTIFICATION_TIMEOUT_MS=1200
DMS_NETWORK_ONVIF_UNICAST_TIMEOUT_MS=700
DMS_NETWORK_IDENTIFICATION_CONCURRENCY=12
```

Para desactivar temporalmente la segunda capa sin perder el descubrimiento básico:

```env
DMS_NETWORK_IDENTIFICATION_ENABLED=false
```

La identificación se ejecuta únicamente sobre los candidatos que la primera capa ya encontró; no amplía el rango configurado ni explora direcciones adicionales.
