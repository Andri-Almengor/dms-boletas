# Acceso operativo para técnicos e invitaciones por correo

Esta mejora permite que los técnicos:

- Vean a todos los usuarios activos en **Asignado a** de las boletas.
- Vean a todos los responsables activos en los mantenimientos.
- Consulten los catálogos necesarios para completar los formularios.
- Agreguen categorías, tipos de dispositivo, fabricantes y modelos desde el flujo operativo sin obtener acceso a la administración completa.

También permite enviar por correo la contraseña temporal cuando un administrador crea un usuario.

## 1. Copiar el archivo al backend

Copie al proyecto de Google Apps Script:

```text
apps-script/OperationalAccessAndInvites.gs
```

## 2. Registrar las rutas operativas

Agregue dentro del objeto `ROUTES` de `Code.gs`:

```javascript
'users.assignment.list': {
  handler: apiAssignableUsersList_,
  permission: 'BOLETAS_CREAR'
},

'catalog.operational.categories.list': {
  handler: apiCategoriesList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.categories.create': {
  handler: apiCategoriesCreate_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.failureTypes.list': {
  handler: apiFailureTypesList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.deviceTypes.list': {
  handler: apiDeviceTypesList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.manufacturers.list': {
  handler: apiManufacturersList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.models.list': {
  handler: apiModelsList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.deviceManufacturers.list': {
  handler: apiDeviceManufacturersList_,
  permission: 'BOLETAS_CREAR'
},
'catalog.operational.deviceManufacturers.create': {
  handler: apiDeviceManufacturersCreate_,
  permission: 'BOLETAS_CREAR'
},
```

Las dos últimas rutas deben reutilizar los mismos handlers que ya utiliza el backend para `catalog.deviceManufacturers.list` y `catalog.deviceManufacturers.create`. Si esos handlers tienen otro nombre en su proyecto, use los nombres existentes.

Estas rutas no permiten entrar a la pantalla administrativa de usuarios o catálogos. Solamente exponen los datos y altas necesarias dentro de boletas y mantenimientos.

## 3. Enviar credenciales al crear un usuario

Dentro de `apiUsersCreate_`, después de guardar y auditar el usuario, agregue:

```javascript
const invitationEmail = sendNewUserCredentialsEmail_(
  row,
  temporaryPassword,
  ctx.user.UsuarioID
);
```

Cambie el retorno de la función por:

```javascript
return {
  user: sanitizeUser_(row),
  temporaryPassword,
  invitationEmail
};
```

El usuario seguirá obligado a cambiar la contraseña temporal cuando inicie sesión.

## 4. Agregar el enlace después

Por ahora no es necesario configurar el enlace. El correo indicará que el administrador lo compartirá posteriormente.

Cuando la página esté publicada con su URL definitiva, ejecute una sola vez:

```javascript
setDmsAppUrl('https://URL-DE-LA-APLICACION');
```

Para verificar el valor guardado:

```javascript
getDmsAppUrl();
```

## 5. Publicar

1. Guarde todos los archivos de Apps Script.
2. Entre a **Implementar → Administrar implementaciones**.
3. Edite la implementación actual.
4. Seleccione **Nueva versión**.
5. Publique sin cambiar la URL usada por React.

## Seguridad

- La lista operativa devuelve usuarios saneados y nunca devuelve hashes, salts ni contraseñas.
- La contraseña temporal se envía solamente al correo registrado del nuevo usuario.
- La contraseña no se guarda en texto plano en una tabla adicional.
- El usuario debe cambiarla en su primer acceso.
