# DMS Boletas

Aplicación React + Vite conectada al backend de Google Apps Script.

## Funciones conservadas

- Login con usuario o correo y contraseña.
- Sesión persistente en el navegador.
- Cierre de sesión.
- Cambio obligatorio de contraseña temporal.
- Página de inicio con información del usuario.
- Lista, búsqueda, creación, detalle y edición de usuarios.
- Eliminación lógica de usuarios mediante estado INACTIVO.
- Protección de rutas mediante permisos del backend.

## Estructura

- `src/app`: configuración principal y rutas.
- `src/components`: componentes reutilizables y navegación.
- `src/context`: autenticación y sesión.
- `src/hooks`: hooks compartidos.
- `src/pages`: pantallas de la aplicación.
- `src/routes`: protección por sesión y permisos.
- `src/styles`: sistema visual y estilos responsivos.

## Ejecutar

```bash
npm install
npm run dev
```

## Compilar

```bash
npm run build
```

La URL del Web App se mantiene en `src/api.js` y las rutas existentes del backend no fueron modificadas.
