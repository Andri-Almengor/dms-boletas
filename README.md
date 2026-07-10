# DMS Boletas

Primera versión funcional en React + Vite conectada al backend de Google Apps Script.

## Funciones incluidas

- Login con usuario o correo y contraseña.
- Sesión persistente en el navegador.
- Cierre de sesión.
- Cambio obligatorio de contraseña temporal.
- Página Home con nombre y rol.
- Lista y búsqueda de usuarios.
- Creación de usuarios con contraseña temporal generada por el backend.
- Detalle del usuario y permisos efectivos.
- Edición de nombre, usuario, correo, rol y estado.
- Eliminación lógica mediante estado INACTIVO.
- Protección de rutas mediante permisos del backend.

## Ejecutar

```bash
npm install
npm run dev
```

## Compilar

```bash
npm run build
```

## Backend

La URL del Web App está configurada en `src/api.js`.

Las solicitudes se envían como `text/plain;charset=utf-8` para evitar el preflight OPTIONS que Google Apps Script no procesa como una API tradicional.

## Prueba inicial

Use el usuario administrador y la contraseña temporal configurados durante la instalación del backend. En el primer acceso se solicitará cambiar la contraseña.
