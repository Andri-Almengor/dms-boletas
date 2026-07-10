# Cambios requeridos en Apps Script para altas desde boletas

El formulario React permite crear ubicaciones, ubicaciones de equipo, supervisores, tipos de dispositivo, fabricantes y modelos sin salir de la boleta.

Para que un técnico pueda utilizar estas opciones, cambie estas rutas dentro de `ROUTES` en el backend de Apps Script.

## Usuarios asignables

Cambiar:

```javascript
'users.list': { handler: apiUsersList_, permission: 'USUARIOS_VER' },
```

por:

```javascript
'users.list': { handler: apiUsersList_, permission: 'BOLETAS_VER' },
```

La respuesta ya utiliza `sanitizeUser_`, por lo que no expone hash ni salt.

## Datos operativos del cliente

Cambiar:

```javascript
'clientLocations.create': { handler: apiClientLocationsCreate_, permission: 'CLIENTES_CREAR' },
'equipmentLocations.create': { handler: apiEquipmentLocationsCreate_, permission: 'CLIENTES_CREAR' },
'contacts.create': { handler: apiContactsCreate_, permission: 'CLIENTES_CREAR' },
```

por:

```javascript
'clientLocations.create': { handler: apiClientLocationsCreate_, permission: 'BOLETAS_CREAR' },
'equipmentLocations.create': { handler: apiEquipmentLocationsCreate_, permission: 'BOLETAS_CREAR' },
'contacts.create': { handler: apiContactsCreate_, permission: 'BOLETAS_CREAR' },
```

Esto no permite editar o eliminar clientes. Solamente permite agregar ubicaciones, ubicaciones de equipo y contactos utilizados en la visita.

## Catálogos desde la boleta

Cambiar:

```javascript
'catalog.deviceTypes.create': { handler: apiDeviceTypesCreate_, permission: 'CATALOGOS_GESTIONAR' },
'catalog.manufacturers.create': { handler: apiManufacturersCreate_, permission: 'CATALOGOS_GESTIONAR' },
'catalog.models.create': { handler: apiModelsCreate_, permission: 'CATALOGOS_GESTIONAR' },
```

por:

```javascript
'catalog.deviceTypes.create': { handler: apiDeviceTypesCreate_, permission: 'BOLETAS_CREAR' },
'catalog.manufacturers.create': { handler: apiManufacturersCreate_, permission: 'BOLETAS_CREAR' },
'catalog.models.create': { handler: apiModelsCreate_, permission: 'BOLETAS_CREAR' },
```

El modelo se guarda con:

```text
TipoDispositivoID + FabricanteID + Nombre
```

Por ejemplo:

```text
Cámara + Axis + 12345
```

## Firma

La firma usa la ruta existente:

```javascript
'boletas.signature.upload': {
  handler: apiSignatureUpload_,
  permission: 'BOLETAS_EDITAR'
},
```

Como los técnicos ya tienen `BOLETAS_EDITAR`, no requiere cambio.

## Publicación

Después de cambiar Apps Script:

1. Guardar el proyecto.
2. Implementar.
3. Administrar implementaciones.
4. Editar la implementación actual.
5. Seleccionar `Nueva versión`.
6. Implementar conservando la misma URL `/exec`.
