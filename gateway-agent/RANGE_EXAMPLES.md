# Ejemplos rápidos de rangos

El agente acepta objetivos exactos en `DMS_NETWORK_TARGETS`.

```env
# Subred completa
DMS_NETWORK_TARGETS=192.168.4.0/24

# Solo del 100 al 200
DMS_NETWORK_TARGETS=192.168.4.100-200

# Atajo equivalente solicitado
DMS_NETWORK_TARGETS=192.168.4.100/200

# Varias redes/rangos
DMS_NETWORK_TARGETS=192.168.4.100/200,192.168.96.10-80,10.20.120.0/24

# IP individual
DMS_NETWORK_TARGETS=192.168.96.12
```

Las direcciones no RFC1918, por ejemplo `201.1.2.10` o `192.68.4.0/24`, requieren habilitación local explícita:

```env
DMS_NETWORK_ALLOW_PUBLIC_TARGETS=true
DMS_NETWORK_TARGETS=201.1.2.10
```

Use destinos públicos únicamente cuando pertenezcan a infraestructura administrada/autorizada del cliente.
