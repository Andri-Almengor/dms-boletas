# Gestor de contraseñas de clientes

## Seguridad

Las contraseñas se cifran en el backend con AES-256-GCM antes de escribirse en Google Sheets. Cada credencial utiliza un IV aleatorio de 12 bytes y una etiqueta de autenticación. El identificador de la credencial, el cliente y la categoría se incluyen como datos autenticados, por lo que una fila no puede moverse a otro cliente o categoría sin volver a cifrarse.

Google Sheets almacena únicamente:

- `PasswordCiphertext`
- `PasswordIV`
- `PasswordTag`
- `PasswordVersion`

La contraseña en texto plano no se escribe en la hoja, en Auditoría ni en los logs del backend.

## Variable obligatoria en Render

Antes de crear la primera credencial, genere una llave de 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

En Render, agregue la variable secreta:

```text
PASSWORD_VAULT_ENCRYPTION_KEY=<resultado del comando>
```

Después reinicie el servicio.

## Advertencia sobre la llave

No cambie ni elimine la llave después de guardar credenciales. Si se pierde, las contraseñas existentes no podrán recuperarse. Una rotación futura debe descifrar cada registro con la llave anterior y volver a cifrarlo con la nueva dentro de una migración controlada.

La llave no debe guardarse en:

- GitHub;
- Google Sheets;
- Apps Script;
- archivos adjuntos;
- capturas de pantalla;
- mensajes del asistente.

## Permisos

- Administradores con `USUARIOS_GESTIONAR`: crean, editan y eliminan categorías y credenciales.
- Técnicos con permisos operativos autorizados: buscan, visualizan, revelan y copian credenciales, sin capacidad de modificación.
- Cada revelado y cada consulta de credenciales desde el asistente queda registrado en Auditoría.

## Comportamiento del asistente

Las consultas de credenciales se resuelven directamente en el backend. Las contraseñas no se envían a Gemini. Las respuestas sensibles no se guardan en `localStorage` y aparecen ocultas hasta que el usuario las revela.

Ejemplos:

- `Dame las credenciales de cámaras de Asamblea.`
- `Lista de usuarios y contraseñas de los sistemas de AFZ.`
- `Muéstrame las credenciales de control de acceso de BCR.`

Por seguridad, el asistente exige identificar un cliente y no entrega un listado global de contraseñas de todos los clientes.

## Hojas creadas automáticamente

La primera apertura del módulo crea, si no existen:

- `CategoriasCredenciales`
- `CredencialesClientes`

No es necesario crear manualmente las columnas.
